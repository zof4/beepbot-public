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
  return registrySchema.parse(JSON.parse(raw));
}

function buildUserMap(registry) {
  return new Map(registry.users.map((user) => [user.id, user]));
}

module.exports = {
  loadUserRegistry,
  buildUserMap
};
