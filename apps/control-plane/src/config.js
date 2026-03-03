const path = require('path');

const config = {
  port: Number(process.env.CONTROL_PLANE_PORT || 3001),
  hardCodedUserId: process.env.HARD_CODED_USER_ID || 'tester',
  hardCodedUserToken: process.env.HARD_CODED_USER_TOKEN || 'tester-dev-token',
  hardCodedOpenAiKey: process.env.HARD_CODED_OPENAI_KEY || 'sk-dev-placeholder',
  userDataRoot: process.env.USER_DATA_ROOT || '/data/users',
  userDataRootHost: process.env.USER_DATA_ROOT_HOST || process.env.USER_DATA_ROOT || '/data/users',
  sisterNetwork: process.env.SISTER_NETWORK || 'site-net',
  sisterDomainSuffix: process.env.SISTER_DOMAIN_SUFFIX || '127.0.0.1.nip.io',
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
