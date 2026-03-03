const http = require('http');
const { randomUUID } = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { z } = require('zod');
const { config, getUserWorkspaceRootHost } = require('./config');
const { spawnSiteContainer, listManagedSites, removeManagedSites, sanitizeSlug } = require('./docker');
const { loadUserRegistry, buildUserMap } = require('./users');

const app = express();
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const registry = loadUserRegistry(config.userRegistryPath);
const usersById = buildUserMap(registry);

const fallbackDefaultUserId = registry.users[0].id;
const resolvedDefaultUserId = usersById.has(config.defaultUserId)
  ? config.defaultUserId
  : fallbackDefaultUserId;

const connectedAgents = new Map();
const pendingReplies = new Map();

const runtimeSchema = z.object({
  profile: z.enum(['static', 'node']).default('static'),
  internalPort: z.number().int().min(1).max(65535).optional(),
  startScript: z.string().regex(/^[a-zA-Z0-9:_-]+$/).optional()
});

const messageSchema = z.object({
  userId: z.string().min(1).optional(),
  message: z.string().min(1)
});

const spawnSiteSchema = z.object({
  userId: z.string().min(1),
  projectDir: z.string().min(1),
  subdomain: z.string().min(1),
  runtime: runtimeSchema.optional()
});

function getUserById(userId) {
  return usersById.get(userId) || null;
}

function sendToAgent(userId, payload) {
  const ws = connectedAgents.get(userId);
  if (!ws || ws.readyState !== ws.OPEN) {
    throw new Error(`Agent for user ${userId} is not connected`);
  }

  ws.send(JSON.stringify(payload));
}

function awaitAgentResponse(requestId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingReplies.delete(requestId);
      reject(new Error('Agent response timed out'));
    }, config.maxAgentResponseMs);

    pendingReplies.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        pendingReplies.delete(requestId);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        pendingReplies.delete(requestId);
        reject(error);
      }
    });
  });
}

async function enforceSiteQuota({ user, userId, requestedSubdomain }) {
  const activeSites = await listManagedSites(userId);
  const normalizedSubdomain = sanitizeSlug(requestedSubdomain);
  const userSubdomainLabel = `${userId}:${normalizedSubdomain}`;

  const hasExistingSiteForSubdomain = activeSites.some((site) => {
    return site.labels['platform.user-subdomain'] === userSubdomainLabel;
  });

  if (!hasExistingSiteForSubdomain && activeSites.length >= user.quotas.maxActiveSites) {
    throw new Error(
      `Site quota exceeded for user ${userId}: limit=${user.quotas.maxActiveSites}, active=${activeSites.length}`
    );
  }
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    loadedUsers: Array.from(usersById.keys()),
    defaultUserId: resolvedDefaultUserId,
    connectedAgents: Array.from(connectedAgents.keys()),
    pendingRequests: pendingReplies.size
  });
});

app.get('/api/status', async (req, res) => {
  const userId = String(req.query.userId || resolvedDefaultUserId);
  const user = getUserById(userId);
  if (!user) {
    res.status(404).json({ error: `Unknown user: ${userId}` });
    return;
  }

  const sites = await listManagedSites(userId);

  res.json({
    userId,
    defaultUserId: resolvedDefaultUserId,
    agentConnected: connectedAgents.has(userId),
    activeSites: sites,
    quota: user.quotas
  });
});

app.delete('/api/sites', async (req, res) => {
  const userId = String(req.query.userId || resolvedDefaultUserId);
  const siteId = req.query.siteId ? String(req.query.siteId) : undefined;
  const user = getUserById(userId);
  if (!user) {
    res.status(404).json({ error: `Unknown user: ${userId}` });
    return;
  }

  try {
    const result = await removeManagedSites({ userId, siteId });
    res.json({
      userId,
      siteId: siteId || null,
      removedCount: result.removedCount,
      removed: result.removed
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/messages', async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const userId = parsed.data.userId || resolvedDefaultUserId;
  const user = getUserById(userId);
  if (!user) {
    res.status(404).json({ error: `Unknown user: ${userId}` });
    return;
  }

  const requestId = randomUUID();
  const message = parsed.data.message;
  let agentReplyPromise;

  try {
    agentReplyPromise = awaitAgentResponse(requestId);
    sendToAgent(userId, {
      type: 'user_message',
      requestId,
      userId,
      message
    });
  } catch (error) {
    res.status(503).json({ error: error.message });
    return;
  }

  try {
    const reply = await agentReplyPromise;
    res.json({ requestId, reply });
  } catch (error) {
    res.status(504).json({ requestId, error: error.message });
  }
});

app.post('/internal/spawn-site', async (req, res) => {
  const parsed = spawnSiteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { userId, projectDir, subdomain } = parsed.data;
  const user = getUserById(userId);
  if (!user) {
    res.status(404).json({ error: `Unknown user: ${userId}` });
    return;
  }

  const agentToken = req.headers['x-agent-token'];
  if (agentToken !== user.agentToken) {
    res.status(401).json({ error: 'Invalid agent token for user' });
    return;
  }

  try {
    await enforceSiteQuota({
      user,
      userId,
      requestedSubdomain: subdomain
    });

    const site = await spawnSiteContainer({
      userId,
      projectDir,
      subdomain,
      runtime: parsed.data.runtime,
      workspaceRoot: getUserWorkspaceRootHost(userId),
      sisterNetwork: config.sisterNetwork,
      sisterDomainSuffix: config.sisterDomainSuffix,
      caddySiteScheme: config.caddySiteScheme,
      caddyExternalPort: config.caddyExternalPort
    });

    res.json(site);
  } catch (error) {
    const statusCode = /quota exceeded/i.test(error.message) ? 429 : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

server.on('upgrade', (req, socket, head) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname !== '/agent') {
    socket.destroy();
    return;
  }

  const userId = requestUrl.searchParams.get('userId');
  const token = requestUrl.searchParams.get('token');
  const user = getUserById(userId);

  if (!user || token !== user.agentToken) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = userId;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  connectedAgents.set(ws.userId, ws);

  ws.on('message', (rawData) => {
    let payload;
    try {
      payload = JSON.parse(rawData.toString('utf8'));
    } catch (_error) {
      return;
    }

    if (payload.type === 'agent_response' && payload.requestId) {
      const pending = pendingReplies.get(payload.requestId);
      if (pending) {
        pending.resolve({
          message: payload.message,
          metadata: payload.metadata || null
        });
      }
      return;
    }

    if (payload.type === 'agent_error' && payload.requestId) {
      const pending = pendingReplies.get(payload.requestId);
      if (pending) {
        pending.reject(new Error(payload.error || 'Unknown agent error'));
      }
      return;
    }
  });

  ws.on('close', () => {
    const current = connectedAgents.get(ws.userId);
    if (current === ws) {
      connectedAgents.delete(ws.userId);
    }
  });
});

server.listen(config.port, () => {
  console.log(`[control-plane] listening on ${config.port}`);
  console.log(`[control-plane] loaded users=${Array.from(usersById.keys()).join(', ')}`);
  console.log(`[control-plane] default user=${resolvedDefaultUserId}`);
});
