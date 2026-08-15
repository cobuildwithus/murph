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
    const createMany = vi.fn<
      (input: {
        data: Record<string, unknown>[]
        skipDuplicates: true
      }) => Promise<{ count: number }>
    >(async (input) => ({ count: input.data.length }))
    const prisma = {
      hostedAssistantRuntimeIssue: {
        createMany,
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
    // Stable issue ids make one idempotent insert equivalent to the old
    // per-issue upsert loop.
    expect(createMany).toHaveBeenCalledTimes(1)
    expect(createMany.mock.calls[0]?.[0]?.skipDuplicates).toBe(true)

    const create = createMany.mock.calls[0]?.[0]?.data[0]
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

  it('persists bounded command attribution without a member relation', async () => {
    const createMany = vi.fn<
      (input: {
        data: Record<string, unknown>[]
        skipDuplicates: true
      }) => Promise<{ count: number }>
    >(async (input) => ({ count: input.data.length }))
    prismaMocks.getPrisma.mockReturnValue({
      hostedAssistantRuntimeIssue: {
        createMany,
      },
    })

    await importHostedAssistantRuntimeIssues({
      issues: [
        {
          component: 'assistant.codex-action',
          details: {
            actionKind: 'command.execution',
            commandFamily: 'search',
            commandOrdinal: 3,
            durationMsBucket: '1_5s',
            exitCode: 2,
            failureClass: 'search_error',
            outputBytesBucket: 'lt_1kb',
            recoveredAfterFailure: true,
          },
          environment: 'hosted',
          errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
          fingerprint: TEST_FINGERPRINT,
          issueId: TEST_ISSUE_ID,
          issueKind: 'tool_error',
          occurredAt: '2026-04-08T12:00:00.000Z',
          operation: 'command.execution',
          phase: 'provider_turn',
          schema: 'murph.assistant-runtime-issue.v1',
          severity: 'warning',
          summary: 'Codex command execution failed during provider turn.',
          surface: 'telegram',
        },
      ],
      now: new Date('2026-04-08T00:00:00.000Z'),
    })

    const create = createMany.mock.calls[0]?.[0]?.data[0]
    expect(create).toEqual(expect.objectContaining({
      component: 'assistant.codex-action',
      detailsJson: {
        actionKind: 'command.execution',
        commandFamily: 'search',
        commandOrdinal: 3,
        durationMsBucket: '1_5s',
        exitCode: 2,
        failureClass: 'search_error',
        outputBytesBucket: 'lt_1kb',
        recoveredAfterFailure: true,
      },
      operation: 'command.execution',
    }))
    expect(create).not.toHaveProperty('memberId')
  })

  it('re-sanitizes hosted issue payloads before persistence', async () => {
    const bearerSecret = ['sk', 'testsecret12345'].join('-')
    const providerSecret = ['sk', 'providersecret12345'].join('-')
    const webhookSecret = ['whsec', 'runtimehook12345'].join('_')
    const createMany = vi.fn<
      (input: {
        data: Record<string, unknown>[]
        skipDuplicates: true
      }) => Promise<{ count: number }>
    >(async (input) => ({ count: input.data.length }))
    prismaMocks.getPrisma.mockReturnValue({
      hostedAssistantRuntimeIssue: {
        createMany,
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

    const create = createMany.mock.calls[0]?.[0]?.data[0]
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
