import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  assistantAskResultSchema,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  inboxListResultSchema,
  inboxShowResultSchema,
  type InboxListResult,
  type InboxShowResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import {
  assistantChatReplyArtifactExists,
  assistantResultArtifactExists,
  assistantAutoReplyGroupOutcomeArtifactExists,
  writeAssistantAutoReplyGroupOutcomeArtifact,
  writeAssistantChatDeferredArtifacts,
  writeAssistantChatErrorArtifacts,
  writeAssistantChatResultArtifacts,
} from '../src/assistant/automation/artifacts.ts'
import { describeAssistantAutoReplyFailure } from '../src/assistant/automation/failure-observability.ts'
import { collectAssistantAutoReplyGroup } from '../src/assistant/automation/grouping.ts'
import {
  createAssistantProviderWatchdog,
} from '../src/assistant/automation/provider-watchdog.ts'
import {
  buildAssistantAutoReplyPrompt,
  loadTelegramAutoReplyMetadata,
  prepareAssistantAutoReplyInput,
  type AssistantAutoReplyPromptCapture,
  type TelegramAutoReplyMetadata,
} from '../src/assistant/automation/prompt-builder.ts'
import {
  acquireAssistantAutomationRunLock,
  clearAssistantAutomationRunLock,
  inspectAssistantAutomationRunLock,
} from '../src/assistant/automation/runtime-lock.ts'
import { resolveAssistantInboxArtifactPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

function toSnapshotRecord<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value))
}

const promptBuilderMocks = vi.hoisted(() => ({
  buildInboxModelAttachmentBundles: vi.fn(),
  hasInboxMultimodalAttachmentEvidenceCandidate: vi.fn(),
  prepareInboxMultimodalUserMessageContent: vi.fn(),
}))

vi.mock('../src/inbox-multimodal.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/inbox-multimodal.ts')
  >('../src/inbox-multimodal.ts')

  return {
    ...actual,
    buildInboxModelAttachmentBundles:
      promptBuilderMocks.buildInboxModelAttachmentBundles,
    hasInboxMultimodalAttachmentEvidenceCandidate:
      promptBuilderMocks.hasInboxMultimodalAttachmentEvidenceCandidate,
    prepareInboxMultimodalUserMessageContent:
      promptBuilderMocks.prepareInboxMultimodalUserMessageContent,
  }
})

const cleanupRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await Promise.all(
    cleanupRoots.splice(0).map(async (target) => {
      await rm(target, {
        force: true,
        recursive: true,
      })
    }),
  )
})

beforeEach(() => {
  promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([])
  promptBuilderMocks.hasInboxMultimodalAttachmentEvidenceCandidate.mockReturnValue(
    false,
  )
  promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
    fallbackError: null,
    inputMode: 'text-only',
    userMessageContent: null,
  })
})

function createAssistantAskResult(input: {
  delivery?: {
    channel: string
    sentAt: string
    target: string
    targetKind?: 'explicit' | 'participant' | 'thread'
  } | null
  deliveryError?: { code: string | null; message: string } | null
  deliveryIntentId?: string | null
  response?: string
  sessionId?: string
}) {
  return assistantAskResultSchema.parse({
    vault: '/tmp/automation-support-vault',
    status: 'completed',
    prompt: 'reply to the inbox capture',
    response: input.response ?? 'Done.',
    session: {
      schema: 'murph.assistant-session.v4',
      sessionId:
        input.sessionId ?? 'asst_1234567890abcdef1234567890abcd',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        model: 'gpt-5.4',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'workspace-write',
      },
      resumeState: null,
      alias: null,
      binding: {
        conversationKey: null,
        channel: 'telegram',
        identityId: null,
        actorId: 'actor-1',
        threadId: 'thread-1',
        threadIsDirect: true,
        delivery: null,
      },
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
      lastTurnAt: null,
      turnCount: 0,
      provider: 'codex-cli',
      providerOptions: {
        model: 'gpt-5.4',
        reasoningEffort: 'medium',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      providerBinding: null,
    },
    delivery: input.delivery
      ? {
          channel: input.delivery.channel,
          idempotencyKey: null,
          target: input.delivery.target,
          targetKind: input.delivery.targetKind ?? 'thread',
          sentAt: input.delivery.sentAt,
          messageLength: (input.response ?? 'Done.').length,
          providerMessageId: null,
          providerThreadId: null,
        }
      : null,
    deliveryDeferred: false,
    deliveryIntentId: input.deliveryIntentId ?? null,
    deliveryError: input.deliveryError ?? null,
  })
}

function createListCapture(
  overrides: Partial<InboxListResult['items'][number]> = {},
): InboxListResult['items'][number] {
  return inboxListResultSchema.parse({
    vault: '/tmp/automation-support-vault',
    filters: {
      sourceId: null,
      limit: 10,
      afterOccurredAt: null,
      afterCaptureId: null,
      oldestFirst: false,
    },
    items: [
      {
        captureId: 'capture-1',
        source: 'telegram',
        accountId: 'account-1',
        externalId: 'external-1',
        threadId: 'thread-1',
        threadTitle: 'Family',
        threadIsDirect: true,
        actorId: 'actor-1',
        actorName: 'Taylor',
        actorIsSelf: false,
        occurredAt: '2026-04-08T00:00:00.000Z',
        receivedAt: null,
        text: 'hello',
        attachmentCount: 0,
        envelopePath: 'inbox/telegram/capture-1.json',
        eventId: 'event-1',
        promotions: [],
        ...overrides,
      },
    ],
  }).items[0]
}

function createAttachment(
  overrides: Partial<InboxShowResult['capture']['attachments'][number]> = {},
): InboxShowResult['capture']['attachments'][number] {
  return inboxShowResultSchema.parse({
    vault: '/tmp/automation-support-vault',
    capture: {
      captureId: 'capture-1',
      source: 'telegram',
      accountId: 'account-1',
      externalId: 'external-1',
      threadId: 'thread-1',
      threadTitle: 'Family',
      threadIsDirect: true,
      actorId: 'actor-1',
      actorName: 'Taylor',
      actorIsSelf: false,
      occurredAt: '2026-04-08T00:00:00.000Z',
      receivedAt: null,
      text: null,
      attachmentCount: 1,
      envelopePath: 'inbox/telegram/capture-1.json',
      eventId: 'event-1',
      promotions: [],
      createdAt: '2026-04-08T00:00:01.000Z',
      attachments: [
        {
          attachmentId: 'attachment-1',
          ordinal: 1,
          externalId: null,
          kind: 'document',
          mime: 'text/plain',
          originalPath: null,
          storedPath: 'inbox/attachments/attachment-1.txt',
          fileName: 'attachment-1.txt',
          byteSize: 128,
          sha256: null,
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parserProviderId: null,
          parseState: 'succeeded',
          ...overrides,
        },
      ],
    },
  }).capture.attachments[0]
}

function createPromptCapture(input: {
  attachments?: readonly InboxShowResult['capture']['attachments'][number][]
  captureOverrides?: Partial<InboxShowResult['capture']>
  telegramMetadata?: TelegramAutoReplyMetadata | null
} = {}): AssistantAutoReplyPromptCapture {
  const attachments = [...(input.attachments ?? [])]
  const resolvedAttachments = input.captureOverrides?.attachments ?? attachments
  const capture = {
    captureId: 'capture-1',
    source: 'telegram',
    accountId: 'account-1',
    externalId: 'external-1',
    threadId: 'thread-1',
    threadTitle: 'Family',
    threadIsDirect: true,
    actorId: 'actor-1',
    actorName: 'Taylor',
    actorIsSelf: false,
    occurredAt: '2026-04-08T00:00:00.000Z',
    receivedAt: null,
    text: null,
    envelopePath: 'inbox/telegram/capture-1.json',
    eventId: 'event-1',
    promotions: [],
    createdAt: '2026-04-08T00:00:01.000Z',
    ...input.captureOverrides,
  }
  return {
    capture: inboxShowResultSchema.parse({
      vault: '/tmp/automation-support-vault',
      capture: {
        ...capture,
        attachmentCount:
          input.captureOverrides?.attachmentCount ?? resolvedAttachments.length,
        attachments: resolvedAttachments,
      },
    }).capture,
    telegramMetadata: input.telegramMetadata ?? null,
  }
}

async function createTempVault(prefix: string) {
  const context = await createTempVaultContext(prefix)
  cleanupRoots.push(context.parentRoot)
  return context
}

describe('assistant automation artifacts', () => {
  it('writes and detects grouped outcome, deferred, result, and error artifacts', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')

    expect(
      await assistantResultArtifactExists(vaultRoot, 'capture-a'),
    ).toBe(false)
    expect(
      await assistantChatReplyArtifactExists(vaultRoot, 'capture-a'),
    ).toBe(false)
    expect(
      await assistantAutoReplyGroupOutcomeArtifactExists(vaultRoot, 'capture-a'),
    ).toBe(false)

    const deferredResult = createAssistantAskResult({
      delivery: null,
      deliveryError: {
        code: 'DELIVERY_QUEUED',
        message: 'delivery queued',
      },
      deliveryIntentId: 'intent-1',
      response: 'Queued reply',
    })
    await writeAssistantChatDeferredArtifacts({
      captureIds: ['capture-a', 'capture-b'],
      queuedAt: '2026-04-08T01:00:00.000Z',
      result: deferredResult,
      vault: vaultRoot,
    })

    expect(
      await assistantChatReplyArtifactExists(vaultRoot, 'capture-a'),
    ).toBe(true)

    await writeAssistantAutoReplyGroupOutcomeArtifact({
      captureIds: ['capture-a', 'capture-b'],
      outcome: 'deferred',
      recordedAt: '2026-04-08T01:01:00.000Z',
      result: deferredResult,
      vault: vaultRoot,
    })
    expect(
      await assistantAutoReplyGroupOutcomeArtifactExists(vaultRoot, 'capture-a'),
    ).toBe(true)

    const primaryOutcomePath = await resolveAssistantInboxArtifactPath(
      vaultRoot,
      'capture-a',
      'chat-group-outcome.json',
    )
    const primaryOutcome = JSON.parse(
      await readFile(primaryOutcomePath.absolutePath, 'utf8'),
    ) as Record<string, unknown>

    expect(primaryOutcome).toMatchObject({
      captureId: 'capture-a',
      delivery: null,
      deliveryIntentId: 'intent-1',
      groupCaptureIds: ['capture-a', 'capture-b'],
      outcome: 'deferred',
      response: 'Queued reply',
      schema: 'murph.assistant-auto-reply-group-outcome.v1',
      sessionId: 'asst_1234567890abcdef1234567890abcd',
    })

    await writeAssistantChatResultArtifacts({
      captureIds: ['capture-a'],
      respondedAt: '2026-04-08T01:02:00.000Z',
      result: createAssistantAskResult({
        delivery: {
          channel: 'telegram',
          sentAt: '2026-04-08T01:02:30.000Z',
          target: 'thread-1',
        },
        response: 'Delivered reply',
      }),
      vault: vaultRoot,
    })
    await writeAssistantChatErrorArtifacts({
      captureIds: ['capture-a'],
      failure: {
        code: 'ASSISTANT_CODEX_FAILED',
        context: { retryable: true },
        kind: 'provider',
        message: 'provider failed',
        retryable: true,
        safeSummary: 'assistant provider failed; retry may succeed (ASSISTANT_CODEX_FAILED)',
      },
      vault: vaultRoot,
    })

    const resultPath = await resolveAssistantInboxArtifactPath(
      vaultRoot,
      'capture-a',
      'result.json',
    )
    await writeFile(resultPath.absolutePath, JSON.stringify({ ok: true }), 'utf8')
    expect(
      await assistantResultArtifactExists(vaultRoot, 'capture-a'),
    ).toBe(true)
  })

  it('rejects empty grouped outcome inputs', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')

    await expect(
      writeAssistantAutoReplyGroupOutcomeArtifact({
        captureIds: [],
        outcome: 'result',
        recordedAt: '2026-04-08T01:00:00.000Z',
        result: createAssistantAskResult({
          response: 'No-op',
        }),
        vault: vaultRoot,
      }),
    ).rejects.toThrow(/require at least one capture id/u)
  })

  it('writes delivered group outcomes and null-delivery result artifacts', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')

    await writeAssistantAutoReplyGroupOutcomeArtifact({
      captureIds: ['capture-c'],
      outcome: 'result',
      recordedAt: '2026-04-08T01:02:30.000Z',
      result: createAssistantAskResult({
        delivery: {
          channel: 'telegram',
          sentAt: '2026-04-08T01:02:30.000Z',
          target: 'thread-9',
        },
        deliveryIntentId: 'intent-9',
        response: 'Delivered reply',
      }),
      vault: vaultRoot,
    })
    await writeAssistantChatResultArtifacts({
      captureIds: ['capture-c'],
      respondedAt: '2026-04-08T01:03:00.000Z',
      result: createAssistantAskResult({
        delivery: null,
        response: 'Saved without delivery metadata',
      }),
      vault: vaultRoot,
    })

    const outcomePath = await resolveAssistantInboxArtifactPath(
      vaultRoot,
      'capture-c',
      'chat-group-outcome.json',
    )
    const outcome = JSON.parse(await readFile(outcomePath.absolutePath, 'utf8')) as {
      delivery: { channel: string; sentAt: string; target: string } | null
    }
    expect(outcome.delivery).toEqual({
      channel: 'telegram',
      sentAt: '2026-04-08T01:02:30.000Z',
      target: 'thread-9',
    })

    const resultPath = await resolveAssistantInboxArtifactPath(
      vaultRoot,
      'capture-c',
      'chat-result.json',
    )
    const resultArtifact = JSON.parse(await readFile(resultPath.absolutePath, 'utf8')) as {
      channel: string | null
      target: string | null
    }
    expect(resultArtifact.channel).toBeNull()
    expect(resultArtifact.target).toBeNull()
  })
})

describe('assistant auto-reply failure observability', () => {
  it('classifies usage-limit provider failures and redacts secrets and home paths', () => {
    const error = Object.assign(
      new Error(
        'Codex CLI failed: usage limit reached. Authorization: Bearer super-secret-token /Users/example-user/project',
      ),
      {
        code: 'ASSISTANT_CODEX_FAILED',
        context: {
          ignored: 'drop me',
          providerSessionId: 'provider-session-1',
          retryable: false,
          status: '429',
        },
        details: {
          retryable: true,
        },
        outboxIntentId: 'outbox-1',
      },
    )

    const snapshot = describeAssistantAutoReplyFailure(error)

    expect(snapshot).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      kind: 'provider',
      retryable: false,
      safeSummary:
        'provider usage limit reached (ASSISTANT_CODEX_FAILED)',
    })
    expect(snapshot.context).toEqual({
      outboxIntentId: 'outbox-1',
      providerSessionId: 'provider-session-1',
      retryable: false,
      status: '429',
    })
    expect(snapshot.message).toContain('[REDACTED]')
    expect(snapshot.message).toContain('<HOME_DIR>')
    expect(snapshot.message).not.toContain('super-secret-token')
    expect(snapshot.message).not.toContain('/Users/example-user')
  })

  it('classifies delivery failures and sanitizes allowed array context values', () => {
    const error = Object.assign(
      new Error('Outbound delivery failed for this reply.'),
      {
        code: 'DELIVERY_FAILED',
        context: {
          providerStalled: true,
          retryAfterSeconds: 30,
          status: [' waiting ', 500, '/Users/example-user/tmp'],
        },
      },
    )

    const snapshot = describeAssistantAutoReplyFailure(error)

    expect(snapshot).toMatchObject({
      code: 'DELIVERY_FAILED',
      kind: 'delivery',
      retryable: null,
      safeSummary: 'outbound delivery failed (DELIVERY_FAILED)',
    })
    expect(snapshot.context).toEqual({
      providerStalled: true,
      retryAfterSeconds: 30,
      status: ['waiting', '<HOME_DIR>/tmp'],
    })
  })

  it('falls back to an unknown summary and details-based retryability when structured data is sparse', () => {
    const snapshot = describeAssistantAutoReplyFailure({
      code: '   ',
      details: {
        connectionLost: true,
        errorCode: ' ECONNRESET ',
        retryable: true,
      },
      message: '   ',
    })

    expect(snapshot).toMatchObject({
      code: null,
      kind: 'unknown',
      retryable: true,
      safeSummary: 'assistant reply failed',
    })
    expect(snapshot.context).toEqual({
      connectionLost: true,
      errorCode: 'ECONNRESET',
      retryable: true,
    })
    expect(snapshot.message).toBe('[object Object]')
  })

  it('classifies provider failures from message text and drops unusable context fragments', () => {
    const snapshot = describeAssistantAutoReplyFailure(
      Object.assign(
        new Error('Assistant provider timed out while syncing state.'),
        {
          context: {
            providerSessionId: [' /Users/example-user/tmp ', 123, ''],
            retryable: 'yes',
          },
        },
      ),
    )

    expect(snapshot).toMatchObject({
      code: null,
      kind: 'provider',
      retryable: null,
      safeSummary: 'assistant provider failed',
    })
    expect(snapshot.context).toEqual({
      providerSessionId: ['<HOME_DIR>/tmp', 'Assistant reply failed.'],
      retryable: 'yes',
    })
  })
})

describe('assistant auto-reply grouping', () => {
  it('returns an empty group when the requested start capture is missing', async () => {
    await expect(
      collectAssistantAutoReplyGroup({
        captures: [],
        startIndex: 4,
        vault: '/tmp/automation-support-vault',
      }),
    ).resolves.toEqual({
      endIndex: 4,
      items: [],
    })
  })

  it('groups adjacent email captures from the same thread and actor', async () => {
    const result = await collectAssistantAutoReplyGroup({
      captures: [
        createListCapture({
          captureId: 'email-1',
          source: 'email',
          accountId: 'mailbox-1',
          threadId: 'thread-1',
        }),
        createListCapture({
          captureId: 'email-2',
          source: 'email',
          accountId: 'mailbox-1',
          threadId: 'thread-1',
        }),
        createListCapture({
          captureId: 'email-3',
          source: 'email',
          actorId: 'actor-2',
          threadId: 'thread-1',
        }),
      ],
      startIndex: 0,
      vault: '/tmp/automation-support-vault',
    })

    expect(result.endIndex).toBe(1)
    expect(result.items.map((item) => item.summary.captureId)).toEqual([
      'email-1',
      'email-2',
    ])
    expect(result.items.every((item) => item.telegramMetadata === null)).toBe(true)
  })

  it('groups adjacent linq captures from the same conversation lane', async () => {
    const result = await collectAssistantAutoReplyGroup({
      captures: [
        createListCapture({
          captureId: 'linq-1',
          source: 'linq',
          accountId: 'linq-account-1',
          externalId: 'linq:1001',
          threadId: 'linq-thread-1',
        }),
        createListCapture({
          captureId: 'linq-2',
          source: 'linq',
          accountId: 'linq-account-1',
          externalId: 'linq:1002',
          threadId: 'linq-thread-1',
        }),
        createListCapture({
          captureId: 'linq-3',
          source: 'linq',
          accountId: 'linq-account-1',
          externalId: 'linq:1003',
          threadId: 'linq-thread-2',
        }),
      ],
      startIndex: 0,
      vault: '/tmp/automation-support-vault',
    })

    expect(result.endIndex).toBe(1)
    expect(result.items.map((item) => item.summary.captureId)).toEqual([
      'linq-1',
      'linq-2',
    ])
    expect(result.items.every((item) => item.telegramMetadata === null)).toBe(true)
  })

  it('groups adjacent telegram captures from the same conversation even when album metadata differs', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')
    const firstEnvelope = path.join(vaultRoot, 'inbox/telegram/capture-1.json')
    const secondEnvelope = path.join(vaultRoot, 'inbox/telegram/capture-2.json')
    const thirdEnvelope = path.join(vaultRoot, 'inbox/telegram/capture-3.json')

    await mkdir(path.dirname(firstEnvelope), { recursive: true })

    await writeFile(
      firstEnvelope,
      JSON.stringify({
        input: {
          raw: {
            schema: 'murph.telegram-capture.v1',
            media_group_id: 'group-1',
            message_id: '101',
          },
        },
      }),
      'utf8',
    )
    await writeFile(
      secondEnvelope,
      JSON.stringify({
        input: {
          raw: {
            schema: 'murph.telegram-capture.v1',
            media_group_id: 'group-2',
            message_id: '102',
          },
        },
      }),
      'utf8',
    )
    await writeFile(
      thirdEnvelope,
      JSON.stringify({
        input: {
          raw: {
            schema: 'murph.telegram-capture.v1',
            media_group_id: 'group-2',
            message_id: '103',
          },
        },
      }),
      'utf8',
    )

    const result = await collectAssistantAutoReplyGroup({
      captures: [
        createListCapture({
          captureId: 'capture-1',
          envelopePath: 'inbox/telegram/capture-1.json',
        }),
        createListCapture({
          captureId: 'capture-2',
          envelopePath: 'inbox/telegram/capture-2.json',
        }),
        createListCapture({
          captureId: 'capture-3',
          actorId: 'actor-2',
          envelopePath: 'inbox/telegram/capture-3.json',
        }),
      ],
      startIndex: 0,
      vault: vaultRoot,
    })

    expect(result.endIndex).toBe(1)
    expect(result.items.map((item) => item.summary.captureId)).toEqual([
      'capture-1',
      'capture-2',
    ])
    expect(result.items.map((item) => item.telegramMetadata?.messageId)).toEqual([
      '101',
      '102',
    ])
  })
})

describe('assistant provider watchdog', () => {
  it('emits provider progress and heartbeats for long-running research commands', () => {
    vi.useFakeTimers()
    const events: Array<Record<string, unknown>> = []
    const watchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 1_000,
      providerStallTimeoutMs: 3_000,
      providerLongRunningCommandStallTimeoutMs: 5_000,
      replyCaptureId: 'capture-1',
    })

    watchdog.onProviderEvent({
      id: 'command-1',
      kind: 'command',
      rawEvent: null,
      safeText: 'researching',
      state: 'running',
      text: '$ murph research inbox grouping',
    })
    watchdog.onProviderEvent({
      id: 'message-1',
      kind: 'message',
      rawEvent: null,
      safeText: 'ignored',
      state: 'running',
      text: 'provider narrative',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      captureId: 'capture-1',
      details: '$ murph research inbox grouping',
      providerKind: 'command',
      providerState: 'running',
      safeDetails: 'researching',
      type: 'capture.reply-progress',
    })

    vi.advanceTimersByTime(1_000)
    expect(events.at(-1)?.details).toContain('research command active for 1s')

    watchdog.onProviderEvent({
      id: 'command-1',
      kind: 'command',
      rawEvent: null,
      safeText: 'done',
      state: 'completed',
      text: '$ murph research inbox grouping',
    })
    vi.advanceTimersByTime(1_000)
    expect(events.at(-1)?.details).not.toContain('research command active')

    watchdog.dispose()
  })

  it('marks timed-out providers as stalled and bridges upstream abort state', () => {
    vi.useFakeTimers()

    const upstream = new AbortController()
    upstream.abort()
    const abortedWatchdog = createAssistantProviderWatchdog({
      providerHeartbeatMs: 1_000,
      providerStallTimeoutMs: 1_000,
      replyCaptureId: 'capture-1',
      signal: upstream.signal,
    })
    expect(abortedWatchdog.signal.aborted).toBe(true)
    abortedWatchdog.dispose()

    const events: Array<Record<string, unknown>> = []
    const watchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 1_000,
      providerStallTimeoutMs: 1_000,
      providerLongRunningCommandStallTimeoutMs: 2_000,
      replyCaptureId: 'capture-2',
    })

    watchdog.onProviderEvent({
      id: 'tool-1',
      kind: 'tool',
      rawEvent: null,
      safeText: 'deepthink',
      state: 'running',
      text: 'tool deepthink',
    })

    vi.advanceTimersByTime(2_000)
    expect(watchdog.signal.aborted).toBe(true)
    expect(events.at(-1)?.details).toContain('during deepthink tool')

    const normalized = watchdog.normalizeError({
      context: {
        existing: true,
      },
    })
    expect(normalized).toEqual({
      context: {
        existing: true,
        providerStalled: true,
        retryable: true,
      },
    })

    watchdog.dispose()
  })

  it('tracks review:gpt and knowledge-upsert operations and leaves primitive errors unchanged', () => {
    vi.useFakeTimers()

    const events: Array<Record<string, unknown>> = []
    const watchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 1_000,
      providerStallTimeoutMs: 2_000,
      providerLongRunningCommandStallTimeoutMs: 3_000,
      replyCaptureId: 'capture-3',
    })

    watchdog.onProviderEvent({
      id: null,
      kind: 'command',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: 'pnpm review:gpt inbox-thread',
    })
    vi.advanceTimersByTime(1_000)
    expect(events.at(-1)?.details).toContain('review:gpt run active for 1s')

    watchdog.onProviderEvent({
      id: null,
      kind: 'tool',
      rawEvent: null,
      safeText: 'knowledge',
      state: 'running',
      text: 'tool knowledge upsert',
    })
    vi.advanceTimersByTime(1_000)
    expect(events.at(-1)).toMatchObject({
      captureId: 'capture-3',
      providerKind: 'status',
      providerState: 'running',
    })
    expect(events.at(-1)?.details).toContain('knowledge upsert tool active for 1s')

    vi.advanceTimersByTime(2_000)
    expect(watchdog.signal.aborted).toBe(true)
    expect(watchdog.normalizeError('provider failed')).toBe('provider failed')

    watchdog.dispose()
  })

  it('tracks bare review:gpt commands and research tools while ignoring non-tool text', () => {
    vi.useFakeTimers()

    const events: Array<Record<string, unknown>> = []
    const watchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 1_000,
      providerStallTimeoutMs: 4_000,
      providerLongRunningCommandStallTimeoutMs: 4_000,
      replyCaptureId: 'capture-4',
    })

    watchdog.onProviderEvent({
      id: null,
      kind: 'command',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: 'review:gpt issue-17',
    })
    vi.advanceTimersByTime(1_000)
    expect(events.at(-1)?.details).toContain('review:gpt run active for 1s')

    watchdog.onProviderEvent({
      id: null,
      kind: 'tool',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: 'status update',
    })
    vi.advanceTimersByTime(1_000)
    expect(events.at(-1)?.details).not.toContain('research tool active')

    watchdog.onProviderEvent({
      id: null,
      kind: 'tool',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: 'tool research knowledge graph',
    })
    vi.advanceTimersByTime(1_000)
    expect(events.at(-1)?.details).toContain('research tool active for 1s')

    watchdog.dispose()
  })

  it('formats minute heartbeats and ignores completed or blank command matches', () => {
    vi.useFakeTimers()

    const events: Array<Record<string, unknown>> = []
    const watchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 60_000,
      providerStallTimeoutMs: 5 * 60_000,
      providerLongRunningCommandStallTimeoutMs: 5 * 60_000,
      replyCaptureId: 'capture-5',
    })

    watchdog.onProviderEvent({
      id: null,
      kind: 'command',
      rawEvent: null,
      safeText: null,
      state: 'completed',
      text: 'review:gpt issue-99',
    })
    watchdog.onProviderEvent({
      id: null,
      kind: 'command',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: '$   ',
    })
    watchdog.onProviderEvent({
      id: null,
      kind: 'tool',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: 'tool research files',
    })

    vi.advanceTimersByTime(60_000)
    expect(events.at(-1)?.details).toContain('research tool active for 1m')

    watchdog.dispose()

    const laterEvents: Array<Record<string, unknown>> = []
    const laterWatchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        laterEvents.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 61_000,
      providerStallTimeoutMs: 5 * 61_000,
      providerLongRunningCommandStallTimeoutMs: 5 * 61_000,
      replyCaptureId: 'capture-6',
    })
    laterWatchdog.onProviderEvent({
      id: null,
      kind: 'tool',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: 'tool research files',
    })

    vi.advanceTimersByTime(61_000)
    expect(laterEvents.at(-1)?.details).toContain('research tool active for 1m')

    laterWatchdog.dispose()
  })
})

describe('assistant auto-reply prompt builder support', () => {
  it('defers pending captures and skips prompts that never produce usable text', () => {
    expect(
      buildAssistantAutoReplyPrompt([
        createPromptCapture({
          attachments: [
            createAttachment({
              parseState: 'pending',
            }),
          ],
        }),
      ]),
    ).toEqual({
      kind: 'defer',
      reason: 'waiting for parser completion',
    })

    expect(
      buildAssistantAutoReplyPrompt([
        createPromptCapture(),
      ]),
    ).toEqual({
      kind: 'skip',
      reason: 'capture has no text or parsed attachment content',
    })
  })

  it('builds a single-capture prompt without grouped capture prefixes', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptCapture({
        attachments: [
          createAttachment({
            extractedText: 'Attachment excerpt',
          }),
        ],
        captureOverrides: {
          text: 'Please summarize this.',
        },
        telegramMetadata: {
          mediaGroupId: null,
          messageId: '123',
          replyContext: 'Replying to Jordan: Can you review this?',
        },
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt.')
    }
    expect(result.prompt).toContain('Reply context:\nReplying to Jordan: Can you review this?')
    expect(result.prompt).toContain('Message text:\nPlease summarize this.')
    expect(result.prompt).toContain('Extracted text:\nAttachment excerpt')
    expect(result.prompt).not.toContain('Capture 1:')
  })

  it('builds grouped prompts with attachment excerpts and shared capture context', () => {
    const longTranscript = 'T'.repeat(2_050)
    const longExtractedText = 'E'.repeat(2_050)
    const result = buildAssistantAutoReplyPrompt([
      createPromptCapture({
        attachments: [
          createAttachment({
            derivedPath: 'derived/attachments/capture-1.txt',
            extractedText: longExtractedText,
            transcriptText: longTranscript,
          }),
        ],
        captureOverrides: {
          actorName: 'Jordan',
          occurredAt: '2026-04-08T00:00:00.000Z',
          text: 'First message',
        },
        telegramMetadata: {
          mediaGroupId: 'group-1',
          messageId: '201',
          replyContext: null,
        },
      }),
      createPromptCapture({
        captureOverrides: {
          actorName: 'Jordan',
          captureId: 'capture-2',
          occurredAt: '2026-04-08T00:00:05.000Z',
          text: 'Second message',
        },
        telegramMetadata: {
          mediaGroupId: 'group-1',
          messageId: '202',
          replyContext: null,
        },
      }),
    ])

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt.')
    }
    expect(result.prompt).toContain('Source: telegram')
    expect(result.prompt).toContain(
      'Occurred at: 2026-04-08T00:00:00.000Z -> 2026-04-08T00:00:05.000Z',
    )
    expect(result.prompt).toContain('Grouped captures: 2')
    expect(result.prompt).toContain('Telegram media group: group-1')
    expect(result.prompt).toContain('Capture 1:')
    expect(result.prompt).toContain('Capture 2:')
    expect(result.prompt).toContain('Transcript excerpt:')
    expect(result.prompt).toContain('Extracted text excerpt:')
    expect(result.prompt).toContain('[truncated 1450 characters]')
    expect(result.prompt).toContain(
      'Large parsed attachment content omitted from prompt to keep context small',
    )
  })

  it('skips prepared multimodal input when no textual or rich evidence is available', async () => {
    promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([
      {
        attachmentId: 'bundle-1',
        ordinal: 1,
        kind: 'document',
        mime: 'application/pdf',
        fileName: 'scan.pdf',
        storedPath: 'inbox/attachments/scan.pdf',
        parseState: 'succeeded',
        routingImage: {
          eligible: false,
          reason: 'not-image',
          mediaType: null,
          extension: '.pdf',
        },
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'metadata',
            path: null,
            text: 'mime: application/pdf',
            truncated: false,
          },
        ],
        combinedText: '[metadata]\nmime: application/pdf',
      },
    ])

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptCapture({
          attachments: [createAttachment()],
        }),
      ],
      '/tmp/automation-support-vault',
    )

    expect(result).toEqual({
      kind: 'skip',
      reason: 'capture has no text or parsed attachment content',
    })
  })

  it('prepares rich multimodal input when only attachment evidence remains', async () => {
    promptBuilderMocks.buildInboxModelAttachmentBundles.mockResolvedValue([
      {
        attachmentId: 'bundle-1',
        ordinal: 1,
        kind: 'image',
        mime: 'image/png',
        fileName: 'photo.png',
        storedPath: 'inbox/attachments/photo.png',
        parseState: 'succeeded',
        routingImage: {
          eligible: true,
          reason: null,
          mediaType: 'image/png',
          extension: '.png',
        },
        fragments: [
          {
            kind: 'attachment_metadata',
            label: 'metadata',
            path: null,
            text: 'mime: image/png',
            truncated: false,
          },
        ],
        combinedText: '[metadata]\nmime: image/png',
      },
    ])
    promptBuilderMocks.hasInboxMultimodalAttachmentEvidenceCandidate.mockReturnValue(
      true,
    )
    promptBuilderMocks.prepareInboxMultimodalUserMessageContent.mockResolvedValue({
      fallbackError: null,
      inputMode: 'multimodal',
      userMessageContent: [
        {
          text: 'image prompt payload',
          type: 'text',
        },
      ],
    })

    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptCapture({
          attachments: [createAttachment()],
        }),
      ],
      '/tmp/automation-support-vault',
    )

    expect(result).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining(
        'No parsed attachment text is available. Use attached image or PDF evidence if present.',
      ),
      requiresRichUserMessageContent: true,
      userMessageContent: [
        {
          text: 'image prompt payload',
          type: 'text',
        },
      ],
    })
  })

  it('extracts quote-only telegram reply context and drops invalid message ids', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')
    const relativeEnvelopePath = 'telegram-envelope.json'
    const absoluteEnvelopePath = path.join(vaultRoot, relativeEnvelopePath)

    await writeFile(
      absoluteEnvelopePath,
      JSON.stringify({
        input: {
          raw: {
            message: {
              message_id: 'not-a-number',
              quote: {
                text: '  This quoted text should survive.  ',
              },
            },
          },
        },
      }),
      'utf8',
    )

    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, relativeEnvelopePath),
    ).resolves.toEqual({
      mediaGroupId: null,
      messageId: null,
      replyContext: 'Quoted text: This quoted text should survive.',
    })
  })

  it('loads minimal and structured telegram metadata from relative and absolute envelope paths', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')
    const minimalEnvelopePath = path.join(vaultRoot, 'telegram-minimal.json')
    const richEnvelopePath = path.join(vaultRoot, 'telegram-rich.json')

    await writeFile(
      minimalEnvelopePath,
      JSON.stringify({
        input: {
          raw: {
            media_group_id: ' group-42 ',
            message_id: 42,
            schema: 'murph.telegram-capture.v1',
          },
        },
      }),
      'utf8',
    )
    await writeFile(
      richEnvelopePath,
      JSON.stringify({
        input: {
          raw: {
            business_message: {
              message_id: '43',
              reply_to_message: {
                from: {
                  username: 'casey',
                },
                poll: {
                  options: [
                    {
                      text: 'Sushi',
                    },
                    {
                      text: 'Soup',
                    },
                  ],
                  question: 'Lunch?',
                },
              },
            },
          },
        },
      }),
      'utf8',
    )

    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, null),
    ).resolves.toBeNull()
    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, 'missing-envelope.json'),
    ).resolves.toBeNull()
    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, 'telegram-minimal.json'),
    ).resolves.toEqual({
      mediaGroupId: 'group-42',
      messageId: '42',
      replyContext: null,
    })
    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, richEnvelopePath),
    ).resolves.toEqual({
      mediaGroupId: null,
      messageId: '43',
      replyContext: 'Replying to @casey: Shared poll Lunch? [Sushi | Soup]',
    })
  })

  it('loads venue-based telegram reply context from business messages', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')
    const envelopePath = path.join(vaultRoot, 'telegram-venue.json')

    await writeFile(
      envelopePath,
      JSON.stringify({
        input: {
          raw: {
            business_message: {
              message_id: '88',
              reply_to_message: {
                venue: {
                  address: '123 Harbour St',
                  location: {
                    latitude: -33.86,
                    longitude: 151.21,
                  },
                  title: 'Cafe Luna',
                },
              },
            },
          },
        },
      }),
      'utf8',
    )

    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, envelopePath),
    ).resolves.toEqual({
      mediaGroupId: null,
      messageId: '88',
      replyContext:
        'Replying to: Shared venue Cafe Luna | 123 Harbour St | Shared location -33.86, 151.21',
    })
  })

  it('falls back to actor-only telegram reply context when a referenced poll is empty', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')
    const envelopePath = path.join(vaultRoot, 'telegram-empty-poll.json')

    await writeFile(
      envelopePath,
      JSON.stringify({
        input: {
          raw: {
            message: {
              message_id: '89',
              reply_to_message: {
                poll: {},
                sender_chat: {
                  title: 'Team Thread',
                },
              },
            },
          },
        },
      }),
      'utf8',
    )

    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, envelopePath),
    ).resolves.toEqual({
      mediaGroupId: null,
      messageId: '89',
      replyContext: 'Replying to Team Thread',
    })
  })

  it('returns null reply context for missing messages and incomplete locations', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')
    const noMessagePath = path.join(vaultRoot, 'telegram-no-message.json')
    const incompleteLocationPath = path.join(vaultRoot, 'telegram-incomplete-location.json')

    await writeFile(
      noMessagePath,
      JSON.stringify({
        input: {
          raw: {},
        },
      }),
      'utf8',
    )
    await writeFile(
      incompleteLocationPath,
      JSON.stringify({
        input: {
          raw: {
            message: {
              message_id: '90',
              reply_to_message: {
                location: {
                  latitude: -33.86,
                },
              },
            },
          },
        },
      }),
      'utf8',
    )

    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, noMessagePath),
    ).resolves.toEqual({
      mediaGroupId: null,
      messageId: null,
      replyContext: null,
    })
    await expect(
      loadTelegramAutoReplyMetadata(vaultRoot, incompleteLocationPath),
    ).resolves.toEqual({
      mediaGroupId: null,
      messageId: '90',
      replyContext: 'Replying to an earlier Telegram message',
    })
  })
})

describe('assistant automation runtime locks', () => {
  it('reports same-process locks while held and returns to unlocked after release', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')
    const paths = resolveAssistantStatePaths(vaultRoot)

    const lock = await acquireAssistantAutomationRunLock({
      once: true,
      paths,
    })

    await expect(inspectAssistantAutomationRunLock(paths)).resolves.toMatchObject({
      state: 'active',
      pid: process.pid,
      mode: 'once',
      reason: 'assistant automation already active in this process',
    })

    await assert.rejects(
      () => acquireAssistantAutomationRunLock({ paths }),
      (error) => {
        assert.equal(
          (error as { code?: unknown }).code,
          'ASSISTANT_AUTOMATION_ALREADY_RUNNING',
        )
        return true
      },
    )

    await lock.release()

    await expect(inspectAssistantAutomationRunLock(paths)).resolves.toEqual({
      state: 'unlocked',
      pid: null,
      startedAt: null,
      mode: null,
      command: null,
      reason: null,
    })
  })

  it('inspects and clears stale external automation locks', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')
    const paths = resolveAssistantStatePaths(vaultRoot)
    const metadataPath = path.join(
      paths.assistantStateRoot,
      '.automation-run-lock.json',
    )
    const lockPath = path.join(
      paths.assistantStateRoot,
      '.automation-run.lock',
    )

    await mkdir(paths.assistantStateRoot, { recursive: true })

    await writeFile(
      metadataPath,
      JSON.stringify({
        command: 'stale-automation-runner',
        mode: 'continuous',
        pid: 999_999,
        startedAt: '2026-04-08T01:23:45.000Z',
      }),
      'utf8',
    )
    await writeFile(lockPath, '', 'utf8')

    await expect(inspectAssistantAutomationRunLock(paths)).resolves.toEqual({
      state: 'stale',
      pid: 999_999,
      startedAt: '2026-04-08T01:23:45.000Z',
      mode: 'continuous',
      command: 'stale-automation-runner',
      reason: 'Process 999999 is no longer running.',
    })

    await clearAssistantAutomationRunLock(paths)

    await expect(inspectAssistantAutomationRunLock(paths)).resolves.toEqual({
      state: 'unlocked',
      pid: null,
      startedAt: null,
      mode: null,
      command: null,
      reason: null,
    })
  })
})
