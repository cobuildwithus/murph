import assert from 'node:assert/strict'

import { test } from 'vitest'

import { extractAssistantMemory } from '../src/assistant/memory/extraction.js'
import { compareAssistantMemorySearchHits } from '../src/assistant/memory/search.js'
import { parseAssistantMemoryRecords } from '../src/assistant/memory/storage-format.js'

test('extractAssistantMemory classifies durable long-term memory apart from daily project context', () => {
  const extracted = extractAssistantMemory(
    [
      'You can call me Sam.',
      'For future responses, use bullet points.',
      "We're working on the assistant memory refactor in this repo.",
      'For this answer, use a table.',
    ].join(' '),
  )

  assert.deepEqual(extracted.longTerm, [
    {
      section: 'Identity',
      text: 'Call the user Sam.',
    },
    {
      section: 'Preferences',
      text: 'Use bullet points.',
    },
  ])
  assert.deepEqual(extracted.daily, [
    "We're working on the assistant memory refactor in this repo.",
  ])
})

test('parseAssistantMemoryRecords preserves provenance metadata and privacy-gates health sections', () => {
  const markdown = [
    '# Assistant memory',
    '',
    '## Identity',
    '',
    '- 2026-03-18 09:30 — Call the user Sam. <!-- healthybob-assistant-memory:{"writtenBy":"assistant","sessionId":"sess-1","turnId":"turn-1"} -->',
    '',
    '## Health context',
    '',
    '- 2026-03-18 09:31 — User takes magnesium daily. <!-- healthybob-assistant-memory:{"writtenBy":"operator","sessionId":null,"turnId":null} -->',
    '',
  ].join('\n')

  const privateRecords = parseAssistantMemoryRecords({
    kind: 'long-term',
    sourcePath: 'assistant-memory.md',
    text: markdown,
    includeSensitiveHealthContext: true,
  })
  const sharedRecords = parseAssistantMemoryRecords({
    kind: 'long-term',
    sourcePath: 'assistant-memory.md',
    text: markdown,
    includeSensitiveHealthContext: false,
  })

  assert.equal(privateRecords.length, 2)
  assert.equal(sharedRecords.length, 1)
  assert.deepEqual(privateRecords[0]?.provenance, {
    writtenBy: 'assistant',
    sessionId: 'sess-1',
    turnId: 'turn-1',
  })
  assert.equal(privateRecords[1]?.section, 'Health context')
  assert.equal(sharedRecords[0]?.section, 'Identity')
})

test('compareAssistantMemorySearchHits sorts scored hits ahead of recency tie-breakers', () => {
  const hits = [
    {
      id: 'daily:a',
      kind: 'daily' as const,
      provenance: null,
      section: 'Notes' as const,
      text: 'Working on parser wiring.',
      recordedAt: '2026-03-18 10:00',
      sourcePath: 'daily/2026-03-18.md',
      sourceLine: 3,
      score: 5,
    },
    {
      id: 'long-term:a',
      kind: 'long-term' as const,
      provenance: null,
      section: 'Standing instructions' as const,
      text: 'Keep answers concise.',
      recordedAt: '2026-03-17 09:00',
      sourcePath: 'memory.md',
      sourceLine: 8,
      score: 12,
    },
    {
      id: 'long-term:b',
      kind: 'long-term' as const,
      provenance: null,
      section: 'Preferences' as const,
      text: 'Use bullet points.',
      recordedAt: '2026-03-18 11:00',
      sourcePath: 'memory.md',
      sourceLine: 12,
      score: 12,
    },
  ]

  hits.sort((left, right) => compareAssistantMemorySearchHits(left, right, true))

  assert.deepEqual(
    hits.map((hit) => hit.id),
    ['long-term:b', 'long-term:a', 'daily:a'],
  )
})
