const path = require('path');

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
  maxAgentResponseMs: Number(process.env.MAX_AGENT_RESPONSE_MS || 180000)
};

function getUserWorkspaceRoot(userId) {
  return path.join(config.userDataRoot, userId, 'workspace');
}

function getUserWorkspaceRootHost(userId) {
  return path.join(config.userDataRootHost, userId, 'workspace');
}

module.exports = {
  config,
  getUserWorkspaceRoot,
  getUserWorkspaceRootHost
};
