const fs = require('fs/promises');
const path = require('path');
const { WebSocket } = require('ws');
const { generateProjectSpec, isScoreTrackerPrompt, hasUsableOpenAiKey } = require('./project-generator');
const { buildFallbackProjectSpec, buildFallbackNodeProjectSpec } = require('./project-template');

const config = {
  userId: process.env.AGENT_USER_ID || 'tester',
  agentToken: process.env.AGENT_TOKEN || 'tester-dev-token',
  model: process.env.AGENT_MODEL || 'gpt-5-codex',
  devOpenAiApiKey: process.env.AGENT_DEV_OPENAI_API_KEY || '',
  controlPlaneWsUrl: process.env.CONTROL_PLANE_WS_URL || 'ws://localhost:3001/agent',
  controlPlaneHttpUrl: process.env.CONTROL_PLANE_HTTP_URL || 'http://localhost:3001',
  workspaceRoot: process.env.WORKSPACE_ROOT || '/workspace'
};

function toSlug(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function ensureSafeRelativePath(candidatePath) {
  const normalized = path.posix.normalize(String(candidatePath).replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error(`Invalid project file path: ${candidatePath}`);
  }

  if (normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Project file path escapes root: ${candidatePath}`);
  }

  return normalized;
}

function ensureNodeSpecIsRunnable(spec) {
  if (spec.runtime.profile !== 'node') {
    return;
  }

  const packageJsonFile = spec.files.find((file) => {
    return ensureSafeRelativePath(file.path) === 'package.json';
  });

  if (!packageJsonFile) {
    throw new Error('Node runtime requires a root package.json file');
  }

  const packageJson = JSON.parse(packageJsonFile.content);
  const scriptName = spec.runtime.startScript;
  if (!packageJson.scripts || typeof packageJson.scripts[scriptName] !== 'string') {
    throw new Error(`Node runtime startScript '${scriptName}' missing in package.json`);
  }
}

function buildProjectSlug(spec) {
  const base = toSlug(spec.projectSlugHint || spec.projectTitle || 'project') || 'project';
  return `${base}-${Date.now().toString(36)}`;
}

function detectRuntimeHint(promptText) {
  if (/\[runtime:node\]/i.test(promptText)) {
    return 'node';
  }
  if (/\[runtime:static\]/i.test(promptText)) {
    return 'static';
  }
  return null;
}

async function writeProjectFiles(projectRoot, files) {
  await fs.mkdir(projectRoot, { recursive: true });

  const writeTasks = files.map(async (file) => {
    const relativePath = ensureSafeRelativePath(file.path);
    const absolutePath = path.resolve(projectRoot, relativePath);
    const normalizedRoot = path.resolve(projectRoot) + path.sep;

    if (!absolutePath.startsWith(normalizedRoot)) {
      throw new Error(`Project file path escapes root: ${file.path}`);
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.content, 'utf8');
  });

  await Promise.all(writeTasks);
}

function resolveOpenAiCredential(llmAuth) {
  if (llmAuth && llmAuth.provider === 'openai' && hasUsableOpenAiKey(llmAuth.accessToken)) {
    return {
      source: 'user-oauth',
      apiKey: llmAuth.accessToken
    };
  }

  if (hasUsableOpenAiKey(config.devOpenAiApiKey)) {
    return {
      source: 'agent-dev-key',
      apiKey: config.devOpenAiApiKey
    };
  }

  return {
    source: 'none',
    apiKey: ''
  };
}

async function createProjectFromPrompt(promptText, llmAuth) {
  const runtimeHint = detectRuntimeHint(promptText);
  const openAiCredential = resolveOpenAiCredential(llmAuth);
  let generation;

  if (runtimeHint === 'node') {
    generation = {
      mode: 'forced-node-fallback',
      reason: 'Prompt requested [runtime:node] deterministic path',
      spec: buildFallbackNodeProjectSpec(promptText)
    };
  } else if (runtimeHint === 'static') {
    generation = {
      mode: 'forced-static-fallback',
      reason: 'Prompt requested [runtime:static] deterministic path',
      spec: buildFallbackProjectSpec(promptText)
    };
  } else {
    generation = await generateProjectSpec({
      openAiApiKey: openAiCredential.apiKey,
      model: config.model,
      promptText
    });
  }

  try {
    ensureNodeSpecIsRunnable(generation.spec);
  } catch (error) {
    const fallbackSpec = isScoreTrackerPrompt(promptText)
      ? buildFallbackNodeProjectSpec(promptText)
      : buildFallbackProjectSpec(promptText);

    generation = {
      mode: 'fallback',
      reason: `Generated spec failed runtime validation: ${error.message}`,
      spec: fallbackSpec
    };
  }

  const projectSlug = buildProjectSlug(generation.spec);
  const projectPath = path.join(config.workspaceRoot, projectSlug);

  await writeProjectFiles(projectPath, generation.spec.files);

  return {
    projectSlug,
    projectPath,
    title: generation.spec.projectTitle,
    summary: generation.spec.summary,
    runtime: generation.spec.runtime,
    generationMode: generation.mode,
    generationReason: generation.reason,
    llmCredentialSource: openAiCredential.source
  };
}

async function spawnSite({ projectDir, subdomain, runtime }) {
  const response = await fetch(`${config.controlPlaneHttpUrl}/internal/spawn-site`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-token': config.agentToken
    },
    body: JSON.stringify({
      userId: config.userId,
      projectDir,
      subdomain,
      runtime
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`spawn-site failed: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}

async function processUserMessage(payload, ws) {
  const { requestId, message, llmAuth } = payload;

  try {
    const project = await createProjectFromPrompt(message, llmAuth);
    const subdomain = toSlug(`${config.userId}-${project.projectSlug}`);
    const site = await spawnSite({
      projectDir: project.projectSlug,
      subdomain,
      runtime: project.runtime
    });

    ws.send(
      JSON.stringify({
        type: 'agent_response',
        requestId,
        message: [
          `Built project: ${project.title}`,
          `Generation mode: ${project.generationMode}`,
          `Runtime: ${project.runtime.profile}`,
          `Workspace path: /workspace/${project.projectSlug}`,
          `Live URL: ${site.url}`
        ].join('\n'),
        metadata: {
          projectDir: project.projectSlug,
          summary: project.summary,
          generationMode: project.generationMode,
          generationReason: project.generationReason,
          llmCredentialSource: project.llmCredentialSource,
          runtime: project.runtime,
          site
        }
      })
    );
  } catch (error) {
    ws.send(
      JSON.stringify({
        type: 'agent_error',
        requestId,
        error: error.message
      })
    );
  }
}

function connectLoop() {
  const wsUrl = new URL(config.controlPlaneWsUrl);
  wsUrl.searchParams.set('userId', config.userId);
  wsUrl.searchParams.set('token', config.agentToken);

  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[agent] connected to control plane');
  });

  ws.on('message', async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch (_error) {
      return;
    }

    if (payload.type === 'user_message') {
      await processUserMessage(payload, ws);
    }
  });

  ws.on('close', () => {
    console.log('[agent] disconnected, retrying in 2s');
    setTimeout(connectLoop, 2000);
  });

  ws.on('error', (error) => {
    console.error('[agent] websocket error:', error.message);
    ws.close();
  });
}

connectLoop();
