const http = require('http');
const { randomUUID } = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { z } = require('zod');
const { config, getUserWorkspaceRootHost } = require('./config');
const { spawnSiteContainer, listManagedSites } = require('./docker');

const app = express();
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const connectedAgents = new Map();
const pendingReplies = new Map();

const messageSchema = z.object({
  userId: z.string().min(1),
  message: z.string().min(1)
});

const spawnSiteSchema = z.object({
  userId: z.string().min(1),
  projectDir: z.string().min(1),
  subdomain: z.string().min(1)
});

function isHardCodedUser(userId) {
  return userId === config.hardCodedUserId;
}

function requireAgentToken(req, res, next) {
  if (req.headers['x-agent-token'] !== config.hardCodedUserToken) {
    res.status(401).json({ error: 'Invalid agent token' });
    return;
  }
  next();
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

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    connectedAgents: Array.from(connectedAgents.keys()),
    pendingRequests: pendingReplies.size
  });
});

app.get('/api/status', async (_req, res) => {
  const sites = await listManagedSites(config.hardCodedUserId);

  res.json({
    hardCodedUser: config.hardCodedUserId,
    agentConnected: connectedAgents.has(config.hardCodedUserId),
    activeSites: sites
  });
});

app.post('/api/messages', async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { userId, message } = parsed.data;
  if (!isHardCodedUser(userId)) {
    res.status(404).json({ error: 'Unknown user for MVP' });
    return;
  }

  const requestId = randomUUID();
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

app.post('/internal/spawn-site', requireAgentToken, async (req, res) => {
  const parsed = spawnSiteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { userId, projectDir, subdomain } = parsed.data;

  if (!isHardCodedUser(userId)) {
    res.status(404).json({ error: 'Unknown user for MVP' });
    return;
  }

  try {
    const site = await spawnSiteContainer({
      userId,
      projectDir,
      subdomain,
      workspaceRoot: getUserWorkspaceRootHost(userId),
      sisterNetwork: config.sisterNetwork,
      sisterDomainSuffix: config.sisterDomainSuffix,
      caddyExternalPort: config.caddyExternalPort
    });

    res.json(site);
  } catch (error) {
    res.status(500).json({ error: error.message });
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

  if (!isHardCodedUser(userId) || token !== config.hardCodedUserToken) {
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
  console.log(`[control-plane] hardcoded user=${config.hardCodedUserId}`);
});
