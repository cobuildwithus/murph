import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AssistantAutomationCursor,
  AssistantAutomationState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  inboxListResultSchema,
  inboxPreserveDocumentAttachmentsResultSchema,
  inboxShowResultSchema,
  type InboxShowResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import { assistantTurnReceiptSchema } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import {
  AssistantActiveTurnInputBudgetExceededError,
  AssistantActiveTurnInputCheckpointRejectedError,
  AssistantActiveTurnInputUnavailableError,
  type AssistantTurnConversationCaptureQuery,
} from '../src/assistant/turn-input.ts'

function toSnapshotRecord<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value))
}

const scannerReplyMocks = vi.hoisted(() => ({
  applyAssistantAutoReplyProcessResult: vi.fn(),
  createAssistantAutoReplyGroupContext: vi.fn(),
  processAssistantAutoReplyGroup: vi.fn(),
}))

const groupingMocks = vi.hoisted(() => ({
  collectAssistantAutoReplyGroup: vi.fn(),
}))

const runLoopMocks = vi.hoisted(() => ({
  acquireAssistantAutomationRunLock: vi.fn(),
  buildAssistantOutboxSummary: vi.fn(),
  createIntegratedInboxServices: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  drainAssistantOutbox: vi.fn(),
  errorMessage: vi.fn(),
  formatStructuredErrorMessage: vi.fn(),
  getAssistantCronStatus: vi.fn(),
  maybeRunAssistantRuntimeMaintenance: vi.fn(),
  maybeThrowInjectedAssistantFault: vi.fn(),
  processDueAssistantCronJobs: vi.fn(),
  readAssistantAutomationState: vi.fn(),
  recordAssistantDiagnosticEvent: vi.fn(),
  redactAssistantDisplayPath: vi.fn(),
  refreshAssistantStatusSnapshot: vi.fn(),
  recoverAssistantAutoReplies: vi.fn(),
  resolveAssistantStatePaths: vi.fn(),
  saveAssistantAutomationState: vi.fn(),
  scanAssistantAutomationOnce: vi.fn(),
  warnAssistantBestEffortFailure: vi.fn(),
}))

const replyMocks = vi.hoisted(() => ({
  assistantAutoReplyGroupOutcomeArtifactExists: vi.fn(),
  assistantChatReplyArtifactExists: vi.fn(),
  collectAssistantAutoReplyGroup: vi.fn(),
  conversationRefFromCapture: vi.fn(),
  createAssistantProviderWatchdog: vi.fn(),
  describeAssistantAutoReplyFailure: vi.fn(),
  errorMessage: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
  isAssistantProviderConnectionLostError: vi.fn(),
  isAssistantProviderStalledError: vi.fn(),
  listAssistantTranscriptEntries: vi.fn(),
  listAssistantTurnReceipts: vi.fn(),
  normalizeNullableString: vi.fn(),
  prepareAssistantAutoReplyInput: vi.fn(),
  readAssistantAutoReplyGroupOutcomeArtifact: vi.fn(),
  readAssistantChatReplyArtifact: vi.fn(),
  resolveAssistantSession: vi.fn(),
  sendAssistantMessage: vi.fn(),
  writeAssistantAutoReplyGroupOutcomeArtifact: vi.fn(),
  writeAssistantChatDeferredArtifacts: vi.fn(),
  writeAssistantChatErrorArtifacts: vi.fn(),
  writeAssistantChatResultArtifacts: vi.fn(),
}))

const evidenceMocks = vi.hoisted(() => ({
  assistantAutoReplyTerminalEvidenceExists: vi.fn(),
  readAssistantAutoReplyTerminalEvidence: vi.fn(),
  writeAssistantAutoReplyReplyIntentEvidence: vi.fn(),
  writeAssistantAutoReplyReplyTerminalEvidence: vi.fn(),
  writeAssistantAutoReplySuppressionEvidence: vi.fn(),
}))

vi.mock('../src/assistant/automation/artifacts.ts', () => ({
  assistantAutoReplyGroupOutcomeArtifactExists:
    replyMocks.assistantAutoReplyGroupOutcomeArtifactExists,
  assistantChatReplyArtifactExists: replyMocks.assistantChatReplyArtifactExists,
  readAssistantAutoReplyGroupOutcomeArtifact:
    replyMocks.readAssistantAutoReplyGroupOutcomeArtifact,
  readAssistantChatReplyArtifact: replyMocks.readAssistantChatReplyArtifact,
  writeAssistantAutoReplyGroupOutcomeArtifact:
    replyMocks.writeAssistantAutoReplyGroupOutcomeArtifact,
  writeAssistantChatDeferredArtifacts: replyMocks.writeAssistantChatDeferredArtifacts,
  writeAssistantChatErrorArtifacts: replyMocks.writeAssistantChatErrorArtifacts,
  writeAssistantChatResultArtifacts: replyMocks.writeAssistantChatResultArtifacts,
}))

vi.mock('../src/assistant/automation/evidence.ts', () => ({
  assistantAutoReplyTerminalEvidenceExists:
    evidenceMocks.assistantAutoReplyTerminalEvidenceExists,
  readAssistantAutoReplyTerminalEvidence:
    evidenceMocks.readAssistantAutoReplyTerminalEvidence,
  writeAssistantAutoReplyReplyIntentEvidence:
    evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence,
  writeAssistantAutoReplyReplyTerminalEvidence:
    evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence,
  writeAssistantAutoReplySuppressionEvidence:
    evidenceMocks.writeAssistantAutoReplySuppressionEvidence,
}))

vi.mock('../src/assistant/automation/reply.ts', () => ({
  applyAssistantAutoReplyProcessResult:
    scannerReplyMocks.applyAssistantAutoReplyProcessResult,
  createAssistantAutoReplyGroupContext:
    scannerReplyMocks.createAssistantAutoReplyGroupContext,
  processAssistantAutoReplyGroup: scannerReplyMocks.processAssistantAutoReplyGroup,
}))

vi.mock('../src/assistant/automation/grouping.ts', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/assistant/automation/grouping.ts')
  >()
  return {
    ...actual,
    collectAssistantAutoReplyGroup: groupingMocks.collectAssistantAutoReplyGroup,
  }
})

vi.mock('../src/assistant/automation/scanner.ts', () => ({
  scanAssistantAutomationOnce: runLoopMocks.scanAssistantAutomationOnce,
}))

vi.mock('../src/assistant/automation/startup-recovery.ts', () => ({
  recoverAssistantAutoReplies:
    runLoopMocks.recoverAssistantAutoReplies,
}))

vi.mock('@murphai/inbox-services', () => ({
  createIntegratedInboxServices: runLoopMocks.createIntegratedInboxServices,
}))

vi.mock('@murphai/vault-usecases/vault-services', () => ({
  createIntegratedVaultServices: runLoopMocks.createIntegratedVaultServices,
}))

vi.mock('../src/assistant/cron.ts', () => ({
  getAssistantCronStatus: runLoopMocks.getAssistantCronStatus,
  processDueAssistantCronJobsLocal: runLoopMocks.processDueAssistantCronJobs,
}))

vi.mock('../src/assistant/diagnostics.ts', () => ({
  recordAssistantDiagnosticEvent: runLoopMocks.recordAssistantDiagnosticEvent,
}))

vi.mock('../src/assistant/fault-injection.ts', () => ({
  maybeThrowInjectedAssistantFault: runLoopMocks.maybeThrowInjectedAssistantFault,
}))

vi.mock('../src/assistant/outbox.ts', () => ({
  drainAssistantOutboxLocal: runLoopMocks.drainAssistantOutbox,
}))

vi.mock('../src/assistant/outbox/summary.ts', () => ({
  buildAssistantOutboxSummary: runLoopMocks.buildAssistantOutboxSummary,
}))

vi.mock('../src/assistant/runtime-budgets.ts', () => ({
  maybeRunAssistantRuntimeMaintenance: runLoopMocks.maybeRunAssistantRuntimeMaintenance,
}))

vi.mock('../src/assistant/status.ts', () => ({
  refreshAssistantStatusSnapshot: runLoopMocks.refreshAssistantStatusSnapshot,
}))

vi.mock('../src/assistant/shared.ts', () => ({
  errorMessage: runLoopMocks.errorMessage,
  formatStructuredErrorMessage: runLoopMocks.formatStructuredErrorMessage,
  normalizeNullableString: replyMocks.normalizeNullableString,
  warnAssistantBestEffortFailure: runLoopMocks.warnAssistantBestEffortFailure,
}))

vi.mock('../src/assistant/store.ts', () => ({
  listAssistantTranscriptEntries: replyMocks.listAssistantTranscriptEntries,
  readAssistantAutomationState: runLoopMocks.readAssistantAutomationState,
  redactAssistantDisplayPath: runLoopMocks.redactAssistantDisplayPath,
  resolveAssistantSession: replyMocks.resolveAssistantSession,
  resolveAssistantStatePaths: runLoopMocks.resolveAssistantStatePaths,
  saveAssistantAutomationState: runLoopMocks.saveAssistantAutomationState,
}))

vi.mock('../src/assistant/automation/runtime-lock.ts', () => ({
  acquireAssistantAutomationRunLock: runLoopMocks.acquireAssistantAutomationRunLock,
}))

vi.mock('../src/assistant/channel-adapters.ts', () => ({
  getAssistantChannelAdapter: replyMocks.getAssistantChannelAdapter,
}))

vi.mock('../src/assistant/conversation-ref.ts', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/assistant/conversation-ref.ts')
  >()
  return {
    ...actual,
    conversationRefFromCapture: replyMocks.conversationRefFromCapture,
  }
})

vi.mock('../src/assistant/provider-turn-recovery.ts', () => ({
  isAssistantProviderConnectionLostError:
    replyMocks.isAssistantProviderConnectionLostError,
  isAssistantProviderStalledError: replyMocks.isAssistantProviderStalledError,
}))

vi.mock('../src/assistant/receipts.ts', () => ({
  listAssistantTurnReceipts: replyMocks.listAssistantTurnReceipts,
}))

vi.mock('../src/assistant/service.ts', () => ({
  sendAssistantMessage: replyMocks.sendAssistantMessage,
}))

vi.mock('../src/assistant/automation/failure-observability.ts', () => ({
  describeAssistantAutoReplyFailure: replyMocks.describeAssistantAutoReplyFailure,
}))

vi.mock('../src/assistant/automation/provider-watchdog.ts', () => ({
  AUTO_REPLY_PROVIDER_STALLED_DETAIL:
    'assistant provider stalled; will retry this capture once it becomes responsive again.',
  createAssistantProviderWatchdog: replyMocks.createAssistantProviderWatchdog,
}))

vi.mock('../src/assistant/automation/prompt-builder.ts', () => ({
  loadTelegramAutoReplyMetadata: vi.fn().mockResolvedValue(null),
  prepareAssistantAutoReplyInput: replyMocks.prepareAssistantAutoReplyInput,
}))

function createCaptureSummary(
  overrides: Partial<
    ReturnType<typeof createListResult>['items'][number]
  > = {},
) {
  return createListResult([
    {
      captureId: 'capture-1',
      source: 'telegram',
      accountId: null,
      externalId: 'external-1',
      threadId: 'thread-1',
      threadTitle: 'Thread 1',
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
      createdAt: '2026-04-08T00:00:01.000Z',
      ...overrides,
    },
  ]).items[0]!
}

function createCaptureDetail(
  overrides: Partial<InboxShowResult['capture']> = {},
): InboxShowResult['capture'] {
  return createShowResult({
    captureId: 'capture-1',
    source: 'telegram',
    accountId: null,
    externalId: 'external-1',
    threadId: 'thread-1',
    threadTitle: 'Thread 1',
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
    createdAt: '2026-04-08T00:00:01.000Z',
    attachments: [],
    ...overrides,
  }).capture
}

function createListResult(
  items: readonly Record<string, unknown>[],
  overrides: Partial<{
    afterCaptureId: string | null
    afterOccurredAt: string | null
    limit: number
    oldestFirst: boolean
  }> = {},
) {
  return inboxListResultSchema.parse({
    vault: '/tmp/assistant-automation-vault',
    filters: {
      sourceId: null,
      limit: overrides.limit ?? 50,
      afterOccurredAt: overrides.afterOccurredAt ?? null,
      afterCaptureId: overrides.afterCaptureId ?? null,
      oldestFirst: overrides.oldestFirst ?? true,
    },
    items,
  })
}

function createShowResult(capture: Record<string, unknown>) {
  return inboxShowResultSchema.parse({
    vault: '/tmp/assistant-automation-vault',
    capture,
  })
}

function createPreserveResult(captureId: string) {
  return inboxPreserveDocumentAttachmentsResultSchema.parse({
    vault: '/tmp/assistant-automation-vault',
    captureId,
    preservedCount: 1,
    createdCount: 1,
    documents: [
      {
        attachmentId: 'attachment-1',
        ordinal: 1,
        lookupId: 'lookup-1',
        relatedId: 'related-1',
        created: true,
      },
    ],
  })
}

function createTurnReceipt(
  overrides: Partial<
    ReturnType<typeof assistantTurnReceiptSchema.parse>
  > & {
    captureIds?: readonly string[]
    primaryCaptureId?: string
  } = {},
) {
  const captureIds = overrides.captureIds ?? ['capture-1']
  const primaryCaptureId = overrides.primaryCaptureId ?? captureIds[0] ?? 'capture-1'

  return assistantTurnReceiptSchema.parse({
    schema: 'murph.assistant-turn-receipt.v1',
    turnId: overrides.turnId ?? 'turn-1',
    sessionId: overrides.sessionId ?? 'session-1',
    provider: overrides.provider ?? 'codex-cli',
    providerModel: overrides.providerModel ?? 'gpt-5.4',
    promptPreview: overrides.promptPreview ?? 'reply prompt',
    responsePreview:
      overrides.responsePreview === undefined ? null : overrides.responsePreview,
    status: overrides.status ?? 'failed',
    deliveryRequested: overrides.deliveryRequested ?? true,
    deliveryDisposition: overrides.deliveryDisposition ?? 'failed',
    deliveryIntentId:
      overrides.deliveryIntentId === undefined ? null : overrides.deliveryIntentId,
    startedAt: overrides.startedAt ?? '2026-04-08T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-08T00:00:05.000Z',
    completedAt:
      overrides.completedAt === undefined
        ? '2026-04-08T00:00:05.000Z'
        : overrides.completedAt,
    lastError:
      overrides.lastError === undefined
        ? {
            code: 'EPIPE',
            message: 'write EPIPE',
          }
        : overrides.lastError,
    timeline: overrides.timeline ?? [
      {
        at: overrides.startedAt ?? '2026-04-08T00:00:00.000Z',
        kind: 'turn.started',
        detail: null,
        metadata: {
          autoReplyCaptureId: primaryCaptureId,
          autoReplyCaptureIds: captureIds.join(','),
        },
      },
    ],
  })
}

type LegacyAutomationStateOverrides = Partial<AssistantAutomationState> & {
  autoReplyBacklogChannels?: readonly string[]
  autoReplyChannels?: readonly string[]
  autoReplyPrimed?: boolean
  autoReplyScanCursor?: AssistantAutomationCursor | null
}

function createAutomationState(
  overrides: LegacyAutomationStateOverrides = {},
): AssistantAutomationState {
  const {
    autoReply: explicitAutoReply,
    autoReplyBacklogChannels: _legacyBacklogChannels,
    autoReplyChannels: legacyAutoReplyChannels,
    autoReplyPrimed: _legacyAutoReplyPrimed,
    autoReplyScanCursor: legacyAutoReplyScanCursor,
    ...stateOverrides
  } = overrides
  const autoReply =
    explicitAutoReply ??
    [...new Set(legacyAutoReplyChannels ?? [])].map((channel) => ({
      channel,
      eligibleAfter: legacyAutoReplyScanCursor ?? null,
      enabledAt: '2026-04-08T00:00:00.000Z',
    }))
  return {
    version: 1,
    inboxScanCursor: null,
    autoReply,
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...stateOverrides,
  }
}

function createAutoReplyEntries(
  channels: readonly string[],
  cursor: AssistantAutomationCursor | null = null,
): AssistantAutomationState['autoReply'] {
  return [...new Set(channels)].map((channel) => ({
    channel,
    eligibleAfter: cursor,
    enabledAt: '2026-04-08T00:00:00.000Z',
  }))
}

function readAutoReplyCursor(
  state: Pick<AssistantAutomationState, 'autoReply'>,
  channel: string,
): AssistantAutomationCursor | null {
  return state.autoReply.find((entry) => entry.channel === channel)?.eligibleAfter ?? null
}

function createInboxServices(
  overrides: Partial<InboxServices> = {},
): InboxServices {
  const unreachable = async () => {
    throw new Error('unreachable inbox service call')
  }

  return {
    bootstrap: unreachable,
    init: unreachable,
    sourceAdd: unreachable,
    sourceList: unreachable,
    sourceRemove: unreachable,
    sourceSetEnabled: unreachable,
    doctor: unreachable,
    setup: unreachable,
    parse: unreachable,
    requeue: unreachable,
    backfill: unreachable,
    run: unreachable,
    status: unreachable,
    stop: unreachable,
    list: unreachable,
    listAttachments: unreachable,
    showAttachment: unreachable,
    showAttachmentStatus: unreachable,
    parseAttachment: unreachable,
    reparseAttachment: unreachable,
    show: unreachable,
    search: unreachable,
    preserveDocumentAttachments: unreachable,
    promoteMeal: unreachable,
    promoteDocument: unreachable,
    promoteJournal: unreachable,
    promoteExperimentNote: unreachable,
    ...overrides,
  }
}

function createAutoReplyContextForTest(
  items: ReadonlyArray<{
    summary: { captureId: string; occurredAt: string }
    telegramMetadata: { mediaGroupId: string | null; messageId: string | null; replyContext: string | null } | null
  }>,
) {
  const firstItem = items[0]
  const lastItem = items[items.length - 1]
  if (!firstItem || !lastItem) {
    return null
  }

  return {
    captureCount: items.length,
    captureIds: items.map((item) => item.summary.captureId),
    firstCaptureId: firstItem.summary.captureId,
    firstItem,
    items,
    lastCursor: {
      captureId: lastItem.summary.captureId,
      occurredAt: lastItem.summary.occurredAt,
    },
  }
}

function applyAutoReplyProcessResultForTest(input: {
  context: { lastCursor: AssistantAutomationCursor }
  result: {
    advanceCursor: boolean
    failed: number
    replied: number
    skipped: number
    stopScanning: boolean
  }
  summary: { failed: number; replied: number; skipped: number }
  updateCursor: (cursor: AssistantAutomationCursor) => void
}) {
  input.summary.failed += input.result.failed
  input.summary.replied += input.result.replied
  input.summary.skipped += input.result.skipped
  if (input.result.advanceCursor) {
    input.updateCursor(input.context.lastCursor)
  }

  return input.result.stopScanning
}

function createReplyGroupItem(
  summary: ReturnType<typeof createCaptureSummary>,
  telegramMetadata: { mediaGroupId: string | null; messageId: string | null; replyContext: string | null } | null = null,
) {
  return {
    summary,
    telegramMetadata,
  }
}

beforeEach(() => {
  vi.useRealTimers()

  scannerReplyMocks.applyAssistantAutoReplyProcessResult
    .mockReset()
    .mockImplementation(applyAutoReplyProcessResultForTest)
  scannerReplyMocks.createAssistantAutoReplyGroupContext
    .mockReset()
    .mockImplementation(createAutoReplyContextForTest)
  scannerReplyMocks.processAssistantAutoReplyGroup.mockReset().mockResolvedValue({
    advanceCursor: true,
    failed: 0,
    replied: 0,
    skipped: 1,
    stopScanning: false,
  })

  groupingMocks.collectAssistantAutoReplyGroup.mockReset().mockImplementation(
    async (input: {
      captures: Array<ReturnType<typeof createCaptureSummary>>
      startIndex: number
    }) => ({
      endIndex: input.startIndex,
      items: [
        createReplyGroupItem(input.captures[input.startIndex]!),
      ],
    }),
  )

  runLoopMocks.acquireAssistantAutomationRunLock.mockReset().mockResolvedValue({
    release: vi.fn().mockResolvedValue(undefined),
  })
  runLoopMocks.createIntegratedInboxServices.mockReset()
  runLoopMocks.createIntegratedVaultServices.mockReset().mockReturnValue({})
  runLoopMocks.drainAssistantOutbox.mockReset().mockResolvedValue({
    attempted: 0,
    failed: 0,
    queued: 0,
    sent: 0,
  })
  runLoopMocks.errorMessage.mockReset().mockImplementation((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  )
  runLoopMocks.formatStructuredErrorMessage
    .mockReset()
    .mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    )
  runLoopMocks.getAssistantCronStatus.mockReset().mockResolvedValue({
    nextRunAt: null,
  })
  runLoopMocks.buildAssistantOutboxSummary.mockReset().mockResolvedValue({
    nextAttemptAt: null,
  })
  runLoopMocks.maybeRunAssistantRuntimeMaintenance.mockReset().mockResolvedValue(undefined)
  runLoopMocks.maybeThrowInjectedAssistantFault.mockReset().mockImplementation(() => {})
  runLoopMocks.processDueAssistantCronJobs.mockReset().mockResolvedValue({
    processed: 0,
  })
  runLoopMocks.readAssistantAutomationState
    .mockReset()
    .mockResolvedValue(createAutomationState())
  runLoopMocks.recordAssistantDiagnosticEvent.mockReset().mockResolvedValue(undefined)
  runLoopMocks.redactAssistantDisplayPath
    .mockReset()
    .mockImplementation((vault: string) => vault.replace('/tmp/', '/redacted/'))
  runLoopMocks.refreshAssistantStatusSnapshot.mockReset().mockResolvedValue(undefined)
  runLoopMocks.recoverAssistantAutoReplies
    .mockReset()
    .mockResolvedValue({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      progressed: false,
      replied: 0,
      skipped: 0,
    })
  runLoopMocks.resolveAssistantStatePaths.mockReset().mockReturnValue({
    lockPath: '/tmp/assistant.lock',
  })
  runLoopMocks.saveAssistantAutomationState
    .mockReset()
    .mockImplementation(async (_vault: string, next: AssistantAutomationState) => next)
  runLoopMocks.scanAssistantAutomationOnce.mockReset().mockResolvedValue({
    routing: {
      considered: 1,
      failed: 0,
      nextWakeAt: null,
      noAction: 0,
      routed: 1,
      skipped: 0,
    },
    replies: {
      considered: 1,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
    },
  })
  runLoopMocks.warnAssistantBestEffortFailure.mockReset().mockImplementation(() => {})

  replyMocks.assistantAutoReplyGroupOutcomeArtifactExists
    .mockReset()
    .mockResolvedValue(false)
  replyMocks.assistantChatReplyArtifactExists.mockReset().mockResolvedValue(false)
  replyMocks.collectAssistantAutoReplyGroup.mockReset()
  replyMocks.conversationRefFromCapture
    .mockReset()
    .mockImplementation((capture: InboxShowResult['capture']) => ({
      channel: capture.source,
      threadId: capture.threadId,
    }))
  replyMocks.createAssistantProviderWatchdog.mockReset().mockImplementation(() => {
    const controller = new AbortController()
    return {
      dispose: vi.fn(),
      normalizeError: (error: unknown) => error,
      onProviderEvent: vi.fn(),
      signal: controller.signal,
    }
  })
  replyMocks.describeAssistantAutoReplyFailure.mockReset().mockImplementation(
    (error: unknown) => ({
      code:
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : null,
      context: null,
      kind: 'provider',
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
      safeSummary: 'safe failure',
    }),
  )
  replyMocks.errorMessage.mockReset().mockImplementation((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  )
  replyMocks.getAssistantChannelAdapter.mockReset().mockReturnValue(null)
  replyMocks.isAssistantProviderConnectionLostError.mockReset().mockReturnValue(false)
  replyMocks.isAssistantProviderStalledError.mockReset().mockReturnValue(false)
  replyMocks.listAssistantTranscriptEntries.mockReset().mockResolvedValue([])
  replyMocks.listAssistantTurnReceipts.mockReset().mockResolvedValue([])
  replyMocks.normalizeNullableString
    .mockReset()
    .mockImplementation((value: string | null | undefined) => {
      if (typeof value !== 'string') {
        return null
      }
      const normalized = value.trim()
      return normalized.length > 0 ? normalized : null
    })
  replyMocks.prepareAssistantAutoReplyInput.mockReset().mockResolvedValue({
    kind: 'ready',
    prompt: 'reply prompt',
    userMessageContent: null,
  })
  replyMocks.readAssistantAutoReplyGroupOutcomeArtifact
    .mockReset()
    .mockResolvedValue({
      deliveryIntentId: null,
      outcome: 'result',
      recordedAt: '2026-04-08T00:10:00.000Z',
      sessionId: 'session-1',
    })
  replyMocks.readAssistantChatReplyArtifact
    .mockReset()
    .mockResolvedValue({
      deliveryIntentId: null,
      outcome: 'result',
      recordedAt: '2026-04-08T00:10:00.000Z',
      sessionId: 'session-1',
    })
  replyMocks.resolveAssistantSession.mockReset().mockRejectedValue(
    Object.assign(new Error('not found'), {
      code: 'ASSISTANT_SESSION_NOT_FOUND',
    }),
  )
  replyMocks.sendAssistantMessage.mockReset().mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'target-1',
      sentAt: '2026-04-08T00:10:00.000Z',
    },
    deliveryDeferred: false,
    deliveryError: null,
    deliveryIntentId: null,
    response: 'response text',
    session: {
      sessionId: 'session-1',
    },
  })
  replyMocks.writeAssistantAutoReplyGroupOutcomeArtifact
    .mockReset()
    .mockResolvedValue(undefined)
  replyMocks.writeAssistantChatDeferredArtifacts.mockReset().mockResolvedValue(undefined)
  replyMocks.writeAssistantChatErrorArtifacts.mockReset().mockResolvedValue(undefined)
  replyMocks.writeAssistantChatResultArtifacts.mockReset().mockResolvedValue(undefined)

  evidenceMocks.assistantAutoReplyTerminalEvidenceExists
    .mockReset()
    .mockResolvedValue(false)
  evidenceMocks.readAssistantAutoReplyTerminalEvidence
    .mockReset()
    .mockResolvedValue(null)
  evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence
    .mockReset()
    .mockResolvedValue(undefined)
  evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence
    .mockReset()
    .mockResolvedValue(undefined)
  evidenceMocks.writeAssistantAutoReplySuppressionEvidence
    .mockReset()
    .mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('assistant automation shared helpers', () => {
  it('normalizes cursors, channels, intervals, limits, and empty summaries', async () => {
    const shared = await vi.importActual<typeof import('../src/assistant/automation/shared.ts')>(
      '../src/assistant/automation/shared.ts',
    )

    const earlier = {
      captureId: 'capture-1',
      createdAt: '2026-04-08T00:00:01.000Z',
      occurredAt: '2026-04-08T00:00:00.000Z',
    }
    const later = {
      captureId: 'capture-2',
      createdAt: '2026-04-08T00:00:02.000Z',
      occurredAt: '2026-04-08T00:00:00.000Z',
    }

    expect(shared.cursorFromCapture(later)).toEqual(later)
    expect(shared.compareAssistantAutomationCursor(earlier, later)).toBeLessThan(0)
    expect(shared.compareAssistantAutomationCursor(later, later)).toBe(0)
    expect(shared.compareAssistantCaptureOrder(later, earlier)).toBeGreaterThan(0)
    expect(shared.isAssistantCaptureAfterCursor(later, earlier)).toBe(true)
    expect(shared.isAssistantCaptureAfterCursor(earlier, later)).toBe(false)
    expect(shared.isAssistantCaptureAfterCursor(earlier, null)).toBe(true)
    expect(
      shared.compareAssistantCaptureOrder(
        {
          captureId: 'capture-3',
          createdAt: '2026-04-08T00:00:03.000Z',
          occurredAt: '2026-04-07T23:59:59.000Z',
        },
        later,
      ),
    ).toBeGreaterThan(0)
    expect(shared.normalizeEnabledChannels([' telegram ', '', 'telegram', 'linq '])).toEqual([
      'telegram',
      'linq',
    ])
    expect(
      shared.computeAssistantAutomationRetryAt(
        5_000,
        Date.parse('2026-04-08T00:00:00.000Z'),
      ),
    ).toBe('2026-04-08T00:00:05.000Z')
    expect(shared.normalizeAssistantAutomationWakeAt('invalid')).toBeNull()
    expect(
      shared.earliestAssistantAutomationWakeAt(
        '2026-04-08T00:00:05.000Z',
        '2026-04-08T00:00:03.000Z',
        null,
      ),
    ).toBe('2026-04-08T00:00:03.000Z')
    expect(shared.normalizeScanLimit(undefined)).toBe(50)
    expect(shared.normalizeScanLimit(0.4)).toBe(1)
    expect(shared.normalizeScanLimit(250.8)).toBe(200)
    expect(shared.createEmptyInboxScanResult()).toEqual({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      noAction: 0,
      routed: 0,
      skipped: 0,
    })
    expect(shared.createEmptyAutoReplyScanResult()).toEqual({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    })
  })

  it('bridges upstream aborts and local shutdown signals', async () => {
    vi.useFakeTimers()
    const shared = await vi.importActual<typeof import('../src/assistant/automation/shared.ts')>(
      '../src/assistant/automation/shared.ts',
    )

    const upstreamController = new AbortController()
    const controller = new AbortController()
    const exitProcess = vi.fn()
    const cleanup = shared.bridgeAbortSignals(controller, upstreamController.signal, {
      exitProcess,
      forceExitGraceMs: 25,
    })

    upstreamController.abort()
    expect(controller.signal.aborted).toBe(true)

    process.emit('SIGINT')
    expect(exitProcess).toHaveBeenCalledWith(130)
    cleanup()

    const localController = new AbortController()
    const localExitProcess = vi.fn()
    const localCleanup = shared.bridgeAbortSignals(localController, undefined, {
      exitProcess: localExitProcess,
      forceExitGraceMs: 25,
    })

    process.emit('SIGTERM')
    expect(localController.signal.aborted).toBe(true)
    expect(localExitProcess).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(25)
    expect(localExitProcess).toHaveBeenCalledWith(143)
    localCleanup()
  })

  it('waits for timeout completion or upstream abort', async () => {
    vi.useFakeTimers()
    const shared = await vi.importActual<typeof import('../src/assistant/automation/shared.ts')>(
      '../src/assistant/automation/shared.ts',
    )

    const timeoutController = new AbortController()
    const timeoutPromise = shared.waitForAbortOrTimeout(timeoutController.signal, 50)
    await vi.advanceTimersByTimeAsync(50)
    await expect(timeoutPromise).resolves.toBeUndefined()

    const abortController = new AbortController()
    const abortPromise = shared.waitForAbortOrTimeout(abortController.signal, 50)
    abortController.abort()
    await expect(abortPromise).resolves.toBeUndefined()
  })
})

describe('assistant automation scanner', () => {
  it('returns immediately when routing and auto-reply are both disabled', async () => {
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices: createInboxServices(),
      state: createAutomationState(),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      replies: {
        considered: 0,
        failed: 0,
        nextWakeAt: null,
        replied: 0,
        skipped: 0,
      },
      routing: {
        considered: 0,
        failed: 0,
        nextWakeAt: null,
        noAction: 0,
        routed: 0,
        skipped: 0,
      },
    })
  })

  it('primes the auto-reply cursor before scanning new inbound messages', async () => {
    const latest = createCaptureSummary({
      captureId: 'capture-latest',
      occurredAt: '2026-04-08T00:05:00.000Z',
    })
    const list = vi
      .fn()
      .mockResolvedValueOnce(createListResult([latest], {
        limit: 1,
        oldestFirst: false,
      }))
      .mockResolvedValueOnce(createListResult([]))
    const inboxServices = createInboxServices({
      list,
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const stateUpdates: AssistantAutomationState[] = []
    const events: Array<Record<string, unknown>> = []
    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      onStateProgress: async (next) => {
        stateUpdates.push({
          ...createAutomationState(),
          autoReply: [...next.autoReply],
          inboxScanCursor: next.inboxScanCursor,
        })
      },
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replies).toEqual({
      considered: 1,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
    })
    expect(readAutoReplyCursor(stateUpdates[0] ?? createAutomationState(), 'telegram')).toBeNull()
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'reply.scan.primed',
      }),
    )
  })

  it('clears reply backlog state once the backlog is drained', async () => {
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([])),
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const stateUpdates: AssistantAutomationState[] = []
    await scanner.scanAssistantAutomationOnce({
      inboxServices,
      onStateProgress: async (next) => {
        stateUpdates.push({
          ...createAutomationState(),
          autoReply: [...next.autoReply],
          inboxScanCursor: next.inboxScanCursor,
        })
      },
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(stateUpdates).toEqual([])
  })

  it('rechecks captures behind the legacy reply cursor until terminal evidence exists', async () => {
    const capture = createCaptureSummary({
      captureId: 'capture-before-cursor',
      occurredAt: '2026-04-08T00:04:00.000Z',
    })
    const list = vi.fn().mockResolvedValue(createListResult([capture]))
    const inboxServices = createInboxServices({
      list,
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      state: createAutomationState({
        autoReply: [
          {
            channel: 'telegram',
            enabledAt: '2026-04-08T00:00:00.000Z',
            eligibleAfter: null,
          },
        ],
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      afterCaptureId: null,
      afterOccurredAt: null,
    }))
    expect(result.replies).toMatchObject({
      considered: 1,
      skipped: 1,
    })
  })

  it('continues reply processing when automatic document preservation fails', async () => {
    const capture = createCaptureSummary({
      attachmentCount: 1,
    })
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([capture])),
      preserveDocumentAttachments: vi
        .fn()
        .mockRejectedValue(new Error('preserve failed')),
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const events: Array<Record<string, unknown>> = []
    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
        autoReplyPrimed: true,
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      replies: {
        considered: 1,
        failed: 0,
        nextWakeAt: null,
        replied: 0,
        skipped: 1,
      },
      routing: {
        considered: 0,
        failed: 0,
        nextWakeAt: null,
        noAction: 0,
        routed: 0,
        skipped: 0,
      },
    })
    expect(events).toContainEqual({
      type: 'capture.reply-progress',
      captureId: 'capture-1',
      details: 'nonblocking document preservation failed',
      providerKind: 'status',
      providerState: 'completed',
      safeDetails: 'document_preservation_failed_nonblocking',
    })
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledOnce()
  })

  it('skips disabled inbox model routing when canonical writes are disabled', async () => {
    const preserveDocumentAttachments = vi
      .fn()
      .mockRejectedValue(new Error('should not preserve'))
    const capture = createCaptureSummary({
      attachmentCount: 1,
    })
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([capture])),
      preserveDocumentAttachments,
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )
    const stateUpdates: AssistantAutomationState[] = []

    const result = await scanner.scanAssistantAutomationOnce({
      applyCanonicalWrites: false,
      inboxServices,
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
        autoReplyPrimed: true,
      }),
      onStateProgress: async (next) => {
        stateUpdates.push({
          ...createAutomationState(),
          autoReply: [...next.autoReply],
          inboxScanCursor: next.inboxScanCursor,
        })
      },
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.routing).toMatchObject({
      considered: 0,
      failed: 0,
    })
    expect(preserveDocumentAttachments).not.toHaveBeenCalled()
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).not.toHaveBeenCalled()
    expect(stateUpdates).toEqual([])
  })

  it('does not route inbox captures through the legacy model path', async () => {
    const first = createCaptureSummary({
      captureId: 'capture-1',
      occurredAt: '2026-04-08T00:01:00.000Z',
    })
    const second = createCaptureSummary({
      captureId: 'capture-2',
      occurredAt: '2026-04-08T00:02:00.000Z',
    })
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([first, second])),
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const stateUpdates: AssistantAutomationState[] = []
    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      onStateProgress: async (next) => {
        stateUpdates.push({
          ...createAutomationState(),
          autoReply: [...next.autoReply],
          inboxScanCursor: next.inboxScanCursor,
        })
      },
      state: createAutomationState(),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.routing).toEqual({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      noAction: 0,
      routed: 0,
      skipped: 0,
    })
    expect(inboxServices.list).not.toHaveBeenCalled()
    expect(stateUpdates).toEqual([])
  })

  it('scans only auto-reply candidates when the reply page is full', async () => {
    const shared = createCaptureSummary({
      captureId: 'capture-reply',
      occurredAt: '2026-04-08T00:01:00.000Z',
    })
    const list = vi.fn().mockResolvedValueOnce(createListResult([shared], {
      limit: 1,
    }))
    const inboxServices = createInboxServices({
      list,
      preserveDocumentAttachments: vi
        .fn()
        .mockResolvedValue(createPreserveResult('capture-reply')),
    })
    scannerReplyMocks.processAssistantAutoReplyGroup.mockResolvedValue({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: true,
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      maxPerScan: 1,
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
        autoReplyPrimed: true,
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replies).toEqual({
      considered: 1,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
    })
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('assistant auto-reply runtime', () => {
  it('skips scan work when no auto-reply channels are enabled', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )

    const result = await reply.scanAssistantAutoReplyOnce({
      enabledChannels: [],
      inboxServices: createInboxServices(),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    })
  })

  it('keeps failed captures pending instead of advancing the reply cursor', async () => {
    const latest = createCaptureSummary({
      captureId: 'capture-latest',
      occurredAt: '2026-04-08T00:03:00.000Z',
    })
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(
        createListResult([latest], {
          limit: 1,
          oldestFirst: false,
        }),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )

    const stateUpdates: Array<Record<string, unknown>> = []
    const events: Array<Record<string, unknown>> = []
    const result = await reply.scanAssistantAutoReplyOnce({
      enabledChannels: ['telegram'],
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      onStateProgress: async (state) => {
        stateUpdates.push(toSnapshotRecord(state))
      },
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      considered: 1,
      failed: 1,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 0,
    })
    expect(stateUpdates).toEqual([])
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'reply.scan.primed',
      }),
    )
  })

  it('keeps a null reply cursor when no captures are present yet', async () => {
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([], {
        limit: 1,
        oldestFirst: false,
      })),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )

    const stateUpdates: Array<Record<string, unknown>> = []
    const events: Array<Record<string, unknown>> = []
    const result = await reply.scanAssistantAutoReplyOnce({
      enabledChannels: ['telegram'],
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      onStateProgress: async (state) => {
        stateUpdates.push(toSnapshotRecord(state))
      },
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    })
    expect(stateUpdates).toEqual([])
    expect(events).toContainEqual({
      type: 'reply.scan.started',
      details: '0 capture(s)',
    })
  })

  it('keeps the supplied reply cursor when no new captures are found', async () => {
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([])),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )

    const stateUpdates: Array<Record<string, unknown>> = []
    const result = await reply.scanAssistantAutoReplyOnce({
      afterCursor: {
        captureId: 'capture-previous',
        occurredAt: '2026-04-08T00:01:00.000Z',
      },
      enabledChannels: ['telegram'],
      inboxServices,
      onStateProgress: async (state) => {
        stateUpdates.push(toSnapshotRecord(state))
      },
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    })
    expect(stateUpdates).toEqual([])
  })

  it('scans grouped captures without using the reply cursor as handling proof', async () => {
    const first = createCaptureSummary({
      captureId: 'capture-2',
      occurredAt: '2026-04-08T00:02:00.000Z',
    })
    const second = createCaptureSummary({
      captureId: 'capture-1',
      occurredAt: '2026-04-08T00:02:00.000Z',
    })
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([first, second])),
      show: vi.fn().mockImplementation(async (input: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt: '2026-04-08T00:02:00.000Z',
          }),
        ),
      ),
    })
    groupingMocks.collectAssistantAutoReplyGroup.mockResolvedValue({
      endIndex: 1,
      items: [
        createReplyGroupItem(second),
        createReplyGroupItem(first),
      ],
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )

    const stateUpdates: Array<Record<string, unknown>> = []
    const events: Array<Record<string, unknown>> = []
    const result = await reply.scanAssistantAutoReplyOnce({
      enabledChannels: ['telegram'],
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      onStateProgress: async (state) => {
        stateUpdates.push(toSnapshotRecord(state))
      },
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      considered: 2,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
    })
    expect(events).toContainEqual({
      type: 'reply.scan.started',
      details: '2 capture(s)',
    })
    expect(stateUpdates).toEqual([])
  })

  it('skips null reply contexts while keeping the scan cursor unchanged', async () => {
    const capture = createCaptureSummary()
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([capture])),
    })
    groupingMocks.collectAssistantAutoReplyGroup.mockResolvedValue({
      endIndex: 0,
      items: [],
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )

    const stateUpdates: Array<Record<string, unknown>> = []
    const result = await reply.scanAssistantAutoReplyOnce({
      afterCursor: {
        captureId: 'capture-before',
        occurredAt: '2026-04-08T00:00:00.000Z',
      },
      enabledChannels: ['telegram'],
      inboxServices,
      onStateProgress: async (state) => {
        stateUpdates.push(toSnapshotRecord(state))
      },
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    })
    expect(stateUpdates).toEqual([])
  })

  it('stops scanning immediately when the reply loop is already aborted', async () => {
    const capture = createCaptureSummary()
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([capture])),
    })
    const signalController = new AbortController()
    signalController.abort()
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )

    const stateUpdates: Array<Record<string, unknown>> = []
    const result = await reply.scanAssistantAutoReplyOnce({
      enabledChannels: ['telegram'],
      inboxServices,
      onStateProgress: async (state) => {
        stateUpdates.push(toSnapshotRecord(state))
      },
      signal: signalController.signal,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    })
    expect(stateUpdates).toEqual([])
  })

  it('exposes context helpers for grouped captures', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const first = createReplyGroupItem(
      createCaptureSummary({
        captureId: 'capture-1',
        occurredAt: '2026-04-08T00:01:00.000Z',
      }),
    )
    const second = createReplyGroupItem(
      createCaptureSummary({
        captureId: 'capture-2',
        occurredAt: '2026-04-08T00:02:00.000Z',
      }),
    )

    expect(reply.createAssistantAutoReplyGroupContext([])).toBeNull()
    expect(reply.createAssistantAutoReplyGroupContext([first, second])).toEqual({
      captureCount: 2,
      captureIds: ['capture-1', 'capture-2'],
      firstCaptureId: 'capture-1',
      firstItem: first,
      items: [first, second],
      lastCursor: {
        captureId: 'capture-2',
        createdAt: '2026-04-08T00:00:01.000Z',
        occurredAt: '2026-04-08T00:02:00.000Z',
      },
    })
  })

  it('applies reply processing results to the scan summary and cursor', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:01:00.000Z',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const summary = {
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    }
    let nextCursor: AssistantAutomationCursor | null = null
    const stopScanning = reply.applyAssistantAutoReplyProcessResult({
      context,
      result: {
        advanceCursor: true,
        cursor: {
          captureId: 'capture-1',
          createdAt: '2026-04-08T00:00:01.000Z',
          occurredAt: '2026-04-08T00:01:00.000Z',
        },
        failed: 1,
        nextWakeAt: null,
        replied: 2,
        skipped: 3,
        stopScanning: true,
      },
      summary,
      updateCursor: (cursor) => {
        nextCursor = cursor
      },
    })

    expect(summary).toEqual({
      considered: 0,
      failed: 1,
      nextWakeAt: null,
      replied: 2,
      skipped: 3,
    })
    expect(nextCursor).toEqual({
      captureId: 'capture-1',
      createdAt: '2026-04-08T00:00:01.000Z',
      occurredAt: '2026-04-08T00:01:00.000Z',
    })
    expect(stopScanning).toBe(true)
  })

  it('does not move the reply cursor when process results stay on the current group', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const summary = {
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    }
    const updateCursor = vi.fn()
    const stopScanning = reply.applyAssistantAutoReplyProcessResult({
      context,
      result: {
        advanceCursor: false,
        cursor: {
          captureId: 'capture-1',
          createdAt: '2026-04-08T00:00:01.000Z',
          occurredAt: '2026-04-08T00:01:00.000Z',
        },
        failed: 1,
        nextWakeAt: null,
        replied: 0,
        skipped: 0,
        stopScanning: false,
      },
      summary,
      updateCursor,
    })

    expect(summary).toEqual({
      considered: 0,
      failed: 1,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    })
    expect(updateCursor).not.toHaveBeenCalled()
    expect(stopScanning).toBe(false)
  })

  it('defers when existing reply artifacts are only partially rebuilt', async () => {
    replyMocks.assistantAutoReplyGroupOutcomeArtifactExists.mockResolvedValue(true)
    replyMocks.assistantChatReplyArtifactExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary({
        captureId: 'capture-1',
      })),
      createReplyGroupItem(createCaptureSummary({
        captureId: 'capture-2',
      })),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const events: Array<Record<string, unknown>> = []
    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices: createInboxServices(),
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 2,
      stopScanning: true,
    })
    expect(events).toContainEqual({
      type: 'capture.reply-skipped',
      captureId: 'capture-1',
      details:
        'assistant reply artifacts are incomplete; will retry this capture after reply artifacts are rebuilt.',
      errorCode: undefined,
      safeDetails: undefined,
    })
  })

  it('marks groups handled when the group-outcome artifact already exists in full', async () => {
    replyMocks.assistantAutoReplyGroupOutcomeArtifactExists.mockResolvedValue(true)
    replyMocks.assistantChatReplyArtifactExists.mockResolvedValue(true)
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence).toHaveBeenCalledWith({
      captureIds: ['capture-1'],
      deliveryIntentId: null,
      linqMessageIds: [],
      outcome: 'result',
      recordedAt: '2026-04-08T00:10:00.000Z',
      sessionId: 'session-1',
      vault: '/tmp/assistant-automation-vault',
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
  })

  it('skips immediately when rebuilt chat reply artifacts already exist', async () => {
    replyMocks.assistantChatReplyArtifactExists.mockResolvedValue(true)
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence).toHaveBeenCalledWith({
      captureIds: ['capture-1'],
      deliveryIntentId: null,
      linqMessageIds: [],
      outcome: 'result',
      recordedAt: '2026-04-08T00:10:00.000Z',
      sessionId: 'session-1',
      vault: '/tmp/assistant-automation-vault',
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
  })

  it('defers when reply artifacts are partially rebuilt even without a group outcome marker', async () => {
    replyMocks.assistantChatReplyArtifactExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary({
        captureId: 'capture-1',
      })),
      createReplyGroupItem(createCaptureSummary({
        captureId: 'capture-2',
      })),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 2,
      stopScanning: true,
    })
  })

  it('does not skip rich-content prompts when the selected provider only accepts text', async () => {
    const primaryCapture = createCaptureDetail({
      attachmentCount: 1,
      attachments: [
        {
          attachmentId: 'attachment-1',
          ordinal: 1,
          externalId: null,
          kind: 'image',
          mime: 'image/png',
          originalPath: null,
          storedPath: 'inbox/attachments/attachment-1.png',
          fileName: 'attachment-1.png',
          byteSize: 128,
          sha256: null,
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parseState: 'succeeded',
        },
      ],
    })
    replyMocks.prepareAssistantAutoReplyInput.mockResolvedValue({
      kind: 'ready',
      prompt: 'rich prompt',
      userMessageContent: [
        {
          type: 'text',
          text: 'rich content',
        },
      ],
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(primaryCapture),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary({
        attachmentCount: 1,
      })),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessageContent: [
          {
            type: 'text',
            text: 'rich content',
          },
        ],
      }),
    )
  })

  it('writes result artifacts for successful replies', async () => {
    const inboxServices = createInboxServices({
      show: vi
        .fn()
        .mockResolvedValue(
          createShowResult(
            createCaptureDetail({
              source: 'telegram',
            }),
          ),
        ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary(),
        {
          mediaGroupId: null,
          messageId: '123',
          replyContext: null,
        },
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const events: Array<Record<string, unknown>> = []
    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryReplyToMessageId: '123',
        operatorAuthority: 'direct-operator',
        receiptMetadata: {
          autoReplyCaptureId: 'capture-1',
          autoReplyCaptureIds: 'capture-1',
        },
        turnTrigger: 'automation-auto-reply',
      }),
    )
    expect(replyMocks.writeAssistantAutoReplyGroupOutcomeArtifact).toHaveBeenCalledOnce()
    expect(replyMocks.writeAssistantChatResultArtifacts).toHaveBeenCalledOnce()
    expect(events).toContainEqual({
      type: 'capture.reply-started',
      captureId: 'capture-1',
      details: 'assistant provider turn started',
    })
    expect(events).toContainEqual({
      type: 'capture.replied',
      captureId: 'capture-1',
      details: 'telegram -> target-1',
      errorCode: undefined,
      safeDetails: undefined,
    })
  })

  it('writes deferred delivery artifacts when outbound delivery is queued', async () => {
    replyMocks.sendAssistantMessage.mockResolvedValue({
      delivery: null,
      deliveryDeferred: true,
      deliveryError: null,
      deliveryIntentId: 'intent-1',
      response: 'response text',
      session: {
        sessionId: 'session-1',
      },
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(replyMocks.writeAssistantChatDeferredArtifacts).toHaveBeenCalledOnce()
  })

  it('emits deferred delivery progress even when the outbox intent id is absent', async () => {
    replyMocks.sendAssistantMessage.mockResolvedValue({
      delivery: null,
      deliveryDeferred: true,
      deliveryError: null,
      deliveryIntentId: null,
      response: 'response text',
      session: {
        sessionId: 'session-1',
      },
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const events: Array<Record<string, unknown>> = []
    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replied).toBe(1)
    expect(events).toContainEqual({
      type: 'capture.reply-progress',
      captureId: 'capture-1',
      details: 'assistant queued outbound delivery for retry',
      providerKind: 'status',
      providerState: 'completed',
    })
  })

  it('treats provider stalls as deferred skips that stop scanning', async () => {
    replyMocks.sendAssistantMessage.mockRejectedValue(new Error('provider stalled'))
    replyMocks.isAssistantProviderStalledError.mockReturnValue(true)
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
  })

  it('keeps rate-limit style provider failures on the current cursor and tolerates error artifact write failures', async () => {
    const capacityError = Object.assign(new Error('rate limit exceeded'), {
      code: 'ASSISTANT_RATE_LIMIT',
    })
    replyMocks.sendAssistantMessage.mockRejectedValue(capacityError)
    replyMocks.writeAssistantChatErrorArtifacts.mockRejectedValue(
      new Error('artifact write failed'),
    )
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 1,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 0,
      stopScanning: true,
    })
    expect(replyMocks.writeAssistantChatErrorArtifacts).toHaveBeenCalledOnce()
  })

  it('keeps raw upstream quota failures on the current cursor for retry', async () => {
    replyMocks.sendAssistantMessage.mockRejectedValue(
      new Error(
        'You exceeded your current quota, please check your plan and billing details.',
      ),
    )
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 1,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 0,
      stopScanning: true,
    })
  })

  it('keeps hosted assistant configuration failures on the current cursor for retry after repair', async () => {
    const configError = Object.assign(
      new Error('Codex CLI executable "codex" was not found.'),
      {
        code: 'ASSISTANT_CODEX_NOT_FOUND',
      },
    )
    replyMocks.sendAssistantMessage.mockRejectedValue(configError)
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary({
        source: 'linq',
      })),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['linq'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 1,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 0,
      stopScanning: true,
    })
  })

  it('skips groups when the source channel is not enabled', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          source: 'linq',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
  })

  it('skips self-authored captures when self-authored automation is disabled', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          actorIsSelf: true,
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices: createInboxServices(),
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
  })

  it('skips groups already handled by assistant turn receipts', async () => {
    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      {
        completedAt: '2026-04-08T00:10:00.000Z',
        deliveryIntentId: null,
        sessionId: 'session-receipt',
        status: 'completed',
        timeline: [
          {
            kind: 'turn.started',
            metadata: {
              autoReplyCaptureId: 'other-capture',
              autoReplyCaptureIds: 'other-capture, capture-1',
            },
          },
        ],
        updatedAt: '2026-04-08T00:10:00.000Z',
      },
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence).toHaveBeenCalledWith({
      captureIds: ['capture-1'],
      deliveryIntentId: null,
      linqMessageIds: [],
      outcome: 'result',
      recordedAt: '2026-04-08T00:10:00.000Z',
      sessionId: 'session-receipt',
      vault: '/tmp/assistant-automation-vault',
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
  })

  it('skips groups when the channel adapter refuses auto-reply', async () => {
    replyMocks.getAssistantChannelAdapter.mockReturnValue({
      canAutoReply: vi.fn().mockReturnValue('channel policy disabled'),
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
  })

  it('defers the group when prompt preparation asks to wait for more evidence', async () => {
    replyMocks.prepareAssistantAutoReplyInput.mockResolvedValue({
      kind: 'defer',
      reason: 'waiting for parser completion',
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
  })

  it('continues a draft with only newly accepted late same-conversation input', async () => {
    const lateCapture = createCaptureSummary({
      attachmentCount: 1,
      captureId: 'capture-late',
      occurredAt: '2026-04-08T00:03:00.000Z',
      text: null,
    })
    replyMocks.prepareAssistantAutoReplyInput.mockImplementation(
      async (captures: readonly { capture: { captureId: string } }[]) => {
        const captureIds = captures.map((entry) => entry.capture.captureId)
        return {
          kind: 'ready',
          prompt: `reply prompt for ${captureIds.join(',')}`,
          userMessageContent: [
            {
              text: `content for ${captureIds.join(',')}`,
              type: 'text',
            },
          ],
        }
      },
    )
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async (input: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt:
              input.captureId === 'capture-late'
                ? '2026-04-08T00:03:00.000Z'
                : '2026-04-08T00:02:00.000Z',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:02:00.000Z',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const turnInputPort = {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      async listNewConversationCaptures(input: AssistantTurnConversationCaptureQuery) {
        expect(input.knownCaptureIds).toEqual(['capture-1'])
        expect(input.conversation).toEqual(
          expect.objectContaining({
            accountId: null,
            actorId: 'actor-1',
            actorIsSelf: false,
            source: 'telegram',
            threadId: 'thread-1',
            threadIsDirect: true,
          }),
        )
        return {
          captures: [lateCapture],
          nextCursor: {
            captureId: lateCapture.captureId,
            createdAt: lateCapture.createdAt ?? null,
            occurredAt: lateCapture.occurredAt,
          },
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(
      async (input: {
        activeTurnInput?: (
          value: {
            phase: 'request_boundary' | 'commit_barrier'
            providerRequestOrdinal: number
            response: string
            sessionId: string
            turnId: string
            vault: string
          }
        ) => Promise<
          | { kind: 'no-new-input' }
          | {
              kind: 'accepted'
              acceptedInputs?: readonly unknown[] | null
              prompt: string
              receiptMetadata?: Record<string, string> | null
              transcriptText?: string | null
              userMessageContent?: readonly unknown[] | null
            }
        >
        receiptMetadata?: { autoReplyCaptureIds?: string }
        response?: string
      }) => {
        const admitted = await input.activeTurnInput?.({
          phase: 'request_boundary',
          providerRequestOrdinal: 0,
          response: 'draft response',
          sessionId: 'session-1',
          turnId: 'turn-1',
          vault: '/tmp/assistant-automation-vault',
        })
        if (admitted?.kind !== 'accepted') {
          throw new Error('expected active input admission')
        }
        expect(admitted.prompt).toBe('reply prompt for capture-late')
        expect(admitted.userMessageContent).toEqual([
          {
            text: 'content for capture-late',
            type: 'text',
          },
        ])
        expect(admitted.receiptMetadata).toEqual({
          autoReplyCaptureId: 'capture-1',
          autoReplyCaptureIds: 'capture-1,capture-late',
        })
        expect(admitted.acceptedInputs).toEqual([
          expect.objectContaining({
            captureIds: ['capture-late'],
            cursorEffects: [
              expect.objectContaining({
                captureIds: ['capture-late'],
                from: {
                  captureId: 'capture-1',
                  createdAt: '2026-04-08T00:00:01.000Z',
                  occurredAt: '2026-04-08T00:02:00.000Z',
                },
                to: {
                  captureId: 'capture-late',
                  createdAt: '2026-04-08T00:00:01.000Z',
                  occurredAt: '2026-04-08T00:03:00.000Z',
                },
              }),
            ],
            id: 'inbox:capture-late',
          }),
        ])
        expect(admitted.transcriptText).toBe('User sent an attachment.')

        return Promise.resolve({
          delivery: {
            channel: 'telegram',
            target: 'target-1',
            sentAt: '2026-04-08T00:10:00.000Z',
          },
          deliveryDeferred: false,
          deliveryError: null,
          deliveryIntentId: 'intent-1',
          response: 'revised response',
          session: {
            sessionId: 'session-1',
          },
        })
      },
    )

    const events: Array<Record<string, unknown>> = []
    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      requestId: null,
      sessionMaxAgeMs: null,
      turnInputPort,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledTimes(1)
    expect(replyMocks.sendAssistantMessage.mock.calls[0]?.[0]?.prompt).toBe(
      'reply prompt for capture-1',
    )
    expect(replyMocks.sendAssistantMessage.mock.calls[0]?.[0]?.userMessageContent).toEqual([
      {
        text: 'content for capture-1',
        type: 'text',
      },
    ])
    expect(replyMocks.sendAssistantMessage.mock.calls[0]?.[0]?.receiptMetadata).toEqual(
      expect.objectContaining({
        autoReplyCaptureIds: 'capture-1',
      }),
    )
    expect(replyMocks.sendAssistantMessage.mock.calls[0]?.[0]?.activeTurnInput).toBeTypeOf(
      'function',
    )
    expect(events).toContainEqual({
      type: 'capture.reply-progress',
      captureId: 'capture-1',
      details: 'new input accepted into active turn with 1 additional capture(s)',
      providerKind: 'status',
      providerState: 'running',
    })
    expect(replyMocks.prepareAssistantAutoReplyInput).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({
        capture: expect.objectContaining({ captureId: 'capture-1' }),
      })],
      '/tmp/assistant-automation-vault',
    )
    expect(replyMocks.prepareAssistantAutoReplyInput).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({
        capture: expect.objectContaining({ captureId: 'capture-late' }),
      })],
      '/tmp/assistant-automation-vault',
    )
    expect(replyMocks.writeAssistantAutoReplyGroupOutcomeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        captureIds: ['capture-1', 'capture-late'],
      }),
    )
    expect(replyMocks.writeAssistantChatResultArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        captureIds: ['capture-1', 'capture-late'],
      }),
    )
  })

  it('defers delivery when the active-turn input budget is exhausted', async () => {
    const lateCapture = createCaptureSummary({
      captureId: 'capture-late',
      occurredAt: '2026-04-08T00:03:00.000Z',
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async (input: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt:
              input.captureId === 'capture-late'
                ? '2026-04-08T00:03:00.000Z'
                : '2026-04-08T00:02:00.000Z',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:02:00.000Z',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const turnInputPort = {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      async listNewConversationCaptures(input: AssistantTurnConversationCaptureQuery) {
        return {
          captures: [lateCapture],
          nextCursor: {
            captureId: lateCapture.captureId,
            createdAt: lateCapture.createdAt ?? null,
            occurredAt: lateCapture.occurredAt,
          },
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnInput?: unknown
    }) => {
      expect(input.activeTurnInput).toBeTypeOf('function')
      throw new AssistantActiveTurnInputBudgetExceededError()
    })

    const events: Array<Record<string, unknown>> = []
    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      requestId: null,
      sessionMaxAgeMs: null,
      turnInputPort,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({
      type: 'capture.reply-skipped',
      captureId: 'capture-1',
    })
  })

  it('defers delivery when hosted active-turn mailbox refresh is unavailable', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async (input: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt: '2026-04-08T00:02:00.000Z',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:02:00.000Z',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const turnInputPort = {
      async refresh() {
        return {
          progressed: false,
          reason: 'source_unavailable' as const,
        }
      },
      async listNewConversationCaptures(input: AssistantTurnConversationCaptureQuery) {
        return {
          captures: [],
          nextCursor: input.afterCursor,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnInput?: (admission: {
        phase: 'request_boundary' | 'commit_barrier'
        providerRequestOrdinal: number
        response: string
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      await input.activeTurnInput?.({
        phase: 'commit_barrier',
        providerRequestOrdinal: 0,
        response: 'draft response',
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      throw new Error('expected active-turn admission to defer')
    })

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      turnInputPort,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledTimes(1)
  })

  it('defers without advancing the cursor when active-turn refresh is unavailable', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async (input: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt: '2026-04-08T00:02:00.000Z',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:02:00.000Z',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const sourceUnavailable = new AssistantActiveTurnInputUnavailableError(
      'Active turn input source is temporarily unavailable; will retry later.',
    )
    const turnInputPort = {
      async refresh() {
        throw sourceUnavailable
      },
      async listNewConversationCaptures(input: AssistantTurnConversationCaptureQuery) {
        return {
          captures: [],
          nextCursor: input.afterCursor,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnInput?: (admission: {
        phase: 'request_boundary' | 'commit_barrier'
        providerRequestOrdinal: number
        response: string
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      await input.activeTurnInput?.({
        phase: 'request_boundary',
        providerRequestOrdinal: 0,
        response: 'draft response',
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      throw new Error('expected active-turn admission to defer')
    })

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      turnInputPort,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
    expect(replyMocks.writeAssistantChatErrorArtifacts).not.toHaveBeenCalled()
    expect(replyMocks.writeAssistantAutoReplyGroupOutcomeArtifact).not.toHaveBeenCalled()
  })

  it('defers without advancing the cursor when active-turn checkpoint is unavailable before outbox commit', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async (input: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt: '2026-04-08T00:02:00.000Z',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:02:00.000Z',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const checkpointConflict = new AssistantActiveTurnInputUnavailableError(
      'Active turn checkpoint was rejected before outbox commit; will retry later.',
    )
    const checkpointAcceptedInput = vi.fn(async () => {
      throw checkpointConflict
    })
    const turnInputPort = {
      checkpointAcceptedInput,
      async refresh() {
        return {
          progressed: false,
          reason: 'no_new_input' as const,
        }
      },
      async listNewConversationCaptures(input: AssistantTurnConversationCaptureQuery) {
        return {
          captures: [],
          nextCursor: input.afterCursor,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: {
        acceptedInputIds: readonly string[]
        providerRequestOrdinal: number
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<void>
    }) => {
      await input.activeTurnCheckpoint?.({
        acceptedInputIds: [],
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      throw new Error('expected active-turn checkpoint to defer')
    })

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      turnInputPort,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
    expect(checkpointAcceptedInput).toHaveBeenCalledTimes(1)
    expect(replyMocks.writeAssistantChatErrorArtifacts).not.toHaveBeenCalled()
    expect(replyMocks.writeAssistantAutoReplyGroupOutcomeArtifact).not.toHaveBeenCalled()
  })

  it('aborts when active-turn checkpoint rejection means local admission work cannot be committed', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async (input: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt: '2026-04-08T00:02:00.000Z',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:02:00.000Z',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const checkpointRejected = new AssistantActiveTurnInputCheckpointRejectedError(
      'Active turn input checkpoint was rejected; retry from durable state.',
    )
    const checkpointAcceptedInput = vi.fn(async () => {
      throw checkpointRejected
    })
    const turnInputPort = {
      checkpointAcceptedInput,
      async refresh() {
        return {
          progressed: false,
          reason: 'no_new_input' as const,
        }
      },
      async listNewConversationCaptures(input: AssistantTurnConversationCaptureQuery) {
        return {
          captures: [],
          nextCursor: input.afterCursor,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: {
        acceptedInputIds: readonly string[]
        providerRequestOrdinal: number
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<void>
    }) => {
      await input.activeTurnCheckpoint?.({
        acceptedInputIds: [],
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      throw new Error('expected active-turn checkpoint rejection to abort')
    })

    await expect(reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      turnInputPort,
      vault: '/tmp/assistant-automation-vault',
    })).rejects.toBe(checkpointRejected)

    expect(checkpointAcceptedInput).toHaveBeenCalledTimes(1)
    expect(replyMocks.writeAssistantChatErrorArtifacts).not.toHaveBeenCalled()
    expect(replyMocks.writeAssistantAutoReplyGroupOutcomeArtifact).not.toHaveBeenCalled()
  })

  it('does not create a default turn-input port for hosted automation passes', async () => {
    const runLoop = await vi.importActual<
      typeof import('../src/assistant/automation/run-loop.ts')
    >('../src/assistant/automation/run-loop.ts')

    const executionContext = {
      hosted: {
        memberId: 'member-1',
        userEnvKeys: [],
      },
    } as const

    const result = await runLoop.runAssistantAutomationPass({
      executionContext,
      requestId: 'request-hosted',
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replies).toMatchObject({
      failed: 0,
    })
    expect(runLoopMocks.recoverAssistantAutoReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext,
        turnInputPort: undefined,
      }),
    )
    expect(runLoopMocks.scanAssistantAutomationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext,
        turnInputPort: undefined,
      }),
    )
  })

  it('skips canonical automation branches for no-canonical-write automation passes', async () => {
    const runLoop = await vi.importActual<
      typeof import('../src/assistant/automation/run-loop.ts')
    >('../src/assistant/automation/run-loop.ts')

    await runLoop.runAssistantAutomationPass({
      applyCanonicalWrites: false,
      requestId: 'request-preview',
      vault: '/tmp/assistant-automation-vault',
      vaultServices: null,
    })

    expect(runLoopMocks.createIntegratedVaultServices).not.toHaveBeenCalled()
    expect(runLoopMocks.recoverAssistantAutoReplies).not.toHaveBeenCalled()
    expect(runLoopMocks.processDueAssistantCronJobs).not.toHaveBeenCalled()
    expect(runLoopMocks.scanAssistantAutomationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        applyCanonicalWrites: false,
        vaultServices: undefined,
      }),
    )
  })

  it('skips the group when prompt preparation produces no replyable content', async () => {
    replyMocks.prepareAssistantAutoReplyInput.mockResolvedValue({
      kind: 'skip',
      reason: 'capture has no text or parsed attachment content',
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
  })

  it('treats connection loss as a deferred retry state', async () => {
    replyMocks.sendAssistantMessage.mockRejectedValue(new Error('provider disconnected'))
    replyMocks.isAssistantProviderConnectionLostError.mockReturnValue(true)
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
  })

  it('skips recent self-authored assistant echoes', async () => {
    replyMocks.resolveAssistantSession.mockResolvedValue({
      session: {
        sessionId: 'session-1',
        lastTurnAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
        createdAt: '2026-04-08T00:00:00.000Z',
      },
    })
    replyMocks.listAssistantTranscriptEntries.mockResolvedValue([
      {
        kind: 'assistant',
        text: 'same text',
      },
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            actorIsSelf: true,
            occurredAt: '2026-04-08T00:05:00.000Z',
            text: 'same text',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          actorIsSelf: true,
          occurredAt: '2026-04-08T00:05:00.000Z',
          text: 'same text',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: true,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
  })

  it('still replies when self-authored captures cannot be matched to a recent assistant echo', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            actorIsSelf: true,
            text: null,
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          actorIsSelf: true,
          text: null,
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: true,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
  })

  it('ignores groups whose captures can no longer be loaded', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue({
        capture: undefined,
      }),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
      stopScanning: false,
    })
  })

  it('sends rich content when any configured route supports multimodal input', async () => {
    replyMocks.prepareAssistantAutoReplyInput.mockResolvedValue({
      kind: 'ready',
      prompt: 'rich prompt',
      userMessageContent: [
        {
          type: 'text',
          text: 'rich content',
        },
      ],
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            attachmentCount: 1,
            attachments: [
              {
                attachmentId: 'attachment-1',
                ordinal: 1,
                externalId: null,
                kind: 'image',
                mime: 'image/png',
                originalPath: null,
                storedPath: 'inbox/attachments/attachment-1.png',
                fileName: 'attachment-1.png',
                byteSize: 128,
                sha256: null,
                extractedText: null,
                transcriptText: null,
                derivedPath: null,
                parseState: 'succeeded',
              },
            ],
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          attachmentCount: 1,
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessageContent: [
          {
            type: 'text',
            text: 'rich content',
          },
        ],
      }),
    )
  })

  it('uses Linq external ids as the outbound reply target when replying in-thread', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            source: 'linq',
            externalId: 'linq:message-42',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          source: 'linq',
          externalId: 'linq:message-42',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['linq'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replied).toBe(1)
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryReplyToMessageId: 'message-42',
      }),
    )
  })

  it('drops opaque hosted Linq ids instead of sending them as reply targets', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            source: 'linq',
            externalId: 'linq:hbid:linq.message:v1:opaque',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(
        createCaptureSummary({
          source: 'linq',
          externalId: 'linq:hbid:linq.message:v1:opaque',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['linq'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replied).toBe(1)
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryReplyToMessageId: null,
      }),
    )
  })

  it('turns unconfirmed outbound deliveries into retryable failed reply outcomes', async () => {
    replyMocks.sendAssistantMessage.mockResolvedValue({
      delivery: null,
      deliveryDeferred: false,
      deliveryError: {
        message: 'delivery rejected',
      },
      deliveryIntentId: 'intent-2',
      response: 'response text',
      session: {
        sessionId: 'session-1',
      },
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 1,
      nextWakeAt: expect.any(String),
      replied: 0,
      skipped: 0,
      stopScanning: true,
    })
  })

  it('treats direct auto-reply receipt ids as already handled work', async () => {
    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      {
        completedAt: null,
        deliveryIntentId: 'intent-receipt',
        sessionId: 'session-receipt',
        status: 'deferred',
        timeline: [
          {
            kind: 'turn.started',
            metadata: {
              autoReplyCaptureId: 'capture-1',
            },
          },
        ],
        updatedAt: '2026-04-08T00:11:00.000Z',
      },
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence).toHaveBeenCalledWith({
      captureIds: ['capture-1'],
      deliveryIntentId: 'intent-receipt',
      linqMessageIds: [],
      outcome: 'deferred',
      recordedAt: '2026-04-08T00:11:00.000Z',
      sessionId: 'session-receipt',
      vault: '/tmp/assistant-automation-vault',
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
  })

  it('rethrows artifact write failures for successful outcomes', async () => {
    replyMocks.writeAssistantAutoReplyGroupOutcomeArtifact.mockRejectedValue(
      new Error('artifact write failed'),
    )
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(createShowResult(createCaptureDetail())),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary()),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    await expect(
      reply.processAssistantAutoReplyGroup({
        allowSelfAuthored: false,
        context,
        enabledChannels: ['telegram'],
        inboxServices,
        requestId: null,
        sessionMaxAgeMs: null,
        vault: '/tmp/assistant-automation-vault',
      }),
    ).rejects.toThrow('artifact write failed')
  })
})

describe('assistant auto-reply receipt recovery', () => {
  it('retries a recent retry-safe failed auto-reply from persisted receipts', async () => {
    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        primaryCaptureId: 'capture-1',
        captureIds: ['capture-1'],
      }),
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            captureId: 'capture-1',
          }),
        ),
      ),
    })
    scannerReplyMocks.processAssistantAutoReplyGroup.mockResolvedValue({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    const recovery = await vi.importActual<
      typeof import('../src/assistant/automation/startup-recovery.ts')
    >('../src/assistant/automation/startup-recovery.ts')

    const events: Array<Record<string, unknown>> = []
    const result = await recovery.recoverAssistantAutoReplies({
      allowSelfAuthored: false,
      autoReply: createAutoReplyEntries(['telegram'], {
        captureId: 'capture-1',
        occurredAt: '2026-04-08T00:00:00.000Z',
      }),
      inboxServices,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toEqual({
      considered: 1,
      failed: 0,
      nextWakeAt: null,
      progressed: true,
      replied: 1,
      skipped: 0,
    })
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledOnce()
    expect(events).toContainEqual({
      type: 'reply.scan.started',
      details: 'retrying up to 1 failed auto-reply capture(s) from persisted receipts',
    })
  })

  it('waits for persisted auto-reply retry deadlines before retrying receipt recovery', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T00:00:10.000Z'))
    try {
      replyMocks.listAssistantTurnReceipts.mockResolvedValue([
        createTurnReceipt({
          primaryCaptureId: 'capture-1',
          captureIds: ['capture-1'],
          timeline: [
            {
              at: '2026-04-08T00:00:00.000Z',
              kind: 'turn.started',
              detail: null,
              metadata: {
                autoReplyCaptureId: 'capture-1',
                autoReplyCaptureIds: 'capture-1',
              },
            },
            {
              at: '2026-04-08T00:00:05.000Z',
              kind: 'turn.completed',
              detail: 'write EPIPE',
              metadata: {
                autoReplyRetryAt: '2026-04-08T00:00:30.000Z',
              },
            },
          ],
        }),
      ])
      const recovery = await vi.importActual<
        typeof import('../src/assistant/automation/startup-recovery.ts')
      >('../src/assistant/automation/startup-recovery.ts')

      const result = await recovery.recoverAssistantAutoReplies({
        allowSelfAuthored: false,
        autoReply: createAutoReplyEntries(['telegram'], {
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:00:00.000Z',
        }),
        inboxServices: createInboxServices(),
        vault: '/tmp/assistant-automation-vault',
      })

      expect(result).toEqual({
        considered: 0,
        failed: 0,
        nextWakeAt: '2026-04-08T00:00:30.000Z',
        progressed: false,
        replied: 0,
        skipped: 0,
      })
      expect(scannerReplyMocks.processAssistantAutoReplyGroup).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips receipt recovery for terminal provider request validation failures', async () => {
    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        turnId: 'turn-invalid-tool-output',
        primaryCaptureId: 'capture-invalid-tool-output',
        captureIds: ['capture-invalid-tool-output'],
        lastError: {
          code: 'ASSISTANT_PROVIDER_FAILED',
          message: 'input.3.output: Invalid input',
        },
      }),
      createTurnReceipt({
        turnId: 'turn-invalid-previous-response',
        primaryCaptureId: 'capture-invalid-previous-response',
        captureIds: ['capture-invalid-previous-response'],
        lastError: {
          code: 'ASSISTANT_PROVIDER_FAILED',
          message: 'assistant provider failed',
        },
        timeline: [
          {
            at: '2026-04-08T00:00:00.000Z',
            kind: 'turn.started',
            detail: null,
            metadata: {
              autoReplyCaptureId: 'capture-invalid-previous-response',
              autoReplyCaptureIds: 'capture-invalid-previous-response',
            },
          },
          {
            at: '2026-04-08T00:00:05.000Z',
            kind: 'turn.completed',
            detail: "Invalid 'previous_response_id': expected a Responses id",
            metadata: {},
          },
        ],
      }),
    ])
    const recovery = await vi.importActual<
      typeof import('../src/assistant/automation/startup-recovery.ts')
    >('../src/assistant/automation/startup-recovery.ts')

    const result = await recovery.recoverAssistantAutoReplies({
      allowSelfAuthored: false,
      autoReply: createAutoReplyEntries(['telegram'], {
        captureId: 'capture-invalid-previous-response',
        occurredAt: '2026-04-08T00:00:00.000Z',
      }),
      inboxServices: createInboxServices(),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toEqual({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      progressed: false,
      replied: 0,
      skipped: 0,
    })
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).not.toHaveBeenCalled()
  })

  it('skips receipt recovery for ambiguous delivery failures', async () => {
    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        turnId: 'turn-4',
        primaryCaptureId: 'capture-4',
        captureIds: ['capture-4'],
        updatedAt: '2026-04-08T00:00:08.000Z',
        responsePreview: 'drafted response',
      }),
      createTurnReceipt({
        turnId: 'turn-5',
        primaryCaptureId: 'capture-5',
        captureIds: ['capture-5'],
        updatedAt: '2026-04-08T00:00:07.000Z',
        timeline: [
          {
            at: '2026-04-08T00:00:00.000Z',
            kind: 'turn.started',
            detail: null,
            metadata: {
              autoReplyCaptureId: 'capture-5',
              autoReplyCaptureIds: 'capture-5',
            },
          },
          {
            at: '2026-04-08T00:00:07.000Z',
            kind: 'delivery.failed',
            detail: 'delivery rejected',
            metadata: {},
          },
        ],
      }),
      createTurnReceipt({
        turnId: 'turn-3',
        primaryCaptureId: 'capture-3',
        captureIds: ['capture-3'],
        updatedAt: '2026-04-08T00:00:06.000Z',
      }),
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async (input: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt:
              input.captureId === 'capture-5'
                ? '2026-04-08T00:00:02.000Z'
                : input.captureId === 'capture-4'
                  ? '2026-04-08T00:00:01.000Z'
                  : '2026-04-08T00:00:00.000Z',
          }),
        ),
      ),
    })
    const recovery = await vi.importActual<
      typeof import('../src/assistant/automation/startup-recovery.ts')
    >('../src/assistant/automation/startup-recovery.ts')

    const result = await recovery.recoverAssistantAutoReplies({
      allowSelfAuthored: false,
      autoReply: createAutoReplyEntries(['telegram'], {
        captureId: 'capture-5',
        occurredAt: '2026-04-08T00:00:02.000Z',
      }),
      inboxServices,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toEqual({
      considered: 1,
      failed: 0,
      nextWakeAt: null,
      progressed: true,
      replied: 0,
      skipped: 1,
    })
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledOnce()
  })

  it('retries failed receipts ahead of the fixed auto-reply eligibility boundary', async () => {
    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        primaryCaptureId: 'capture-2',
        captureIds: ['capture-2'],
      }),
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            captureId: 'capture-2',
            occurredAt: '2026-04-08T00:00:02.000Z',
          }),
        ),
      ),
    })
    const recovery = await vi.importActual<
      typeof import('../src/assistant/automation/startup-recovery.ts')
    >('../src/assistant/automation/startup-recovery.ts')

    const result = await recovery.recoverAssistantAutoReplies({
      allowSelfAuthored: false,
      autoReply: createAutoReplyEntries(['telegram'], {
        captureId: 'capture-1',
        occurredAt: '2026-04-08T00:00:00.000Z',
      }),
      inboxServices,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toEqual({
      considered: 1,
      failed: 0,
      nextWakeAt: null,
      progressed: true,
      replied: 0,
      skipped: 1,
    })
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledOnce()
  })

  it('skips receipt recovery when the persisted primary capture is missing', async () => {
    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        primaryCaptureId: 'capture-missing',
        captureIds: ['capture-missing', 'capture-later'],
      }),
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async (input: { captureId: string }) => {
        if (input.captureId === 'capture-missing') {
          throw Object.assign(new Error('not found'), {
            code: 'INBOX_CAPTURE_NOT_FOUND',
          })
        }
        return createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt: '2026-04-08T00:00:01.000Z',
          }),
        )
      }),
    })
    const recovery = await vi.importActual<
      typeof import('../src/assistant/automation/startup-recovery.ts')
    >('../src/assistant/automation/startup-recovery.ts')

    const result = await recovery.recoverAssistantAutoReplies({
      allowSelfAuthored: false,
      autoReply: createAutoReplyEntries(['telegram'], {
        captureId: 'capture-later',
        occurredAt: '2026-04-08T00:00:01.000Z',
      }),
      inboxServices,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toEqual({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      progressed: false,
      replied: 0,
      skipped: 0,
    })
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).not.toHaveBeenCalled()
  })

  it('skips malformed or already-handled receipts and stops after the recovery limit', async () => {
    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        turnId: 'turn-no-start',
        timeline: [
          {
            at: '2026-04-08T00:00:00.000Z',
            kind: 'turn.completed',
            detail: null,
            metadata: {},
          },
        ],
      }),
      createTurnReceipt({
        turnId: 'turn-empty-metadata',
        timeline: [
          {
            at: '2026-04-08T00:00:00.000Z',
            kind: 'turn.started',
            detail: null,
            metadata: {},
          },
        ],
      }),
      createTurnReceipt({
        turnId: 'turn-handled',
        primaryCaptureId: 'capture-handled',
        captureIds: ['capture-handled'],
        updatedAt: '2026-04-08T00:00:08.000Z',
      }),
      createTurnReceipt({
        turnId: 'turn-recover',
        primaryCaptureId: 'capture-recover',
        captureIds: ['capture-recover'],
        updatedAt: '2026-04-08T00:00:07.000Z',
      }),
      createTurnReceipt({
        turnId: 'turn-later',
        primaryCaptureId: 'capture-later',
        captureIds: ['capture-later'],
        updatedAt: '2026-04-08T00:00:06.000Z',
      }),
    ])
    replyMocks.assistantChatReplyArtifactExists.mockImplementation(
      async (_vault: string, captureId: string) => captureId === 'capture-handled',
    )
    scannerReplyMocks.processAssistantAutoReplyGroup.mockResolvedValue({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async (input: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId: input.captureId,
            occurredAt:
              input.captureId === 'capture-later'
                ? '2026-04-08T00:00:01.000Z'
                : '2026-04-08T00:00:00.000Z',
          }),
        ),
      ),
    })
    const recovery = await vi.importActual<
      typeof import('../src/assistant/automation/startup-recovery.ts')
    >('../src/assistant/automation/startup-recovery.ts')

    const result = await recovery.recoverAssistantAutoReplies({
      allowSelfAuthored: false,
      autoReply: createAutoReplyEntries(['telegram'], {
        captureId: 'capture-later',
        occurredAt: '2026-04-08T00:00:01.000Z',
      }),
      inboxServices,
      maxPerScan: 1,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toEqual({
      considered: 1,
      failed: 0,
      nextWakeAt: expect.any(String),
      progressed: true,
      replied: 1,
      skipped: 0,
    })
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledOnce()
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          firstCaptureId: 'capture-recover',
        }),
      }),
    )
  })
})

describe('assistant automation run loop', () => {
  it('runs one automation scan and returns the aggregated result', async () => {
    const inboxServices = createInboxServices({
      run: vi.fn().mockResolvedValue(undefined),
    })
    runLoopMocks.resolveAssistantStatePaths.mockReturnValue({
      lockPath: '/tmp/run-lock',
    })
    const release = vi.fn().mockResolvedValue(undefined)
    runLoopMocks.acquireAssistantAutomationRunLock.mockResolvedValue({
      release,
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const result = await runLoop.runAssistantAutomation({
      drainOutbox: true,
      inboxServices,
      once: true,
      startDaemon: false,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.reason).toBe('completed')
    expect(result.daemonStarted).toBe(false)
    expect(result.scans).toBe(1)
    expect(result.considered).toBe(1)
    expect(result.routed).toBe(1)
    expect(result.replyConsidered).toBe(1)
    expect(result.replied).toBe(1)
    expect(result.vault).toBe('/redacted/assistant-automation-vault')
    expect(runLoopMocks.drainAssistantOutbox).toHaveBeenCalledWith({
      vault: '/tmp/assistant-automation-vault',
      limit: undefined,
    })
    expect(runLoopMocks.recoverAssistantAutoReplies).toHaveBeenCalledWith(
      expect.objectContaining({
        autoReply: [],
        vault: '/tmp/assistant-automation-vault',
      }),
    )
    expect(runLoopMocks.processDueAssistantCronJobs).toHaveBeenCalledOnce()
    expect(runLoopMocks.recordAssistantDiagnosticEvent).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('runs inbox recovery and scanning before due cron jobs in a pass', async () => {
    const inboxServices = createInboxServices({
      run: vi.fn().mockResolvedValue(undefined),
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    await runLoop.runAssistantAutomation({
      drainOutbox: true,
      inboxServices,
      once: true,
      startDaemon: false,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(runLoopMocks.recoverAssistantAutoReplies).toHaveBeenCalledOnce()
    expect(runLoopMocks.scanAssistantAutomationOnce).toHaveBeenCalledOnce()
    expect(runLoopMocks.processDueAssistantCronJobs).toHaveBeenCalledOnce()
    expect(
      runLoopMocks.scanAssistantAutomationOnce.mock.invocationCallOrder[0],
    ).toBeLessThan(
      runLoopMocks.processDueAssistantCronJobs.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('can finish a document-preservation retry pass without replying or outbox work', async () => {
    runLoopMocks.scanAssistantAutomationOnce.mockResolvedValueOnce({
      routing: {
        considered: 0,
        failed: 0,
        nextWakeAt: null,
        noAction: 0,
        routed: 0,
        skipped: 0,
      },
      replies: {
        considered: 0,
        failed: 0,
        nextWakeAt: '2026-04-08T00:00:30.000Z',
        replied: 0,
        skipped: 0,
      },
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const result = await runLoop.runAssistantAutomationPass({
      requestId: 'request-preserve-failed',
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      cronProcessed: 0,
      nextWakeAt: '2026-04-08T00:00:30.000Z',
      outboxAttempted: 0,
      progressed: false,
      replies: {
        considered: 0,
        failed: 0,
        replied: 0,
        skipped: 0,
      },
      routing: {
        considered: 0,
        failed: 0,
        noAction: 0,
        routed: 0,
        skipped: 0,
      },
    })
    expect(runLoopMocks.scanAssistantAutomationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-preserve-failed',
        vault: '/tmp/assistant-automation-vault',
      }),
    )
    expect(runLoopMocks.drainAssistantOutbox).toHaveBeenCalledOnce()
    expect(runLoopMocks.processDueAssistantCronJobs).toHaveBeenCalledOnce()
  })

  it('wakes immediately on non-self imported captures instead of waiting for the scan interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const externalAbort = new AbortController()
    const scanStartedAt: number[] = []
    const inboxServices = createInboxServices({
      run: vi.fn().mockImplementation(
        async (
          _input: { requestId: string | null; vault: string },
          options: {
            onEvent?: (event: Record<string, unknown>) => void
            signal: AbortSignal
          },
        ) => {
          setTimeout(() => {
            options.onEvent?.({
              type: 'capture.imported',
              connectorId: 'telegram',
              source: 'telegram',
              capture: {
                actor: {
                  isSelf: false,
                },
              },
            })
          }, 10)

          await new Promise<void>((resolve) => {
            options.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
          })
        },
      ),
    })
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(async () => {
      scanStartedAt.push(Date.now())
      if (scanStartedAt.length === 2) {
        externalAbort.abort()
      }
      return {
        routing: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          noAction: 0,
          routed: 0,
          skipped: 0,
        },
        replies: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          replied: 0,
          skipped: 0,
        },
      }
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const resultPromise = runLoop.runAssistantAutomation({
      inboxServices,
      once: false,
      signal: externalAbort.signal,
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(scanStartedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10)
    const result = await resultPromise

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(scanStartedAt[1]! - scanStartedAt[0]!).toBe(10)
  })

  it('wakes immediately on self-authored imported captures when allowSelfAuthored is enabled', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const externalAbort = new AbortController()
    const scanStartedAt: number[] = []
    const inboxServices = createInboxServices({
      run: vi.fn().mockImplementation(
        async (
          _input: { requestId: string | null; vault: string },
          options: {
            onEvent?: (event: Record<string, unknown>) => void
            signal: AbortSignal
          },
        ) => {
          setTimeout(() => {
            options.onEvent?.({
              type: 'capture.imported',
              connectorId: 'telegram',
              source: 'telegram',
              capture: {
                actor: {
                  isSelf: true,
                },
              },
            })
          }, 10)

          await new Promise<void>((resolve) => {
            options.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
          })
        },
      ),
    })
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(async () => {
      scanStartedAt.push(Date.now())
      if (scanStartedAt.length === 2) {
        externalAbort.abort()
      }
      return {
        routing: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          noAction: 0,
          routed: 0,
          skipped: 0,
        },
        replies: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          replied: 0,
          skipped: 0,
        },
      }
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const resultPromise = runLoop.runAssistantAutomation({
      allowSelfAuthored: true,
      inboxServices,
      once: false,
      signal: externalAbort.signal,
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(scanStartedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10)
    const result = await resultPromise

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(scanStartedAt[1]! - scanStartedAt[0]!).toBe(10)
  })

  it('does not wake on self-authored imported captures during ordinary runs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const externalAbort = new AbortController()
    const scanStartedAt: number[] = []
    const inboxServices = createInboxServices({
      run: vi.fn().mockImplementation(
        async (
          _input: { requestId: string | null; vault: string },
          options: {
            onEvent?: (event: Record<string, unknown>) => void
            signal: AbortSignal
          },
        ) => {
          setTimeout(() => {
            options.onEvent?.({
              type: 'capture.imported',
              connectorId: 'telegram',
              source: 'telegram',
              capture: {
                actor: {
                  isSelf: true,
                },
              },
            })
          }, 10)

          await new Promise<void>((resolve) => {
            options.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
          })
        },
      ),
    })
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(async () => {
      scanStartedAt.push(Date.now())
      if (scanStartedAt.length === 2) {
        externalAbort.abort()
      }
      return {
        routing: {
          considered: 0,
          failed: 0,
          nextWakeAt: '2026-04-09T00:00:00.020Z',
          noAction: 0,
          routed: 0,
          skipped: 0,
        },
        replies: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          replied: 0,
          skipped: 0,
        },
      }
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const resultPromise = runLoop.runAssistantAutomation({
      allowSelfAuthored: false,
      inboxServices,
      once: false,
      signal: externalAbort.signal,
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    await vi.advanceTimersByTimeAsync(10)
    expect(scanStartedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(9)
    expect(scanStartedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    const result = await resultPromise

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(scanStartedAt[1]! - scanStartedAt[0]!).toBe(20)
  })

  it('wakes immediately on parser drain events instead of waiting for the scan interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const externalAbort = new AbortController()
    const scanStartedAt: number[] = []
    const inboxServices = createInboxServices({
      run: vi.fn().mockImplementation(
        async (
          _input: { requestId: string | null; vault: string },
          options: {
            onEvent?: (event: Record<string, unknown>) => void
            signal: AbortSignal
          },
        ) => {
          setTimeout(() => {
            options.onEvent?.({
              connectorId: 'parser',
              parser: {
                captureIds: ['capture_1'],
                failed: 0,
                processed: 1,
                succeeded: 1,
              },
              source: 'parser',
              type: 'parser.jobs.drained',
            })
          }, 10)

          await new Promise<void>((resolve) => {
            options.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
          })
        },
      ),
    })
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(async () => {
      scanStartedAt.push(Date.now())
      if (scanStartedAt.length === 2) {
        externalAbort.abort()
      }
      return {
        routing: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          noAction: 0,
          routed: 0,
          skipped: 0,
        },
        replies: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          replied: 0,
          skipped: 0,
        },
      }
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const resultPromise = runLoop.runAssistantAutomation({
      inboxServices,
      once: false,
      signal: externalAbort.signal,
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(scanStartedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10)
    const result = await resultPromise

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(scanStartedAt[1]! - scanStartedAt[0]!).toBe(10)
  })

  it('waits for the receipt recovery retry deadline instead of rescanning immediately on failures', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const externalAbort = new AbortController()
    const scanStartedAt: number[] = []
    const inboxServices = createInboxServices({
      run: vi.fn().mockImplementation(
        async (
          _input: { requestId: string | null; vault: string },
          options: { signal: AbortSignal },
        ) =>
          await new Promise<void>((resolve) => {
            options.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
          }),
      ),
    })
    runLoopMocks.readAssistantAutomationState.mockResolvedValue(
      createAutomationState({
        autoReplyChannels: ['telegram'],
        autoReplyScanCursor: {
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:00:00.000Z',
        },
      }),
    )
    runLoopMocks.recoverAssistantAutoReplies.mockResolvedValue({
      considered: 1,
      failed: 1,
      nextWakeAt: '2026-04-09T00:00:10.000Z',
      progressed: false,
      replied: 0,
      skipped: 0,
    })
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(async () => {
      scanStartedAt.push(Date.now())
      if (scanStartedAt.length === 2) {
        externalAbort.abort()
      }
      return {
        routing: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          noAction: 0,
          routed: 0,
          skipped: 0,
        },
        replies: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          replied: 0,
          skipped: 0,
        },
      }
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const resultPromise = runLoop.runAssistantAutomation({
      inboxServices,
      once: false,
      signal: externalAbort.signal,
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(scanStartedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(9_999)
    expect(scanStartedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    const result = await resultPromise

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(scanStartedAt[1]! - scanStartedAt[0]!).toBe(10_000)
  })

  it('continues immediately when scan state progress is persisted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const externalAbort = new AbortController()
    const scanStartedAt: number[] = []
    const inboxServices = createInboxServices({
      run: vi.fn().mockImplementation(
        async (
          _input: { requestId: string | null; vault: string },
          options: { signal: AbortSignal },
        ) =>
          await new Promise<void>((resolve) => {
            options.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
          }),
      ),
    })
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(
      async (input: {
        onStateProgress: (next: {
          autoReply: AssistantAutomationState['autoReply']
          inboxScanCursor: AssistantAutomationCursor | null
        }) => Promise<void>
      }) => {
        scanStartedAt.push(Date.now())
        if (scanStartedAt.length === 1) {
          await input.onStateProgress({
            autoReply: createAutoReplyEntries(['telegram'], {
              captureId: 'capture-auto-reply',
              occurredAt: '2026-04-09T00:00:00.000Z',
            }),
            inboxScanCursor: null,
          })
        } else {
          externalAbort.abort()
        }

        return {
          routing: {
            considered: 0,
            failed: 0,
            nextWakeAt: null,
            noAction: 0,
            routed: 0,
            skipped: 0,
          },
          replies: {
            considered: 0,
            failed: 0,
            nextWakeAt: null,
            replied: 0,
            skipped: 0,
          },
        }
      },
    )
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const result = await runLoop.runAssistantAutomation({
      inboxServices,
      once: false,
      signal: externalAbort.signal,
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(scanStartedAt[1]! - scanStartedAt[0]!).toBe(0)
  })

  it('re-runs receipt recovery on later scans until the loop goes idle', async () => {
    const externalAbort = new AbortController()
    const scanStartedAt: number[] = []
    const inboxServices = createInboxServices({
      run: vi.fn().mockImplementation(
        async (
          _input: { requestId: string | null; vault: string },
          options: { signal: AbortSignal },
        ) =>
          await new Promise<void>((resolve) => {
            options.signal.addEventListener('abort', () => resolve(), {
              once: true,
            })
          }),
      ),
    })
    runLoopMocks.readAssistantAutomationState.mockResolvedValue(
      createAutomationState({
        autoReplyChannels: ['telegram'],
        autoReplyScanCursor: {
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:00:00.000Z',
        },
      }),
    )
    runLoopMocks.recoverAssistantAutoReplies
      .mockResolvedValueOnce({
        considered: 1,
        failed: 0,
        nextWakeAt: null,
        progressed: true,
        replied: 1,
        skipped: 0,
      })
      .mockResolvedValueOnce({
        considered: 0,
        failed: 0,
        nextWakeAt: null,
        progressed: false,
        replied: 0,
        skipped: 0,
      })
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(async () => {
      scanStartedAt.push(Date.now())
      if (scanStartedAt.length === 2) {
        externalAbort.abort()
      }
      return {
        routing: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          noAction: 0,
          routed: 0,
          skipped: 0,
        },
        replies: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          replied: 0,
          skipped: 0,
        },
      }
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const result = await runLoop.runAssistantAutomation({
      inboxServices,
      once: false,
      signal: externalAbort.signal,
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(runLoopMocks.recoverAssistantAutoReplies).toHaveBeenCalledTimes(2)
  })

  it('includes the receipt recovery summary before the normal scan result', async () => {
    runLoopMocks.readAssistantAutomationState.mockResolvedValue(
      createAutomationState({
        autoReplyChannels: ['telegram'],
        autoReplyScanCursor: {
          captureId: 'capture-1',
          occurredAt: '2026-04-08T00:00:00.000Z',
        },
      }),
    )
    runLoopMocks.recoverAssistantAutoReplies.mockResolvedValue({
      considered: 1,
      failed: 0,
      nextWakeAt: null,
      progressed: true,
      replied: 1,
      skipped: 0,
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const result = await runLoop.runAssistantAutomation({
      once: true,
      startDaemon: false,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replyConsidered).toBe(2)
    expect(result.replied).toBe(2)
    expect(runLoopMocks.recoverAssistantAutoReplies).toHaveBeenCalledOnce()
  })

  it('returns an error reason when the inbox daemon fails and aborts the loop', async () => {
    const inboxServices = createInboxServices({
      run: vi.fn().mockRejectedValue(new Error('daemon down')),
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const events: Array<Record<string, unknown>> = []
    const result = await runLoop.runAssistantAutomation({
      inboxServices,
      once: false,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.reason).toBe('error')
    expect(result.lastError).toBe('daemon down')
    expect(events).toContainEqual({
      type: 'daemon.failed',
      details: 'daemon down',
    })
  })

  it('rethrows scan failures after recording the last error and releasing the lock', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    runLoopMocks.acquireAssistantAutomationRunLock.mockResolvedValue({
      release,
    })
    runLoopMocks.maybeThrowInjectedAssistantFault.mockImplementation(() => {
      throw new Error('injected fault')
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    await expect(
      runLoop.runAssistantAutomation({
        once: true,
        startDaemon: false,
        vault: '/tmp/assistant-automation-vault',
      }),
    ).rejects.toThrow('injected fault')

    expect(runLoopMocks.errorMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'injected fault',
      }),
    )
    expect(release).toHaveBeenCalledOnce()
  })

  it('reports a signal reason when the upstream abort signal is already set', async () => {
    const controller = new AbortController()
    controller.abort()
    const inboxServices = createInboxServices({
      run: vi.fn().mockResolvedValue(undefined),
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const result = await runLoop.runAssistantAutomation({
      inboxServices,
      once: false,
      signal: controller.signal,
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.reason).toBe('signal')
    expect(result.scans).toBe(0)
  })

  it('creates integrated services, persists scan state progress, and warns on best-effort failures', async () => {
    const externalAbort = new AbortController()
    const integratedInboxServices = createInboxServices({
      run: vi.fn().mockResolvedValue(undefined),
    })
    const release = vi.fn().mockRejectedValue(new Error('release failed'))
    runLoopMocks.acquireAssistantAutomationRunLock.mockResolvedValue({
      release,
    })
    runLoopMocks.createIntegratedInboxServices.mockReturnValue(integratedInboxServices)
    runLoopMocks.createIntegratedVaultServices.mockReturnValue({
      owner: 'vault-services',
    })
    runLoopMocks.refreshAssistantStatusSnapshot
      .mockRejectedValueOnce(new Error('status start failed'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('status end failed'))
    runLoopMocks.maybeRunAssistantRuntimeMaintenance.mockRejectedValueOnce(
      new Error('maintenance failed'),
    )
    runLoopMocks.scanAssistantAutomationOnce.mockImplementationOnce(
      async (input: {
        onStateProgress: (next: {
          autoReply: AssistantAutomationState['autoReply']
          inboxScanCursor: AssistantAutomationCursor | null
        }) => Promise<void>
      }) => {
        await input.onStateProgress({
          autoReply: createAutoReplyEntries(['telegram'], {
            captureId: 'capture-auto-reply',
            occurredAt: '2026-04-08T00:01:00.000Z',
          }),
          inboxScanCursor: {
            captureId: 'capture-routing',
            occurredAt: '2026-04-08T00:02:00.000Z',
          },
        })
        queueMicrotask(() => {
          externalAbort.abort()
        })
        return {
          routing: {
            considered: 0,
            failed: 0,
            nextWakeAt: null,
            noAction: 0,
            routed: 0,
            skipped: 0,
          },
          replies: {
            considered: 0,
            failed: 0,
            nextWakeAt: null,
            replied: 0,
            skipped: 0,
          },
        }
      },
    )
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const result = await runLoop.runAssistantAutomation({
      requestId: 'request-1',
      signal: externalAbort.signal,
      startDaemon: true,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.reason).toBe('signal')
    expect(runLoopMocks.createIntegratedInboxServices).toHaveBeenCalledOnce()
    expect(runLoopMocks.createIntegratedVaultServices).toHaveBeenCalledWith()
    expect(runLoopMocks.saveAssistantAutomationState).toHaveBeenCalledWith(
      '/tmp/assistant-automation-vault',
      expect.objectContaining({
        autoReply: createAutoReplyEntries(['telegram'], {
          captureId: 'capture-auto-reply',
          occurredAt: '2026-04-08T00:01:00.000Z',
        }),
        inboxScanCursor: {
          captureId: 'capture-routing',
          occurredAt: '2026-04-08T00:02:00.000Z',
        },
      }),
    )
    expect(runLoopMocks.warnAssistantBestEffortFailure).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: 'status start failed',
      }),
      operation: 'status snapshot refresh',
    })
    expect(runLoopMocks.warnAssistantBestEffortFailure).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: 'maintenance failed',
      }),
      operation: 'runtime maintenance',
    })
    expect(runLoopMocks.warnAssistantBestEffortFailure).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: 'release failed',
      }),
      operation: 'automation run-lock release',
    })
    expect(runLoopMocks.warnAssistantBestEffortFailure).toHaveBeenCalledWith({
      error: expect.objectContaining({
        message: 'status end failed',
      }),
      operation: 'status snapshot refresh',
    })
  })

  it('cleans up and rethrows when the automation run lock cannot be acquired', async () => {
    runLoopMocks.acquireAssistantAutomationRunLock.mockRejectedValue(
      new Error('lock unavailable'),
    )
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    await expect(
      runLoop.runAssistantAutomation({
        once: true,
        startDaemon: false,
        vault: '/tmp/assistant-automation-vault',
      }),
    ).rejects.toThrow('lock unavailable')
  })
})
