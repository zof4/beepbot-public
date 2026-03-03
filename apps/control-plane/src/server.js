const http = require('http');
const { randomUUID } = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { z } = require('zod');
const { config, getUserWorkspaceRootHost, getUserOauthDir } = require('./config');
const { spawnSiteContainer, listManagedSites, removeManagedSites, sanitizeSlug } = require('./docker');
const { loadUserRegistry, buildUserMap, buildUserTokenMap } = require('./users');
const { createOauthManager } = require('./oauth');

const app = express();
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const registry = loadUserRegistry(config.userRegistryPath);
const usersById = buildUserMap(registry);
const usersByToken = buildUserTokenMap(registry);

const fallbackDefaultUserId = registry.users[0].id;
const resolvedDefaultUserId = usersById.has(config.defaultUserId)
  ? config.defaultUserId
  : fallbackDefaultUserId;

const oauthManager = createOauthManager({
  oauthConfig: config.oauth,
  getUserOauthDir
});

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

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getUserById(userId) {
  return usersById.get(userId) || null;
}

function getAuthenticatedUser(req) {
  const token = req.headers['x-user-token'];
  if (typeof token !== 'string' || !token) {
    return null;
  }

  return usersByToken.get(token) || null;
}

function requireAuthenticatedUser(req, res, requestedUserId) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized user token' });
    return null;
  }

  if (requestedUserId && requestedUserId !== user.id) {
    res.status(403).json({ error: `Token does not grant access to userId=${requestedUserId}` });
    return null;
  }

  return user;
}

async function sendToAgent(userId, payload) {
  const ws = connectedAgents.get(userId);
  if (!ws || ws.readyState !== ws.OPEN) {
    throw new Error(`Agent for user ${userId} is not connected`);
  }

  await new Promise((resolve, reject) => {
    ws.send(JSON.stringify(payload), (error) => {
      if (error) {
        reject(new Error(`Failed to send message to agent for user ${userId}: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}

function createPendingReply(requestId) {
  let timeoutId = null;
  let resolvePending;
  let rejectPending;

  const promise = new Promise((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
  });

  timeoutId = setTimeout(() => {
    pendingReplies.delete(requestId);
    rejectPending(new Error('Agent response timed out'));
  }, config.maxAgentResponseMs);

  pendingReplies.set(requestId, {
    resolve: (value) => {
      clearTimeout(timeoutId);
      pendingReplies.delete(requestId);
      resolvePending(value);
    },
    reject: (error) => {
      clearTimeout(timeoutId);
      pendingReplies.delete(requestId);
      rejectPending(error);
    }
  });

  return {
    promise,
    cancel: () => {
      clearTimeout(timeoutId);
      pendingReplies.delete(requestId);
    }
  };
}

function classifyDispatchError(error) {
  const message = String(error?.message || 'Unknown dispatch error');
  if (/not connected/i.test(message)) {
    return 'AGENT_OFFLINE';
  }
  if (/failed to send/i.test(message)) {
    return 'WS_SEND_FAILED';
  }
  return 'AGENT_DISPATCH_FAILED';
}

async function dispatchToAgentWithRetries({ userId, payload }) {
  const attempts = [];

  for (let index = 0; index < config.agentDispatchRetryDelaysMs.length; index += 1) {
    const waitMs = config.agentDispatchRetryDelaysMs[index];
    if (waitMs > 0) {
      await delay(waitMs);
    }

    const attempt = index + 1;
    const startedAt = new Date().toISOString();

    try {
      await sendToAgent(userId, payload);
      attempts.push({
        attempt,
        waitMs,
        at: startedAt,
        status: 'sent'
      });

      return {
        sent: true,
        attempts
      };
    } catch (error) {
      attempts.push({
        attempt,
        waitMs,
        at: startedAt,
        status: 'failed',
        reasonCode: classifyDispatchError(error),
        reason: error.message
      });
    }
  }

  const finalFailure = attempts[attempts.length - 1] || null;
  return {
    sent: false,
    attempts,
    finalReasonCode: finalFailure?.reasonCode || 'AGENT_DISPATCH_FAILED',
    finalReason: finalFailure?.reason || 'Unable to dispatch to agent'
  };
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
    pendingRequests: pendingReplies.size,
    dispatchRetryDelaysMs: config.agentDispatchRetryDelaysMs,
    openAiOauthConfigured: oauthManager.isConfigured()
  });
});

app.get('/api/status', async (req, res) => {
  const requestedUserId = req.query.userId ? String(req.query.userId) : null;
  const user = requireAuthenticatedUser(req, res, requestedUserId);
  if (!user) {
    return;
  }

  const sites = await listManagedSites(user.id);
  const openAi = await oauthManager.getCredentialStatus(user.id);

  res.json({
    userId: user.id,
    defaultUserId: resolvedDefaultUserId,
    agentConnected: connectedAgents.has(user.id),
    activeSites: sites,
    quota: user.quotas,
    openAi
  });
});

app.delete('/api/sites', async (req, res) => {
  const requestedUserId = req.query.userId ? String(req.query.userId) : null;
  const user = requireAuthenticatedUser(req, res, requestedUserId);
  if (!user) {
    return;
  }

  const siteId = req.query.siteId ? String(req.query.siteId) : undefined;

  try {
    const result = await removeManagedSites({ userId: user.id, siteId });
    res.json({
      userId: user.id,
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

  const requestedUserId = parsed.data.userId || null;
  const user = requireAuthenticatedUser(req, res, requestedUserId);
  if (!user) {
    return;
  }

  const requestId = randomUUID();
  const message = parsed.data.message;
  const pendingReply = createPendingReply(requestId);

  try {
    const openAiAccessToken = await oauthManager.getUsableAccessToken(user.id);

    const dispatchResult = await dispatchToAgentWithRetries({
      userId: user.id,
      payload: {
        type: 'user_message',
        requestId,
        userId: user.id,
        message,
        llmAuth: openAiAccessToken
          ? {
              provider: 'openai',
              accessToken: openAiAccessToken
            }
          : null
      }
    });

    if (!dispatchResult.sent) {
      pendingReply.cancel();
      res.status(503).json({
        requestId,
        error: 'Agent unavailable after retry attempts',
        reasonCode: dispatchResult.finalReasonCode,
        reason: dispatchResult.finalReason,
        attempts: dispatchResult.attempts
      });
      return;
    }

    const reply = await pendingReply.promise;
    res.json({
      requestId,
      reply,
      dispatch: {
        attempts: dispatchResult.attempts
      }
    });
  } catch (error) {
    pendingReply.cancel();
    if (/timed out/i.test(String(error.message))) {
      res.status(504).json({
        requestId,
        error: error.message,
        reasonCode: 'AGENT_TIMEOUT'
      });
      return;
    }

    res.status(500).json({
      requestId,
      error: error.message,
      reasonCode: 'AGENT_REQUEST_FAILED'
    });
  }
});

app.get('/api/auth/openai/status', async (req, res) => {
  const requestedUserId = req.query.userId ? String(req.query.userId) : null;
  const user = requireAuthenticatedUser(req, res, requestedUserId);
  if (!user) {
    return;
  }

  const status = await oauthManager.getCredentialStatus(user.id);
  res.json({
    userId: user.id,
    ...status
  });
});

app.get('/api/auth/openai/start', (req, res) => {
  const requestedUserId = req.query.userId ? String(req.query.userId) : null;
  const user = requireAuthenticatedUser(req, res, requestedUserId);
  if (!user) {
    return;
  }

  try {
    const authorization = oauthManager.createAuthorizationRequest(user.id);
    res.json({
      userId: user.id,
      ...authorization
    });
  } catch (error) {
    res.status(501).json({ error: error.message });
  }
});

app.delete('/api/auth/openai/connection', async (req, res) => {
  const requestedUserId = req.query.userId ? String(req.query.userId) : null;
  const user = requireAuthenticatedUser(req, res, requestedUserId);
  if (!user) {
    return;
  }

  try {
    await oauthManager.clearCredential(user.id);
    res.json({
      userId: user.id,
      disconnected: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/auth/openai/callback', async (req, res) => {
  const state = req.query.state ? String(req.query.state) : '';
  const code = req.query.code ? String(req.query.code) : '';
  const providerError = req.query.error ? String(req.query.error) : '';
  const providerErrorDescription = req.query.error_description ? String(req.query.error_description) : '';

  if (providerError) {
    res.status(400).send(`OpenAI OAuth failed: ${providerErrorDescription || providerError}`);
    return;
  }

  if (!state || !code) {
    res.status(400).send('OpenAI OAuth callback missing state or code');
    return;
  }

  try {
    const result = await oauthManager.completeAuthorization({ state, code });
    res.status(200).send(`OpenAI account connected for user ${result.userId}. You can return to the app.`);
  } catch (error) {
    res.status(400).send(`OpenAI OAuth callback failed: ${error.message}`);
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
