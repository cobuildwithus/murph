import { describe, expect, it, vi } from 'vitest'

import { importHostedAssistantRuntimeIssues } from '@/src/lib/hosted-execution/runtime-issues'

const prismaMocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}))

vi.mock('@/src/lib/prisma', () => ({
  getPrisma: prismaMocks.getPrisma,
}))

const TEST_FINGERPRINT = 'abcdef123456abcdef123456'
const TEST_ISSUE_ID = 'ari_0123456789abcdef_abcdef123456abcdef123456'

describe('importHostedAssistantRuntimeIssues', () => {
  it('stores anonymized issue rows with retention metadata and no member relation', async () => {
    const upsert = vi.fn<
      (input: {
        create: Record<string, unknown>
        update: Record<string, never>
        where: { id: string }
      }) => Promise<void>
    >(async () => undefined)
    const prisma = {
      hostedAssistantRuntimeIssue: {
        upsert,
      },
    }

    prismaMocks.getPrisma.mockReturnValue(prisma)
    const now = new Date('2026-04-08T00:00:00.000Z')
    const result = await importHostedAssistantRuntimeIssues({
      issues: [
        {
          component: 'assistant.reply-finalizer',
          details: {
            noteCharCount: 42,
          },
          environment: 'hosted',
          errorCode: null,
          fingerprint: TEST_FINGERPRINT,
          issueId: TEST_ISSUE_ID,
          issueKind: 'dev_note_stripped',
          occurredAt: '2026-04-08T12:00:00.000Z',
          operation: null,
          phase: 'final_response',
          schema: 'murph.assistant-runtime-issue.v1',
          severity: 'warning',
          summary:
            'Assistant produced a visible developer note on a surface where developer notes are hidden.',
          surface: 'telegram',
        },
      ],
      now,
    })

    expect(result.recordedIds).toEqual([TEST_ISSUE_ID])
    expect(result.records).toHaveLength(1)
    expect(upsert).toHaveBeenCalledTimes(1)

    const upsertInput = upsert.mock.calls[0]?.[0]
    expect(upsertInput?.where).toEqual({
      id: TEST_ISSUE_ID,
    })

    const create = upsertInput?.create
    expect(create).toEqual(
      expect.objectContaining({
        component: 'assistant.reply-finalizer',
        detailsJson: {
          noteCharCount: 42,
        },
        environment: 'hosted',
        errorCode: null,
        expiresAt: new Date('2026-05-08T00:00:00.000Z'),
        fingerprint: TEST_FINGERPRINT,
        id: TEST_ISSUE_ID,
        issueKind: 'dev_note_stripped',
        occurredAt: new Date('2026-04-08T12:00:00.000Z'),
        operation: null,
        phase: 'final_response',
        severity: 'warning',
        summary:
          'Assistant produced a visible developer note on a surface where developer notes are hidden.',
        surface: 'telegram',
      }),
    )
    expect(create).not.toHaveProperty('memberId')
  })

  it('re-sanitizes hosted issue payloads before persistence', async () => {
    const bearerSecret = ['sk', 'testsecret12345'].join('-')
    const providerSecret = ['sk', 'providersecret12345'].join('-')
    const webhookSecret = ['whsec', 'runtimehook12345'].join('_')
    const upsert = vi.fn<
      (input: {
        create: Record<string, unknown>
        update: Record<string, never>
        where: { id: string }
      }) => Promise<void>
    >(async () => undefined)
    prismaMocks.getPrisma.mockReturnValue({
      hostedAssistantRuntimeIssue: {
        upsert,
      },
    })

    await importHostedAssistantRuntimeIssues({
      issues: [
        {
          component: 'assistant.reply-finalizer',
          details: {
            rawPrompt: 'Contact <REDACTED_NAME> at user@example.com or /tmp/private-note.txt',
            rawToolInput: `Bearer ${bearerSecret} then bare ${providerSecret} and ${webhookSecret}`,
            nested: {
              url: 'https://example.com/private',
            },
          },
          environment: 'hosted',
          errorCode: `TOKEN ${bearerSecret}`,
          fingerprint: TEST_FINGERPRINT,
          issueId: TEST_ISSUE_ID,
          issueKind: 'tool_error',
          occurredAt: '2026-04-08T12:00:00.000Z',
          operation: 'tool run /tmp/private-note.txt',
          phase: 'tool_call',
          schema: 'murph.assistant-runtime-issue.v1',
          severity: 'warning',
          summary:
            `Prompt leaked from /tmp/private-note.txt for user@example.com with Bearer ${bearerSecret} and ${providerSecret}`,
          surface: 'telegram',
        },
      ],
      now: new Date('2026-04-08T00:00:00.000Z'),
    })

    const create = upsert.mock.calls[0]?.[0]?.create
    expect(create).toEqual(
      expect.objectContaining({
        component: 'assistant.reply-finalizer',
        errorCode: null,
        operation: null,
        summary: 'Prompt leaked from [path] for [email] with Bearer [REDACTED] and [REDACTED]',
      }),
    )
    expect(create?.detailsJson).toEqual({
      nested: {
        url: '[url]',
      },
      rawPrompt: 'Contact <REDACTED_NAME> at [email] or [path]',
      rawToolInput: 'Bearer [REDACTED] then bare [REDACTED] and [REDACTED]',
    })
  })
})
