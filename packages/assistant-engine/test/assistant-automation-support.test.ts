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
  inboxListResultSchema,
  inboxShowResultSchema,
  type InboxListResult,
  type InboxShowResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import { initializeVault } from '@murphai/core'
import type { AssistantInputCandidate } from '../src/assistant/input-source.ts'
import type { AssistantAutomationInputSummary } from '../src/assistant/automation/input-summary.ts'
import {
  assistantResultArtifactExists,
  writeAssistantChatErrorArtifacts,
} from '../src/assistant/automation/artifacts.ts'
import { describeAssistantAutoReplyFailure } from '../src/assistant/automation/failure-observability.ts'
import { collectAssistantAutoReplyGroup } from '../src/assistant/automation/grouping.ts'
import {
  createAssistantProviderWatchdog,
} from '../src/assistant/automation/provider-watchdog.ts'
import {
  buildAssistantAutoReplyPrompt,
  prepareAssistantAutoReplyInput,
  type AssistantAutoReplyPromptInput,
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

const DEFAULT_TEST_ATTACHMENT_EVIDENCE = {
  attachments: [],
  optionalInboxCaptureId: null,
  reasonCode: null,
  source: null,
  status: 'not_attempted',
  updatedAt: null,
} satisfies AssistantInputCandidate['event']['attachmentEvidence']

const promptBuilderMocks = vi.hoisted(() => ({
  buildAssistantInputAttachmentPromptBundles: vi.fn(),
  hasAssistantInputAttachmentEvidenceCandidate: vi.fn(),
  prepareAssistantInputMultimodalUserMessageContent: vi.fn(),
}))

vi.mock('../src/assistant/attachment-evidence-model.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/assistant/attachment-evidence-model.ts')
  >('../src/assistant/attachment-evidence-model.ts')

  return {
    ...actual,
    buildAssistantInputAttachmentPromptBundles:
      promptBuilderMocks.buildAssistantInputAttachmentPromptBundles,
    hasAssistantInputAttachmentEvidenceCandidate:
      promptBuilderMocks.hasAssistantInputAttachmentEvidenceCandidate,
    prepareAssistantInputMultimodalUserMessageContent:
      promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent,
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
  promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([])
  promptBuilderMocks.hasAssistantInputAttachmentEvidenceCandidate.mockReturnValue(
    false,
  )
  promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent.mockResolvedValue({
    fallbackError: null,
    inputMode: 'text-only',
    userMessageContent: null,
  })
})

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
        sourceDirectory: 'raw/inbox/telegram/capture-1',
        eventId: 'event-1',
        promotions: [],
        ...overrides,
      },
    ],
  }).items[0]
}

function createInputSummary(
  overrides: Partial<InboxListResult['items'][number]> &
    Partial<AssistantAutomationInputSummary> = {},
): AssistantAutomationInputSummary {
  const capture = createListCapture(overrides)
  return {
    inputId: overrides.inputId ?? capture.captureId,
    optionalInboxCaptureId:
      'optionalInboxCaptureId' in overrides
        ? overrides.optionalInboxCaptureId ?? null
        : capture.captureId,
    source: capture.source,
    conversation: overrides.conversation ?? {
      accountId: capture.accountId,
      actorId: capture.actorId,
      actorIsSelf: capture.actorIsSelf,
      source: capture.source,
      threadId: capture.threadId,
      threadIsDirect: capture.threadIsDirect,
    },
    occurredAt: capture.occurredAt,
    receivedAt: capture.receivedAt,
    text: capture.text,
    attachmentCount: capture.attachmentCount,
    actorIsSelf: capture.actorIsSelf,
    deliveryTarget: overrides.deliveryTarget ?? capture.threadId,
    groupRoomBatchingEligible: overrides.groupRoomBatchingEligible ?? false,
    projectionReady: overrides.projectionReady ?? true,
    replyToMessageId: overrides.replyToMessageId ?? null,
  }
}

function createTelegramAssistantInputCandidate(input: {
  inputId: string
  mediaGroupId: string | null
  messageId: string | null
  replyContext: string | null
}): AssistantInputCandidate {
  return {
    acceptedInput: {
      id: input.inputId,
      source: 'assistant-input',
      captureIds: [],
      contentRef: {
        kind: 'assistant-input-event',
        refId: input.inputId,
        version: 'murph.assistant-input-event.v1',
      },
    },
    event: {
      attachmentCount: 0,
      attachmentEvidence: DEFAULT_TEST_ATTACHMENT_EVIDENCE,
      attachmentDescriptors: [],
      conversation: {
        accountId: 'account-1',
        actorId: 'actor-1',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: true,
      },
      cursor: {
        createdAt: '2026-04-08T00:00:01.000Z',
        inputId: input.inputId,
        occurredAt: '2026-04-08T00:00:00.000Z',
        sourceKind: 'hosted-mailbox',
        sourcePosition: 'hosted-mailbox:conversation:1:item-1',
      },
      inputId: input.inputId,
      occurredAt: '2026-04-08T00:00:00.000Z',
      receivedAt: '2026-04-08T00:00:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: input.messageId,
        threadId: 'thread-1',
      },
      source: 'telegram',
      sourceMetadata: {
        kind: 'telegram',
        mediaGroupId: input.mediaGroupId,
        replyContext: input.replyContext,
      },
      sourceRef: {
        dedupeKey: null,
        eventId: 'event-1',
        itemId: 'item-1',
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: '1',
        payloadSchema: 'murph.hosted-mailbox-item-payload.v1',
        payloadSource: 'inline',
        source: 'hosted-mailbox',
        wakeSchema: 'murph.hosted-execution-wake.v1',
      },
      text: 'hello',
      transcriptText: 'hello',
      userMessageContent: [
        {
          text: 'hello',
          type: 'text',
        },
      ],
    },
    projection: {
      captureId: null,
      reasonCode: null,
      status: 'pending',
    },
  }
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
      sourceDirectory: 'raw/inbox/telegram/capture-1',
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
          parseState: 'succeeded',
          ...overrides,
        },
      ],
    },
  }).capture.attachments[0]
}

function createPromptInput(input: {
  attachments?: readonly InboxShowResult['capture']['attachments'][number][]
  captureOverrides?: Partial<InboxShowResult['capture']>
  telegramMetadata?: TelegramAutoReplyMetadata | null
} = {}): AssistantAutoReplyPromptInput {
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
    sourceDirectory: 'raw/inbox/telegram/capture-1',
    eventId: 'event-1',
    promotions: [],
    createdAt: '2026-04-08T00:00:01.000Z',
    ...input.captureOverrides,
  }
  const parsedCapture = inboxShowResultSchema.parse({
    vault: '/tmp/automation-support-vault',
    capture: {
      ...capture,
      attachmentCount:
        input.captureOverrides?.attachmentCount ?? resolvedAttachments.length,
      attachments: resolvedAttachments,
    },
  }).capture
  return {
    actorIsSelf: parsedCapture.actorIsSelf,
    attachmentDescriptors: [],
    attachmentEvidence: createSupportAttachmentEvidence({
      attachments: parsedCapture.attachments,
      captureId: parsedCapture.captureId,
    }),
    conversation: {
      accountId: parsedCapture.accountId,
      actorId: parsedCapture.actorId,
      actorIsSelf: parsedCapture.actorIsSelf,
      source: parsedCapture.source,
      threadId: parsedCapture.threadId,
      threadIsDirect: parsedCapture.threadIsDirect,
    },
    inputId: parsedCapture.eventId,
    occurredAt: parsedCapture.occurredAt,
    projection: parsedCapture.attachments.length > 0
      ? {
          optionalInboxCaptureId: parsedCapture.captureId,
          reasonCode: null,
          status: 'succeeded',
        }
      : null,
    receivedAt: parsedCapture.receivedAt,
    replyTarget: null,
    source: parsedCapture.source,
    sourceMetadata: null,
    telegramMetadata: input.telegramMetadata ?? null,
    text: parsedCapture.text,
  }
}

function createSupportAttachmentEvidence(input: {
  attachments: readonly InboxShowResult['capture']['attachments'][number][]
  captureId: string
}): AssistantInputCandidate['event']['attachmentEvidence'] {
  if (input.attachments.length === 0) {
    return DEFAULT_TEST_ATTACHMENT_EVIDENCE
  }

  return {
    attachments: input.attachments.map((attachment) => {
      const inlineFragments: AssistantInputCandidate['event']['attachmentEvidence']['attachments'][number]['inlineFragments'] = []
      if (attachment.transcriptText) {
        inlineFragments.push({
          kind: 'attachment_transcript',
          label: `attachment-${attachment.ordinal}-transcript`,
          text: attachment.transcriptText,
          truncated: false,
        })
      }
      if (attachment.extractedText) {
        inlineFragments.push({
          kind: 'attachment_extracted_text',
          label: `attachment-${attachment.ordinal}-extracted-text`,
          text: attachment.extractedText,
          truncated: false,
        })
      }

      return {
        byteSize: attachment.byteSize ?? null,
        derived: null,
        descriptorAttachmentId:
          attachment.attachmentId ?? `attachment-${attachment.ordinal}`,
        fileName: attachment.fileName ?? null,
        inlineFragments,
        kind: normalizeSupportAttachmentEvidenceKind(attachment.kind),
        mime: attachment.mime ?? null,
        ordinal: attachment.ordinal,
        parseState: normalizeSupportAttachmentEvidenceParseState(
          attachment.parseState,
        ),
        raw: null,
        sourceAttachmentId:
          attachment.attachmentId ?? `attachment-${attachment.ordinal}`,
      }
    }),
    optionalInboxCaptureId: input.captureId,
    reasonCode: null,
    source: 'manual',
    status: 'available',
    updatedAt: '2026-04-08T00:00:01.000Z',
  }
}

function normalizeSupportAttachmentEvidenceKind(
  value: InboxShowResult['capture']['attachments'][number]['kind'],
): AssistantInputCandidate['event']['attachmentEvidence']['attachments'][number]['kind'] {
  switch (value) {
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'other':
      return value
    default:
      return 'other'
  }
}

function normalizeSupportAttachmentEvidenceParseState(
  value: InboxShowResult['capture']['attachments'][number]['parseState'],
): AssistantInputCandidate['event']['attachmentEvidence']['attachments'][number]['parseState'] {
  switch (value) {
    case 'pending':
    case 'running':
    case 'succeeded':
    case 'failed':
      return value
    default:
      return null
  }
}

async function createTempVault(prefix: string) {
  const context = await createTempVaultContext(prefix)
  cleanupRoots.push(context.parentRoot)
  return context
}

describe('assistant automation artifacts', () => {
  it('detects result artifacts and writes non-terminal chat error diagnostics', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-support-')

    expect(
      await assistantResultArtifactExists(vaultRoot, 'capture-a'),
    ).toBe(false)

    await writeAssistantChatErrorArtifacts({
      captureIds: ['capture-a', 'capture-b'],
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
    const errorPath = await resolveAssistantInboxArtifactPath(
      vaultRoot,
      'capture-a',
      'chat-error.json',
    )
    const errorArtifact = JSON.parse(
      await readFile(errorPath.absolutePath, 'utf8'),
    ) as Record<string, unknown>

    expect(errorArtifact).toMatchObject({
      captureId: 'capture-a',
      groupCaptureIds: ['capture-a', 'capture-b'],
      kind: 'provider',
      retryable: true,
      schema: 'murph.assistant-chat-error.v1',
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
})

describe('assistant auto-reply failure observability', () => {
  const syntheticHomePath = `/${'Users'}/example-user`

  it('classifies usage-limit provider failures and redacts secrets and home paths', () => {
    const error = Object.assign(
      new Error(
        `Codex CLI failed: usage limit reached. Authorization: Bearer super-secret-token ${syntheticHomePath}/project`,
      ),
      {
        code: 'ASSISTANT_CODEX_FAILED',
        context: {
          codexFailureDetailPresent: true,
          codexFailureStage: 'process_exit',
          codexStderrPresent: false,
          ignored: 'drop me',
          providerActionCount: 2,
          codexThreadId: 'provider-session-1',
          codexThreadIdPresent: true,
          retryable: false,
          status: '429',
          upstreamErrorMessage:
            `provider failed at ${syntheticHomePath}/detail with api_key=super-secret-token`,
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
      codexFailureDetailPresent: true,
      codexFailureStage: 'process_exit',
      codexStderrPresent: false,
      codexThreadIdPresent: true,
      outboxIntentId: 'outbox-1',
      providerActionCount: 2,
      retryable: false,
      status: '429',
      upstreamErrorMessage:
        'provider failed at <HOME_DIR>/detail with api_key=[REDACTED]',
    })
    expect(snapshot.message).toContain('[REDACTED]')
    expect(snapshot.message).toContain('<HOME_DIR>')
    expect(snapshot.message).not.toContain('super-secret-token')
    expect(snapshot.message).not.toContain(syntheticHomePath)
    expect(JSON.stringify(snapshot.context)).not.toContain('provider-session-1')
  })

  it('classifies quota and billing exhaustion as provider usage limits', () => {
    const error = Object.assign(
      new Error('Codex app-server turn failed. status failed. Quota exceeded. Check your plan and billing details.'),
      {
        code: 'ASSISTANT_CODEX_USAGE_LIMIT',
        context: {
          codexFailureDetailPresent: true,
          codexFailureStage: 'turn_failed',
          codexTurnStatus: 'failed',
          providerActionCount: 0,
          providerUsageLimit: true,
          retryable: false,
        },
      },
    )

    const snapshot = describeAssistantAutoReplyFailure(error)

    expect(snapshot).toMatchObject({
      code: 'ASSISTANT_CODEX_USAGE_LIMIT',
      kind: 'provider',
      retryable: false,
      safeSummary:
        'provider usage limit reached (ASSISTANT_CODEX_USAGE_LIMIT)',
    })
    expect(snapshot.context).toEqual({
      codexFailureDetailPresent: true,
      codexFailureStage: 'turn_failed',
      codexTurnStatus: 'failed',
      providerActionCount: 0,
      providerUsageLimit: true,
      retryable: false,
    })
  })

  it('marks Codex provider failures that arrive without structured context', () => {
    const error = Object.assign(
      new Error('Codex app-server failed before structured diagnostics were attached.'),
      {
        code: 'ASSISTANT_CODEX_FAILED',
      },
    )

    const snapshot = describeAssistantAutoReplyFailure(error)

    expect(snapshot).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexDiagnosticsPresent: false,
      },
      kind: 'provider',
      safeSummary: 'assistant provider failed (ASSISTANT_CODEX_FAILED)',
    })
  })

  it('preserves metadata-only Codex process diagnostics for runtime logs', () => {
    const error = Object.assign(
      new Error('Codex app-server failed. signal SIGKILL.'),
      {
        code: 'ASSISTANT_CODEX_FAILED',
        context: {
          codexAbortRequested: false,
          codexExitSignal: 'SIGKILL',
          codexJsonEventCount: 3,
          codexLifecycleStage: 'turn_running',
          codexLiveTurnOpen: true,
          codexPendingRpcCount: 1,
          codexPendingRpcMethod: 'turn/start',
          codexProcessGroupPresent: true,
          codexProcessLifetimeMs: 2041,
          codexProviderRequestStarted: true,
          codexShutdownRequested: false,
          codexStderrBytes: 128,
          codexThreadId: 'raw-thread-id-should-not-persist',
          codexThreadIdPresent: true,
          retryable: false,
        },
      },
    )

    const snapshot = describeAssistantAutoReplyFailure(error)

    expect(snapshot).toMatchObject({
      code: 'ASSISTANT_CODEX_FAILED',
      kind: 'provider',
      safeSummary: 'assistant provider failed (ASSISTANT_CODEX_FAILED)',
    })
    expect(snapshot.context).toEqual({
      codexAbortRequested: false,
      codexExitSignal: 'SIGKILL',
      codexJsonEventCount: 3,
      codexLifecycleStage: 'turn_running',
      codexLiveTurnOpen: true,
      codexPendingRpcCount: 1,
      codexPendingRpcMethod: 'turn/start',
      codexProcessGroupPresent: true,
      codexProcessLifetimeMs: 2041,
      codexProviderRequestStarted: true,
      codexShutdownRequested: false,
      codexStderrBytes: 128,
      codexThreadIdPresent: true,
      retryable: false,
    })
    expect(JSON.stringify(snapshot.context)).not.toContain('raw-thread-id')
  })

  it('classifies delivery failures and sanitizes allowed array context values', () => {
    const error = Object.assign(
      new Error('Outbound delivery failed for this reply.'),
      {
        code: 'DELIVERY_FAILED',
        context: {
          providerStalled: true,
          retryAfterSeconds: 30,
          status: [' waiting ', 500, `${syntheticHomePath}/tmp`],
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
            codexThreadId: [` ${syntheticHomePath}/tmp `, 123, ''],
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
      retryable: 'yes',
    })
  })
})

describe('assistant auto-reply grouping', () => {
  it('returns an empty group when the requested start capture is missing', async () => {
    await expect(
      collectAssistantAutoReplyGroup({
        inputSummaries: [],
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
      inputSummaries: [
        createInputSummary({
          captureId: 'email-1',
          source: 'email',
          accountId: 'mailbox-1',
          threadId: 'thread-1',
        }),
        createInputSummary({
          captureId: 'email-2',
          source: 'email',
          accountId: 'mailbox-1',
          threadId: 'thread-1',
        }),
        createInputSummary({
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
    expect(result.items.map((item) => item.summary.optionalInboxCaptureId)).toEqual([
      'email-1',
      'email-2',
    ])
    expect(result.items.every((item) => item.telegramMetadata === null)).toBe(true)
  })

  it('groups adjacent linq captures from the same conversation lane', async () => {
    const result = await collectAssistantAutoReplyGroup({
      inputSummaries: [
        createInputSummary({
          captureId: 'linq-1',
          source: 'linq',
          accountId: 'linq-account-1',
          externalId: 'linq:1001',
          threadId: 'linq-thread-1',
        }),
        createInputSummary({
          captureId: 'linq-2',
          source: 'linq',
          accountId: 'linq-account-1',
          externalId: 'linq:1002',
          threadId: 'linq-thread-1',
        }),
        createInputSummary({
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
    expect(result.items.map((item) => item.summary.optionalInboxCaptureId)).toEqual([
      'linq-1',
      'linq-2',
    ])
    expect(result.items.every((item) => item.telegramMetadata === null)).toBe(true)
  })

  it('groups adjacent telegram inputs without reading projected envelope metadata', async () => {
    const result = await collectAssistantAutoReplyGroup({
      inputSummaries: [
        createInputSummary({
          captureId: 'capture-1',
          sourceDirectory: 'raw/inbox/telegram/capture-1',
        }),
        createInputSummary({
          captureId: 'capture-2',
          sourceDirectory: 'raw/inbox/telegram/capture-2',
        }),
        createInputSummary({
          captureId: 'capture-3',
          actorId: 'actor-2',
          sourceDirectory: 'raw/inbox/telegram/capture-3',
        }),
      ],
      startIndex: 0,
      vault: '/tmp/automation-support-vault',
    })

    expect(result.endIndex).toBe(1)
    expect(result.items.map((item) => item.summary.optionalInboxCaptureId)).toEqual([
      'capture-1',
      'capture-2',
    ])
    expect(result.items.map((item) => item.telegramMetadata)).toEqual([null, null])
  })

  it('uses assistant input Telegram metadata', async () => {
    const inputId = 'ain_0123456789abcdef0123456789abcdef'
    const candidate = createTelegramAssistantInputCandidate({
      inputId,
      mediaGroupId: 'event-group-1',
      messageId: '777',
      replyContext: 'Replying to: earlier assistant input',
    })

    const result = await collectAssistantAutoReplyGroup({
      inputSummaries: [
        createInputSummary({
          inputId,
          captureId: inputId,
          sourceDirectory: `assistant-input-events/${inputId}`,
          eventId: inputId,
          externalId: inputId,
          text: 'hello',
        }),
      ],
      inputCandidatesByInputId: new Map([[inputId, candidate]]),
      startIndex: 0,
      vault: '/tmp/automation-support-vault',
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.telegramMetadata).toEqual({
      mediaGroupId: 'event-group-1',
      messageId: '777',
      replyContext: 'Replying to: earlier assistant input',
    })
  })
})

describe('assistant provider watchdog', () => {
  it('emits provider progress and heartbeats for long-running knowledge commands', () => {
    vi.useFakeTimers()
    const events: Array<Record<string, unknown>> = []
    const watchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 1_000,
      providerStallTimeoutMs: 3_000,
      providerLongRunningCommandStallTimeoutMs: 5_000,
      replyInputId: 'input-1',
    })

    watchdog.onProviderEvent({
      id: 'command-1',
      kind: 'command',
      rawEvent: null,
      safeText: 'writing knowledge',
      state: 'running',
      text: '$ murph knowledge upsert --body "# Inbox grouping"',
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
      details: '$ murph knowledge upsert --body "# Inbox grouping"',
      inputId: 'input-1',
      providerKind: 'command',
      providerState: 'running',
      safeDetails: 'writing knowledge',
      type: 'input.reply-progress',
    })

    vi.advanceTimersByTime(1_000)
    expect(events.at(-1)?.details).toContain('knowledge upsert command active for 1s')

    watchdog.onProviderEvent({
      id: 'command-1',
      kind: 'command',
      rawEvent: null,
      safeText: 'done',
      state: 'completed',
      text: '$ murph knowledge upsert --body "# Inbox grouping"',
    })
    vi.advanceTimersByTime(1_000)
    expect(events.at(-1)?.details).not.toContain('knowledge upsert command active')

    watchdog.dispose()
  })

  it('marks timed-out providers as stalled and bridges upstream abort state', () => {
    vi.useFakeTimers()

    const upstream = new AbortController()
    upstream.abort()
    const abortedWatchdog = createAssistantProviderWatchdog({
      providerHeartbeatMs: 1_000,
      providerStallTimeoutMs: 1_000,
      replyInputId: 'input-1',
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
      replyInputId: 'input-2',
    })

    watchdog.onProviderEvent({
      id: 'tool-1',
      kind: 'tool',
      rawEvent: null,
      safeText: 'knowledge',
      state: 'running',
      text: 'tool knowledge upsert',
    })

    vi.advanceTimersByTime(2_000)
    expect(watchdog.signal.aborted).toBe(true)
    expect(events.at(-1)?.details).toContain('during knowledge upsert tool')

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

  it('tracks knowledge-upsert operations and leaves primitive errors unchanged', () => {
    vi.useFakeTimers()

    const events: Array<Record<string, unknown>> = []
    const watchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 1_000,
      providerStallTimeoutMs: 2_000,
      providerLongRunningCommandStallTimeoutMs: 3_000,
      replyInputId: 'input-3',
    })

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
      inputId: 'input-3',
      providerKind: 'status',
      providerState: 'running',
    })
    expect(events.at(-1)?.details).toContain('knowledge upsert tool active for 1s')

    vi.advanceTimersByTime(2_000)
    expect(watchdog.signal.aborted).toBe(true)
    expect(watchdog.normalizeError('provider failed')).toBe('provider failed')

    watchdog.dispose()
  })

  it('ignores deleted review-gpt commands, deleted research tools, and non-tool text', () => {
    vi.useFakeTimers()

    const events: Array<Record<string, unknown>> = []
    const watchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 1_000,
      providerStallTimeoutMs: 4_000,
      providerLongRunningCommandStallTimeoutMs: 4_000,
      replyInputId: 'input-4',
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
    expect(events.map((event) => String(event.details ?? '')).join('\n')).not.toContain(
      'review:gpt run active',
    )

    watchdog.onProviderEvent({
      id: null,
      kind: 'tool',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: 'status update',
    })
    vi.advanceTimersByTime(1_000)
    expect(events.map((event) => String(event.details ?? '')).join('\n')).not.toContain(
      'research tool active',
    )

    watchdog.onProviderEvent({
      id: null,
      kind: 'tool',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: 'tool research knowledge graph',
    })
    vi.advanceTimersByTime(1_000)
    expect(events.map((event) => String(event.details ?? '')).join('\n')).not.toContain(
      'research tool active',
    )

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
      replyInputId: 'input-5',
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
      text: 'tool knowledge upsert',
    })

    vi.advanceTimersByTime(60_000)
    expect(events.at(-1)?.details).toContain('knowledge upsert tool active for 1m')

    watchdog.dispose()

    const laterEvents: Array<Record<string, unknown>> = []
    const laterWatchdog = createAssistantProviderWatchdog({
      onEvent: (event) => {
        laterEvents.push(toSnapshotRecord(event))
      },
      providerHeartbeatMs: 61_000,
      providerStallTimeoutMs: 5 * 61_000,
      providerLongRunningCommandStallTimeoutMs: 5 * 61_000,
      replyInputId: 'input-6',
    })
    laterWatchdog.onProviderEvent({
      id: null,
      kind: 'tool',
      rawEvent: null,
      safeText: null,
      state: 'running',
      text: 'tool knowledge upsert',
    })

    vi.advanceTimersByTime(61_000)
    expect(laterEvents.at(-1)?.details).toContain('knowledge upsert tool active for 1m')

    laterWatchdog.dispose()
  })
})

describe('assistant auto-reply prompt builder support', () => {
  it('renders pending attachment status and skips prompts that never produce usable text', () => {
    expect(
      buildAssistantAutoReplyPrompt([
        createPromptInput({
          attachments: [
            createAttachment({
              kind: 'audio',
              mime: 'audio/mpeg',
              fileName: 'voice-note.mp3',
              parseState: 'pending',
            }),
          ],
        }),
      ]),
    ).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining(
        'Attachment parser status: audio/video transcript is not available yet.',
      ),
    })

    expect(
      buildAssistantAutoReplyPrompt([
        createPromptInput(),
      ]),
    ).toEqual({
      kind: 'skip',
      reason: 'input has no text or attachment context',
    })
  })

  it('builds a single-capture prompt without grouped capture prefixes', () => {
    const result = buildAssistantAutoReplyPrompt([
      createPromptInput({
        attachments: [
          createAttachment({
            kind: 'audio',
            mime: 'audio/mpeg',
            fileName: 'voice-note.mp3',
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
    expect(result.prompt).not.toContain('Input 1:')
  })

  it('builds grouped prompts with attachment excerpts and shared capture context', () => {
    const longTranscript = 'T'.repeat(2_050)
    const longExtractedText = 'E'.repeat(2_050)
    const result = buildAssistantAutoReplyPrompt(
      [
        createPromptInput({
          attachments: [
            createAttachment({
              derivedPath: 'derived/attachments/capture-1.txt',
              kind: 'audio',
              mime: 'audio/mpeg',
              fileName: 'voice-note.mp3',
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
        createPromptInput({
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
      ],
      { timeZone: 'America/New_York' },
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prompt.')
    }
    expect(result.prompt).toContain('Source: telegram')
    expect(result.prompt).toContain(
      'Occurred at (America/New_York local; UTC in brackets): 2026-04-07 20:00:00 [UTC 2026-04-08T00:00:00.000Z] -> 2026-04-07 20:00:05 [UTC 2026-04-08T00:00:05.000Z]',
    )
    expect(result.prompt).toContain('Grouped inputs: 2')
    expect(result.prompt).toContain('Telegram media group: present')
    expect(result.prompt).not.toContain('group-1')
    expect(result.prompt).toContain('Input 1:')
    expect(result.prompt).toContain('Input 2:')
    expect(result.prompt).toContain('Transcript excerpt:')
    expect(result.prompt).toContain('Extracted text excerpt:')
    expect(result.prompt).toContain('[truncated 1450 characters]')
    expect(result.prompt).toContain(
      'Large audio/video attachment transcript content omitted from prompt to keep context small',
    )
  })

  it('renders summer event times in the vault timezone without model arithmetic', async () => {
    const { vaultRoot } = await createTempVault('assistant-automation-timezone-')
    await initializeVault({
      timezone: 'America/New_York',
      vaultRoot,
    })
    const result = await prepareAssistantAutoReplyInput(
      [
        createPromptInput({
          captureOverrides: {
            occurredAt: '2026-07-15T17:45:30.000Z',
            text: 'Can you check this?',
          },
        }),
      ],
      vaultRoot,
    )

    expect(result).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining(
        'Occurred at (America/New_York local; UTC in brackets): 2026-07-15 13:45:30 [UTC 2026-07-15T17:45:30.000Z]',
      ),
      userMessageContent: null,
    })
  })

  it('keeps lifecycle context when no textual or rich evidence is available', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
      {
        attachmentId: 'bundle-1',
        ordinal: 1,
        kind: 'document',
        mime: null,
        fileName: null,
        storedPath: null,
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
        createPromptInput({
          attachments: [createAttachment()],
        }),
      ],
      '/tmp/automation-support-vault',
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready prepared input.')
    }
    expect(result.prompt).toContain('Attachment evidence:')
    expect(result.prompt).toContain('- raw evidence: partial')
    expect(result.prompt).not.toContain('- parser output:')
    expect(result.prompt).toContain('Attachment 1\nfileName: attachment-1.txt')
    expect(result.userMessageContent).toBeNull()
  })

  it('prepares rich multimodal input when only attachment evidence remains', async () => {
    promptBuilderMocks.buildAssistantInputAttachmentPromptBundles.mockResolvedValue([
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
    promptBuilderMocks.hasAssistantInputAttachmentEvidenceCandidate.mockReturnValue(
      true,
    )
    promptBuilderMocks.prepareAssistantInputMultimodalUserMessageContent.mockResolvedValue({
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
        createPromptInput({
          attachments: [createAttachment()],
        }),
      ],
      '/tmp/automation-support-vault',
    )

    expect(result).toEqual({
      kind: 'ready',
      prompt: expect.stringContaining(
        'No decoded attachment text is available. Inspect local attachment paths with tools when needed; do not claim a QR or barcode payload was decoded unless it appears in explicit text evidence.',
      ),
      userMessageContent: [
        {
          text: 'image prompt payload',
          type: 'text',
        },
      ],
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
      '.automation-run.lock',
      'owner.json',
    )
    const lockPath = path.join(
      paths.assistantStateRoot,
      '.automation-run.lock',
    )

    await mkdir(lockPath, { recursive: true })

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
