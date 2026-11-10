import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX,
  buildAssistantProviderTranscriptAuditEntries,
} from '../src/assistant/transcript-audit.js'

describe('assistant transcript audit replay', () => {
  it('builds a sanitized provider failure transcript entry', () => {
    const entries = buildAssistantProviderTranscriptAuditEntries({
      error: Object.assign(new Error('schema rejected /tmp/local/dev token=secret'), {
        code: 'SCHEMA_REJECTION',
      }),
      routeLabel: 'OpenAI',
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'error',
    })
    expect(entries[0]?.text).toContain(ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX)
    expect(entries[0]?.text).toContain('Provider route OpenAI failed')
    expect(entries[0]?.text).toContain('SCHEMA_REJECTION')
    expect(entries[0]?.text).not.toContain('/tmp/local')
    expect(entries[0]?.text).not.toContain('secret')
  })

  it('handles nested provider failure context without leaking values', () => {
    const entries = buildAssistantProviderTranscriptAuditEntries({
      at: '2026-04-08T00:00:00.000Z',
      error: {
        cause: {
          code: 'NESTED_CODE',
          message: 'Nested failure from local scratch path /tmp/local/dev',
        },
      },
      routeLabel: '',
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      createdAt: '2026-04-08T00:00:00.000Z',
      kind: 'error',
    })
    expect(entries[0]?.text).toContain('Provider route failed (NESTED_CODE)')
    expect(entries[0]?.text).not.toContain('/tmp/local')
  })

})
