const path = require('path');

function parseDelayList(raw) {
  return String(raw || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.floor(value));
}

const dispatchRetryDelaysMs = parseDelayList(process.env.AGENT_DISPATCH_RETRY_DELAYS_MS || '0,2000,6000,15000,30000');

const config = {
  port: Number(process.env.CONTROL_PLANE_PORT || 3001),
  userRegistryPath: process.env.USER_REGISTRY_PATH || '/app/config/users.json',
  defaultUserId: process.env.DEFAULT_USER_ID || 'tester',
  userDataRoot: process.env.USER_DATA_ROOT || '/data/users',
  userDataRootHost: process.env.USER_DATA_ROOT_HOST || process.env.USER_DATA_ROOT || '/data/users',
  sisterNetwork: process.env.SISTER_NETWORK || 'site-net',
  sisterDomainSuffix: process.env.SISTER_DOMAIN_SUFFIX || '127.0.0.1.nip.io',
  caddySiteScheme: process.env.CADDY_SITE_SCHEME || 'http',
  caddyExternalPort: Number(process.env.CADDY_EXTERNAL_PORT || 8080),
  maxAgentResponseMs: Number(process.env.MAX_AGENT_RESPONSE_MS || 180000),
  agentDispatchRetryDelaysMs: dispatchRetryDelaysMs.length > 0 ? dispatchRetryDelaysMs : [0],
  oauth: {
    provider: 'openai',
    authorizationUrl: process.env.OPENAI_OAUTH_AUTHORIZATION_URL || '',
    tokenUrl: process.env.OPENAI_OAUTH_TOKEN_URL || '',
    clientId: process.env.OPENAI_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.OPENAI_OAUTH_CLIENT_SECRET || '',
    redirectUri: process.env.OPENAI_OAUTH_REDIRECT_URI || '',
    scopes: process.env.OPENAI_OAUTH_SCOPES || 'openid profile offline_access',
    stateTtlMs: Number(process.env.OPENAI_OAUTH_STATE_TTL_MS || 600000)
  }
};

function getUserWorkspaceRoot(userId) {
  return path.join(config.userDataRoot, userId, 'workspace');
}

function getUserWorkspaceRootHost(userId) {
  return path.join(config.userDataRootHost, userId, 'workspace');
}

function getUserOauthDir(userId) {
  return path.join(config.userDataRoot, userId, 'oauth');
}

module.exports = {
  config,
  getUserWorkspaceRoot,
  getUserWorkspaceRootHost,
  getUserOauthDir
};
