const path = require('path');
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const SITE_RUNTIME_IMAGES = {
  static: 'busybox:1.36',
  node: 'node:20-alpine'
};

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

function normalizeRuntime(runtime) {
  const candidate = runtime || { profile: 'static' };
  if (!['static', 'node'].includes(candidate.profile)) {
    throw new Error(`Unsupported runtime profile: ${candidate.profile}`);
  }

  if (candidate.profile === 'static') {
    return { profile: 'static', internalPort: 8080 };
  }

  const internalPort = Number(candidate.internalPort || 3000);
  if (!Number.isInteger(internalPort) || internalPort < 1 || internalPort > 65535) {
    throw new Error('Invalid node runtime internalPort');
  }

  const startScript = String(candidate.startScript || 'start');
  if (!/^[a-zA-Z0-9:_-]+$/.test(startScript)) {
    throw new Error('Invalid node runtime startScript');
  }

  return {
    profile: 'node',
    internalPort,
    startScript
  };
}

function buildNodeRuntimeCommand(startScript) {
  return [
    'set -e',
    'rm -rf /home/node/app',
    'mkdir -p /home/node/app',
    'cp -R /src/. /home/node/app/',
    'cd /home/node/app',
    'if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi',
    `npm run ${startScript}`
  ].join(' && ');
}

function buildContainerSpec({ runtime, workspacePath, domain, sisterNetwork, userId, safeSubdomain, containerName }) {
  const baseLabels = {
    'platform.managed': 'true',
    'platform.kind': 'site',
    'platform.userId': userId,
    'platform.user-subdomain': `${userId}:${safeSubdomain}`,
    'platform.runtime': runtime.profile,
    caddy: domain
  };

  if (runtime.profile === 'static') {
    const staticPort = runtime.internalPort;
    return {
      imageName: SITE_RUNTIME_IMAGES.static,
      createOptions: {
        Image: SITE_RUNTIME_IMAGES.static,
        name: containerName,
        Labels: {
          ...baseLabels,
          'caddy.reverse_proxy': `{{upstreams ${staticPort}}}`
        },
        ExposedPorts: {
          [`${staticPort}/tcp`]: {}
        },
        Cmd: ['httpd', '-f', '-p', String(staticPort), '-h', '/site'],
        HostConfig: {
          AutoRemove: true,
          Binds: [`${workspacePath}:/site:ro`],
          Memory: 256 * 1024 * 1024,
          NanoCpus: 500000000,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges:true'],
          NetworkMode: sisterNetwork
        }
      }
    };
  }

  const portKey = `${runtime.internalPort}/tcp`;

  return {
    imageName: SITE_RUNTIME_IMAGES.node,
    createOptions: {
      Image: SITE_RUNTIME_IMAGES.node,
      name: containerName,
      Labels: {
        ...baseLabels,
        'caddy.reverse_proxy': `{{upstreams ${runtime.internalPort}}}`
      },
      ExposedPorts: {
        [portKey]: {}
      },
      User: 'node',
      Env: [`PORT=${runtime.internalPort}`],
      Cmd: ['sh', '-lc', buildNodeRuntimeCommand(runtime.startScript)],
      HostConfig: {
        AutoRemove: true,
        Binds: [`${workspacePath}:/src:ro`],
        Memory: 256 * 1024 * 1024,
        NanoCpus: 500000000,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        NetworkMode: sisterNetwork
      }
    }
  };
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

async function removeManagedSites({ userId, siteId }) {
  if (!userId) {
    throw new Error('userId is required to remove managed sites');
  }

  const removed = [];

  if (siteId) {
    const container = docker.getContainer(siteId);
    let inspectData;
    try {
      inspectData = await container.inspect();
    } catch (error) {
      if (error.statusCode === 404) {
        return { removedCount: 0, removed };
      }
      throw error;
    }

    const labels = inspectData.Config?.Labels || {};
    if (labels['platform.managed'] !== 'true' || labels['platform.kind'] !== 'site') {
      throw new Error(`Container ${siteId} is not a managed site container`);
    }
    if (labels['platform.userId'] !== userId) {
      throw new Error(`Container ${siteId} does not belong to user ${userId}`);
    }

    await container.remove({ force: true });
    removed.push(siteId);
    return { removedCount: removed.length, removed };
  }

  const containers = await docker.listContainers({
    all: true,
    filters: {
      label: ['platform.managed=true', 'platform.kind=site', `platform.userId=${userId}`]
    }
  });

  await Promise.all(
    containers.map(async (item) => {
      const container = docker.getContainer(item.Id);
      await container.remove({ force: true }).catch(() => {});
      removed.push(item.Id);
    })
  );

  return { removedCount: removed.length, removed };
}

async function spawnSiteContainer({
  userId,
  projectDir,
  subdomain,
  workspaceRoot,
  sisterNetwork,
  sisterDomainSuffix,
  caddySiteScheme,
  caddyExternalPort,
  runtime
}) {
  const supportedSchemes = new Set(['http', 'https']);
  const siteScheme = caddySiteScheme || 'http';
  if (!supportedSchemes.has(siteScheme)) {
    throw new Error(`Unsupported Caddy site scheme: ${siteScheme}`);
  }

  const safeSubdomain = sanitizeSlug(subdomain);
  const workspacePath = assertSafeWorkspacePath(workspaceRoot, projectDir);
  const domain = `${safeSubdomain}.${sisterDomainSuffix}`;
  const caddyAddress = `${siteScheme}://${domain}`;
  const runtimeConfig = normalizeRuntime(runtime);
  const containerName = `site-${sanitizeSlug(userId)}-${safeSubdomain}-${Date.now().toString(36)}`;

  // Keep one active container per user/subdomain for predictable routing in Caddy.
  await stopContainersByLabel(`platform.user-subdomain=${userId}:${safeSubdomain}`);

  const spec = buildContainerSpec({
    runtime: runtimeConfig,
    workspacePath,
    domain: caddyAddress,
    sisterNetwork,
    userId,
    safeSubdomain,
    containerName
  });

  await ensureImage(spec.imageName);

  const container = await docker.createContainer(spec.createOptions);
  await container.start();

  return {
    containerName,
    domain,
    runtime: runtimeConfig,
    url: `${siteScheme}://${domain}:${caddyExternalPort}`
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
  listManagedSites,
  removeManagedSites,
  normalizeRuntime,
  sanitizeSlug
};
