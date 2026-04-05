import assert from 'node:assert/strict'

import { test } from 'vitest'

import { buildAssistantCliSurfaceSummary } from '../src/assistant/cli-surface-bootstrap.js'

test('buildAssistantCliSurfaceSummary compresses llms output into a bootstrap map', () => {
  const summary = buildAssistantCliSurfaceSummary({
    commands: [
      { name: 'chat' },
      { name: 'show' },
      { name: 'status' },
      { name: 'assistant ask' },
      { name: 'assistant chat' },
      { name: 'assistant cron add' },
      { name: 'assistant cron list' },
      { name: 'assistant memory get' },
      { name: 'assistant memory search' },
      { name: 'assistant status' },
      { name: 'assistant stop' },
      { name: 'device account list' },
      { name: 'device connect' },
      { name: 'device provider list' },
      { name: 'inbox init' },
      { name: 'inbox list' },
      { name: 'inbox process' },
      { name: 'knowledge index rebuild' },
      { name: 'knowledge lint' },
      { name: 'knowledge list' },
      { name: 'knowledge search' },
      { name: 'knowledge show' },
      { name: 'knowledge upsert' },
      { name: 'workout list' },
      { name: 'workout scaffold' },
      { name: 'workout show' },
      { name: 'workout upsert' },
    ],
    version: 'incur.v1',
  })

  assert.equal(typeof summary, 'string')
  assert.match(summary ?? '', /^CLI surface summary:/u)
  assert.match(summary ?? '', /Standalone root commands: chat, show, status\./u)
  assert.match(
    summary ?? '',
    /Major command families: assistant, inbox, knowledge, device, workout\./u,
  )
  assert.match(summary ?? '', /assistant: cron, memory, ask, chat, status, stop\./u)
  assert.match(summary ?? '', /knowledge: index, lint, list, search, show, upsert\./u)
  assert.match(summary ?? '', /device: account, provider, connect\./u)
})
