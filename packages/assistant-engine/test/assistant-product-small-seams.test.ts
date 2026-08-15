import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  AssistantDeliveryError,
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveAssistantConversationPolicy,
  resolveAssistantConversationScope,
} from '../src/assistant/conversation-policy.ts'
import {
  flushPendingAssistantRuntimeIssueWrites,
  recordAssistantRuntimeIssueInputsBestEffort,
  recordAssistantRuntimeIssue,
  recordAssistantToolFailureRuntimeIssues,
  resolveAssistantDiagnosticsPolicy,
} from '../src/assistant/issue-reporting.ts'
import { normalizeCodexEvent } from '../src/assistant-codex-events.ts'
import {
  createCodexActionRuntimeIssueTracker,
} from '../src/assistant-codex/action-diagnostics.ts'
import {
  hasAssistantSeenFirstContact,
  markAssistantFirstContactSeen,
  resolveAssistantFirstContactStateDocIds,
} from '../src/assistant/first-contact.ts'
import {
  ASSISTANT_OPERATOR_AUTHORITY_VALUES,
  isAssistantOperatorAuthority,
  resolveAssistantOperatorAuthority,
  resolveTrustedLocalAssistantOperatorAuthority,
} from '../src/assistant/operator-authority.ts'
import {
  buildFailedAssistantPromptAttemptText,
  extractAssistantAutoReplyFailedPromptText,
} from '../src/assistant/prompt-attempts.ts'
import {
  maybeRunAssistantRuntimeMaintenance,
  readAssistantRuntimeBudgetStatus,
  runAssistantRuntimeMaintenance,
} from '../src/assistant/runtime-budgets.ts'
import {
  createEmptyAssistantDiagnosticsCounters,
  readAssistantDiagnosticsSnapshot,
  recordAssistantDiagnosticEvent,
} from '../src/assistant/diagnostics.ts'
import { resolveAssistantExecutionPlan } from '../src/assistant/execution-plan.ts'
import {
  consumeInjectedAssistantFault,
  hasInjectedAssistantFault,
  maybeThrowInjectedAssistantFault,
  resetInjectedAssistantFaults,
} from '../src/assistant/fault-injection.ts'
import { createAssistantRuntimeCache } from '../src/assistant/runtime-cache.ts'
import {
  resolveAssistantStateDocumentPath,
} from '../src/assistant/state.ts'
import {
  resolveAssistantStatePaths,
} from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.js'

const runtimeStateMocks = vi.hoisted(() => ({
  writePendingAssistantRuntimeIssueRecord: vi.fn(),
}))

vi.mock('@murphai/runtime-state/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@murphai/runtime-state/node')>()
  return {
    ...actual,
    writePendingAssistantRuntimeIssueRecord:
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord,
  }
})

const tempRoots: string[] = []

afterEach(async () => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.doUnmock('../src/assistant/store.js')
  vi.doUnmock('../src/assistant/turn-lock.js')
  vi.doUnmock('../src/assistant/runtime-state-service.js')
  vi.doUnmock('../src/assistant/runtime-events.js')
  vi.doUnmock('../src/assistant/session-resolution.js')
  vi.doUnmock('@murphai/runtime-state/node')
  vi.doUnmock('../src/assistant/first-contact.js')
  vi.doUnmock('../src/assistant/quarantine.js')
  vi.doUnmock('../src/assistant/cron.js')
  vi.doUnmock('../src/assistant/delivery-service.js')
  vi.doUnmock('../src/assistant/store.js')
  vi.doUnmock('@murphai/operator-config/operator-config')
  vi.doUnmock('@murphai/operator-config/assistant/provider-config')
  vi.doUnmock('@murphai/vault-usecases/runtime')
  resetInjectedAssistantFaults()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant product small seams', () => {
  it('resolves conversation audiences and directness for delivery routing', () => {
    const explicitOverride = resolveAssistantConversationPolicy({
      message: {
        deliverResponse: true,
        deliveryReplyToMessageId: 'reply-1',
        deliveryTarget: 'actor-1',
        operatorAuthority: 'direct-operator',
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: 'actor-1',
          channel: 'email',
          conversationKey: null,
          delivery: {
            kind: 'participant',
            target: 'actor-1',
          },
          identityId: 'identity-1',
          threadId: 'thread-1',
          threadIsDirect: true,
        },
      },
    })

    expect(explicitOverride.audience).toMatchObject({
      deliveryPolicy: 'explicit-target-override',
      effectiveThreadIsDirect: true,
      replyToMessageId: 'reply-1',
      threadId: 'thread-1',
      threadIsDirect: true,
    })
    expect(explicitOverride.operatorAuthority).toBe('direct-operator')
    expect(resolveAssistantConversationScope(explicitOverride.audience)).toBe('direct')

    const publicAudience = resolveAssistantConversationPolicy({
      message: {
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: 'group-thread',
        operatorAuthority: 'direct-operator',
        threadId: 'group-thread',
        threadIsDirect: false,
      },
      session: {
        binding: {
          actorId: 'actor-1',
          channel: 'telegram',
          conversationKey: null,
          delivery: null,
          identityId: 'identity-1',
          threadId: 'group-thread',
          threadIsDirect: false,
        },
      },
    })

    expect(publicAudience.audience).toMatchObject({
      deliveryPolicy: 'explicit-target-override',
      effectiveThreadIsDirect: false,
      threadId: 'group-thread',
      threadIsDirect: false,
    })
    expect(resolveAssistantConversationScope(publicAudience.audience)).toBe('group')

    const messageChannelFallback = resolveAssistantConversationPolicy({
      message: {
        channel: 'telegram',
        conversation: {
          channel: null,
          directness: 'direct',
          threadId: 'telegram-thread',
        },
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: 'telegram-thread',
        operatorAuthority: 'direct-operator',
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: null,
          channel: null,
          conversationKey: null,
          delivery: null,
          identityId: null,
          threadId: null,
          threadIsDirect: null,
        },
      },
    })
    expect(messageChannelFallback.audience).toMatchObject({
      channel: 'telegram',
      deliveryPolicy: 'explicit-target-override',
      effectiveThreadIsDirect: null,
      explicitTarget: 'telegram-thread',
      threadId: 'telegram-thread',
      threadIsDirect: true,
    })
    expect(resolveAssistantConversationScope(messageChannelFallback.audience)).toBe(
      'unverified-external',
    )

    const unboundGroupTarget = resolveAssistantConversationPolicy({
      message: {
        channel: 'telegram',
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: 'telegram-group',
        operatorAuthority: 'direct-operator',
        threadId: 'telegram-group',
        threadIsDirect: false,
      },
      session: {
        binding: {
          actorId: null,
          channel: null,
          conversationKey: null,
          delivery: null,
          identityId: null,
          threadId: null,
          threadIsDirect: null,
        },
      },
    })
    expect(unboundGroupTarget.audience.effectiveThreadIsDirect).toBeNull()
    expect(resolveAssistantConversationScope(unboundGroupTarget.audience)).toBe(
      'unverified-external',
    )

    const blindedHostedDirectAudience = resolveAssistantConversationPolicy({
      message: {
        bindingDeliveryTarget: 'provider-direct-thread',
        channel: 'linq',
        conversation: {
          channel: 'linq',
          directness: 'direct',
          threadId: 'blinded-direct-thread',
        },
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: 'provider-direct-thread',
        operatorAuthority: 'direct-operator',
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: 'blinded-direct-actor',
          channel: 'linq',
          conversationKey: null,
          delivery: {
            kind: 'thread',
            target: 'blinded-direct-thread',
          },
          identityId: 'blinded-direct-identity',
          threadId: 'blinded-direct-thread',
          threadIsDirect: true,
        },
      },
    })
    expect(blindedHostedDirectAudience.audience.effectiveThreadIsDirect).toBe(true)
    expect(resolveAssistantConversationScope(blindedHostedDirectAudience.audience)).toBe(
      'direct',
    )

    const blindedHostedGroupAudience = resolveAssistantConversationPolicy({
      message: {
        bindingDeliveryTarget: 'provider-group-thread',
        channel: 'linq',
        conversation: {
          channel: 'linq',
          directness: 'group',
          threadId: 'blinded-group-thread',
        },
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: 'provider-group-thread',
        operatorAuthority: 'direct-operator',
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: 'blinded-group-actor',
          channel: 'linq',
          conversationKey: null,
          delivery: {
            kind: 'thread',
            target: 'blinded-group-thread',
          },
          identityId: 'blinded-group-identity',
          threadId: 'blinded-group-thread',
          threadIsDirect: false,
        },
      },
    })
    expect(blindedHostedGroupAudience.audience.effectiveThreadIsDirect).toBe(false)
    expect(resolveAssistantConversationScope(blindedHostedGroupAudience.audience)).toBe(
      'group',
    )

    const unverifiedExternalAudience = resolveAssistantConversationPolicy({
      message: {
        channel: 'telegram',
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: 'external-thread',
        operatorAuthority: 'direct-operator',
        threadId: 'external-thread',
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: null,
          channel: 'telegram',
          conversationKey: null,
          delivery: null,
          identityId: null,
          threadId: 'external-thread',
          threadIsDirect: null,
        },
      },
    })
    expect(
      resolveAssistantConversationScope(unverifiedExternalAudience.audience),
    ).toBe('unverified-external')

    const mismatchedDirectTarget = resolveAssistantConversationPolicy({
      message: {
        channel: 'telegram',
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: 'different-thread',
        operatorAuthority: 'direct-operator',
        threadId: 'different-thread',
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: 'direct-actor',
          channel: 'telegram',
          conversationKey: null,
          delivery: {
            kind: 'thread',
            target: 'stored-direct-thread',
          },
          identityId: 'direct-identity',
          threadId: 'stored-direct-thread',
          threadIsDirect: true,
        },
      },
    })
    expect(mismatchedDirectTarget.audience.effectiveThreadIsDirect).toBeNull()
    expect(resolveAssistantConversationScope(mismatchedDirectTarget.audience)).toBe(
      'unverified-external',
    )

    const mismatchedExplicitDirectTarget = resolveAssistantConversationPolicy({
      message: {
        bindingDeliveryTarget: 'current-direct-thread',
        channel: 'telegram',
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: 'different-target',
        operatorAuthority: 'direct-operator',
        threadId: 'current-direct-thread',
        threadIsDirect: true,
      },
      session: {
        binding: {
          actorId: 'direct-actor',
          channel: 'telegram',
          conversationKey: null,
          delivery: {
            kind: 'thread',
            target: 'current-direct-thread',
          },
          identityId: 'direct-identity',
          threadId: 'current-direct-thread',
          threadIsDirect: true,
        },
      },
    })
    expect(mismatchedExplicitDirectTarget.audience.effectiveThreadIsDirect).toBeNull()
    expect(
      resolveAssistantConversationScope(mismatchedExplicitDirectTarget.audience),
    ).toBe('unverified-external')

    const bindingTargetOnly = resolveAssistantConversationPolicy({
      message: {
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: null,
        operatorAuthority: 'direct-operator',
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: ' actor-2 ',
          channel: ' email ',
          conversationKey: null,
          delivery: {
            kind: 'participant',
            target: 'actor-2',
          },
          identityId: 'identity-2',
          threadId: null,
          threadIsDirect: null,
        },
      },
    })
    expect(bindingTargetOnly.audience.deliveryPolicy).toBe('binding-target-only')
    expect(bindingTargetOnly.audience.effectiveThreadIsDirect).toBe(true)

    const threadTargetAudience = resolveAssistantConversationPolicy({
      message: {
        conversation: null,
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: null,
        operatorAuthority: 'direct-operator',
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: 'actor-3',
          channel: 'telegram',
          conversationKey: null,
          delivery: {
            kind: 'thread',
            target: 'thread-3',
          },
          identityId: 'identity-3',
          threadId: 'thread-3',
          threadIsDirect: false,
        },
      },
    })
    expect(threadTargetAudience.audience.effectiveThreadIsDirect).toBe(false)

    const reboundDirectThreadAudience = resolveAssistantConversationPolicy({
      message: {
        conversation: {
          channel: 'linq',
          directness: 'direct',
          identityId: 'identity-4',
          participantId: 'actor-4',
          threadId: 'chat-4',
        },
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: null,
        operatorAuthority: 'direct-operator',
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: 'actor-4',
          channel: 'linq',
          conversationKey: null,
          delivery: {
            kind: 'participant',
            target: 'actor-4',
          },
          identityId: 'identity-4',
          threadId: null,
          threadIsDirect: true,
        },
      },
    })
    expect(reboundDirectThreadAudience.audience).toMatchObject({
      bindingDelivery: {
        kind: 'thread',
        target: 'chat-4',
      },
      threadId: 'chat-4',
      threadIsDirect: true,
    })
  })

  it('hashes first-contact doc ids, skips indirect actor ids, and persists seen markers', async () => {
    const directIds = resolveAssistantFirstContactStateDocIds({
      actorId: ' actor-1 ',
      channel: ' email ',
      identityId: ' identity-1 ',
      threadId: ' thread-1 ',
      threadIsDirect: true,
    })
    expect(directIds).toHaveLength(2)
    expect(directIds.every((value) => value.startsWith('onboarding/first-contact/'))).toBe(
      true,
    )

    expect(
      resolveAssistantFirstContactStateDocIds({
        actorId: 'actor-1',
        channel: 'email',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: false,
      }),
    ).toHaveLength(1)
    expect(
      resolveAssistantFirstContactStateDocIds({
        actorId: 'actor-1',
        channel: '   ',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
      }),
    ).toEqual([])

    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-first-contact-small-seams-',
    )
    tempRoots.push(parentRoot)

    expect(
      await hasAssistantSeenFirstContact({
        docIds: directIds,
        vault: vaultRoot,
      }),
    ).toBe(false)

    await markAssistantFirstContactSeen({
      docIds: [directIds[0], directIds[0], '  ', directIds[1]].filter(
        (value) => value.length > 0,
      ),
      seenAt: '2026-04-08T00:00:00.000Z',
      vault: vaultRoot,
    })

    expect(
      await hasAssistantSeenFirstContact({
        docIds: directIds,
        vault: vaultRoot,
      }),
    ).toBe(true)

    const malformedDocId = resolveAssistantFirstContactStateDocIds({
      actorId: 'actor-2',
      channel: 'email',
      identityId: 'identity-2',
      threadId: null,
      threadIsDirect: true,
    })[0]
    const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
    const malformedPath = resolveAssistantStateDocumentPath(
      {
        stateDirectory,
      },
      malformedDocId,
    )
    await mkdir(path.dirname(malformedPath), {
      recursive: true,
    })
    await writeFile(malformedPath, '{"broken":', 'utf8')

    expect(
      await hasAssistantSeenFirstContact({
        docIds: [malformedDocId],
        vault: vaultRoot,
      }),
    ).toBe(false)
  })

  it('normalizes assistant operator authority values', () => {
    expect(ASSISTANT_OPERATOR_AUTHORITY_VALUES).toEqual([
      'direct-operator',
    ])
    expect(isAssistantOperatorAuthority('direct-operator')).toBe(true)
    expect(isAssistantOperatorAuthority('user')).toBe(false)
    expect(resolveAssistantOperatorAuthority('not-valid')).toBe(
      'direct-operator',
    )
    expect(resolveAssistantOperatorAuthority(undefined)).toBe(
      'direct-operator',
    )
    expect(resolveTrustedLocalAssistantOperatorAuthority('not-valid')).toBe(
      'direct-operator',
    )
  })

  it('extracts failed auto-reply prompts and persists deduplicated failure entries', async () => {
    const appendAssistantTranscriptEntries = vi.fn().mockResolvedValue(undefined)
    const listAssistantTranscriptEntries = vi.fn()
    const promptModule = await loadPromptAttemptsModule({
      appendAssistantTranscriptEntries,
      listAssistantTranscriptEntries,
    })

    expect(
      extractAssistantAutoReplyFailedPromptText(
        [
          'Input 1:',
          'Message ref: ain_11111111111111111111111111111111',
          'Reply context:',
          'quoted',
          '',
          'Message text:',
          'first message',
          '',
          'Input 2:',
          'Message ref: ain_22222222222222222222222222222222',
          'Message text:',
          'second message',
        ].join('\n'),
      ),
    ).toBe('first message\n\nsecond message')
    expect(
      extractAssistantAutoReplyFailedPromptText(
        [
          'Source: telegram',
          '',
          'Message ref: ain_33333333333333333333333333333333',
          '',
          'Attachment context:',
          'content: unavailable',
        ].join('\n'),
      ),
    ).toBe('Source: telegram\n\nAttachment context:\ncontent: unavailable')
    expect(
      extractAssistantAutoReplyFailedPromptText(
        [
          'Message text:',
          'Message ref: ain_44444444444444444444444444444444',
        ].join('\n'),
      ),
    ).toBe('Message ref: ain_44444444444444444444444444444444')
    expect(
      buildFailedAssistantPromptAttemptText({
        prompt: 'plain prompt',
        turnTrigger: 'manual-ask',
      }),
    ).toBe('Failed assistant prompt attempt [manual-ask]: plain prompt')

    await promptModule.persistFailedAssistantPromptAttempt({
      persistUserPromptOnFailure: true,
      prompt: 'ignored',
      session: createAssistantSession(),
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnTrigger: 'manual-ask',
      vault: '/tmp/test-vault',
    })
    expect(listAssistantTranscriptEntries).not.toHaveBeenCalled()
    expect(appendAssistantTranscriptEntries).not.toHaveBeenCalled()

    listAssistantTranscriptEntries.mockResolvedValueOnce([
      {
        kind: 'error',
        text: 'Failed assistant prompt attempt [manual-ask]: duplicate',
      },
    ])
    await promptModule.persistFailedAssistantPromptAttempt({
      persistUserPromptOnFailure: false,
      prompt: 'duplicate',
      session: createAssistantSession(),
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnTrigger: 'manual-ask',
      vault: '/tmp/test-vault',
    })
    expect(appendAssistantTranscriptEntries).not.toHaveBeenCalled()

    listAssistantTranscriptEntries.mockResolvedValueOnce([])
    await promptModule.persistFailedAssistantPromptAttempt({
      persistUserPromptOnFailure: false,
      prompt: 'Input 1:\nMessage text:\nqueued reply',
      session: createAssistantSession({
        sessionId: 'session-2',
      }),
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnTrigger: 'automation-auto-reply',
      vault: '/tmp/test-vault',
    })
    expect(appendAssistantTranscriptEntries).toHaveBeenCalledWith(
      '/tmp/test-vault',
      'session-2',
      [
        {
          kind: 'error',
          text:
            'Failed assistant prompt attempt [automation-auto-reply]: queued reply',
          createdAt: '2026-04-08T00:00:00.000Z',
        },
      ],
    )
  })

  it('resolves diagnostics policy environment and private issue capture overrides', () => {
    const localPolicy = resolveAssistantDiagnosticsPolicy({
      channel: 'email',
      env: {},
      executionContext: null,
    })
    expect(localPolicy).toMatchObject({
      environment: 'local',
      privateIssueCaptureEnabled: true,
      surface: 'email',
    })

    const disabledPolicy = resolveAssistantDiagnosticsPolicy({
      channel: 'email',
      env: {
        MURPH_ASSISTANT_PRIVATE_ISSUES: 'false',
      },
      executionContext: null,
    })
    expect(disabledPolicy).toMatchObject({
      environment: 'local',
      privateIssueCaptureEnabled: false,
      surface: 'email',
    })

    const invalidEnvPolicy = resolveAssistantDiagnosticsPolicy({
      channel: 'local',
      env: {
        MURPH_ASSISTANT_PRIVATE_ISSUES: 'sometimes',
      },
      executionContext: null,
    })
    expect(invalidEnvPolicy).toMatchObject({
      environment: 'local',
      privateIssueCaptureEnabled: true,
      surface: 'local',
    })

    const hostedPolicy = resolveAssistantDiagnosticsPolicy({
      channel: 'telegram',
      env: {},
      executionContext: {
        hosted: {
          memberId: 'member-1',
          userEnvKeys: [],
        },
      },
    })
    expect(hostedPolicy).toMatchObject({
      environment: 'hosted',
      privateIssueCaptureEnabled: true,
      surface: 'telegram',
    })
  })

  it('skips runtime issue writes when private capture is disabled', async () => {
    const disabledPolicy = resolveAssistantDiagnosticsPolicy({
      channel: 'email',
      env: {
        MURPH_ASSISTANT_PRIVATE_ISSUES: 'no',
      },
      executionContext: null,
    })

    await recordAssistantRuntimeIssue({
      issue: {
        component: 'assistant.tool',
        issueKind: 'tool_error',
        phase: 'tool_call',
        severity: 'warning',
        summary: 'This write should be skipped.',
      },
      policy: disabledPolicy,
      vault: '/vaults/test',
    })

    await recordAssistantToolFailureRuntimeIssues({
      policy: disabledPolicy,
      rawToolEvents: [
        {
          type: 'assistant.tool.failed',
        },
      ],
      vault: '/vaults/test',
    })

    expect(
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord,
    ).not.toHaveBeenCalled()
  })

  it('sanitizes runtime issue records before persisting them', async () => {
    runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mockResolvedValue(undefined)

    const policy = resolveAssistantDiagnosticsPolicy({
      channel: ' email ',
      env: {
        MURPH_ASSISTANT_PRIVATE_ISSUES: 'true',
      },
      executionContext: null,
    })

    const sensitiveSummary = [
      'foo@example.com',
      '+1 (555) 777-9999',
      'https://example.com/private/log',
      '/Users/example/private/notes.txt',
      'C:\\Temp\\secret.txt',
      'authorization=secret-value',
      'Repeated summary text '.repeat(20).trim(),
    ].join(' ')

    const details = Object.fromEntries([
      ['bool', false],
      ['nullable', null],
      ['finite', 42],
      ['infinite', Number.POSITIVE_INFINITY],
      [
        'string',
        [
          'token=top-secret',
          'foo@example.com',
          '+1 (555) 333-4444',
          'https://example.com/traces',
          '/Users/example/private/trace.log',
          'C:\\Temp\\trace.log',
        ].join(' '),
      ],
      [
        'array',
        [
          null,
          false,
          5,
          Number.NaN,
          'bar@example.com',
          {
            authorization: 'Bearer top-secret-token',
            path: '/tmp/private-file',
          },
          [],
        ],
      ],
      [
        'object',
        {
          authorization: 'Bearer nested-token',
          nestedEmail: 'baz@example.com',
          nestedPath: '/Users/example/private/object.log',
          nestedPhone: '+1 (555) 111-2222',
          nestedUrl: 'file:///tmp/object.log',
        },
      ],
      ['9bad', 'ignored'],
      ...Array.from({ length: 30 }, (_, index) => [
        `extra${String(index).padStart(2, '0')}`,
        index,
      ]),
    ])

    await recordAssistantRuntimeIssue({
      issue: {
        component: ' !!! ',
        details,
        errorCode: ' E_TIMEOUT ',
        issueKind: 'tool_error',
        operation: ' codex.tool ',
        phase: 'tool_call',
        severity: 'warning',
        summary: sensitiveSummary,
      },
      policy,
      vault: '/vaults/test',
    })

    await recordAssistantRuntimeIssue({
      issue: {
        component: 'assistant.cleanup',
        issueKind: 'timeout',
        operation: ' cleanup ',
        phase: 'vault_write',
        severity: 'warning',
        summary: 'No extra details.',
      },
      policy,
      vault: '/vaults/test',
    })

    expect(
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord,
    ).toHaveBeenCalledTimes(2)

    const firstCall =
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mock.calls[0]?.[0]
    const secondCall =
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mock.calls[1]?.[0]

    expect(firstCall).toMatchObject({
      vault: '/vaults/test',
      record: expect.objectContaining({
        component: 'assistant-runtime',
        environment: 'local',
        errorCode: 'E_TIMEOUT',
        issueKind: 'tool_error',
        operation: 'codex.tool',
        phase: 'tool_call',
        severity: 'warning',
        surface: 'email',
      }),
    })

    const writtenRecord = firstCall?.record as {
      details: Record<string, unknown>
      summary: string
    }
    expect(writtenRecord.summary).toContain('[email]')
    expect(writtenRecord.summary).toContain('[number]')
    expect(writtenRecord.summary).toContain('[url]')
    expect(writtenRecord.summary).toContain('[path]')
    expect(writtenRecord.summary.endsWith('…')).toBe(true)
    expect(writtenRecord.details).toMatchObject({
      array: expect.arrayContaining([
        null,
        false,
        5,
        '[email]',
        {
          authorization: '[REDACTED]',
          path: '[path]',
        },
      ]),
      bool: false,
      extra00: 0,
      extra17: 17,
      finite: 42,
      nullable: null,
      object: {
        authorization: '[REDACTED]',
        nestedEmail: '[email]',
        nestedPath: '[path]',
        nestedPhone: '[number]',
        nestedUrl: '[url]',
      },
    })
    expect(writtenRecord.details.string).toContain('[email]')
    expect(writtenRecord.details.string).toContain('[number]')
    expect(writtenRecord.details.string).toContain('[url]')
    expect(writtenRecord.details.string).toContain('[path]')
    expect(writtenRecord.details.string).toContain('[REDACTED]')
    expect(writtenRecord.details).not.toHaveProperty('9bad')
    expect(writtenRecord.details).not.toHaveProperty('infinite')
    expect(writtenRecord.details).not.toHaveProperty('extra18')
    expect(JSON.stringify(writtenRecord)).not.toContain('top-secret')
    expect(JSON.stringify(writtenRecord)).not.toContain('foo@example.com')
    expect(JSON.stringify(writtenRecord)).not.toContain('/Users/example/private')

    expect(secondCall).toMatchObject({
      vault: '/vaults/test',
      record: expect.objectContaining({
        component: 'assistant.cleanup',
        details: {},
        issueKind: 'timeout',
        operation: 'cleanup',
      }),
    })
  })

  it('persists only bounded command failure attribution', async () => {
    runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mockResolvedValue(
      undefined,
    )
    const tracker = createCodexActionRuntimeIssueTracker()
    const started = {
      method: 'item/started',
      params: {
        item: {
          command: 'rg private-query /tmp/private-record',
          id: 'private-command-id',
          type: 'commandExecution',
        },
        turnId: 'private-turn-id',
      },
    }
    const failed = {
      method: 'item/completed',
      params: {
        item: {
          aggregatedOutput: 'private command output',
          exitCode: 2,
          id: 'private-command-id',
          type: 'commandExecution',
        },
        turnId: 'private-turn-id',
      },
    }
    const recovered = {
      method: 'item/completed',
      params: {
        item: {
          command: 'rg narrower-query /tmp/private-record',
          exitCode: 0,
          id: 'private-recovery-id',
          type: 'commandExecution',
        },
        turnId: 'private-turn-id',
      },
    }

    expect(tracker.recordEvent({
      activeTurnId: 'private-turn-id',
      normalizedEvent: normalizeCodexEvent(started),
      rawEvent: started,
    })).toBeNull()
    const issue = tracker.recordEvent({
      activeTurnId: 'private-turn-id',
      normalizedEvent: normalizeCodexEvent(failed),
      rawEvent: failed,
    })
    expect(issue).not.toBeNull()
    expect(tracker.recordEvent({
      activeTurnId: 'private-turn-id',
      normalizedEvent: normalizeCodexEvent(recovered),
      rawEvent: recovered,
    })).toBeNull()

    await recordAssistantRuntimeIssue({
      issue: issue!,
      policy: resolveAssistantDiagnosticsPolicy({
        channel: 'telegram',
        env: {},
        executionContext: {
          hosted: {
            memberId: 'private-member-id',
            userEnvKeys: [],
          },
        },
      }),
      vault: '/vaults/test',
    })

    const written =
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mock.calls[0]?.[0]
    expect(written?.record.details).toEqual({
      actionKind: 'command.execution',
      commandFamily: 'search',
      commandOrdinal: 1,
      durationMsBucket: 'unknown',
      exitCode: 2,
      failureClass: 'search_error',
      outputBytesBucket: 'lt_1kb',
      recoveredAfterFailure: true,
    })
    const encodedRecord = JSON.stringify(written?.record)
    expect(encodedRecord).not.toContain('private-query')
    expect(encodedRecord).not.toContain('narrower-query')
    expect(encodedRecord).not.toContain('/tmp/private-record')
    expect(encodedRecord).not.toContain('private command output')
    expect(encodedRecord).not.toContain('private-command-id')
    expect(encodedRecord).not.toContain('private-recovery-id')
    expect(encodedRecord).not.toContain('private-turn-id')
    expect(encodedRecord).not.toContain('private-member-id')
  })

  it('records runtime issue inputs best-effort without blocking or exceeding the cap', async () => {
    runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mockRejectedValue(
      new Error('write failed'),
    )

    const policy = resolveAssistantDiagnosticsPolicy({
      channel: 'telegram',
      env: {
        MURPH_ASSISTANT_PRIVATE_ISSUES: 'true',
      },
      executionContext: null,
    })
    const issues = Array.from({ length: 10 }, (_, index) => ({
      component: 'assistant.codex-action',
      details: {
        unsafeText: `token=secret-value /tmp/private-${index}.log`,
      },
      errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
      issueKind: 'tool_error' as const,
      operation: 'command.execution',
      phase: 'provider_turn' as const,
      severity: 'warning' as const,
      summary: 'Codex command execution failed during provider turn.',
    }))

    expect(() => {
      recordAssistantRuntimeIssueInputsBestEffort({
        issues,
        policy,
        vault: '/vaults/test',
      })
    }).not.toThrow()

    expect(
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord,
    ).toHaveBeenCalledTimes(8)
    const firstRecord =
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mock.calls[0]?.[0]?.record
    expect(firstRecord).toMatchObject({
      component: 'assistant.codex-action',
      details: {
        unsafeText: expect.stringContaining('[path]'),
      },
      errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
      issueKind: 'tool_error',
      operation: 'command.execution',
      phase: 'provider_turn',
      severity: 'warning',
      surface: 'telegram',
      summary: 'Codex command execution failed during provider turn.',
    })
    expect(JSON.stringify(firstRecord)).not.toContain('secret-value')
    expect(JSON.stringify(firstRecord)).not.toContain('/tmp/private')

    runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mockClear()
    recordAssistantRuntimeIssueInputsBestEffort({
      issues,
      policy: {
        ...policy,
        privateIssueCaptureEnabled: false,
      },
      vault: '/vaults/test',
    })
    expect(
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord,
    ).not.toHaveBeenCalled()
    await flushPendingAssistantRuntimeIssueWrites()
  })

  it('flushes pending best-effort runtime issue writes on demand', async () => {
    let resolveWrite!: () => void
    runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveWrite = resolve
      }),
    )

    const policy = resolveAssistantDiagnosticsPolicy({
      channel: 'linq',
      env: {
        MURPH_ASSISTANT_PRIVATE_ISSUES: 'true',
      },
      executionContext: null,
    })

    recordAssistantRuntimeIssueInputsBestEffort({
      issues: [
        {
          component: 'assistant.codex-provider',
          details: {
            providerActionCount: 1,
            providerRequestOutcome: 'failed',
            rawEventCountBucket: '1',
          },
          errorCode: 'ASSISTANT_CODEX_PROVIDER_FAILED',
          issueKind: 'tool_error',
          operation: 'codex-cli',
          phase: 'provider_turn',
          severity: 'error',
          summary: 'Codex provider turn failed.',
        },
      ],
      policy,
      vault: '/vaults/test',
    })

    expect(runtimeStateMocks.writePendingAssistantRuntimeIssueRecord).toHaveBeenCalledOnce()

    let flushed = false
    const flush = flushPendingAssistantRuntimeIssueWrites().then(() => {
      flushed = true
    })
    await Promise.resolve()
    expect(flushed).toBe(false)

    resolveWrite()
    await flush
    expect(flushed).toBe(true)
  })

  it('extracts and classifies tool failure runtime issues from provider events', async () => {
    runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mockResolvedValue(undefined)

    const policy = resolveAssistantDiagnosticsPolicy({
      channel: 'email',
      env: {
        MURPH_ASSISTANT_PRIVATE_ISSUES: 'true',
      },
      executionContext: null,
    })

    await recordAssistantToolFailureRuntimeIssues({
      policy,
      rawToolEvents: [
        null,
        [],
        'not-an-event',
        {
          type: 'assistant.tool.started',
        },
        {
          errorCode: 'SCHEMA_INVALID',
          errorMessage: 'provider rejected invalid payload',
          input: {
            ' contact id ': '1',
            'bad key!': '2',
          },
          mode: ' sync ',
          sequence: 1,
          tool: ' Lookup Contacts ',
          type: 'assistant.tool.failed',
        },
        {
          errorMessage: 'request timed out before deadline',
          input: 'not-an-object',
          mode: 5,
          sequence: '2',
          tool: '   ',
          type: 'assistant.tool.failed',
        },
        {
          errorCode: 'E_REMOTE',
          errorMessage: 42,
          input: {
            z: 'last',
            a: 'first',
          },
          mode: 'async',
          sequence: 3,
          tool: 'notes/export',
          type: 'assistant.tool.failed',
        },
      ],
      vault: '/vaults/test',
    })

    expect(
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord,
    ).toHaveBeenCalledTimes(3)

    const schemaCall =
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mock.calls[0]?.[0]
    const timeoutCall =
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mock.calls[1]?.[0]
    const genericCall =
      runtimeStateMocks.writePendingAssistantRuntimeIssueRecord.mock.calls[2]?.[0]

    expect(schemaCall).toMatchObject({
      vault: '/vaults/test',
      record: expect.objectContaining({
        component: 'assistant.tool',
        details: {
          inputKeys: ['bad-key', 'contact-id'],
          mode: 'sync',
          sequence: 1,
        },
        errorCode: 'SCHEMA_INVALID',
        issueKind: 'schema_rejection',
        operation: 'Lookup-Contacts',
        phase: 'tool_call',
        severity: 'warning',
        summary: 'Assistant tool Lookup-Contacts failed during provider turn.',
      }),
    })

    expect(timeoutCall).toMatchObject({
      vault: '/vaults/test',
      record: expect.objectContaining({
        details: {
          inputKeys: [],
          mode: null,
          sequence: null,
        },
        errorCode: null,
        issueKind: 'timeout',
        operation: 'unknown-tool',
        summary: 'Assistant tool unknown-tool failed during provider turn.',
      }),
    })

    expect(genericCall).toMatchObject({
      vault: '/vaults/test',
      record: expect.objectContaining({
        details: {
          inputKeys: ['a', 'z'],
          mode: 'async',
          sequence: 3,
        },
        errorCode: 'E_REMOTE',
        issueKind: 'tool_error',
        operation: 'notes-export',
        summary: 'Assistant tool notes-export failed during provider turn.',
      }),
    })
  })

  it('builds execution plans from explicit targets and rejects missing targets', async () => {
    const { createDefaultLocalAssistantModelTarget } = await import(
      '@murphai/operator-config/assistant-backend'
    )
    const plan = resolveAssistantExecutionPlan({
      defaults: null,
      sessionTarget: createDefaultLocalAssistantModelTarget(),
    })

    expect(plan.primaryTarget.adapter).toBeTruthy()
    expect(plan.codexRoute.provider).toBe('codex-cli')

    expect(() =>
      resolveAssistantExecutionPlan({
        defaults: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'ASSISTANT_TARGET_REQUIRED',
      }),
    )
  })

  it('records diagnostics, trims warnings, and recovers malformed snapshots', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T00:01:00.000Z'))

    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-diagnostics-small-seams-',
    )
    tempRoots.push(parentRoot)

    expect(createEmptyAssistantDiagnosticsCounters()).toEqual({
      automationScans: 0,
      deliveriesFailed: 0,
      deliveriesQueued: 0,
      deliveriesRetryable: 0,
      deliveriesSent: 0,
      outboxDrains: 0,
      outboxRetries: 0,
      providerAttempts: 0,
      providerFailures: 0,
      turnsCompleted: 0,
      turnsDeferred: 0,
      turnsFailed: 0,
      turnsStarted: 0,
    })

    expect(await readAssistantDiagnosticsSnapshot(vaultRoot)).toMatchObject({
      lastErrorAt: null,
      lastEventAt: null,
      recentWarnings: [],
      schema: 'murph.assistant-diagnostics.v1',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })

    for (let index = 0; index < 14; index += 1) {
      await recordAssistantDiagnosticEvent({
        at: `2026-04-08T00:00:${String(index).padStart(2, '0')}.000Z`,
        component: 'assistant',
        counterDeltas: {
          turnsStarted: 1,
          turnsFailed: index === 13 ? 1 : 0,
        },
        kind: 'turn.warned',
        level: index === 13 ? 'error' : 'warn',
        message: `warning-${index}`,
        vault: vaultRoot,
      })
    }

    const snapshot = await readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(snapshot.counters.turnsStarted).toBe(14)
    expect(snapshot.counters.turnsFailed).toBe(1)
    expect(snapshot.recentWarnings).toHaveLength(12)
    expect(snapshot.recentWarnings[0]).toContain('warning-2')
    expect(snapshot.lastErrorAt).toBe('2026-04-08T00:00:13.000Z')

    const paths = resolveAssistantStatePaths(vaultRoot)
    await writeFile(paths.diagnosticSnapshotPath, '{"broken":', 'utf8')

    const recovered = await readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(recovered.schema).toBe('murph.assistant-diagnostics.v1')
    expect(recovered.updatedAt).not.toBe('1970-01-01T00:00:00.000Z')
    expect(JSON.parse(await readFile(paths.diagnosticSnapshotPath, 'utf8'))).toMatchObject({
      schema: 'murph.assistant-diagnostics.v1',
    })
  })

  it('bounds diagnostic events while retaining snapshot counters and recent warnings', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T00:00:00.000Z'))

    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-diagnostics-retention-',
    )
    tempRoots.push(parentRoot)

    await recordAssistantDiagnosticEvent({
      at: '2026-04-15T00:00:00.000Z',
      component: 'assistant',
      kind: 'routine-info',
      level: 'info',
      message: 'routine-info',
      vault: vaultRoot,
    })
    await recordAssistantDiagnosticEvent({
      at: '2026-04-07T23:59:59.000Z',
      component: 'assistant',
      counterDeltas: {
        providerFailures: 1,
      },
      kind: 'too-old-diagnostic',
      level: 'warn',
      message: 'too-old-diagnostic',
      vault: vaultRoot,
    })
    await recordAssistantDiagnosticEvent({
      at: '2026-04-15T00:00:30.000Z',
      component: 'assistant',
      data: {
        payload: 'x'.repeat(2 * 1024 * 1024),
      },
      kind: 'oversized-diagnostic',
      level: 'warn',
      message: 'oversized-diagnostic',
      vault: vaultRoot,
    })

    for (let index = 0; index < 70; index += 1) {
      const hour = String(Math.floor(index / 60)).padStart(2, '0')
      const minute = String(index % 60).padStart(2, '0')
      await recordAssistantDiagnosticEvent({
        at: `2026-04-15T${hour}:${minute}:00.000Z`,
        component: 'assistant',
        counterDeltas: {
          turnsStarted: 1,
        },
        data: {
          payload: 'x'.repeat(12_000),
        },
        kind: 'turn.warned',
        level: 'warn',
        message: `retained-warning-${index}`,
        vault: vaultRoot,
      })
    }

    const paths = resolveAssistantStatePaths(vaultRoot)
    await runAssistantRuntimeMaintenance({
      now: new Date('2026-04-15T01:11:00.000Z'),
      vault: vaultRoot,
    })

    const diagnosticEventsRaw = await readFile(paths.diagnosticEventsPath, 'utf8')
    expect(Buffer.byteLength(diagnosticEventsRaw, 'utf8')).toBeLessThanOrEqual(
      512 * 1024,
    )
    expect(diagnosticEventsRaw).toContain('retained-warning-69')
    expect(diagnosticEventsRaw).not.toContain('retained-warning-0')
    expect(diagnosticEventsRaw).not.toContain('oversized-diagnostic')
    expect(diagnosticEventsRaw).not.toContain('too-old-diagnostic')

    const runtimeEventsRaw = await readFile(paths.runtimeEventsPath, 'utf8')
    expect(runtimeEventsRaw).toContain('retained-warning-69')
    expect(runtimeEventsRaw).not.toContain('routine-info')
    expect(runtimeEventsRaw).not.toContain('oversized-diagnostic')
    expect(runtimeEventsRaw).not.toContain('too-old-diagnostic')

    const snapshot = await readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(snapshot.counters.turnsStarted).toBe(70)
    expect(snapshot.counters.providerFailures).toBe(1)
    expect(snapshot.recentWarnings).toHaveLength(12)
    expect(snapshot.recentWarnings[0]).toContain('retained-warning-58')
    expect(snapshot.recentWarnings.at(-1)).toContain('retained-warning-69')
  })

  it('redacts hosted direct identifiers from diagnostics and mirrored runtime events', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T00:01:00.000Z'))

    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-diagnostics-direct-id-redaction-',
    )
    tempRoots.push(parentRoot)

    await recordAssistantDiagnosticEvent({
      at: '2026-04-08T00:00:00.000Z',
      code: 'member_123',
      component: 'assistant',
      data: {
        note: 'retry user_123',
        status: 'user_not_active',
        workflow: 'hosted-user-runtime:member_123',
      },
      kind: 'turn.warned',
      level: 'warn',
      message: 'failure hosted-user-runtime:member_123 for member_123 and user_123',
      vault: vaultRoot,
    })

    const paths = resolveAssistantStatePaths(vaultRoot)
    const diagnosticEventsRaw = await readFile(paths.diagnosticEventsPath, 'utf8')
    const runtimeEventsRaw = await readFile(paths.runtimeEventsPath, 'utf8')
    const snapshotRaw = JSON.stringify(await readAssistantDiagnosticsSnapshot(vaultRoot))
    const durableText = [diagnosticEventsRaw, runtimeEventsRaw, snapshotRaw].join('\n')

    expect(durableText).not.toContain('hosted-user-runtime:member_123')
    expect(durableText).not.toContain('member_123')
    expect(durableText).not.toContain('user_123')
    expect(durableText).toContain('hosted-user-runtime:[redacted-id]')
    expect(durableText).toContain('member_[redacted-id]')
    expect(durableText).toContain('user_[redacted-id]')
    expect(durableText).toContain('user_not_active')
  })

  it('saves diagnostics snapshots and swallows runtime-event/quarantine failures', async () => {
    const appendAssistantRuntimeEventAtPaths = vi
      .fn()
      .mockRejectedValue(new Error('runtime-events-offline'))
    const quarantineAssistantStateFile = vi
      .fn()
      .mockRejectedValue(new Error('quarantine-offline'))
    vi.doMock('../src/assistant/runtime-events.js', () => ({
      appendAssistantRuntimeEventAtPaths,
    }))
    vi.doMock('../src/assistant/quarantine.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/quarantine.ts')
      >('../src/assistant/quarantine.ts')
      return {
        ...actual,
        quarantineAssistantStateFile,
      }
    })
    const diagnosticsModule = await import('../src/assistant/diagnostics.ts')

    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-diagnostics-mocked-side-effects-',
    )
    tempRoots.push(parentRoot)

    const saved = await diagnosticsModule.saveAssistantDiagnosticsSnapshot(vaultRoot, {
      counters: createEmptyAssistantDiagnosticsCounters(),
      lastErrorAt: null,
      lastEventAt: null,
      recentWarnings: ['keep-existing-warning'],
      schema: 'murph.assistant-diagnostics.v1',
      updatedAt: '2026-04-08T00:00:00.000Z',
    })
    expect(saved.recentWarnings).toEqual(['keep-existing-warning'])

    const event = await diagnosticsModule.recordAssistantDiagnosticEvent({
      at: '2026-04-08T00:00:01.000Z',
      code: '',
      component: 'assistant',
      kind: 'turn.started',
      message: 'plain info event',
      vault: vaultRoot,
    })
    expect(event.code).toBe('turn.started')
    expect(event.dataJson).toBeNull()
    expect(appendAssistantRuntimeEventAtPaths).not.toHaveBeenCalled()

    const snapshot = await diagnosticsModule.readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(snapshot.counters).toEqual(createEmptyAssistantDiagnosticsCounters())
    expect(snapshot.recentWarnings).toEqual(['keep-existing-warning'])

    const paths = resolveAssistantStatePaths(vaultRoot)
    await writeFile(paths.diagnosticSnapshotPath, '{"broken":', 'utf8')

    const recovered = await diagnosticsModule.readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(recovered.schema).toBe('murph.assistant-diagnostics.v1')
    expect(quarantineAssistantStateFile).toHaveBeenCalledOnce()
    expect(appendAssistantRuntimeEventAtPaths).toHaveBeenCalled()
  })

  it('injects assistant faults once or always and marks retryable faults', () => {
    const onceEnv = {
      ASSISTANT_FAULTS: 'provider,automation:weird-mode',
    }
    expect(hasInjectedAssistantFault('provider', onceEnv)).toBe(true)
    expect(consumeInjectedAssistantFault('provider', onceEnv)).toBe(true)
    expect(consumeInjectedAssistantFault('provider', onceEnv)).toBe(false)
    expect(consumeInjectedAssistantFault('automation', onceEnv)).toBe(true)
    expect(consumeInjectedAssistantFault('automation', onceEnv)).toBe(false)

    const alwaysEnv = {
      ASSISTANT_FAULTS: 'delivery:always',
    }
    expect(consumeInjectedAssistantFault('delivery', alwaysEnv)).toBe(true)
    expect(consumeInjectedAssistantFault('delivery', alwaysEnv)).toBe(true)

    expect(() =>
      maybeThrowInjectedAssistantFault({
        component: 'provider-turn',
        env: {
          ASSISTANT_FAULTS: 'provider',
        },
        fault: 'provider',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'ASSISTANT_FAULT_INJECTED',
        context: expect.objectContaining({
          component: 'provider-turn',
          fault: 'provider',
          injected: true,
          retryable: true,
        }),
      }),
    )
    expect(() =>
      maybeThrowInjectedAssistantFault({
        code: 'CUSTOM_FAULT',
        component: 'status',
        env: {
          ASSISTANT_FAULTS: 'status',
        },
        fault: 'status',
        message: 'custom status failure',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'CUSTOM_FAULT',
        context: expect.objectContaining({
          retryable: false,
        }),
        message: 'custom status failure',
      }),
    )

    resetInjectedAssistantFaults()
    expect(consumeInjectedAssistantFault('provider', onceEnv)).toBe(true)
    expect(hasInjectedAssistantFault('missing', {})).toBe(false)
  })

  it('reads default runtime budgets, prunes expired cache/quarantine state, and skips too-frequent maintenance', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-runtime-budget-small-seams-',
    )
    tempRoots.push(parentRoot)

    const initial = await readAssistantRuntimeBudgetStatus(vaultRoot)
    expect(initial).toMatchObject({
      maintenance: {
        lastRunAt: null,
        notes: [],
        staleLocksCleared: 0,
        staleQuarantinePruned: 0,
      },
      schema: 'murph.assistant-runtime-budget.v1',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })

    const paths = resolveAssistantStatePaths(vaultRoot)
    await mkdir(paths.quarantineDirectory, {
      recursive: true,
    })
    await mkdir(paths.outboxQuarantineDirectory, {
      recursive: true,
    })

    const oldDate = new Date('2026-01-01T00:00:00.000Z')
    const maintenanceDate = new Date('2026-02-10T00:00:00.000Z')
    const pairPayloadPath = path.join(paths.quarantineDirectory, 'budget.invalid.json')
    const pairMetadataPath = `${pairPayloadPath}.meta.json`
    const orphanPayloadPath = path.join(
      paths.outboxQuarantineDirectory,
      'orphan.invalid.json',
    )
    await writeFile(pairPayloadPath, '{"bad":true}', 'utf8')
    await writeFile(
      pairMetadataPath,
      JSON.stringify({
        schema: 'murph.assistant-quarantine-entry.v1',
        artifactKind: 'runtime-budget',
        quarantineId: 'quarantine-1',
        quarantinedAt: oldDate.toISOString(),
        quarantinedPath: pairPayloadPath,
        sourcePath: paths.resourceBudgetPath,
      }),
      'utf8',
    )
    await writeFile(orphanPayloadPath, '{"bad":true}', 'utf8')
    await utimes(pairPayloadPath, oldDate, oldDate)
    await utimes(pairMetadataPath, oldDate, oldDate)
    await utimes(orphanPayloadPath, oldDate, oldDate)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-09T23:59:50.000Z'))
    const cache = createAssistantRuntimeCache<string, string>({
      maxEntries: 2,
      name: 'small-seams-runtime-budget',
      ttlMs: 5,
    })
    cache.set('alpha', 'one')
    vi.advanceTimersByTime(10)

    const maintained = await runAssistantRuntimeMaintenance({
      now: maintenanceDate,
      vault: vaultRoot,
    })

    expect(maintained.maintenance.lastRunAt).toBe('2026-02-10T00:00:00.000Z')
    expect(maintained.maintenance.staleQuarantinePruned).toBe(2)
    expect(maintained.maintenance.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expired runtime cache'),
        '2 expired quarantine artifact(s) were removed.',
      ]),
    )
    await expect(stat(pairPayloadPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(pairMetadataPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(orphanPayloadPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const skipped = await maybeRunAssistantRuntimeMaintenance({
      now: new Date('2026-02-10T00:01:00.000Z'),
      vault: vaultRoot,
    })
    expect(skipped.updatedAt).toBe(maintained.updatedAt)

    await writeFile(paths.resourceBudgetPath, '{"broken":', 'utf8')
    const recovered = await readAssistantRuntimeBudgetStatus(vaultRoot)
    expect(recovered.schema).toBe('murph.assistant-runtime-budget.v1')
  })

  it('derives expired quarantine payload cleanup from the metadata sidecar path', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-runtime-budget-quarantine-sidecar-',
    )
    tempRoots.push(parentRoot)

    const paths = resolveAssistantStatePaths(vaultRoot)
    await mkdir(paths.quarantineDirectory, {
      recursive: true,
    })
    const oldDate = new Date('2026-01-01T00:00:00.000Z')
    const payloadPath = path.join(paths.quarantineDirectory, 'payload.invalid.json')
    const metadataPath = `${payloadPath}.meta.json`
    const victimPath = path.join(paths.quarantineDirectory, 'victim.invalid.json')

    await writeFile(payloadPath, '{"bad":true}', 'utf8')
    await writeFile(victimPath, '{"keep":true}', 'utf8')
    await writeFile(
      metadataPath,
      JSON.stringify({
        schema: 'murph.assistant-quarantine-entry.v1',
        artifactKind: 'runtime-budget',
        quarantineId: 'quarantine-1',
        quarantinedAt: oldDate.toISOString(),
        quarantinedPath: victimPath,
        sourcePath: paths.resourceBudgetPath,
      }),
      'utf8',
    )
    await utimes(payloadPath, oldDate, oldDate)
    await utimes(metadataPath, oldDate, oldDate)

    const maintained = await runAssistantRuntimeMaintenance({
      now: new Date('2026-02-10T00:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(maintained.maintenance.staleQuarantinePruned).toBe(1)
    await expect(stat(payloadPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(metadataPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(victimPath, 'utf8')).resolves.toBe('{"keep":true}')
  })

  it('delegates local-service conversation open and option updates through the existing store helpers', async () => {
    const resolveAssistantSessionMock = vi.fn()
    const saveAssistantSessionMock = vi.fn()
    const buildResolveAssistantSessionInputMock = vi
      .fn()
      .mockReturnValue({
        channel: 'email',
        sessionId: 'session-service',
        vault: '/tmp/test-vault',
      })

    vi.doMock('../src/assistant/store.js', async () => {
      const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
        '../src/assistant/store.ts',
      )
      return {
        ...actual,
        resolveAssistantSession: resolveAssistantSessionMock,
        saveAssistantSession: saveAssistantSessionMock,
      }
    })
    vi.doMock('../src/assistant/session-resolution.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/session-resolution.ts')
      >('../src/assistant/session-resolution.ts')
      return {
        ...actual,
        buildResolveAssistantSessionInput: buildResolveAssistantSessionInputMock,
      }
    })
    vi.doMock('@murphai/operator-config/operator-config', async () => {
      const actual = await vi.importActual<
        typeof import('@murphai/operator-config/operator-config')
      >('@murphai/operator-config/operator-config')
      return {
        ...actual,
        resolveAssistantOperatorDefaults: vi.fn().mockResolvedValue(null),
      }
    })

    const localService = await import('../src/assistant/local-service.ts')
    const sessionWithoutResume = createAssistantSession({
      sessionId: 'session-service',
    })
    const currentRoute = resolveAssistantExecutionPlan({
      defaults: null,
      sessionTarget: sessionWithoutResume.target,
    }).codexRoute
    const resumeState = {
      routeFingerprint: currentRoute.routeFingerprint ?? currentRoute.routeId,
      threadId: 'thread-service',
    }
    const session = {
      ...sessionWithoutResume,
      codexResume: resumeState,
      resumeState,
    }

    resolveAssistantSessionMock.mockResolvedValueOnce({
      session,
    })
    await localService.openAssistantConversationLocal({
      channel: 'email',
      vault: '/tmp/test-vault',
    })
    expect(buildResolveAssistantSessionInputMock).toHaveBeenCalled()
    expect(resolveAssistantSessionMock).toHaveBeenCalledWith({
      channel: 'email',
      sessionId: 'session-service',
      vault: '/tmp/test-vault',
    })

    resolveAssistantSessionMock.mockResolvedValueOnce({
      session,
    })
    saveAssistantSessionMock.mockResolvedValueOnce({
      ...session,
      providerOptions: {
        ...session.providerOptions,
        model: 'gpt-4.1-mini',
      },
    })
    await localService.updateAssistantSessionOptionsLocal({
      providerOptions: {
        provider: 'codex-cli',
        model: 'gpt-4.1-mini',
      },
      sessionId: session.sessionId,
      vault: '/tmp/test-vault',
    })
    expect(saveAssistantSessionMock).toHaveBeenCalledWith(
      '/tmp/test-vault',
      expect.objectContaining({
        providerOptions: expect.objectContaining({
          model: 'gpt-4.1-mini',
        }),
        resumeState: expect.objectContaining({
          threadCompatibilityFingerprint: expect.any(String),
          threadId: 'thread-service',
        }),
        sessionId: 'session-service',
      }),
    )
  })
})

async function loadPromptAttemptsModule(input: {
  appendAssistantTranscriptEntries: ReturnType<typeof vi.fn>
  listAssistantTranscriptEntries: ReturnType<typeof vi.fn>
}) {
  vi.doMock('../src/assistant/store.js', async () => {
    const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
      '../src/assistant/store.ts',
    )
    return {
      ...actual,
      appendAssistantTranscriptEntries: input.appendAssistantTranscriptEntries,
      listAssistantTranscriptEntries: input.listAssistantTranscriptEntries,
    }
  })

  return await import('../src/assistant/prompt-attempts.ts')
}

function createProviderOptions(
  overrides: Partial<AssistantProviderSessionOptions> = {},
): AssistantProviderSessionOptions {
  return serializeAssistantProviderSessionOptions({
    approvalPolicy: 'never',
    provider: 'codex-cli',
    model: 'gpt-5.6-terra',
    modelProvider: 'vercel-ai-gateway',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    ...overrides,
  })
}

function createAssistantSession(input?: {
  binding?: AssistantSession['binding']
  providerOptions?: AssistantProviderSessionOptions
  sessionId?: string
  target?: AssistantSession['target']
  turnCount?: number
}): AssistantSession {
  const providerOptions = input?.providerOptions ?? createProviderOptions()
  const target: AssistantSession['target'] =
    input?.target ??
    (() => {
      const resolvedTarget = createAssistantModelTarget({
        provider: 'codex-cli',
        approvalPolicy: providerOptions.approvalPolicy,
        codexHome: providerOptions.codexHome ?? null,
        model: providerOptions.model,
        modelProvider: providerOptions.modelProvider ?? null,
        oss: providerOptions.oss,
        profile: providerOptions.profile,
        reasoningEffort: providerOptions.reasoningEffort ?? null,
        sandbox: providerOptions.sandbox,
      })
      if (!resolvedTarget) {
        throw new Error('Expected assistant session target.')
      }
      return resolvedTarget
    })()

  return {
    alias: null,
    binding: input?.binding ?? {
      actorId: null,
      channel: null,
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    },
    codexResume: null,
    codexTarget: target,
    conversationId: input?.sessionId ?? 'session-test',
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions,
    resumeState: null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: input?.sessionId ?? 'session-test',
    target,
    turnCount: input?.turnCount ?? 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}

function createDeliveryError(
  overrides: Partial<AssistantDeliveryError> = {},
): AssistantDeliveryError {
  return {
    code: 'ASSISTANT_DELIVERY_FAILED',
    message: 'delivery failed',
    ...overrides,
  }
}
