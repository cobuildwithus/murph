import { readFile } from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAssistantInputEvents: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  listAssistantSessions: vi.fn(),
  listAssistantTranscriptTailEntries: vi.fn(),
}))

vi.mock('../src/assistant/input-store.js', () => ({
  listAssistantInputEvents: mocks.listAssistantInputEvents,
}))
vi.mock('../src/assistant/outbox.js', () => ({
  listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
}))
vi.mock('../src/assistant/store.js', () => ({
  listAssistantSessions: mocks.listAssistantSessions,
  listAssistantTranscriptTailEntries:
    mocks.listAssistantTranscriptTailEntries,
}))

import {
  buildAssistantMaintenanceConversationEvidence,
} from '../src/assistant/maintenance-evidence.ts'

describe('group room history limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listAssistantInputEvents.mockResolvedValue({ events: [] })
    mocks.listAssistantOutboxIntents.mockResolvedValue([])
    mocks.listAssistantSessions.mockResolvedValue([
      {
        binding: {
          channel: 'linq',
          threadIsDirect: false,
        },
        lastTurnAt: '2026-07-31T12:00:00.000Z',
        sessionId: 'session_group_history',
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
    ])
    const startMs = Date.parse('2026-07-31T12:00:00.000Z')
    mocks.listAssistantTranscriptTailEntries.mockResolvedValue(
      Array.from({ length: 1_001 }, (_, index) => ({
        createdAt: new Date(startMs + index).toISOString(),
        kind: 'user',
        text: `message-${index.toString().padStart(4, '0')}`,
      })),
    )
  })

  it('selects the newest 1000 bounded group conversation entries', async () => {
    const evidence = await buildAssistantMaintenanceConversationEvidence({
      now: new Date('2026-07-31T12:30:00.000Z'),
      profile: 'group-room-model',
      vault: 'ignored-by-mock',
    })

    expect(evidence).toContain('- selected entries: 1000')
    expect(evidence).toContain('- candidate entries: 1001')
    expect(evidence).toContain('- truncated: true')

    const records = evidence
      .split('\n')
      .filter((line) => line.startsWith('{"createdAt"'))
      .map((line) => JSON.parse(line) as { text: string })

    expect(records).toHaveLength(1_000)
    expect(records[0]?.text).toBe('message-0001')
    expect(records.at(-1)?.text).toBe('message-1000')
  })

  it('retains 1000 input events without widening other residue caps', async () => {
    const source = await readFile(
      new URL('../src/assistant/runtime-residue.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain(
      'const ASSISTANT_RUNTIME_RESIDUE_RETENTION_LIMIT = 100',
    )
    expect(source).toContain(
      'const ASSISTANT_INPUT_EVENT_RETENTION_LIMIT = 1_000',
    )
    expect(source).toContain(
      'index >= ASSISTANT_INPUT_EVENT_RETENTION_LIMIT',
    )
    expect(
      source.match(
        /index >= ASSISTANT_RUNTIME_RESIDUE_RETENTION_LIMIT/gu,
      ),
    ).toHaveLength(2)
  })
})
