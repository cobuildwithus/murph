import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX,
  buildAssistantProviderTranscriptAuditEntries,
} from '../src/assistant/transcript-audit.js'

describe('assistant transcript audit replay', () => {
  it('builds bounded sanitized tool and provider failure transcript entries', () => {
    const entries = buildAssistantProviderTranscriptAuditEntries({
      error: Object.assign(new Error('schema rejected /tmp/local/dev token=secret'), {
        code: 'SCHEMA_REJECTION',
      }),
      rawToolEvents: [
        {
          type: 'assistant.tool.succeeded',
          mode: 'apply',
          tool: 'vault.cli.run',
          input: {
            command: 'vault-cli experiment edit',
          },
        },
        {
          type: 'assistant.tool.failed',
          mode: 'apply',
          tool: 'healthCommons.get',
          input: {
            id: 'dry-sauna',
            apiKey: 'synthetic-private-value',
          },
          errorCode: 'VALIDATION_FAILED',
          errorMessage:
            'Payload rejected for /tmp/local/vault access_token=synthetic-token-123456789.',
        },
      ],
      routeLabel: 'OpenAI',
    })

    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      kind: 'status',
      text:
        `${ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX}Tool vault.cli.run succeeded in apply mode. Input keys: command.`,
    })
    expect(entries[1]).toMatchObject({
      kind: 'error',
    })
    expect(entries[1]?.text).toContain('Tool healthCommons.get failed')
    expect(entries[1]?.text).toContain('Input keys: apiKey, id.')
    expect(entries[1]?.text).not.toContain('synthetic-private-value')
    expect(entries[1]?.text).not.toContain('/tmp/local')
    expect(entries[1]?.text).not.toContain('synthetic-token-123456789')
    expect(entries[2]).toMatchObject({
      kind: 'error',
    })
    expect(entries[2]?.text).toContain('Provider route OpenAI failed')
    expect(entries[2]?.text).toContain('SCHEMA_REJECTION')
    expect(entries[2]?.text).not.toContain('/tmp/local')
    expect(entries[2]?.text).not.toContain('secret')
  })

  it('handles partial audit events without leaking values or overfilling replay', () => {
    const entries = buildAssistantProviderTranscriptAuditEntries({
      at: '2026-04-08T00:00:00.000Z',
      error: {
        cause: {
          code: 'NESTED_CODE',
          message: 'Nested failure from local scratch path /tmp/local/dev',
        },
      },
      rawToolEvents: [
        null,
        { type: 'assistant.tool.started', tool: 'ignored.started' },
        { type: 'assistant.tool.previewed' },
        {
          type: 'assistant.tool.failed',
          input: 'not-an-object',
        },
      ],
      routeLabel: '',
    })

    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      createdAt: '2026-04-08T00:00:00.000Z',
      kind: 'status',
      text:
        `${ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX}Tool unknown-tool previewed in apply mode.`,
    })
    expect(entries[1]).toMatchObject({
      createdAt: '2026-04-08T00:00:00.000Z',
      kind: 'error',
      text:
        `${ASSISTANT_TRANSCRIPT_AUDIT_TEXT_PREFIX}Tool unknown-tool failed in apply mode: Tool execution failed.`,
    })
    expect(entries[2]?.text).toContain('Provider route failed (NESTED_CODE)')
    expect(entries[2]?.text).not.toContain('/tmp/local')
  })

  it('caps tool audit entries before appending provider failures', () => {
    const rawToolEvents = Array.from({ length: 14 }, (_, index) => ({
      type: 'assistant.tool.succeeded',
      mode: 'apply',
      tool: `tool.${index}`,
      input: {
        id: index,
      },
    }))

    const entries = buildAssistantProviderTranscriptAuditEntries({
      error: 'provider failure outside capped tool list',
      rawToolEvents,
      routeLabel: 'Backup',
    })

    expect(entries).toHaveLength(12)
    expect(entries[0]?.text).toContain('tool.0')
    expect(entries[11]?.text).toContain('tool.11')
    expect(entries.some((entry) => entry.text.includes('provider failure'))).toBe(false)
  })

})
