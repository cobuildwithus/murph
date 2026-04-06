import assert from 'node:assert/strict'

import { test } from 'vitest'

import { buildAssistantCliSurfaceContract } from '../src/assistant/cli-surface-bootstrap.js'

test('buildAssistantCliSurfaceContract compiles llms-full output into a terse prompt contract', () => {
  const contract = buildAssistantCliSurfaceContract({
    commands: [
      {
        name: 'chat',
        description: 'Open the assistant chat UI directly from the CLI root.',
        schema: {
          options: {
            properties: {
              alias: { type: 'string' },
              channel: { type: 'string' },
              provider: { enum: ['codex-cli', 'openai-compatible'] },
              requestId: { type: 'string' },
              session: { type: 'string' },
              vault: { type: 'string' },
            },
            required: ['vault'],
            type: 'object',
          },
        },
      },
      {
        name: 'assistant cron add',
        description: 'Create one assistant cron job backed by the local assistant runtime.',
        schema: {
          args: {
            properties: {
              prompt: { type: 'string' },
            },
            required: ['prompt'],
            type: 'object',
          },
          options: {
            properties: {
              alias: { type: 'string' },
              channel: { type: 'string' },
              name: { type: 'string' },
              requestId: { type: 'string' },
              session: { type: 'string' },
              vault: { type: 'string' },
            },
            required: ['name', 'vault'],
            type: 'object',
          },
        },
      },
      {
        name: 'device connect',
        description: 'Start a browser-based OAuth connection for one device provider.',
        schema: {
          args: {
            properties: {
              provider: { type: 'string' },
            },
            required: ['provider'],
            type: 'object',
          },
          options: {
            properties: {
              baseUrl: { type: 'string' },
              open: { type: 'boolean' },
              requestId: { type: 'string' },
              vault: { type: 'string' },
            },
            required: ['vault'],
            type: 'object',
          },
        },
      },
      {
        name: 'journal append',
        description: 'Append freeform markdown text to one journal day.',
        schema: {
          args: {
            properties: {
              date: { type: 'string' },
            },
            required: ['date'],
            type: 'object',
          },
          options: {
            properties: {
              requestId: { type: 'string' },
              text: { type: 'string' },
              vault: { type: 'string' },
            },
            required: ['text', 'vault'],
            type: 'object',
          },
        },
      },
      {
        name: 'search query',
        description: 'Search the local read model when the target is fuzzy or remembered by phrase rather than exact id.',
        schema: {
          options: {
            properties: {
              backend: { enum: ['auto', 'scan', 'sqlite'] },
              kind: { type: 'array' },
              limit: { type: 'integer' },
              recordType: { type: 'array' },
              requestId: { type: 'string' },
              text: { type: 'string' },
              vault: { type: 'string' },
            },
            required: ['limit', 'vault'],
            type: 'object',
          },
        },
      },
      {
        name: 'wearables day',
        description: 'Show the deduplicated wearable day mirror for one date.',
        schema: {
          options: {
            properties: {
              date: { type: 'string' },
              provider: { type: 'array' },
              requestId: { type: 'string' },
              vault: { type: 'string' },
            },
            required: ['date', 'vault'],
            type: 'object',
          },
        },
      },
    ],
    version: 'incur.v1',
  })

  assert.equal(typeof contract, 'string')
  assert.match(contract ?? '', /^Murph CLI Contract:/u)
  assert.match(
    contract ?? '',
    /This block is compiled automatically from `vault-cli --llms-full --format json` at session bootstrap\./u,
  )
  assert.match(contract ?? '', /Family Index:/u)
  assert.match(contract ?? '', /- root \(1\): chat/u)
  assert.match(contract ?? '', /- assistant \(1\): cron add/u)
  assert.match(contract ?? '', /- `journal append`: Append freeform markdown text to one journal day\.; args <date>; required --text\./u)
  assert.match(contract ?? '', /- `search query`: Search the local read model when the target is fuzzy or remembered by phrase rather than exact id\.; required --limit=integer; common --backend=auto\|scan\|sqlite, --kind=list, --recordType=list, --text\./u)
  assert.doesNotMatch(contract ?? '', /additionalProperties/u)
  assert.doesNotMatch(contract ?? '', /--vault/u)
  assert.doesNotMatch(contract ?? '', /--requestId/u)
})
