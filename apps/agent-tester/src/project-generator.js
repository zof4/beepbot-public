const OpenAI = require('openai');
const { z } = require('zod');
const { buildFallbackProjectSpec } = require('./project-template');

const projectSpecSchema = z.object({
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

const PROJECT_SPEC_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['projectTitle', 'summary', 'runtime', 'files'],
  properties: {
    projectTitle: { type: 'string', minLength: 1, maxLength: 120 },
    projectSlugHint: { type: 'string', minLength: 1, maxLength: 60 },
    summary: { type: 'string', minLength: 1, maxLength: 600 },
    runtime: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['profile'],
          properties: {
            profile: { const: 'static' }
          }
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['profile', 'internalPort', 'startScript'],
          properties: {
            profile: { const: 'node' },
            internalPort: {
              type: 'integer',
              minimum: 1,
              maximum: 65535
            },
            startScript: {
              type: 'string',
              pattern: '^[a-zA-Z0-9:_-]+$'
            }
          }
        }
      ]
    },
    files: {
      type: 'array',
      minItems: 1,
      maxItems: 60,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 240 },
          content: { type: 'string', maxLength: 350000 }
        }
      }
    }
  }
};

function hasUsableOpenAiKey(key) {
  return Boolean(key && key.startsWith('sk-') && !key.includes('placeholder'));
}

function buildSystemPrompt() {
  return [
    'You are a senior software builder creating production-quality starter projects for an autonomous agent runtime.',
    'Return only JSON matching the required schema.',
    'Prefer static sites unless dynamic server behavior is clearly required by the prompt.',
    'If using runtime.profile="node":',
    '- include a valid package.json with a script matching runtime.startScript',
    '- ensure server listens on process.env.PORT or runtime.internalPort',
    '- include all files needed to run successfully',
    'Do not include markdown fences or explanations outside JSON.'
  ].join('\n');
}

function buildUserPrompt(promptText) {
  return [
    'Build a user-requested project from this prompt:',
    promptText,
    '',
    'Output constraints:',
    '- Keep implementation concise but complete.',
    '- Use clear file names and maintainable code.',
    '- Include a README.md with run notes.',
    '- For a score-tracker or simple utility, static runtime is acceptable and preferred.',
    '- Avoid placeholders like TODO.'
  ].join('\n');
}

function parseModelResponse(content) {
  const parsed = JSON.parse(content);
  return projectSpecSchema.parse(parsed);
}

async function generateModelProjectSpec({ openAiApiKey, model, promptText }) {
  const client = new OpenAI({ apiKey: openAiApiKey });

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(promptText) }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'project_spec',
        strict: true,
        schema: PROJECT_SPEC_JSON_SCHEMA
      }
    }
  });

  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Model did not return JSON content');
  }

  return parseModelResponse(content);
}

async function generateProjectSpec({ openAiApiKey, model, promptText }) {
  if (!hasUsableOpenAiKey(openAiApiKey)) {
    return {
      mode: 'fallback',
      reason: 'No usable OPENAI_API_KEY configured',
      spec: buildFallbackProjectSpec(promptText)
    };
  }

  try {
    const spec = await generateModelProjectSpec({
      openAiApiKey,
      model,
      promptText
    });

    return {
      mode: 'model',
      reason: null,
      spec
    };
  } catch (error) {
    return {
      mode: 'fallback',
      reason: `Model generation failed: ${error.message}`,
      spec: buildFallbackProjectSpec(promptText)
    };
  }
}

module.exports = {
  generateProjectSpec
};
