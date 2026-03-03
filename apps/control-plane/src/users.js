const fs = require('fs');
const { z } = require('zod');

const userSchema = z.object({
  id: z.string().min(1),
  userToken: z.string().min(1),
  agentToken: z.string().min(1),
  quotas: z
    .object({
      maxActiveSites: z.number().int().positive().default(3),
      dailyTokenLimit: z.number().int().positive().optional()
    })
    .default({ maxActiveSites: 3 })
});

const registrySchema = z.object({
  users: z.array(userSchema).min(1)
});

function loadUserRegistry(userRegistryPath) {
  const raw = fs.readFileSync(userRegistryPath, 'utf8');
  const registry = registrySchema.parse(JSON.parse(raw));

  const userIds = new Set();
  const userTokens = new Set();
  const agentTokens = new Set();

  for (const user of registry.users) {
    if (userIds.has(user.id)) {
      throw new Error(`Duplicate user id in registry: ${user.id}`);
    }
    userIds.add(user.id);

    if (userTokens.has(user.userToken)) {
      throw new Error(`Duplicate user token in registry for user: ${user.id}`);
    }
    userTokens.add(user.userToken);

    if (agentTokens.has(user.agentToken)) {
      throw new Error(`Duplicate agent token in registry for user: ${user.id}`);
    }
    agentTokens.add(user.agentToken);
  }

  return registry;
}

function buildUserMap(registry) {
  return new Map(registry.users.map((user) => [user.id, user]));
}

function buildUserTokenMap(registry) {
  return new Map(registry.users.map((user) => [user.userToken, user]));
}

module.exports = {
  loadUserRegistry,
  buildUserMap,
  buildUserTokenMap
};
