const path = require('path');
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function ensureImage(imageName) {
  try {
    await docker.getImage(imageName).inspect();
    return;
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  const stream = await docker.pull(imageName);
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sanitizeSlug(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'site';
}

function assertSafeWorkspacePath(workspaceRoot, projectDir) {
  const resolved = path.resolve(workspaceRoot, projectDir);
  const normalizedRoot = path.resolve(workspaceRoot) + path.sep;
  if (!resolved.startsWith(normalizedRoot)) {
    throw new Error('Project path escapes workspace root');
  }
  return resolved;
}

async function stopContainersByLabel(label) {
  const containers = await docker.listContainers({
    all: true,
    filters: {
      label: [label]
    }
  });

  await Promise.all(
    containers.map(async (item) => {
      const container = docker.getContainer(item.Id);
      if (item.State === 'running') {
        await container.stop({ t: 5 }).catch(() => {});
      }
      await container.remove({ force: true }).catch(() => {});
    })
  );
}

async function spawnSiteContainer({ userId, projectDir, subdomain, workspaceRoot, sisterNetwork, sisterDomainSuffix, caddyExternalPort }) {
  const safeSubdomain = sanitizeSlug(subdomain);
  const workspacePath = assertSafeWorkspacePath(workspaceRoot, projectDir);
  const domain = `${safeSubdomain}.${sisterDomainSuffix}`;
  const containerName = `site-${sanitizeSlug(userId)}-${safeSubdomain}-${Date.now().toString(36)}`;

  // Keep one active container per user/subdomain for predictable routing in Caddy.
  await stopContainersByLabel(`platform.user-subdomain=${userId}:${safeSubdomain}`);
  await ensureImage('nginx:alpine');

  const container = await docker.createContainer({
    Image: 'nginx:alpine',
    name: containerName,
    Labels: {
      'platform.managed': 'true',
      'platform.kind': 'site',
      'platform.userId': userId,
      'platform.user-subdomain': `${userId}:${safeSubdomain}`,
      caddy: domain,
      'caddy.reverse_proxy': '{{upstreams 80}}'
    },
    ExposedPorts: {
      '80/tcp': {}
    },
    HostConfig: {
      AutoRemove: true,
      Binds: [`${workspacePath}:/usr/share/nginx/html:ro`],
      Memory: 256 * 1024 * 1024,
      NanoCpus: 500000000,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      NetworkMode: sisterNetwork
    }
  });

  await container.start();

  return {
    containerName,
    domain,
    url: `http://${domain}:${caddyExternalPort}`
  };
}

async function listManagedSites(userId) {
  const filters = {
    label: ['platform.managed=true', 'platform.kind=site']
  };

  if (userId) {
    filters.label.push(`platform.userId=${userId}`);
  }

  const containers = await docker.listContainers({ all: false, filters });

  return containers.map((container) => ({
    id: container.Id,
    name: container.Names[0]?.replace(/^\//, ''),
    status: container.Status,
    labels: container.Labels
  }));
}

module.exports = {
  spawnSiteContainer,
  listManagedSites
};
