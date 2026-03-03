const { z } = require('zod');

const codexProjectSpecSchema = z.object({
  projectTitle: z.string().min(1).max(120),
  projectSlugHint: z.string().min(1).max(60).optional(),
  summary: z.string().min(1).max(600),
  runtime: z.discriminatedUnion('profile', [
    z.object({
      profile: z.literal('static')
    }),
    z.object({
      profile: z.literal('node'),
      internalPort: z.number().int().min(1).max(65535).default(3000),
      startScript: z.string().regex(/^[a-zA-Z0-9:_-]+$/).default('start')
    })
  ]),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(240),
        content: z.string().max(350000)
      })
    )
    .min(1)
    .max(60)
});

function buildCodexPrompt(promptText) {
  return [
    'Create a complete project specification as JSON only.',
    'Do not use markdown code fences.',
    'The JSON must include: projectTitle, projectSlugHint, summary, runtime, files.',
    'For score trackers and CRUD-style tools, prefer runtime.profile="node" with server-side persistence.',
    'If runtime.profile="node": include package.json with runtime.startScript and all required files.',
    'Each files item must include path and content.',
    '',
    `User request: ${promptText}`
  ].join('\n');
}

function extractLikelyText(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const directKeys = ['output_text', 'text', 'content', 'result', 'response', 'message'];
  for (const key of directKeys) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key];
    }
  }

  const listKeys = ['output', 'messages', 'parts', 'content_blocks', 'segments'];
  for (const key of listKeys) {
    if (Array.isArray(value[key])) {
      const aggregated = value[key].map(extractLikelyText).filter(Boolean).join('\n');
      if (aggregated) {
        return aggregated;
      }
    }
  }

  for (const nested of Object.values(value)) {
    const text = extractLikelyText(nested);
    if (text) {
      return text;
    }
  }

  return '';
}

function extractJsonObject(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    throw new Error('Codex result did not contain text output');
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    // Try to recover a JSON object if Codex prepends/appends prose.
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const slice = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(slice);
    }
    throw new Error('Codex result was not valid JSON');
  }
}

class CodexProjectRunner {
  constructor({ model }) {
    this.model = model;
    this.codex = null;
    this.thread = null;
  }

  async initialize() {
    if (this.codex) {
      return;
    }

    const sdkModule = await import('@openai/codex-sdk');
    const Codex = sdkModule.Codex || sdkModule.default?.Codex || sdkModule.default;
    if (!Codex) {
      throw new Error('Unable to resolve Codex constructor from @openai/codex-sdk');
    }

    const options = {};
    if (this.model) {
      options.model = this.model;
    }

    this.codex = new Codex(options);
    this.thread = this.codex.startThread();
  }

  async runProjectSpec(promptText) {
    await this.initialize();

    const result = await this.thread.run(buildCodexPrompt(promptText));
    const text = extractLikelyText(result);
    const parsed = extractJsonObject(text);
    const spec = codexProjectSpecSchema.parse(parsed);

    return {
      spec,
      rawText: text,
      threadId: this.thread?.id || null
    };
  }
}

module.exports = {
  CodexProjectRunner
};
