import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AssistantInputCursor,
  AssistantAutomationState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  inboxListResultSchema,
  inboxShowResultSchema,
  type InboxShowResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import { assistantTurnReceiptSchema } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import {
  serializeHostedEmailThreadTarget,
} from '@murphai/runtime-state'
import {
  AssistantActiveTurnInputBudgetExceededError,
  AssistantActiveTurnInputCheckpointRejectedError,
  AssistantActiveTurnInputUnavailableError,
  type AssistantActiveTurnInputCheckpointInput,
} from '../src/assistant/turn-input.ts'
import {
  createStoreBackedAssistantInputSource,
  type AssistantInputCandidate,
  type AssistantInputSource,
  type AssistantTurnConversationInputQuery,
} from '../src/assistant/input-source.ts'
import {
  createAssistantInputEventId,
  compareAssistantInputCursors,
  type AssistantInputAttachmentDescriptor,
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.ts'
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

const scannerReplyMocks = vi.hoisted(() => ({
  applyAssistantAutoReplyProcessResult: vi.fn(),
  createAssistantAutoReplyGroupContext: vi.fn(),
  createAssistantAutoReplyReceiptReader: vi.fn(),
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
  resolveAssistantStatePaths: vi.fn(),
  saveAssistantAutomationState: vi.fn(),
  scanAssistantAutomationOnce: vi.fn(),
  warnAssistantBestEffortFailure: vi.fn(),
}))

const replyMocks = vi.hoisted(() => ({
  collectAssistantAutoReplyGroup: vi.fn(),
  conversationRefFromCapture: vi.fn(),
  createAssistantProviderWatchdog: vi.fn(),
  describeAssistantAutoReplyFailure: vi.fn(),
  errorMessage: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
  isAssistantProviderConnectionLostError: vi.fn(),
  isAssistantProviderStalledError: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  listAssistantTranscriptEntries: vi.fn(),
  listAssistantTurnReceipts: vi.fn(),
  normalizeNullableString: vi.fn(),
  prepareAssistantAutoReplyInput: vi.fn(),
  readTelegramAutoReplyMetadataFromAssistantInput: vi.fn(),
  renderAssistantInputAttachmentDescriptorPromptSection: vi.fn(),
  resolveAssistantSession: vi.fn(),
  sendAssistantMessage: vi.fn(),
  writeAssistantChatErrorArtifacts: vi.fn(),
}))

const evidenceMocks = vi.hoisted(() => ({
  assistantAutoReplyTerminalEvidenceExists: vi.fn(),
  hasCompleteAssistantAutoReplyTerminalEvidence: vi.fn(),
  readAssistantAutoReplyTerminalEvidenceByEvidenceId: vi.fn(),
  writeAssistantAutoReplyReplyIntentEvidence: vi.fn(),
  writeAssistantAutoReplyReplyTerminalEvidence: vi.fn(),
  writeAssistantAutoReplySuppressionEvidence: vi.fn(),
}))

const tempRoots: string[] = []

vi.mock('../src/assistant/automation/artifacts.ts', () => ({
  writeAssistantChatErrorArtifacts: replyMocks.writeAssistantChatErrorArtifacts,
}))

vi.mock('../src/assistant/automation/evidence.ts', () => ({
  assistantAutoReplyTerminalEvidenceExists:
    evidenceMocks.assistantAutoReplyTerminalEvidenceExists,
  hasCompleteAssistantAutoReplyTerminalEvidence:
    evidenceMocks.hasCompleteAssistantAutoReplyTerminalEvidence,
  readAssistantAutoReplyTerminalEvidenceByEvidenceId:
    evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId,
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
  createAssistantAutoReplyReceiptReader:
    scannerReplyMocks.createAssistantAutoReplyReceiptReader,
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

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  bytes: Buffer,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, bytes)
}

vi.mock('../src/assistant/automation/scanner.ts', () => ({
  scanAssistantAutomationOnce: runLoopMocks.scanAssistantAutomationOnce,
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
  listAssistantOutboxIntents: replyMocks.listAssistantOutboxIntents,
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

vi.mock('../src/assistant/shared.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/shared.ts')>(
    '../src/assistant/shared.ts',
  )
  return {
    ...actual,
    errorMessage: runLoopMocks.errorMessage,
    formatStructuredErrorMessage: runLoopMocks.formatStructuredErrorMessage,
    normalizeNullableString: replyMocks.normalizeNullableString,
    warnAssistantBestEffortFailure: runLoopMocks.warnAssistantBestEffortFailure,
  }
})

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

vi.mock('../src/assistant/provider-failure-diagnostics.ts', () => ({
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
  normalizeAssistantSafeFailureContext: (context: Record<string, unknown> | null) =>
    context ?? undefined,
}))

vi.mock('../src/assistant/automation/provider-watchdog.ts', () => ({
  AUTO_REPLY_PROVIDER_STALLED_DETAIL:
    'assistant provider stalled; will retry this input once it becomes responsive again.',
  createAssistantProviderWatchdog: replyMocks.createAssistantProviderWatchdog,
}))

vi.mock('../src/assistant/automation/prompt-builder.ts', () => ({
  prepareAssistantAutoReplyInput: replyMocks.prepareAssistantAutoReplyInput,
  readTelegramAutoReplyMetadataFromAssistantInput:
    replyMocks.readTelegramAutoReplyMetadataFromAssistantInput,
  renderAssistantInputAttachmentDescriptorPromptSection:
    replyMocks.renderAssistantInputAttachmentDescriptorPromptSection,
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

function createAutomationInputSummary(input: {
  inputId: string
  occurredAt: string
  receivedAt?: string | null
}) {
  return {
    inputId: input.inputId,
    optionalInboxCaptureId: null,
    source: 'telegram',
    conversation: {
      accountId: null,
      actorId: null,
      actorIsSelf: false,
      source: 'telegram',
      threadId: 'thread-1',
      threadIsDirect: true,
    },
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt ?? null,
    text: 'hello',
    attachmentCount: 0,
    actorIsSelf: false,
    replyToMessageId: null,
  }
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

function createSentOutboxIntent(input: {
  actorId?: string | null
  channel?: string
  identityId?: string | null
  intentId?: string
  message: string
  providerMessageId?: string | null
  providerMessageIds?: string[]
  providerThreadId?: string | null
  sentAt: string
  sessionId?: string
  target?: string
  threadId?: string | null
}) {
  const channel = input.channel ?? 'telegram'
  const target = input.target ?? 'thread-1'
  const providerThreadId = input.providerThreadId ?? target
  return {
    actorId: input.actorId === undefined ? 'actor-1' : input.actorId,
    channel,
    delivery: {
      channel,
      idempotencyKey: null,
      kind: 'message',
      messageLength: input.message.length,
      providerMessageId: input.providerMessageId ?? null,
      ...(input.providerMessageIds ? { providerMessageIds: input.providerMessageIds } : {}),
      providerThreadId,
      sentAt: input.sentAt,
      target,
      targetKind: 'thread',
    },
    identityId: input.identityId ?? null,
    intentId: input.intentId ?? 'intent-1',
    message: input.message,
    operation: null,
    sessionId: input.sessionId ?? 'session-1',
    status: 'sent',
    threadId: input.threadId === undefined ? providerThreadId : input.threadId,
  }
}

function createTranscriptEntry(input: {
  createdAt: string
  kind?: 'assistant' | 'error' | 'status' | 'thinking' | 'user'
  text: string
}) {
  return {
    createdAt: input.createdAt,
    kind: input.kind ?? 'assistant',
    schema: 'murph.assistant-transcript-entry.v1',
    text: input.text,
  }
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

function createTurnReceipt(
  overrides: Partial<
    ReturnType<typeof assistantTurnReceiptSchema.parse>
  > & {
    captureIds?: readonly string[]
    inputIds?: readonly string[]
    primaryCaptureId?: string
    primaryInputId?: string
  } = {},
) {
  const captureIds = overrides.captureIds ?? ['capture-1']
  const primaryCaptureId = overrides.primaryCaptureId ?? captureIds[0] ?? 'capture-1'
  const inputIds = overrides.inputIds ?? []
  const primaryInputId = overrides.primaryInputId ?? inputIds[0] ?? null

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
          ...(primaryInputId
            ? {
                autoReplyInputId: primaryInputId,
              }
            : {}),
          ...(inputIds.length > 0
            ? {
                autoReplyInputIds: inputIds.join(','),
              }
            : {}),
          autoReplyCaptureId: primaryCaptureId,
          autoReplyCaptureIds: captureIds.join(','),
        },
      },
    ],
  })
}

function createTerminalEvidence(input: {
  captureId?: string
  groupCaptureIds?: string[]
  groupInputIds?: string[]
  terminal?: {
    deliveryIntentId: string | null
    kind: 'deferred' | 'replied' | 'reply_intent_committed'
    sessionId: string
  } | {
    kind: 'suppressed'
    reason: string
  } | {
    failedAttempts: number
    kind: 'retry_exhausted'
    maxFailedAttempts: number
    reason: string
  }
} = {}) {
  const captureId = input.captureId ?? 'capture-1'
  const groupCaptureIds = input.groupCaptureIds ?? [captureId]
  const groupInputIds = input.groupInputIds ?? []

  return {
    captureId,
    groupCaptureIds,
    groupId: groupCaptureIds.join('+'),
    groupInputIds,
    inputId: captureId,
    primaryCaptureId: groupCaptureIds[0] ?? captureId,
    primaryInputId: groupInputIds[0] ?? captureId,
    providerCleanup: {
      linqMessageIds: [],
      queuedAt: null,
    },
    recordedAt: '2026-04-08T00:10:00.000Z',
    schema: 'murph.assistant-auto-reply-terminal-evidence.v1',
    terminal: input.terminal ?? {
      deliveryIntentId: null,
      kind: 'replied',
      sessionId: 'session-1',
    },
  }
}

type LegacyAutomationStateOverrides = Partial<AssistantAutomationState> & {
  autoReplyChannels?: readonly string[]
  autoReplyEligibleAfter?: AssistantInputCursor | null
}

function createAutomationState(
  overrides: LegacyAutomationStateOverrides = {},
): AssistantAutomationState {
  const {
    autoReply: explicitAutoReply,
    autoReplyChannels: legacyAutoReplyChannels,
    autoReplyEligibleAfter,
    ...stateOverrides
  } = overrides
  const autoReply =
    explicitAutoReply ??
    [...new Set(legacyAutoReplyChannels ?? [])].map((channel) => ({
      channel,
      eligibleAfter: autoReplyEligibleAfter ?? null,
      enabledAt: '2026-04-08T00:00:00.000Z',
    }))
  return {
    version: 1,
    autoReply,
    updatedAt: '2026-04-08T00:00:00.000Z',
    ...stateOverrides,
  }
}

function createAutoReplyEntries(
  channels: readonly string[],
  cursor: AssistantInputCursor | null = null,
): AssistantAutomationState['autoReply'] {
  return [...new Set(channels)].map((channel) => ({
    channel,
    eligibleAfter: cursor,
    enabledAt: '2026-04-08T00:00:00.000Z',
  }))
}

function createAssistantInputCursor(input: {
  createdAt?: string | null
  inputId: string
  occurredAt: string
  sourceKind?: 'inbox-capture' | 'hosted-mailbox'
  sourcePosition?: string | null
}): AssistantInputCursor {
  return {
    createdAt: input.createdAt ?? null,
    inputId: input.inputId,
    occurredAt: input.occurredAt,
    sourceKind: input.sourceKind ?? 'inbox-capture',
    ...(input.sourcePosition !== undefined
      ? { sourcePosition: input.sourcePosition }
      : {}),
  }
}

function readAutoReplyCursor(
  state: Pick<AssistantAutomationState, 'autoReply'>,
  channel: string,
): AssistantInputCursor | null {
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

function createAssistantInputSourceForCaptures(
  captures: readonly ReturnType<typeof createCaptureSummary>[],
): AssistantInputSource {
  return {
    refresh: vi.fn(async () => ({
      progressed: false,
      reason: 'no_new_input' as const,
    })),
    listInputCandidates: vi.fn(async (input) => ({
      inputs: captures
        .map((capture) => assistantInputCandidateFromInboxCapture(capture))
        .filter((candidate) =>
          input.sourceId ? candidate.event.source === input.sourceId : true,
        )
        .filter((candidate) =>
          input.afterCursor
            ? compareAssistantInputCursors(candidate.event.cursor, input.afterCursor) > 0
            : true,
        )
        .slice(0, input.limit ?? captures.length),
      nextCursor: captures[0]
        ? assistantInputCandidateFromInboxCapture(captures[captures.length - 1]!)
            .event.cursor
        : input.afterCursor ?? null,
    })),
    listNewConversationInputs: vi.fn(async () => ({
      inputs: [],
      nextCursor: null,
    })),
  }
}

function assistantInputCandidateFromInboxCapture(
  capture: ReturnType<typeof createCaptureSummary>,
): AssistantInputCandidate {
  const sourceRef = {
    captureId: capture.captureId,
    kind: 'inbox-capture' as const,
    source: capture.source,
    version: null,
  }
  const inputId = createAssistantInputEventId({
    sourceRef,
  })
  return {
    acceptedInput: {
      captureIds: [capture.captureId],
      contentRef: {
        kind: 'assistant-input-event',
        refId: inputId,
        version: 'murph.assistant-input-event.v1',
      },
      id: inputId,
      source: 'assistant-input',
    },
    event: {
      attachmentCount: capture.attachmentCount,
      attachmentEvidence: DEFAULT_TEST_ATTACHMENT_EVIDENCE,
      attachmentDescriptors: [],
      conversation: {
        accountId: capture.accountId,
        actorId: capture.actorId,
        actorIsSelf: capture.actorIsSelf,
        source: capture.source,
        threadId: capture.threadId,
        threadIsDirect: capture.threadIsDirect,
      },
      cursor: {
        createdAt: capture.createdAt ?? null,
        inputId,
        occurredAt: capture.occurredAt,
        sourceKind: 'inbox-capture',
        sourcePosition: `inbox-capture:${capture.source}:${capture.captureId}`,
      },
      inputId,
      occurredAt: capture.occurredAt,
      receivedAt: capture.receivedAt,
      replyTarget: capture.source === 'linq'
        ? {
            channel: 'linq',
            messageId: capture.externalId?.startsWith('linq:')
              ? capture.externalId.slice('linq:'.length)
              : null,
            threadId: capture.threadId,
          }
        : null,
      source: capture.source,
      sourceMetadata: null,
      sourceRef,
      text: capture.text,
      transcriptText: capture.text,
      userMessageContent: null,
    },
    projection: {
      captureId: capture.captureId,
      reasonCode: null,
      status: 'succeeded',
    },
  }
}

function createCapturelessAssistantInputCandidate(input: {
  actorIsSelf?: boolean
  conversationThreadId?: string | null
  inputId: string
  mailboxRow?: {
    dedupeKey: string
    eventId: string
    hostedMailboxItemId?: string
    itemId: string
    laneSeq: string
    sourceRefItemId?: string
  }
  occurredAt: string
  receivedAt?: string | null
  replyTarget?: AssistantInputCandidate['event']['replyTarget']
  source?: string
  sourceMetadata?: AssistantInputCandidate['event']['sourceMetadata']
  text: string
}): AssistantInputCandidate {
  const source = input.source ?? 'linq'
  return {
    acceptedInput: {
      captureIds: [],
      contentRef: {
        kind: 'assistant-input-event',
        refId: input.inputId,
        version: 'murph.assistant-input-event.v1',
      },
      id: input.inputId,
      promptFallbackReason: 'system-input',
      promptFallbackText: input.text,
      source: 'assistant-input',
    },
    event: {
      attachmentCount: 0,
      attachmentEvidence: DEFAULT_TEST_ATTACHMENT_EVIDENCE,
      attachmentDescriptors: [],
      conversation: {
        accountId: 'safe_acct_1',
        actorId: 'safe_actor_1',
        actorIsSelf: input.actorIsSelf ?? false,
        source,
        threadId: input.conversationThreadId ?? 'safe_thread_1',
        threadIsDirect: true,
      },
      cursor: {
        createdAt: input.receivedAt ?? input.occurredAt,
        inputId: input.inputId,
        occurredAt: input.occurredAt,
        sourceKind: 'hosted-mailbox',
        sourcePosition: `hosted-mailbox:conversation:${input.inputId}`,
      },
      hostedMailboxItemId: input.mailboxRow?.hostedMailboxItemId ??
        input.mailboxRow?.itemId ??
        `item_${input.inputId}`,
      inputId: input.inputId,
      occurredAt: input.occurredAt,
      receivedAt: input.receivedAt ?? null,
      replyTarget: input.replyTarget ?? null,
      source,
      sourceMetadata: input.sourceMetadata ?? null,
      sourceRef: {
        dedupeKey: input.mailboxRow?.dedupeKey ?? `dedupe_${input.inputId}`,
        eventId: input.mailboxRow?.eventId ?? `event_${input.inputId}`,
        itemId: input.mailboxRow?.sourceRefItemId ??
          input.mailboxRow?.itemId ??
          `item_${input.inputId}`,
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: input.mailboxRow?.laneSeq ?? '42',
        payloadSchema: 'murph.hosted-mailbox-payload.v1',
        payloadSource: 'inline',
        source: 'hosted-mailbox',
        wakeSchema: 'murph.hosted-execution-wake.v1',
      },
      text: input.text,
      transcriptText: input.text,
      userMessageContent: [
        {
          text: input.text,
          type: 'text',
        },
      ],
    },
    projection: {
      captureId: null,
      reasonCode: 'conversation-import.projection-failed',
      status: 'failed',
    },
  }
}

async function stageInboxCaptureAssistantInputEvent(input: {
  attachmentDescriptors?: AssistantInputAttachmentDescriptor[]
  capture: InboxShowResult['capture'] | ReturnType<typeof createCaptureSummary>
  vault: string
}) {
  return upsertAssistantInputEvent({
    vault: input.vault,
    event: {
      content: {
        attachmentDescriptors: input.attachmentDescriptors,
        text: input.capture.text,
        transcriptText: input.capture.text,
        userMessageContent: input.capture.text
          ? [
              {
                text: input.capture.text,
                type: 'text',
              },
            ]
          : null,
      },
      conversation: {
        accountId: input.capture.accountId,
        actorId: input.capture.actorId,
        actorIsSelf: input.capture.actorIsSelf,
        source: input.capture.source,
        threadId: input.capture.threadId,
        threadIsDirect: input.capture.threadIsDirect,
      },
      occurredAt: input.capture.occurredAt,
      receivedAt: input.capture.receivedAt,
      sourceRef: {
        captureId: input.capture.captureId,
        kind: 'inbox-capture',
        source: input.capture.source,
        version: null,
      },
    },
  })
}

function createAutoReplyContextForTest(
  items: ReadonlyArray<{
    inputCandidate?: AssistantInputCandidate
    summary: { inputId?: string; optionalInboxCaptureId?: string | null; captureId?: string; occurredAt: string }
    telegramMetadata: { mediaGroupId: string | null; messageId: string | null; replyContext: string | null } | null
  }>,
) {
  const firstItem = items[0]
  const lastItem = items[items.length - 1]
  if (!firstItem || !lastItem) {
    return null
  }
  if (items.some((item) => !item.inputCandidate)) {
    return null
  }

  return {
    firstItem,
    inputCount: items.length,
    inputIds: items.map((item) => item.inputCandidate!.event.inputId),
    items,
    lastInputCursor: lastItem.inputCandidate!.event.cursor,
    firstInputId:
      firstItem.summary.inputId ?? firstItem.inputCandidate!.event.inputId,
    optionalInboxCaptureIds: items
      .map((item) => item.summary.optionalInboxCaptureId ?? item.summary.captureId ?? null)
      .filter((captureId): captureId is string => captureId !== null),
  }
}

function applyAutoReplyProcessResultForTest(input: {
  result: {
    checkpointRequired?: true
    failed: number
    replied: number
    skipped: number
    stopScanning: boolean
  }
  summary: { checkpointRequired?: true; failed: number; replied: number; skipped: number }
}) {
  if (input.result.checkpointRequired) {
    input.summary.checkpointRequired = true
  }
  input.summary.failed += input.result.failed
  input.summary.replied += input.result.replied
  input.summary.skipped += input.result.skipped

  return input.result.stopScanning
}

function createReplyGroupItem(
  capture: ReturnType<typeof createCaptureSummary>,
  telegramMetadata: { mediaGroupId: string | null; messageId: string | null; replyContext: string | null } | null = null,
) {
  const inputCandidate = assistantInputCandidateFromInboxCapture(capture)
  const metadata = inputCandidate.event.sourceMetadata
  return {
    inputCandidate,
    summary: {
      inputId: inputCandidate.event.inputId,
      optionalInboxCaptureId: capture.captureId,
      source: capture.source,
      conversation: inputCandidate.event.conversation!,
      occurredAt: capture.occurredAt,
      receivedAt: capture.receivedAt,
      text: capture.text,
      attachmentCount: capture.attachmentCount,
      actorIsSelf: capture.actorIsSelf,
      replyToMessageId:
        metadata?.kind === 'linq' ? metadata.replyToMessageId ?? null : null,
      captureId: capture.captureId,
    },
    telegramMetadata,
  }
}

function createCapturelessReplyGroupItem(
  candidate: AssistantInputCandidate,
) {
  const conversation = candidate.event.conversation
  const metadata = candidate.event.sourceMetadata
  return {
    inputCandidate: candidate,
    summary: {
      attachmentCount: candidate.event.attachmentCount,
      actorIsSelf: conversation?.actorIsSelf ?? false,
      conversation: conversation ?? {
        accountId: null,
        actorId: null,
        actorIsSelf: false,
        source: candidate.event.source,
        threadId: candidate.event.inputId,
        threadIsDirect: false,
      },
      inputId: candidate.event.inputId,
      occurredAt: candidate.event.occurredAt,
      optionalInboxCaptureId: null,
      receivedAt: candidate.event.receivedAt,
      source: candidate.event.source,
      text: candidate.event.transcriptText ?? candidate.event.text,
      replyToMessageId:
        metadata?.kind === 'linq' ? metadata.replyToMessageId ?? null : null,
      captureId: candidate.event.inputId,
    },
    telegramMetadata: null,
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
  scannerReplyMocks.createAssistantAutoReplyReceiptReader
    .mockReset()
    .mockImplementation(() => ({
      readReceipts: vi.fn(async () => []),
    }))
  scannerReplyMocks.processAssistantAutoReplyGroup.mockReset().mockResolvedValue({
    advanceCursor: true,
    failed: 0,
    replied: 0,
    skipped: 1,
    stopScanning: false,
  })

  groupingMocks.collectAssistantAutoReplyGroup.mockReset().mockImplementation(
    async (input: {
      inputSummaries: Array<ReturnType<typeof createReplyGroupItem>['summary']>
      startIndex: number
    }) => ({
      endIndex: input.startIndex,
      items: [
        {
          inputCandidate:
            input.inputSummaries[input.startIndex]!.inputId
              ? undefined
              : undefined,
          summary: input.inputSummaries[input.startIndex]!,
          telegramMetadata: null,
        },
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
  runLoopMocks.resolveAssistantStatePaths.mockReset().mockReturnValue({
    lockPath: '/tmp/assistant.lock',
  })
  runLoopMocks.saveAssistantAutomationState
    .mockReset()
    .mockImplementation(async (_vault: string, next: AssistantAutomationState) => next)
  runLoopMocks.scanAssistantAutomationOnce.mockReset().mockResolvedValue({
    currentTurnDeliveryIntentIds: [],
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
  replyMocks.listAssistantOutboxIntents.mockReset().mockResolvedValue([])
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
  replyMocks.writeAssistantChatErrorArtifacts.mockReset().mockResolvedValue(undefined)

  evidenceMocks.assistantAutoReplyTerminalEvidenceExists
    .mockReset()
    .mockResolvedValue(false)
  evidenceMocks.hasCompleteAssistantAutoReplyTerminalEvidence
    .mockReset()
    .mockImplementation(async (input: {
      captureId?: string | null
      inputId: string
      vault: string
    }) => {
      const evidence =
        await evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId(
          input.vault,
          input.inputId,
        ) ??
        (input.captureId
          ? await evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId(
              input.vault,
              input.captureId,
            )
          : null)
      if (!evidence) {
        return false
      }

      const groupInputIds =
        evidence.groupInputIds.length > 0
          ? evidence.groupInputIds
          : evidence.groupCaptureIds.map((captureId: string) => `inbox:${captureId}`)
      const uniqueGroupInputIds = Array.from(new Set(groupInputIds))
      if (uniqueGroupInputIds.length === 0) {
        return true
      }

      const groupEvidence = await Promise.all(
        uniqueGroupInputIds.map((inputId) =>
          evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId(
            input.vault,
            inputId,
          ),
        ),
      )
      return groupEvidence.every((entry) => entry !== null)
    })
  evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId
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

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant automation shared helpers', () => {
  it('normalizes cursors, channels, intervals, limits, and empty summaries', async () => {
    const shared = await vi.importActual<typeof import('../src/assistant/automation/shared.ts')>(
      '../src/assistant/automation/shared.ts',
    )
    const inputSummary = await vi.importActual<
      typeof import('../src/assistant/automation/input-summary.ts')
    >('../src/assistant/automation/input-summary.ts')
    const autoReplyRetry = await vi.importActual<
      typeof import('../src/assistant/automation/auto-reply-retry.ts')
    >('../src/assistant/automation/auto-reply-retry.ts')

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

    expect(shared.compareAssistantCaptureOrder(later, earlier)).toBeGreaterThan(0)
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
    expect(
      shared.compareAssistantCaptureOrder(
        {
          captureId: 'capture-offset-earlier',
          createdAt: '2026-04-08T00:30:00+01:00',
          occurredAt: '2026-04-08T00:30:00+01:00',
        },
        {
          captureId: 'capture-utc-later',
          createdAt: '2026-04-08T00:00:00.000Z',
          occurredAt: '2026-04-08T00:00:00.000Z',
        },
      ),
    ).toBeLessThan(0)
    expect(
      inputSummary.compareAssistantInputSummaryOrder(
        createAutomationInputSummary({
          inputId: 'input-offset-earlier',
          occurredAt: '2026-04-08T00:30:00+01:00',
          receivedAt: '2026-04-08T00:30:00+01:00',
        }),
        createAutomationInputSummary({
          inputId: 'input-utc-later',
          occurredAt: '2026-04-08T00:00:00.000Z',
          receivedAt: '2026-04-08T00:00:00.000Z',
        }),
      ),
    ).toBeLessThan(0)
    expect(
      autoReplyRetry.compareAssistantAutoReplyReceiptRecency(
        createTurnReceipt({
          status: 'completed',
          turnId: 'turn-offset-earlier',
          updatedAt: '2026-04-08T00:30:00+01:00',
        }),
        createTurnReceipt({
          status: 'completed',
          turnId: 'turn-utc-later',
          updatedAt: '2026-04-08T00:00:00.000Z',
        }),
      ),
    ).toBeLessThan(0)
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
    expect(shared.normalizeScanLimit(250.8)).toBe(250)
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
      inputSource: createAssistantInputSourceForCaptures([]),
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

  it('does not create groups when no live auto-reply candidates exist', async () => {
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices: createInboxServices(),
      inputSource: createAssistantInputSourceForCaptures([]),
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replies).toEqual({
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    })
    expect(scannerReplyMocks.processAssistantAutoReplyGroup)
      .not.toHaveBeenCalled()
  })

  it('scans auto-reply candidates from the supplied assistant input source', async () => {
    const latest = createCaptureSummary({
      captureId: 'capture-latest',
      occurredAt: '2026-04-08T00:05:00.000Z',
    })
    const inboxServices = createInboxServices()
    const inputSource = createAssistantInputSourceForCaptures([latest])
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const stateUpdates: AssistantAutomationState[] = []
    const events: Array<Record<string, unknown>> = []
    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      inputSource,
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      onStateProgress: async (next) => {
        stateUpdates.push({
          ...createAutomationState(),
          autoReply: [...next.autoReply],
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
    expect(readAutoReplyCursor(
      stateUpdates[0] ?? createAutomationState(),
      'telegram',
    )).toEqual(assistantInputCandidateFromInboxCapture(latest).event.cursor)
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'reply.scan.primed',
      }),
    )
  })

  it('advances the auto-reply channel cursor with the processed assistant input cursor', async () => {
    const first = createCaptureSummary({
      captureId: 'capture-1',
      occurredAt: '2026-04-08T00:01:00.000Z',
    })
    const second = createCaptureSummary({
      captureId: 'capture-2',
      occurredAt: '2026-04-08T00:02:00.000Z',
    })
    groupingMocks.collectAssistantAutoReplyGroup.mockImplementationOnce(
      async () => ({
        endIndex: 1,
        items: [
          createReplyGroupItem(first),
          createReplyGroupItem(second),
        ],
      }),
    )
    scannerReplyMocks.processAssistantAutoReplyGroup.mockResolvedValueOnce({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    const stateUpdates: AssistantAutomationState[] = []
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    await scanner.scanAssistantAutomationOnce({
      inboxServices: createInboxServices(),
      inputSource: createAssistantInputSourceForCaptures([first, second]),
      onStateProgress: async (next) => {
        stateUpdates.push({
          ...createAutomationState(),
          autoReply: [...next.autoReply],
        })
      },
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    const cursor = readAutoReplyCursor(
      stateUpdates[stateUpdates.length - 1] ?? createAutomationState(),
      'telegram',
    )
    expect(cursor).toEqual(createReplyGroupItem(second).inputCandidate.event.cursor)
  })

  it('clears reply backlog state once the backlog is drained', async () => {
    const inboxServices = createInboxServices()
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const stateUpdates: AssistantAutomationState[] = []
    await scanner.scanAssistantAutomationOnce({
      inboxServices,
      inputSource: createAssistantInputSourceForCaptures([]),
      onStateProgress: async (next) => {
        stateUpdates.push({
          ...createAutomationState(),
          autoReply: [...next.autoReply],
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
    const inboxServices = createInboxServices()
    const inputSource = createAssistantInputSourceForCaptures([capture])
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      inputSource,
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

    expect(result.replies).toMatchObject({
      considered: 1,
      skipped: 1,
    })
  })

  it('keeps evidenced captures in candidate grouping when terminal evidence is incomplete', async () => {
    const first = createCaptureSummary({
      captureId: 'capture-1',
      occurredAt: '2026-04-08T00:01:00.000Z',
    })
    const second = createCaptureSummary({
      captureId: 'capture-2',
      occurredAt: '2026-04-08T00:02:00.000Z',
    })
    const firstEvidence = createTerminalEvidence({
      captureId: 'capture-1',
      groupCaptureIds: ['capture-1', 'capture-2'],
    })
    evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId.mockImplementation(
      async (_vault: string, captureId: string) =>
        captureId === 'capture-1' ? firstEvidence : null,
    )
    groupingMocks.collectAssistantAutoReplyGroup.mockImplementationOnce(
      async () => ({
        endIndex: 1,
        items: [
          createReplyGroupItem(first),
          createReplyGroupItem(second),
        ],
      }),
    )
    scannerReplyMocks.processAssistantAutoReplyGroup.mockResolvedValueOnce({
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      replied: 0,
      skipped: 2,
      stopScanning: false,
    })
    const inboxServices = createInboxServices()
    const inputSource = createAssistantInputSourceForCaptures([first, second])
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      inputSource,
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(groupingMocks.collectAssistantAutoReplyGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSummaries: [
          expect.objectContaining({ optionalInboxCaptureId: 'capture-1' }),
          expect.objectContaining({ optionalInboxCaptureId: 'capture-2' }),
        ],
      }),
    )
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledOnce()
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          optionalInboxCaptureIds: ['capture-1', 'capture-2'],
        }),
      }),
    )
    expect(result.replies).toMatchObject({
      checkpointRequired: true,
      considered: 2,
      skipped: 2,
    })
  })

  it('admits captureless assistant input events without scanning inbox captures', async () => {
    const rawInput: AssistantInputCandidate = {
      acceptedInput: {
        captureIds: [],
        contentRef: {
          kind: 'assistant-input-event',
          refId: 'ain_raw_initial',
          version: 'murph.assistant-input-event.v1',
        },
        id: 'ain_raw_initial',
        source: 'assistant-input',
      },
      event: {
        attachmentCount: 0,
        attachmentEvidence: DEFAULT_TEST_ATTACHMENT_EVIDENCE,
        attachmentDescriptors: [],
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'linq',
          threadId: 'thread_1',
          threadIsDirect: true,
        },
        cursor: {
          createdAt: '2026-04-08T00:00:02.500Z',
          inputId: 'ain_raw_initial',
          occurredAt: '2026-04-08T00:00:02.000Z',
          sourceKind: 'hosted-mailbox',
          sourcePosition: 'hosted-mailbox:conversation:0000000000000042:item_1',
        },
        inputId: 'ain_raw_initial',
        occurredAt: '2026-04-08T00:00:02.000Z',
        receivedAt: '2026-04-08T00:00:02.500Z',
        replyTarget: {
          channel: 'linq',
          messageId: 'msg_1',
          threadId: 'thread_1',
        },
        source: 'linq',
        sourceMetadata: null,
        sourceRef: {
          dedupeKey: 'dedupe_1',
          eventId: 'evt_1',
          itemId: 'item_1',
          kind: 'hosted-mailbox',
          lane: 'conversation',
          laneSeq: '42',
          payloadSchema: 'murph.hosted-mailbox-payload.v1',
          payloadSource: 'inline',
          source: 'hosted-mailbox',
          wakeSchema: 'murph.hosted-execution-wake.v1',
        },
        text: 'raw hosted input',
        transcriptText: 'raw hosted input',
        userMessageContent: [
          {
            text: 'raw hosted input',
            type: 'text',
          },
        ],
      },
      projection: {
        captureId: null,
        reasonCode: 'conversation-import.projection-failed',
        status: 'failed',
      },
    }
    const listInputCandidates = vi.fn(async () => ({
      inputs: [rawInput],
      nextCursor: rawInput.event.cursor,
    }))
    const inputSource = {
      listInputCandidates,
      listNewConversationInputs: vi.fn(async () => ({
        inputs: [],
        nextCursor: null,
      })),
      refresh: vi.fn(async () => ({
        progressed: false,
        reason: 'no_new_input' as const,
      })),
    }
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([])),
      show: vi.fn(),
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      inputSource,
      state: createAutomationState({
        autoReplyChannels: ['linq'],
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(listInputCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'linq',
      }),
    )
    expect(inboxServices.list).not.toHaveBeenCalled()
    expect(inboxServices.show).not.toHaveBeenCalled()
    expect(groupingMocks.collectAssistantAutoReplyGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSummaries: [
          expect.objectContaining({
            inputId: 'ain_raw_initial',
            source: 'linq',
            text: 'raw hosted input',
          }),
        ],
      }),
    )
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledOnce()
    expect(result.replies).toMatchObject({
      considered: 1,
      skipped: 1,
    })
  })

  it('reads staged assistant input events from the store-backed source', async () => {
    const context = await createTempVaultContext('assistant-scanner-input-store-')
    tempRoots.push(context.parentRoot)
    const stored = await upsertAssistantInputEvent({
      vault: context.vaultRoot,
      event: {
        content: {
          text: 'stored scanner input',
          userMessageContent: [
            {
              text: 'stored scanner input',
              type: 'text',
            },
          ],
        },
        conversation: {
          accountId: 'acct_store',
          actorId: 'actor_store',
          actorIsSelf: false,
          source: 'linq',
          threadId: 'thread_store',
          threadIsDirect: true,
        },
        occurredAt: '2026-04-08T00:07:00.000Z',
        receivedAt: '2026-04-08T00:07:01.000Z',
        replyTarget: {
          channel: 'linq',
          messageId: 'msg_store',
          threadId: 'thread_store',
        },
        sourceRef: {
          dedupeKey: 'dedupe_store',
          eventId: 'evt_store',
          itemId: 'item_store',
          kind: 'hosted-mailbox',
          lane: 'conversation',
          laneSeq: '7',
          payloadSchema: 'murph.hosted-mailbox-payload.v1',
          payloadSource: 'inline',
          source: 'hosted-mailbox',
          wakeSchema: 'murph.hosted-execution-wake.v1',
        },
      },
    })
    const inputSource = createStoreBackedAssistantInputSource({
      vault: context.vaultRoot,
    })
    const inboxServices = createInboxServices({
      list: vi.fn().mockResolvedValue(createListResult([])),
      show: vi.fn(),
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      inputSource,
      state: createAutomationState({
        autoReplyChannels: ['linq'],
      }),
      vault: context.vaultRoot,
    })

    expect(inboxServices.list).not.toHaveBeenCalled()
    expect(inboxServices.show).not.toHaveBeenCalled()
    expect(groupingMocks.collectAssistantAutoReplyGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSummaries: [
          expect.objectContaining({
            inputId: stored.inputId,
            source: 'linq',
            text: 'stored scanner input',
          }),
        ],
      }),
    )
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          inputIds: [stored.inputId],
        }),
      }),
    )
    expect(result.replies).toMatchObject({
      considered: 1,
      skipped: 1,
    })
  })

  it('does not automatically preserve document attachments after reply processing', async () => {
    const capture = createCaptureSummary({
      attachmentCount: 1,
    })
    const preserveDocumentAttachments = vi
      .fn()
      .mockRejectedValue(new Error('preserve should not run'))
    const inboxServices = createInboxServices({
      preserveDocumentAttachments,
    })
    const inputSource = createAssistantInputSourceForCaptures([capture])
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      inputSource,
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
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
    expect(preserveDocumentAttachments).not.toHaveBeenCalled()
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledOnce()
  })

  it('does not preserve documents for captureless candidates', async () => {
    const candidate = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'thread-null-projection',
      inputId: 'ain_null_projection_0123456789abcdef01234567',
      occurredAt: '2026-04-08T00:01:00.000Z',
      receivedAt: '2026-04-08T00:01:01.000Z',
      source: 'telegram',
      text: 'captureless attachment text',
    })
    const attachmentCandidate: AssistantInputCandidate = {
      ...candidate,
      event: {
        ...candidate.event,
        attachmentCount: 1,
      },
    }
    const inputSource = {
      async refresh() {
        return {
          progressed: false,
          reason: 'no_new_input' as const,
        }
      },
      async listInputCandidates() {
        return {
          inputs: [attachmentCandidate],
          nextCursor: attachmentCandidate.event.cursor,
        }
      },
      async listNewConversationInputs() {
        return {
          inputs: [],
          nextCursor: null,
        }
      },
    }
    const preserveDocumentAttachments = vi.fn()
    const inboxServices = createInboxServices({
      preserveDocumentAttachments,
    })
    scannerReplyMocks.processAssistantAutoReplyGroup.mockResolvedValueOnce({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )

    const result = await scanner.scanAssistantAutomationOnce({
      inboxServices,
      inputSource,
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
      }),
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replies).toMatchObject({
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    expect(groupingMocks.collectAssistantAutoReplyGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSummaries: [
          expect.objectContaining({
            inputId: attachmentCandidate.event.inputId,
            optionalInboxCaptureId: null,
          }),
        ],
      }),
    )
    expect(preserveDocumentAttachments).not.toHaveBeenCalled()
    expect(scannerReplyMocks.processAssistantAutoReplyGroup).toHaveBeenCalledOnce()
  })

  it('skips disabled reply scanning when canonical writes are disabled', async () => {
    const preserveDocumentAttachments = vi
      .fn()
      .mockRejectedValue(new Error('should not preserve'))
    const capture = createCaptureSummary({
      attachmentCount: 1,
    })
    const inboxServices = createInboxServices({
      preserveDocumentAttachments,
    })
    const scanner = await vi.importActual<typeof import('../src/assistant/automation/scanner.ts')>(
      '../src/assistant/automation/scanner.ts',
    )
    const stateUpdates: AssistantAutomationState[] = []

    const result = await scanner.scanAssistantAutomationOnce({
      applyCanonicalWrites: false,
      inboxServices,
      inputSource: createAssistantInputSourceForCaptures([capture]),
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
      }),
      onStateProgress: async (next) => {
        stateUpdates.push({
          ...createAutomationState(),
          autoReply: [...next.autoReply],
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
      inputSource: createAssistantInputSourceForCaptures([first, second]),
      onStateProgress: async (next) => {
        stateUpdates.push({
          ...createAutomationState(),
          autoReply: [...next.autoReply],
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
    const inputSource = createAssistantInputSourceForCaptures([shared])
    const inboxServices = createInboxServices()
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
      inputSource,
      maxPerScan: 1,
      state: createAutomationState({
        autoReplyChannels: ['telegram'],
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
    expect(inputSource.listInputCandidates).toHaveBeenCalledTimes(1)
  })
})

describe('assistant auto-reply runtime', () => {
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
      firstInputId: first.inputCandidate.event.inputId,
      firstItem: first,
      inputCount: 2,
      inputIds: [
        first.inputCandidate.event.inputId,
        second.inputCandidate.event.inputId,
      ],
      items: [first, second],
      lastInputCursor: {
        createdAt: '2026-04-08T00:00:01.000Z',
        inputId: second.inputCandidate.event.inputId,
        occurredAt: '2026-04-08T00:02:00.000Z',
        sourceKind: 'inbox-capture',
        sourcePosition: 'inbox-capture:telegram:capture-2',
      },
      optionalInboxCaptureIds: ['capture-1', 'capture-2'],
    })
  })

  it('applies reply processing results to the scan summary', async () => {
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
    const stopScanning = reply.applyAssistantAutoReplyProcessResult({
      context,
      result: {
        advanceCursor: true,
        failed: 1,
        lastInputCursor: context.lastInputCursor,
        nextWakeAt: null,
        replied: 2,
        skipped: 3,
        stopScanning: true,
      },
      summary,
    })

    expect(summary).toEqual({
      considered: 0,
      failed: 1,
      nextWakeAt: null,
      replied: 2,
      skipped: 3,
    })
    expect(stopScanning).toBe(true)
  })

  it('leaves reply scan running when process results stay on the current group', async () => {
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
    const stopScanning = reply.applyAssistantAutoReplyProcessResult({
      context,
      result: {
        advanceCursor: false,
        failed: 1,
        lastInputCursor: context.lastInputCursor,
        nextWakeAt: null,
        replied: 0,
        skipped: 0,
        stopScanning: false,
      },
      summary,
    })

    expect(summary).toEqual({
      considered: 0,
      failed: 1,
      nextWakeAt: null,
      replied: 0,
      skipped: 0,
    })
    expect(stopScanning).toBe(false)
  })

  it('defers when terminal evidence is only partially written', async () => {
    evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId
      .mockResolvedValueOnce(createTerminalEvidence({
        captureId: 'capture-1',
      }))
      .mockResolvedValueOnce(null)
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
    expect(events).toContainEqual(expect.objectContaining({
      type: 'input.reply-skipped',
      inputId: expect.stringMatching(/^ain_/u),
      details:
        'assistant reply terminal evidence is incomplete; will retry this input after evidence is rebuilt.',
      errorCode: undefined,
      safeDetails: undefined,
    }))
  })

  it('does not align filtered projection capture ids with mixed captureless group items', async () => {
    const capturelessInput = createCapturelessAssistantInputCandidate({
      inputId: 'ain_captureless_first_0123456789abc',
      occurredAt: '2026-04-08T00:01:00.000Z',
      receivedAt: '2026-04-08T00:01:01.000Z',
      source: 'telegram',
      text: 'captureless first',
    })
    const projectedItem = createReplyGroupItem(createCaptureSummary({
      captureId: 'capture-projected-second',
      occurredAt: '2026-04-08T00:02:00.000Z',
      source: 'telegram',
      text: 'projected second',
      threadId: capturelessInput.event.conversation?.threadId ?? 'safe_thread_1',
    }))
    evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId
      .mockImplementation(async (_vault: string, evidenceId: string) =>
        evidenceId === 'capture-projected-second'
          ? createTerminalEvidence({ captureId: 'capture-projected-second' })
          : null
      )
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(capturelessInput),
      projectedItem,
    ])

    if (!context) {
      throw new Error('expected reply context')
    }
    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        deliveryIntentId: 'intent-already-handled',
        inputIds: context.inputIds,
        primaryInputId: context.firstInputId,
        status: 'completed',
      }),
    ])

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
    expect(evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId)
      .toHaveBeenCalledWith(
        '/tmp/assistant-automation-vault',
        'capture-projected-second',
      )
    expect(
      evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId.mock.calls
        .filter(([, evidenceId]) => evidenceId === capturelessInput.event.inputId),
    ).toHaveLength(2)
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
  })

  it('marks groups handled when terminal evidence already exists in full', async () => {
    evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId.mockResolvedValue(
      createTerminalEvidence(),
    )
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
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence).not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
  })

  it('repairs the full terminal evidence group from one evidenced candidate', async () => {
    evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId
      .mockResolvedValueOnce(createTerminalEvidence({
        captureId: 'capture-1',
        groupCaptureIds: ['capture-1', 'capture-2'],
      }))
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary({
        captureId: 'capture-1',
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
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence).toHaveBeenCalledWith({
      captureIds: ['capture-1', 'capture-2'],
      deliveryIntentId: null,
      linqMessageIds: [],
      outcome: 'result',
      recordedAt: '2026-04-08T00:10:00.000Z',
      sessionId: 'session-1',
      terminalKind: 'replied',
      vault: '/tmp/assistant-automation-vault',
    })
  })

  it('backfills legacy retry-exhausted evidence as ordinary suppression', async () => {
    evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId
      .mockResolvedValueOnce(createTerminalEvidence({
        captureId: 'capture-1',
        groupCaptureIds: ['capture-1', 'capture-2'],
        groupInputIds: ['ain_legacy_input_1', 'ain_legacy_input_2'],
        terminal: {
          failedAttempts: 3,
          kind: 'retry_exhausted',
          maxFailedAttempts: 3,
          reason: 'legacy retry limit reached',
        },
      }))
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createReplyGroupItem(createCaptureSummary({
        captureId: 'capture-1',
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
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith({
        captureIds: ['capture-1', 'capture-2'],
        linqMessageIds: [],
        reason: 'legacy retry limit reached',
        recordedAt: '2026-04-08T00:10:00.000Z',
        vault: '/tmp/assistant-automation-vault',
      })
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence)
      .not.toHaveBeenCalled()
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
      checkpointRequired: true,
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
      checkpointRequired: true,
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
          autoReplyInputId: expect.stringMatching(/^ain_[0-9a-f]{32}$/u),
          autoReplyInputIds: expect.stringMatching(/^ain_[0-9a-f]{32}$/u),
        },
        turnTrigger: 'automation-auto-reply',
      }),
    )
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).toHaveBeenCalledOnce()
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        captureIds: ['capture-1'],
        outcome: 'result',
        vault: '/tmp/assistant-automation-vault',
      }),
    )
    expect(events).toContainEqual(expect.objectContaining({
      type: 'input.reply-started',
      inputId: expect.stringMatching(/^ain_/u),
      details: 'assistant provider turn started',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant.delivery.sent',
      inputId: expect.stringMatching(/^ain_/u),
      details: 'delivery sent',
      errorCode: undefined,
      safeDetails: 'delivery sent',
    }))
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
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).toHaveBeenCalledOnce()
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        captureIds: ['capture-1'],
        outcome: 'deferred',
        vault: '/tmp/assistant-automation-vault',
      }),
    )
  })

  it('emits reply intent-created events even when the outbox intent id is absent', async () => {
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
    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant.reply.intent_created',
      inputId: expect.stringMatching(/^ain_/u),
      details: 'assistant reply intent created',
      safeDetails: 'reply intent created',
    }))
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

  it('suppresses Codex usage-limit failures as terminal auto-reply evidence', async () => {
    const usageLimitError = Object.assign(
      new Error('Codex app-server turn failed. status failed.'),
      {
        code: 'ASSISTANT_CODEX_USAGE_LIMIT',
        context: {
          providerUsageLimit: true,
        },
      },
    )
    replyMocks.sendAssistantMessage.mockRejectedValue(usageLimitError)
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
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        captureIds: ['capture-1'],
        inputIds: context.inputIds,
        reason: 'assistant provider usage limit reached; auto-reply suppressed until usage is restored.',
      }))
    expect(replyMocks.writeAssistantChatErrorArtifacts).not.toHaveBeenCalled()
  })

  it('emits provider failure diagnostics for hosted runtime logs', async () => {
    const codexError = Object.assign(
      new Error('Codex app-server turn failed. status failed.'),
      {
        code: 'ASSISTANT_CODEX_FAILED',
      },
    )
    replyMocks.sendAssistantMessage.mockRejectedValue(codexError)
    replyMocks.describeAssistantAutoReplyFailure.mockReturnValue({
      code: 'ASSISTANT_CODEX_FAILED',
      context: {
        codexFailureDetailPresent: true,
        codexFailureStage: 'turn_failed',
        codexTurnStatus: 'failed',
        providerActionCount: 2,
        retryable: false,
      },
      kind: 'provider',
      message: 'Codex app-server turn failed. status failed.',
      retryable: false,
      safeSummary: 'assistant provider failed (ASSISTANT_CODEX_FAILED)',
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

    expect(result).toMatchObject({
      failed: 1,
      replied: 0,
      skipped: 0,
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'input.reply-failed',
      inputId: expect.stringMatching(/^ain_/u),
      details: 'Codex app-server turn failed. status failed.',
      errorCode: 'ASSISTANT_CODEX_FAILED',
      failureContext: expect.objectContaining({
        codexFailureDetailPresent: true,
        codexFailureStage: 'turn_failed',
        codexTurnStatus: 'failed',
        providerActionCount: 2,
        retryable: false,
      }),
      safeDetails: 'assistant provider failed (ASSISTANT_CODEX_FAILED)',
      safeErrorMessage: 'Codex app-server turn failed. status failed.',
    }))
  })

  it('treats empty provider auto-reply results as terminal no-reply skips', async () => {
    replyMocks.sendAssistantMessage.mockRejectedValue(
      Object.assign(
        new Error(
          'Assistant provider completed without a final response. Use finish_without_reply for an intentional no-reply turn.',
        ),
        {
          code: 'ASSISTANT_PROVIDER_EMPTY_RESPONSE',
        },
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
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(replyMocks.writeAssistantChatErrorArtifacts).not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        captureIds: ['capture-1'],
        reason: 'assistant provider completed without a reply',
        vault: '/tmp/assistant-automation-vault',
      }))
  })

  it('suppresses raw upstream billing exhaustion without storing provider text', async () => {
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
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        reason: 'assistant provider usage limit reached; auto-reply suppressed until usage is restored.',
      }))
    expect(
      evidenceMocks.writeAssistantAutoReplySuppressionEvidence.mock.calls[0]?.[0].reason,
    ).not.toContain('quota')
  })

  it('suppresses raw upstream quota exhaustion without requiring billing-detail wording', async () => {
    replyMocks.sendAssistantMessage.mockRejectedValue(
      new Error('Quota exceeded. Purchase more credits to continue.'),
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
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        reason: 'assistant provider usage limit reached; auto-reply suppressed until usage is restored.',
      }))
    expect(replyMocks.writeAssistantChatErrorArtifacts).not.toHaveBeenCalled()
  })

  it('keeps raw transient provider throttling on the retry path', async () => {
    replyMocks.sendAssistantMessage.mockRejectedValue(
      new Error('HTTP 429 too many requests; retry-after: 60'),
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
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
    expect(replyMocks.writeAssistantChatErrorArtifacts).toHaveBeenCalledOnce()
  })

  it('writes usage-limit suppression evidence by input id for captureless hosted mailbox input', async () => {
    replyMocks.sendAssistantMessage.mockRejectedValue(
      Object.assign(new Error('provider usage limit reached'), {
        code: 'ASSISTANT_CODEX_USAGE_LIMIT',
      }),
    )
    const hostedInput = createCapturelessAssistantInputCandidate({
      inputId: 'ain_hosted_usage_limit',
      occurredAt: '2026-04-08T00:00:00.000Z',
      text: 'hosted input',
    })
    const inboxServices = createInboxServices()
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
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
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: true,
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        inputIds: ['ain_hosted_usage_limit'],
        reason: 'assistant provider usage limit reached; auto-reply suppressed until usage is restored.',
      }))
  })

  it('does not finish usage-limit suppression when terminal evidence cannot be written', async () => {
    replyMocks.sendAssistantMessage.mockRejectedValue(
      Object.assign(new Error('provider usage limit reached'), {
        code: 'ASSISTANT_CODEX_USAGE_LIMIT',
      }),
    )
    evidenceMocks.writeAssistantAutoReplySuppressionEvidence.mockRejectedValue(
      new Error('evidence write failed'),
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

    await expect(reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })).rejects.toThrow('evidence write failed')
    expect(replyMocks.writeAssistantChatErrorArtifacts).not.toHaveBeenCalled()
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
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence).toHaveBeenCalledWith(expect.objectContaining({
      captureIds: ['capture-1'],
      deliveryIntentId: null,
      inputIds: [expect.stringMatching(/^ain_[0-9a-f]{32}$/u)],
      linqMessageIds: [],
      outcome: 'result',
      recordedAt: '2026-04-08T00:10:00.000Z',
      sessionId: 'session-receipt',
      vault: '/tmp/assistant-automation-vault',
    }))
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
  })

  it('skips groups when the channel adapter refuses auto-reply', async () => {
    replyMocks.getAssistantChannelAdapter.mockReturnValue({
      canAutoReply: vi.fn().mockReturnValue(
        'channel policy disabled: /tmp/provider/file.txt',
      ),
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
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'channel policy disabled: [path]',
      }),
    )
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
    const projectedLateInput = assistantInputCandidateFromInboxCapture(lateCapture)
    const lateInput: AssistantInputCandidate = {
      ...projectedLateInput,
      event: {
        ...projectedLateInput.event,
        replyTarget: {
          channel: 'telegram',
          messageId: 'late_msg_1',
          threadId: 'late_thread_1',
        },
      },
    }
    replyMocks.prepareAssistantAutoReplyInput.mockImplementation(
      async (inputs: readonly {
        inputId: string
        projection: { optionalInboxCaptureId: string | null } | null
      }[]) => {
        const captureIds = inputs.map(
          (entry) => entry.projection?.optionalInboxCaptureId ?? entry.inputId,
        )
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

    let listNewCallCount = 0
    const inputSource = {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        listNewCallCount += 1
        expect(input.knownProjectionCaptureIds).toEqual(
          listNewCallCount === 1
            ? ['capture-1']
            : ['capture-1', 'capture-late'],
        )
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
        if (input.knownProjectionCaptureIds?.includes('capture-late')) {
          return {
            inputs: [],
            nextCursor: input.afterCursor ?? null,
          }
        }
        return {
          inputs: [lateInput],
          nextCursor: lateInput.event.cursor,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(
      async (input: {
        activeTurnInput?: (
          value: {
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
        activeTurnCheckpoint?: (value: AssistantActiveTurnInputCheckpointInput) => Promise<void>
        receiptMetadata?: { autoReplyInputIds?: string }
        response?: string
      }) => {
        const admitted = await input.activeTurnInput?.({
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
          autoReplyInputId: expect.stringMatching(/^ain_[0-9a-f]{32}$/u),
          autoReplyInputIds: expect.stringContaining(lateInput.event.inputId),
        })
        expect(admitted.receiptMetadata?.autoReplyInputIds).toEqual(
          expect.stringContaining(context.inputIds[0]),
        )
        expect(admitted.acceptedInputs).toEqual([
          expect.objectContaining({
            captureIds: ['capture-late'],
            id: lateInput.event.inputId,
          }),
        ])
        expect(admitted).toMatchObject({
          deliveryReplyToMessageId: 'late_msg_1',
          deliveryTarget: 'late_thread_1',
        })
        expect(admitted.transcriptText).toBe('User sent an attachment.')
        const duplicateAdmission = await input.activeTurnInput?.({
          sessionId: 'session-1',
          turnId: 'turn-1',
          vault: '/tmp/assistant-automation-vault',
        })
        expect(duplicateAdmission).toEqual({
          kind: 'no-new-input',
        })
        await input.activeTurnCheckpoint?.({
          acceptedInputIds: [lateInput.event.inputId],
          providerRequestOrdinal: 0,
          sessionId: 'session-1',
          turnId: 'turn-1',
          vault: '/tmp/assistant-automation-vault',
        })

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
      inputSource: inputSource,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      checkpointRequired: true,
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
        autoReplyInputIds: expect.stringMatching(/^ain_[0-9a-f]{32}$/u),
      }),
    )
    expect(replyMocks.sendAssistantMessage.mock.calls[0]?.[0]?.activeTurnInput).toBeTypeOf(
      'function',
    )
    expect(events).toContainEqual(expect.objectContaining({
      type: 'input.reply-progress',
      inputId: expect.stringMatching(/^ain_/u),
      details: 'new input queued for active turn with 1 additional input(s)',
      providerKind: 'status',
      providerState: 'running',
    }))
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'input.reply-progress',
        details: 'new input committed to active turn with 1 additional input(s)',
        providerKind: 'status',
        providerState: 'running',
      }),
    )
    expect(replyMocks.prepareAssistantAutoReplyInput).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({
        projection: expect.objectContaining({ optionalInboxCaptureId: 'capture-1' }),
      })],
      '/tmp/assistant-automation-vault',
      { onEvent: expect.any(Function) },
    )
    expect(replyMocks.prepareAssistantAutoReplyInput).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({
        projection: expect.objectContaining({ optionalInboxCaptureId: 'capture-late' }),
      })],
      '/tmp/assistant-automation-vault',
      { onEvent: expect.any(Function) },
    )
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        captureIds: ['capture-1', 'capture-late'],
        inputIds: [context.inputIds[0], lateInput.event.inputId],
        outcome: 'result',
      }),
    )
  })

  it('admits captureless late assistant input by input id during an active turn', async () => {
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

    const hostedInput: AssistantInputCandidate = {
      acceptedInput: {
        captureIds: [],
        contentRef: {
          kind: 'system',
          refId: 'ain_0123456789abcdef0123456789abcdef',
          version: 'murph.assistant-input-event.v1',
        },
        id: 'ain_0123456789abcdef0123456789abcdef',
        promptFallbackReason: 'system-input',
        promptFallbackText: 'late hosted text',
        source: 'system',
      },
      event: {
        attachmentCount: 0,
        attachmentEvidence: DEFAULT_TEST_ATTACHMENT_EVIDENCE,
        attachmentDescriptors: [],
        conversation: context.firstItem.summary.conversation,
        cursor: {
          createdAt: '2026-04-08T00:00:04.000Z',
          inputId: 'ain_0123456789abcdef0123456789abcdef',
          occurredAt: '2026-04-08T00:04:00.000Z',
          sourceKind: 'hosted-mailbox',
          sourcePosition: '4',
        },
        inputId: 'ain_0123456789abcdef0123456789abcdef',
        occurredAt: '2026-04-08T00:04:00.000Z',
        receivedAt: '2026-04-08T00:04:01.000Z',
        replyTarget: {
          channel: 'telegram',
          messageId: 'msg_4',
          threadId: 'thread_4',
        },
        source: 'telegram',
        sourceMetadata: null,
        sourceRef: {
          dedupeKey: 'dedupe-4',
          eventId: 'event-4',
          itemId: 'item-4',
          kind: 'hosted-mailbox',
          lane: 'conversation',
          laneSeq: '4',
          payloadSchema: 'payload.v1',
          payloadSource: 'inline',
          source: 'hosted-mailbox',
          wakeSchema: 'wake.v1',
        },
        text: 'late hosted text',
        transcriptText: 'late hosted text',
        userMessageContent: [
          {
            text: 'late hosted text',
            type: 'text',
          },
        ],
      },
      projection: {
        captureId: null,
        reasonCode: null,
        status: 'not_attempted',
      },
    }

    const inputSource = {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        expect(input.knownInputIds).toContain(context.inputIds[0])
        if (input.knownInputIds?.includes(hostedInput.event.inputId)) {
          return {
            inputs: [],
            nextCursor: input.afterCursor ?? null,
          }
        }
        return {
          inputs: [hostedInput],
          nextCursor: hostedInput.event.cursor,
        }
      },
    }

    let admittedTurnInput: unknown = null
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: AssistantActiveTurnInputCheckpointInput) => Promise<void>
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      const admitted = await input.activeTurnInput?.({
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      admittedTurnInput = admitted
      await input.activeTurnCheckpoint?.({
        acceptedInputIds: [hostedInput.event.inputId],
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      return {
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
      }
    })

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    expect(admittedTurnInput).toMatchObject({
      acceptedInputs: [
        expect.objectContaining({
          captureIds: [],
          id: hostedInput.event.inputId,
        }),
      ],
      deliveryReplyToMessageId: 'msg_4',
      kind: 'accepted',
      prompt: expect.stringContaining('late hosted text'),
      receiptMetadata: {
        autoReplyInputId: context.firstInputId,
        autoReplyInputIds: `${context.inputIds[0]},${hostedInput.event.inputId}`,
      },
      transcriptText: 'late hosted text',
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        inputIds: expect.arrayContaining([
          context.inputIds[0],
          hostedInput.event.inputId,
        ]),
      }),
    )
  })

  it('does not clear the prior reply target when captureless late input has no message id', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            captureId: 'capture-1',
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
        {
          mediaGroupId: null,
          messageId: 'initial_msg_1',
          replyContext: null,
        },
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'thread-1',
      inputId: 'ain_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      occurredAt: '2026-04-08T00:04:00.000Z',
      receivedAt: '2026-04-08T00:04:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: null,
        threadId: 'thread-1',
      },
      source: 'telegram',
      text: 'late text without message id',
    })
    const inputSource = {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        if (input.knownInputIds?.includes(hostedInput.event.inputId)) {
          return {
            inputs: [],
            nextCursor: input.afterCursor ?? null,
          }
        }
        return {
          inputs: [hostedInput],
          nextCursor: hostedInput.event.cursor,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: AssistantActiveTurnInputCheckpointInput) => Promise<void>
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
      deliveryReplyToMessageId?: string | null
    }) => {
      expect(input.deliveryReplyToMessageId).toBe('initial_msg_1')
      const admitted = await input.activeTurnInput?.({
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      expect(admitted).toMatchObject({
        kind: 'accepted',
        prompt: expect.stringContaining('late text without message id'),
      })
      expect(
        Object.prototype.hasOwnProperty.call(
          admitted as Record<string, unknown>,
          'deliveryReplyToMessageId',
        ),
      ).toBe(false)
      await input.activeTurnCheckpoint?.({
        acceptedInputIds: [hostedInput.event.inputId],
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      return {
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
      }
    })

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
  })

  it('uses the latest captureless assistant input reply target during active-turn admission', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            captureId: 'capture-1',
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
        {
          mediaGroupId: null,
          messageId: 'initial_msg_1',
          replyContext: null,
        },
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const olderInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'thread-1',
      inputId: 'ain_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01',
      occurredAt: '2026-04-08T00:04:00.000Z',
      receivedAt: '2026-04-08T00:04:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'older_msg',
        threadId: 'thread-1',
      },
      source: 'telegram',
      text: 'older late text',
    })
    const newerInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'thread-1',
      inputId: 'ain_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa02',
      occurredAt: '2026-04-08T00:05:00.000Z',
      receivedAt: '2026-04-08T00:05:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'newer_msg',
        threadId: 'thread-1',
      },
      source: 'telegram',
      text: 'newer late text',
    })
    const inputSource = {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        if (
          input.knownInputIds?.includes(olderInput.event.inputId) &&
          input.knownInputIds?.includes(newerInput.event.inputId)
        ) {
          return {
            inputs: [],
            nextCursor: input.afterCursor ?? null,
          }
        }
        return {
          inputs: [olderInput, newerInput],
          nextCursor: newerInput.event.cursor,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: AssistantActiveTurnInputCheckpointInput) => Promise<void>
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      const admitted = await input.activeTurnInput?.({
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      expect(admitted).toMatchObject({
        acceptedInputs: [
          expect.objectContaining({
            captureIds: [],
            id: olderInput.event.inputId,
          }),
          expect.objectContaining({
            captureIds: [],
            id: newerInput.event.inputId,
          }),
        ],
        deliveryTarget: 'thread-1',
        deliveryReplyToMessageId: 'newer_msg',
        kind: 'accepted',
      })
      await input.activeTurnCheckpoint?.({
        acceptedInputIds: [olderInput.event.inputId, newerInput.event.inputId],
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      return {
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
      }
    })

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
  })

  it('derives Linq reaction availability from the same mixed late input as the reply target', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn().mockImplementation(async ({ captureId }: { captureId: string }) =>
        createShowResult(
          createCaptureDetail({
            captureId,
            externalId: `linq:${captureId}-message`,
            occurredAt: '2026-04-08T00:04:00.000Z',
            source: 'linq',
            threadId: 'linq-thread-1',
          }),
        ),
      ),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const initialCapture = createCaptureSummary({
      captureId: 'capture-initial',
      externalId: 'linq:linq-message-initial',
      occurredAt: '2026-04-08T00:02:00.000Z',
      source: 'linq',
      threadId: 'linq-thread-1',
    })
    const context = reply.createAssistantAutoReplyGroupContext([
      {
        ...createReplyGroupItem(initialCapture),
        inputCandidate: {
          ...assistantInputCandidateFromInboxCapture(initialCapture),
          event: {
            ...assistantInputCandidateFromInboxCapture(initialCapture).event,
            sourceMetadata: {
              kind: 'linq',
              partCount: 1,
              reactionEligible: true,
              replyToMessageId: null,
              service: 'iMessage',
            },
          },
        },
      },
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const projectedLateCapture = createCaptureSummary({
      captureId: 'capture-late-imessage',
      externalId: 'linq:linq-message-imessage',
      occurredAt: '2026-04-08T00:04:00.000Z',
      receivedAt: '2026-04-08T00:04:01.000Z',
      source: 'linq',
      threadId: 'linq-thread-1',
    })
    const projectedLateBase = assistantInputCandidateFromInboxCapture(
      projectedLateCapture,
    )
    const projectedLateInput: AssistantInputCandidate = {
      ...projectedLateBase,
      event: {
        ...projectedLateBase.event,
        sourceMetadata: {
          kind: 'linq',
          partCount: 1,
          reactionEligible: true,
          replyToMessageId: null,
          service: 'iMessage',
        },
      },
    }
    const capturelessLateSms = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'linq-thread-1',
      inputId: 'ain_fefefefefefefefefefefefefefefefe',
      occurredAt: '2026-04-08T00:05:00.000Z',
      receivedAt: '2026-04-08T00:05:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'linq-message-sms',
        threadId: 'linq-thread-1',
      },
      source: 'linq',
      sourceMetadata: {
        kind: 'linq',
        partCount: 1,
        reactionEligible: false,
        replyToMessageId: null,
        service: 'sms',
      },
      text: 'late sms text',
    })
    const inputSource = {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        if (input.knownInputIds?.includes(capturelessLateSms.event.inputId)) {
          return {
            inputs: [],
            nextCursor: input.afterCursor ?? null,
          }
        }
        return {
          inputs: [projectedLateInput, capturelessLateSms],
          nextCursor: capturelessLateSms.event.cursor,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: AssistantActiveTurnInputCheckpointInput) => Promise<void>
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      const admitted = await input.activeTurnInput?.({
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      expect(admitted).toMatchObject({
        deliveryMessageReactionsAvailable: false,
        deliveryReplyToMessageId: 'linq-message-sms',
        deliveryTarget: 'linq-thread-1',
        kind: 'accepted',
      })
      await input.activeTurnCheckpoint?.({
        acceptedInputIds: [
          projectedLateInput.event.inputId,
          capturelessLateSms.event.inputId,
        ],
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      return {
        delivery: {
          channel: 'linq',
          target: 'linq-thread-1',
          sentAt: '2026-04-08T00:10:00.000Z',
        },
        deliveryDeferred: false,
        deliveryError: null,
        deliveryIntentId: 'intent-1',
        response: 'revised response',
        session: {
          sessionId: 'session-1',
        },
      }
    })

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['linq'],
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
  })

  it('merges multiple pending captureless active-turn admissions before one checkpoint', async () => {
    const initialInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_rapid',
      inputId: 'ain_cccccccccccccccccccccccccccccccc',
      occurredAt: '2026-04-08T00:03:00.000Z',
      receivedAt: '2026-04-08T00:03:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_initial',
        threadId: 'real_thread_initial',
      },
      source: 'linq',
      text: 'initial captureless text',
    })
    const firstLateInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_rapid',
      inputId: 'ain_dddddddddddddddddddddddddddddddd',
      occurredAt: '2026-04-08T00:04:00.000Z',
      receivedAt: '2026-04-08T00:04:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_first',
        threadId: 'real_thread_first',
      },
      source: 'linq',
      text: 'first rapid text',
    })
    const secondLateInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_rapid',
      inputId: 'ain_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      occurredAt: '2026-04-08T00:05:00.000Z',
      receivedAt: '2026-04-08T00:05:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_second',
        threadId: 'real_thread_second',
      },
      source: 'linq',
      text: 'second rapid text',
    })
    const thirdLateInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_rapid',
      inputId: 'ain_ffffffffffffffffffffffffffffffff',
      occurredAt: '2026-04-08T00:06:00.000Z',
      receivedAt: '2026-04-08T00:06:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_third',
        threadId: 'real_thread_third',
      },
      source: 'linq',
      text: 'third rapid text',
    })
    const fourthLateInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_rapid',
      inputId: 'ain_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      occurredAt: '2026-04-08T00:07:00.000Z',
      receivedAt: '2026-04-08T00:07:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_fourth',
        threadId: 'real_thread_fourth',
      },
      source: 'linq',
      text: 'fourth rapid text',
    })
    const fifthLateInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_rapid',
      inputId: 'ain_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      occurredAt: '2026-04-08T00:08:00.000Z',
      receivedAt: '2026-04-08T00:08:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_fifth',
        threadId: 'real_thread_fifth',
      },
      source: 'linq',
      text: 'fifth rapid text',
    })
    const lateInputs = [
      firstLateInput,
      secondLateInput,
      thirdLateInput,
      fourthLateInput,
      fifthLateInput,
    ]
    const listNewConversationInputs = vi.fn(
      async (input: AssistantTurnConversationInputQuery) => {
        expect(input.conversation).toMatchObject({
          source: 'linq',
          threadId: 'hid_thread_rapid',
        })
        expect(input.knownInputIds).toContain(initialInput.event.inputId)
        const nextInput = lateInputs.find(
          (candidate) => !input.knownInputIds?.includes(candidate.event.inputId),
        )
        if (nextInput) {
          return {
            inputs: [nextInput],
            nextCursor: nextInput.event.cursor,
          }
        }

        return {
          inputs: [],
          nextCursor: input.afterCursor ?? null,
        }
      },
    )
    const checkpointAcceptedInput = vi.fn(async () => undefined)
    const inputSource = {
      checkpointAcceptedInput,
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      listNewConversationInputs,
    }
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(initialInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: AssistantActiveTurnInputCheckpointInput) => Promise<void>
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      for (const lateInput of lateInputs) {
        const admission = await input.activeTurnInput?.({
          sessionId: 'session-1',
          turnId: 'turn-1',
          vault: '/tmp/assistant-automation-vault',
        })
        expect(admission).toMatchObject({
          acceptedInputs: [
            expect.objectContaining({
              captureIds: [],
              id: lateInput.event.inputId,
            }),
          ],
          deliveryReplyToMessageId: lateInput.event.replyTarget?.messageId,
          kind: 'accepted',
          prompt: expect.stringContaining(lateInput.event.text ?? ''),
        })
      }

      await input.activeTurnCheckpoint?.({
        acceptedInputIds: lateInputs.map((candidate) => candidate.event.inputId),
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })

      return {
        delivery: {
          channel: 'linq',
          target: 'real_thread_initial',
          sentAt: '2026-04-08T00:10:00.000Z',
        },
        deliveryDeferred: false,
        deliveryError: null,
        deliveryIntentId: 'intent-1',
        response: 'revised response',
        session: {
          sessionId: 'session-1',
        },
      }
    })

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['linq'],
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    expect(listNewConversationInputs).toHaveBeenCalledTimes(5)
    expect(checkpointAcceptedInput).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedInputIds: lateInputs.map((candidate) => candidate.event.inputId),
      }),
    )
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        inputIds: [
          initialInput.event.inputId,
          ...lateInputs.map((candidate) => candidate.event.inputId),
        ],
        outcome: 'result',
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

    const inputSource = {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        const lateInput = assistantInputCandidateFromInboxCapture(lateCapture)
        return {
          inputs: [lateInput],
          nextCursor: lateInput.event.cursor,
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
      inputSource: inputSource,
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
      type: 'input.reply-skipped',
      inputId: expect.stringMatching(/^ain_/u),
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

    const inputSource = {
      async refresh() {
        return {
          progressed: false,
          reason: 'source_unavailable' as const,
        }
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        return {
          inputs: [],
          nextCursor: input.afterCursor ?? null,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      await input.activeTurnInput?.({
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
      inputSource: inputSource,
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
    const inputSource = {
      async refresh() {
        throw sourceUnavailable
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        return {
          inputs: [],
          nextCursor: input.afterCursor ?? null,
        }
      },
    }

    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      await input.activeTurnInput?.({
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
      inputSource: inputSource,
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
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).not.toHaveBeenCalled()
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
    const inputSource = {
      checkpointAcceptedInput,
      async refresh() {
        return {
          progressed: false,
          reason: 'no_new_input' as const,
        }
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        return {
          inputs: [],
          nextCursor: input.afterCursor ?? null,
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
      inputSource: inputSource,
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
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).not.toHaveBeenCalled()
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
    const inputSource = {
      checkpointAcceptedInput,
      async refresh() {
        return {
          progressed: false,
          reason: 'no_new_input' as const,
        }
      },
      async listNewConversationInputs(input: AssistantTurnConversationInputQuery) {
        return {
          inputs: [],
          nextCursor: input.afterCursor ?? null,
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
      inputSource: inputSource,
      vault: '/tmp/assistant-automation-vault',
    })).rejects.toBe(checkpointRejected)

    expect(checkpointAcceptedInput).toHaveBeenCalledTimes(1)
    expect(replyMocks.writeAssistantChatErrorArtifacts).not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence).not.toHaveBeenCalled()
  })

  it('creates a store-backed input source for hosted automation passes', async () => {
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
    expect(runLoopMocks.scanAssistantAutomationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext,
        inputSource: expect.objectContaining({
          listInputCandidates: expect.any(Function),
          listNewConversationInputs: expect.any(Function),
          refresh: expect.any(Function),
        }),
      }),
    )
  })

  it('refreshes assistant input before the normal scanner', async () => {
    const runLoop = await vi.importActual<
      typeof import('../src/assistant/automation/run-loop.ts')
    >('../src/assistant/automation/run-loop.ts')
    const inputSource: AssistantInputSource = {
      listInputCandidates: vi.fn(async () => ({
        inputs: [],
        nextCursor: null,
      })),
      listNewConversationInputs: vi.fn(async () => ({
        inputs: [],
        nextCursor: null,
      })),
      refresh: vi.fn(async () => ({
        progressed: true,
        reason: 'ingested_input' as const,
      })),
    }
    await runLoop.runAssistantAutomationPass({
      inputSource,
      requestId: 'request-input-refresh',
      vault: '/tmp/assistant-automation-vault',
    })

    expect(inputSource.refresh).toHaveBeenCalledWith({
      signal: undefined,
    })
    expect(vi.mocked(inputSource.refresh).mock.invocationCallOrder[0]!)
      .toBeLessThan(
        runLoopMocks.scanAssistantAutomationOnce.mock.invocationCallOrder[0]!,
      )
  })

  it('drops optional hosted dynamic context when the canonical refresh ingests input', async () => {
    const runLoop = await vi.importActual<
      typeof import('../src/assistant/automation/run-loop.ts')
    >('../src/assistant/automation/run-loop.ts')
    const inputSource: AssistantInputSource = {
      listInputCandidates: vi.fn(async () => ({
        inputs: [],
        nextCursor: null,
      })),
      listNewConversationInputs: vi.fn(async () => ({
        inputs: [],
        nextCursor: null,
      })),
      refresh: vi.fn(async () => ({
        progressed: true,
        reason: 'ingested_input' as const,
      })),
    }
    const executionContext = {
      hosted: {
        dynamicContextPrompts: ['Background wearable reconnect context.'],
        memberId: 'member-1',
        userEnvKeys: [],
      },
    }

    await runLoop.runAssistantAutomationPass({
      executionContext,
      inputSource,
      requestId: 'request-context-after-refresh',
      vault: '/tmp/assistant-automation-vault',
    })

    expect(inputSource.refresh).toHaveBeenCalledWith({
      signal: undefined,
    })
    expect(vi.mocked(inputSource.refresh).mock.invocationCallOrder[0]!)
      .toBeLessThan(
        runLoopMocks.scanAssistantAutomationOnce.mock.invocationCallOrder[0]!,
      )
    expect(runLoopMocks.scanAssistantAutomationOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: {
          hosted: {
            memberId: 'member-1',
            userEnvKeys: [],
          },
        },
      }),
    )
  })

  it('keeps fresh hosted queue-only replies on the scanner and outbox path', async () => {
    runLoopMocks.scanAssistantAutomationOnce.mockResolvedValueOnce({
      currentTurnDeliveryIntentIds: [],
      routing: {
        considered: 0,
        failed: 0,
        nextWakeAt: null,
        noAction: 0,
        routed: 0,
        skipped: 0,
      },
      replies: {
        checkpointRequired: true,
        considered: 1,
        failed: 0,
        nextWakeAt: null,
        replied: 1,
        skipped: 0,
      },
    })
    const runLoop = await vi.importActual<
      typeof import('../src/assistant/automation/run-loop.ts')
    >('../src/assistant/automation/run-loop.ts')

    const result = await runLoop.runAssistantAutomationPass({
      deliveryDispatchMode: 'queue-only',
      executionContext: {
        hosted: {
          memberId: 'member-test',
          userEnvKeys: [],
        },
      },
      requestId: 'request-hosted-fresh-reply',
      vault: '/tmp/assistant-automation-vault',
    })

    expect(runLoopMocks.scanAssistantAutomationOnce).toHaveBeenCalledOnce()
    expect(runLoopMocks.drainAssistantOutbox).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      progressed: true,
      replies: {
        checkpointRequired: true,
        considered: 1,
        replied: 1,
      },
    })
  })

  it('does not create reply work from failed receipts when the scanner is idle', async () => {
    runLoopMocks.scanAssistantAutomationOnce.mockResolvedValueOnce({
      currentTurnDeliveryIntentIds: [],
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
    })
    const runLoop = await vi.importActual<
      typeof import('../src/assistant/automation/run-loop.ts')
    >('../src/assistant/automation/run-loop.ts')

    const result = await runLoop.runAssistantAutomationPass({
      deliveryDispatchMode: 'queue-only',
      executionContext: {
        hosted: {
          memberId: 'member-test',
          userEnvKeys: [],
        },
      },
      requestId: 'request-hosted-idle-recovery',
      vault: '/tmp/assistant-automation-vault',
    })

    expect(runLoopMocks.scanAssistantAutomationOnce).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      progressed: false,
      replies: {
        considered: 0,
        replied: 0,
      },
    })
  })

  it('skips status refresh on hosted queue-only automation passes', async () => {
    const runLoop = await vi.importActual<
      typeof import('../src/assistant/automation/run-loop.ts')
    >('../src/assistant/automation/run-loop.ts')
    await runLoop.runAssistantAutomationPass({
      deliveryDispatchMode: 'queue-only',
      executionContext: {
        hosted: {
          memberId: 'member-test',
          userEnvKeys: [],
        },
      },
      requestId: 'request-hosted-queue-only',
      vault: '/tmp/assistant-automation-vault',
    })

    expect(runLoopMocks.refreshAssistantStatusSnapshot).not.toHaveBeenCalled()
  })

  it('defers cron scanning after fresh hosted queue-only replies', async () => {
    runLoopMocks.getAssistantCronStatus.mockResolvedValueOnce({
      nextRunAt: '2026-05-08T16:00:00.000Z',
    })
    const runLoop = await vi.importActual<
      typeof import('../src/assistant/automation/run-loop.ts')
    >('../src/assistant/automation/run-loop.ts')

    const result = await runLoop.runAssistantAutomationPass({
      deliveryDispatchMode: 'queue-only',
      executionContext: {
        hosted: {
          memberId: 'member-test',
          userEnvKeys: [],
        },
      },
      requestId: 'request-hosted-queue-only-cron',
      vault: '/tmp/assistant-automation-vault',
    })

    expect(runLoopMocks.processDueAssistantCronJobs).not.toHaveBeenCalled()
    expect(result.cronProcessed).toBe(0)
    expect(result.nextWakeAt).toBe('2026-05-08T16:00:00.000Z')
  })

  it('schedules hosted cron catch-up when deferred cron is already due', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-08T16:00:00.000Z'))
    try {
      runLoopMocks.getAssistantCronStatus.mockResolvedValueOnce({
        dueJobs: 1,
        nextRunAt: '2026-05-08T15:59:00.000Z',
      })
      const runLoop = await vi.importActual<
        typeof import('../src/assistant/automation/run-loop.ts')
      >('../src/assistant/automation/run-loop.ts')

      const result = await runLoop.runAssistantAutomationPass({
        deliveryDispatchMode: 'queue-only',
        executionContext: {
          hosted: {
            memberId: 'member-test',
            userEnvKeys: [],
          },
        },
        requestId: 'request-hosted-queue-only-due-cron',
        vault: '/tmp/assistant-automation-vault',
      })

      expect(runLoopMocks.processDueAssistantCronJobs).not.toHaveBeenCalled()
      expect(result.cronProcessed).toBe(0)
      expect(result.nextWakeAt).toBe('2026-05-08T16:00:10.000Z')
    } finally {
      vi.useRealTimers()
    }
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
      reason: 'input has no text or attachment context',
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

  it('does not let failed receipts suppress scanner-owned auto-reply work', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const item = createReplyGroupItem(createCaptureSummary({
      captureId: 'capture-retry-cap',
    }))
    const context = reply.createAssistantAutoReplyGroupContext([item])

    if (!context) {
      throw new Error('expected reply context')
    }

    replyMocks.listAssistantTurnReceipts.mockResolvedValue(
      [1, 2, 3].map((attempt) =>
        createTurnReceipt({
          turnId: `turn-retry-cap-${attempt}`,
          primaryCaptureId: 'capture-retry-cap',
          primaryInputId: context.firstInputId,
          inputIds: [context.firstInputId],
        }),
      ),
    )

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
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledOnce()
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        captureIds: ['capture-retry-cap'],
        outcome: 'result',
      }))
  })

  it('repairs handled receipts without treating failed receipts as retry state', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const item = createReplyGroupItem(createCaptureSummary({
      captureId: 'capture-retry-cap-handled',
    }))
    const context = reply.createAssistantAutoReplyGroupContext([item])

    if (!context) {
      throw new Error('expected reply context')
    }

    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        turnId: 'turn-retry-cap-handled-success',
        primaryCaptureId: 'capture-retry-cap-handled',
        primaryInputId: context.firstInputId,
        inputIds: [context.firstInputId],
        status: 'completed',
      }),
      ...[1, 2, 3].map((attempt) =>
        createTurnReceipt({
          turnId: `turn-retry-cap-handled-failed-${attempt}`,
          primaryCaptureId: 'capture-retry-cap-handled',
          primaryInputId: context.firstInputId,
          inputIds: [context.firstInputId],
        }),
      ),
    ])

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
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        captureIds: ['capture-retry-cap-handled'],
        inputIds: [context.firstInputId],
        outcome: 'result',
      }))
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
  })

  it('ignores failed receipt retry metadata when scanner owns retry', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const item = createReplyGroupItem(createCaptureSummary({
      captureId: 'capture-persisted-retry-delay',
    }))
    const context = reply.createAssistantAutoReplyGroupContext([item])

    if (!context) {
      throw new Error('expected reply context')
    }

    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        completedAt: '2026-04-08T00:00:05.000Z',
        inputIds: [context.firstInputId],
        primaryCaptureId: 'capture-persisted-retry-delay',
        primaryInputId: context.firstInputId,
        turnId: 'turn-persisted-retry-delay',
        updatedAt: '2026-04-08T00:00:05.000Z',
        timeline: [
          {
            at: '2026-04-08T00:00:00.000Z',
            detail: null,
            kind: 'turn.started',
            metadata: {
              autoReplyInputId: context.firstInputId,
              autoReplyInputIds: context.firstInputId,
              autoReplyCaptureId: 'capture-persisted-retry-delay',
              autoReplyCaptureIds: 'capture-persisted-retry-delay',
            },
          },
          {
            at: '2026-04-08T00:00:05.000Z',
            detail: 'rate limited',
            kind: 'turn.completed',
            metadata: {
              autoReplyRetryAt: '2026-04-08T00:05:00.000Z',
            },
          },
        ],
      }),
    ])

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
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(replyMocks.prepareAssistantAutoReplyInput).toHaveBeenCalledOnce()
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledOnce()
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        captureIds: ['capture-persisted-retry-delay'],
        outcome: 'result',
      }))
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence)
      .not.toHaveBeenCalled()
  })

  it('repairs handled receipts even when a newer failed receipt exists', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const item = createReplyGroupItem(createCaptureSummary({
      captureId: 'capture-persisted-retry-due',
    }))
    const context = reply.createAssistantAutoReplyGroupContext([item])

    if (!context) {
      throw new Error('expected reply context')
    }

    replyMocks.listAssistantTurnReceipts.mockResolvedValue([
      createTurnReceipt({
        completedAt: '2026-04-08T00:00:04.000Z',
        inputIds: [context.firstInputId],
        primaryCaptureId: 'capture-persisted-retry-due',
        primaryInputId: context.firstInputId,
        status: 'completed',
        turnId: 'turn-persisted-retry-due-old-handled',
        updatedAt: '2026-04-08T00:00:04.000Z',
      }),
      createTurnReceipt({
        completedAt: '2026-04-08T00:00:05.000Z',
        inputIds: [context.firstInputId],
        primaryCaptureId: 'capture-persisted-retry-due',
        primaryInputId: context.firstInputId,
        turnId: 'turn-persisted-retry-due',
        updatedAt: '2026-04-08T00:00:05.000Z',
        timeline: [
          {
            at: '2026-04-08T00:00:00.000Z',
            detail: null,
            kind: 'turn.started',
            metadata: {
              autoReplyInputId: context.firstInputId,
              autoReplyInputIds: context.firstInputId,
              autoReplyCaptureId: 'capture-persisted-retry-due',
              autoReplyCaptureIds: 'capture-persisted-retry-due',
            },
          },
          {
            at: '2026-04-08T00:00:05.000Z',
            detail: 'rate limited',
            kind: 'turn.completed',
            metadata: {
              autoReplyRetryAt: '2026-04-08T00:05:00.000Z',
            },
          },
        ],
      }),
    ])

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
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        captureIds: ['capture-persisted-retry-due'],
        inputIds: [context.firstInputId],
        outcome: 'result',
      }))
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

  it('skips recent self-authored assistant echoes when the provider timestamp precedes the transcript write', async () => {
    replyMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:00:01.000Z',
        sessionId: 'session-echo',
      },
    })
    replyMocks.listAssistantTranscriptEntries.mockResolvedValue([
      createTranscriptEntry({
        createdAt: '2026-04-08T00:00:01.000Z',
        text: 'same text',
      }),
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            actorIsSelf: true,
            occurredAt: '2026-04-08T00:00:00.000Z',
            source: 'linq',
            text: 'same text',
            threadId: 'thread-1',
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
          occurredAt: '2026-04-08T00:00:00.000Z',
          source: 'linq',
          text: 'same text',
          threadId: 'thread-1',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: true,
      context,
      enabledChannels: ['linq'],
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
    expect(replyMocks.prepareAssistantAutoReplyInput).toHaveBeenCalledOnce()
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
  })

  it('replies to self-authored text that only matches an older transcript entry', async () => {
    replyMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:00:04.000Z',
        sessionId: 'session-echo-multiple',
      },
    })
    replyMocks.listAssistantTranscriptEntries.mockResolvedValue([
      createTranscriptEntry({
        createdAt: '2026-04-08T00:00:01.000Z',
        text: 'first reminder',
      }),
      createTranscriptEntry({
        createdAt: '2026-04-08T00:00:04.000Z',
        text: 'second reminder',
      }),
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            actorIsSelf: true,
            occurredAt: '2026-04-08T00:00:05.000Z',
            source: 'linq',
            text: 'first reminder',
            threadId: 'thread-1',
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
          occurredAt: '2026-04-08T00:00:05.000Z',
          source: 'linq',
          text: 'first reminder',
          threadId: 'thread-1',
        }),
      ),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: true,
      context,
      enabledChannels: ['linq'],
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
    expect(replyMocks.prepareAssistantAutoReplyInput).toHaveBeenCalledOnce()
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledOnce()
  })

  it('suppresses self-authored echoes from confirmed cross-session outbox history', async () => {
    replyMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:00:00.000Z',
        sessionId: 'session-chat',
      },
    })
    replyMocks.listAssistantOutboxIntents.mockResolvedValue([
      createSentOutboxIntent({
        channel: 'linq',
        intentId: 'intent-old-provider-id',
        message: 'older provider-id message',
        providerMessageId: 'linq-old-message-id',
        sentAt: '2026-04-08T00:01:00.000Z',
        sessionId: 'session-old',
      }),
      createSentOutboxIntent({
        channel: 'linq',
        message: 'same text',
        sentAt: '2026-04-08T00:02:01.000Z',
        sessionId: 'session-automation',
      }),
    ])
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            actorIsSelf: true,
            externalId: 'linq:linq-new-message-id',
            occurredAt: '2026-04-08T00:02:00.000Z',
            source: 'linq',
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
          externalId: 'linq:linq-new-message-id',
          occurredAt: '2026-04-08T00:02:00.000Z',
          source: 'linq',
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
      enabledChannels: ['linq'],
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
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
  })

  it('suppresses Linq self-authored echoes by provider message id after thread materialization', async () => {
    replyMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      session: {
        lastTurnAt: '2026-04-08T00:00:00.000Z',
        sessionId: 'session-chat',
      },
    })
    replyMocks.listAssistantOutboxIntents.mockResolvedValue([
      createSentOutboxIntent({
        actorId: null,
        channel: 'linq',
        identityId: null,
        message: 'provider-id matched assistant delivery',
        providerMessageId: 'linq-assistant-message-1',
        providerThreadId: 'raw-linq-chat-1',
        sentAt: '2026-04-08T00:02:01.000Z',
        sessionId: 'session-automation',
        target: 'raw-linq-chat-1',
        threadId: null,
      }),
    ])
    const candidate = createCapturelessAssistantInputCandidate({
      actorIsSelf: true,
      conversationThreadId: 'lid_linq_chat_1',
      inputId: 'ain_linq_echo_1',
      occurredAt: '2026-04-08T00:02:00.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'linq-assistant-message-1',
        threadId: 'raw-linq-chat-1',
      },
      source: 'linq',
      text: 'scheduled prompt',
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(candidate),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: true,
      context,
      enabledChannels: ['linq'],
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
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
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

  it('uses the staged assistant input when projected captures can no longer be loaded', async () => {
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
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(inboxServices.show).not.toHaveBeenCalled()
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

  it('uses the captureless assistant input reply target for the initial auto-reply route', async () => {
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_initial',
      inputId: 'ain_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      occurredAt: '2026-04-08T00:04:00.000Z',
      receivedAt: '2026-04-08T00:04:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_initial',
        threadId: 'real_thread_initial',
      },
      source: 'linq',
      text: 'captureless initial text',
    })
    const listNewConversationInputs = vi.fn(
      async (input: AssistantTurnConversationInputQuery) => {
        expect(input.conversation).toMatchObject({
          source: 'linq',
          threadId: 'hid_thread_initial',
        })
        return {
          inputs: [],
          nextCursor: input.afterCursor ?? null,
        }
      },
    )
    const inputSource = {
      async refresh() {
        return {
          progressed: false,
          reason: 'no_new_input' as const,
        }
      },
      listNewConversationInputs,
    }
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      const admitted = await input.activeTurnInput?.({
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      expect(admitted).toEqual({
        kind: 'no-new-input',
      })
      return {
        delivery: {
          channel: 'linq',
          target: 'real_thread_initial',
          sentAt: '2026-04-08T00:10:00.000Z',
        },
        deliveryDeferred: false,
        deliveryError: null,
        deliveryIntentId: 'intent-1',
        response: 'response text',
        session: {
          sessionId: 'session-1',
        },
      }
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['linq'],
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replied).toBe(1)
    expect(listNewConversationInputs).toHaveBeenCalledTimes(1)
    expect(inboxServices.show).not.toHaveBeenCalled()
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: 'real_thread_initial',
        conversation: expect.objectContaining({
          threadId: 'hid_thread_initial',
        }),
        deliveryTarget: 'real_thread_initial',
        deliveryReplyToMessageId: 'real_msg_initial',
      }),
    )
    expect(replyMocks.sendAssistantMessage.mock.calls[0]?.[0]).not.toHaveProperty('threadId')
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          linqMessageIds: ['real_msg_initial'],
          outcome: 'result',
        }),
      )
  })

  it('does not re-admit foreground replay route input during active-turn checks', async () => {
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_telegram_initial',
      inputId: 'ain_babababababababababababababababa',
      occurredAt: '2026-04-08T00:04:00.000Z',
      receivedAt: '2026-04-08T00:04:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: '7001234567',
        threadId: '6001234567',
      },
      source: 'telegram',
      text: 'captureless telegram initial text',
    })
    const listNewConversationInputs = vi.fn(
      async (input: AssistantTurnConversationInputQuery) => {
        expect(input.knownInputIds).toContain(hostedInput.event.inputId)
        return {
          inputs: [],
          nextCursor: input.afterCursor ?? null,
        }
      },
    )
    const listInputCandidates = vi.fn(async () => ({
      inputs: [hostedInput],
      nextCursor: hostedInput.event.cursor,
    }))
    const inputSource = {
      async refresh() {
        return {
          progressed: false,
          reason: 'no_new_input' as const,
        }
      },
      listInputCandidates,
      listNewConversationInputs,
    }
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnInput?: (admission: {
        phase: 'input_available' | 'request_boundary' | 'commit_barrier'
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      const admitted = await input.activeTurnInput?.({
        phase: 'request_boundary',
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      expect(admitted).toEqual({
        kind: 'no-new-input',
      })
      return {
        delivery: {
          channel: 'telegram',
          target: '6001234567',
          sentAt: '2026-04-08T00:10:00.000Z',
        },
        deliveryDeferred: false,
        deliveryError: null,
        deliveryIntentId: 'intent-1',
        response: 'response text',
        session: {
          sessionId: 'session-1',
        },
      }
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result.replied).toBe(1)
    expect(listNewConversationInputs).toHaveBeenCalledTimes(1)
    expect(listInputCandidates).toHaveBeenCalledTimes(1)
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'telegram',
        bindingDeliveryTarget: '6001234567',
        conversation: expect.objectContaining({
          threadId: 'hid_thread_telegram_initial',
        }),
        deliveryTarget: '6001234567',
        deliveryReplyToMessageId: '7001234567',
      }),
    )
  })

  it('suppresses hosted Telegram auto-replies without a provider delivery target', async () => {
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_missing_route',
      inputId: 'ain_cccccccccccccccccccccccccccccccc',
      occurredAt: '2026-04-08T00:04:00.000Z',
      receivedAt: '2026-04-08T00:04:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'hbid:telegram:message',
        threadId: 'hbid:telegram:thread',
      },
      source: 'telegram',
      text: 'captureless telegram missing route text',
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['telegram'],
      executionContext: {
        hosted: {
          memberId: 'member_telegram_route_guard',
          userEnvKeys: [],
        },
      },
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          inputIds: [hostedInput.event.inputId],
          reason: 'hosted Telegram auto-reply is missing a provider delivery target',
        }),
      )
  })

  it('admits captureless active-turn input by delivery route when projection uses a different conversation id', async () => {
    const initialCapture = createCaptureSummary({
      captureId: 'capture-projected-initial',
      occurredAt: '2026-04-08T00:03:00.000Z',
      receivedAt: '2026-04-08T00:03:01.000Z',
      source: 'linq',
      text: 'projected initial text',
      threadId: 'real_thread_initial',
    })
    const projectedInitialCandidate = assistantInputCandidateFromInboxCapture(
      initialCapture,
    )
    const initialInput: AssistantInputCandidate = {
      ...projectedInitialCandidate,
      event: {
        ...projectedInitialCandidate.event,
        replyTarget: {
          channel: 'linq',
          messageId: 'real_msg_initial',
          threadId: 'real_thread_initial',
        },
      },
    }
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_late',
      inputId: 'ain_abababababababababababababababab',
      occurredAt: '2026-04-08T00:04:00.000Z',
      receivedAt: '2026-04-08T00:04:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_late',
        threadId: 'real_thread_initial',
      },
      source: 'linq',
      text: 'late captureless route text',
    })
    const listNewConversationInputs = vi.fn(
      async (input: AssistantTurnConversationInputQuery) => {
        expect(input.conversation).toMatchObject({
          source: 'linq',
          threadId: 'real_thread_initial',
        })
        return {
          inputs: [],
          nextCursor: input.afterCursor ?? null,
        }
      },
    )
    const listInputCandidates = vi.fn(async (input: {
      sourceId?: string | null
    }) => {
      expect(input.sourceId).toBe('linq')
      return {
        inputs: [hostedInput],
        nextCursor: hostedInput.event.cursor,
      }
    })
    const checkpointAcceptedInput = vi.fn(async () => undefined)
    const inputSource = {
      checkpointAcceptedInput,
      listInputCandidates,
      listNewConversationInputs,
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
    }
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: AssistantActiveTurnInputCheckpointInput) => Promise<void>
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      const admitted = await input.activeTurnInput?.({
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      expect(admitted).toMatchObject({
        acceptedInputs: [
          expect.objectContaining({
            captureIds: [],
            id: hostedInput.event.inputId,
          }),
        ],
        deliveryTarget: 'real_thread_initial',
        deliveryReplyToMessageId: 'real_msg_late',
        kind: 'accepted',
        prompt: expect.stringContaining('late captureless route text'),
      })
      await input.activeTurnCheckpoint?.({
        acceptedInputIds: [hostedInput.event.inputId],
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      return {
        delivery: {
          channel: 'linq',
          target: 'real_thread_initial',
          sentAt: '2026-04-08T00:10:00.000Z',
        },
        deliveryDeferred: false,
        deliveryError: null,
        deliveryIntentId: 'intent-1',
        response: 'response text',
        session: {
          sessionId: 'session-1',
        },
      }
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const initialItem = createReplyGroupItem(initialCapture)
    const context = reply.createAssistantAutoReplyGroupContext([
      {
        ...initialItem,
        inputCandidate: initialInput,
      },
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['linq'],
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    expect(listNewConversationInputs).toHaveBeenCalledTimes(1)
    expect(listInputCandidates).toHaveBeenCalledTimes(1)
    expect(checkpointAcceptedInput).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedInputIds: [hostedInput.event.inputId],
      }),
    )
    expect(inboxServices.show).not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          inputIds: [initialInput.event.inputId, hostedInput.event.inputId],
          linqMessageIds: ['real_msg_initial', 'real_msg_late'],
          outcome: 'result',
        }),
      )
  })

  it('ignores captureless assistant input reply targets from another channel', async () => {
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_mismatch',
      inputId: 'ain_99999999999999999999999999999999',
      occurredAt: '2026-04-08T00:05:00.000Z',
      receivedAt: '2026-04-08T00:05:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'wrong_msg_initial',
        threadId: 'wrong_thread_initial',
      },
      source: 'linq',
      text: 'captureless mismatched target text',
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
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
    expect(inboxServices.show).not.toHaveBeenCalled()
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryTarget: null,
        deliveryReplyToMessageId: null,
      }),
    )
  })

  it('uses event-owned attachment evidence for hosted assistant input prompts', async () => {
    const optionalInboxCaptureId = 'cap_projected_attachment'
    const baseHostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'hid_thread_projected',
      inputId: 'ain_abcdabcdabcdabcdabcdabcdabcdabcd',
      occurredAt: '2026-04-08T00:04:00.000Z',
      receivedAt: '2026-04-08T00:04:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_projected',
        threadId: 'real_thread_projected',
      },
      source: 'linq',
      text: 'Received a Linq message with 1 attachment.',
    })
    const hostedInput: AssistantInputCandidate = {
      ...baseHostedInput,
      acceptedInput: {
        ...baseHostedInput.acceptedInput,
        captureIds: [optionalInboxCaptureId],
      },
      event: {
        ...baseHostedInput.event,
        attachmentCount: 1,
        attachmentDescriptors: [
          {
            attachmentId: 'safe_attachment_descriptor',
            contentType: 'application/pdf',
            fileName: null,
            kind: 'document',
            sizeBytes: 128,
          },
        ],
        attachmentEvidence: {
          attachments: [
            {
              byteSize: 128,
              derived: null,
              descriptorAttachmentId: 'safe_attachment_descriptor',
              fileName: 'lab-results.pdf',
              inlineFragments: [],
              kind: 'document',
              mime: 'application/pdf',
              ordinal: 1,
              parseState: 'succeeded',
              raw: {
                byteSize: 128,
                kind: 'vault-relative-file',
                mediaType: 'application/pdf',
                path: 'raw/inbox/linq/cap_projected_attachment/attachments/lab-results.pdf',
                sha256: null,
              },
              sourceAttachmentId: 'attachment-1',
            },
          ],
          optionalInboxCaptureId,
          reasonCode: null,
          source: 'hosted-inbox-projection',
          status: 'available',
          updatedAt: '2026-04-08T00:04:02.000Z',
        },
      },
      projection: {
        captureId: optionalInboxCaptureId,
        reasonCode: null,
        status: 'succeeded',
      },
    }
    const show = vi.fn()
    const inboxServices = createInboxServices({
      show,
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const groupItem = createCapturelessReplyGroupItem(hostedInput)
    const context = reply.createAssistantAutoReplyGroupContext([
      {
        ...groupItem,
        summary: {
          ...groupItem.summary,
          optionalInboxCaptureId,
        },
      },
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
    expect(show).not.toHaveBeenCalled()
    expect(replyMocks.prepareAssistantAutoReplyInput).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          attachmentDescriptors: hostedInput.event.attachmentDescriptors,
          attachmentEvidence: expect.objectContaining({
            attachments: hostedInput.event.attachmentEvidence.attachments,
            optionalInboxCaptureId,
          }),
          projection: expect.objectContaining({
            optionalInboxCaptureId,
            reasonCode: null,
            status: 'succeeded',
          }),
        }),
      ],
      '/tmp/assistant-automation-vault',
    )
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingDeliveryTarget: 'real_thread_projected',
        conversation: expect.objectContaining({
          threadId: 'hid_thread_projected',
        }),
        deliveryTarget: 'real_thread_projected',
        deliveryReplyToMessageId: 'real_msg_projected',
      }),
    )
  })

  it('uses deterministic hosted delivery idempotency keys for replayed hosted auto-replies', async () => {
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_replay',
      inputId: 'ain_11111111111111111111111111111111',
      mailboxRow: {
        dedupeKey: 'dedupe_replay',
        eventId: 'event_replay',
        hostedMailboxItemId: 'raw_mailbox_item_replay',
        itemId: 'raw_mailbox_item_replay',
        laneSeq: '42',
        sourceRefItemId: 'blinded_mailbox_item_replay',
      },
      occurredAt: '2026-04-08T00:07:00.000Z',
      receivedAt: '2026-04-08T00:07:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_replay',
        threadId: 'real_thread_replay',
      },
      source: 'linq',
      text: 'captureless replay text',
    })
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const withoutMailboxProofInput: AssistantInputCandidate = {
      ...hostedInput,
      event: {
        ...hostedInput.event,
        hostedMailboxItemId: null,
      },
    }
    const withoutMailboxProofContext = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(withoutMailboxProofInput),
    ])
    if (!withoutMailboxProofContext) {
      throw new Error('expected reply context without mailbox proof')
    }

    await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context: withoutMailboxProofContext,
      enabledChannels: ['linq'],
      executionContext: {
        hosted: {
          memberId: 'member_replay',
          userEnvKeys: [],
        },
      },
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })
    const withoutProofSend = replyMocks.sendAssistantMessage.mock.calls[0]?.[0]
    const withoutProofKey = withoutProofSend?.deliveryIdempotencyKey
    expect(withoutProofKey).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(withoutProofSend?.hostedDeliveryIdempotency).toBeNull()

    replyMocks.sendAssistantMessage.mockClear()
    await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['linq'],
      executionContext: {
        hosted: {
          memberId: 'member_replay',
          userEnvKeys: [],
        },
      },
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })
    const firstSend = replyMocks.sendAssistantMessage.mock.calls[0]?.[0]
    const firstKey = firstSend?.deliveryIdempotencyKey

    expect(firstKey).toBe(withoutProofKey)

    replyMocks.sendAssistantMessage.mockClear()
    await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['linq'],
      executionContext: {
        hosted: {
          memberId: 'member_replay',
          userEnvKeys: [],
        },
      },
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })
    const replaySend = replyMocks.sendAssistantMessage.mock.calls[0]?.[0]
    const replayKey = replaySend?.deliveryIdempotencyKey

    expect(firstKey).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(replayKey).toBe(firstKey)
    expect(firstSend?.hostedDeliveryIdempotency?.inboundMailboxItemIds).toEqual([
      'raw_mailbox_item_replay',
    ])
    expect(replaySend?.hostedDeliveryIdempotency?.inboundMailboxItemIds).toEqual([
      'raw_mailbox_item_replay',
    ])
    expect(hostedInput.event.sourceRef).toMatchObject({
      itemId: 'blinded_mailbox_item_replay',
      kind: 'hosted-mailbox',
    })
  })

  it.each([
    [
      'linq',
      {
        conversationThreadId: 'safe_thread_replayed_linq_rows',
        replyTarget: {
          channel: 'linq',
          messageId: 'linq_msg_replayed_row_002',
          threadId: 'linq_thread_replayed_rows',
        },
        source: 'linq',
      },
    ],
    [
      'email',
      {
        conversationThreadId: 'safe_thread_replayed_email_rows',
        replyTarget: {
          channel: 'email',
          messageId: '<email-msg-replayed-row-002@example.test>',
          threadId: serializeHostedEmailThreadTarget({
            lastMessageId: '<email-msg-replayed-row-002@example.test>',
            references: ['<email-msg-replayed-root@example.test>'],
            subject: 'Replay rows',
            to: ['sender@example.test'],
          }),
        },
        source: 'email',
      },
    ],
  ] as const)(
    'uses durable hosted mailbox rows for replayed %s delivery idempotency after local-state loss',
    async (_channel, fixture) => {
      const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
        '../src/assistant/automation/reply.ts',
      )
      const mailboxRows = [
        {
          dedupeKey: 'durable_dedupe_replayed_row_001',
          eventId: 'durable_event_replayed_row_001',
          itemId: 'durable_mailbox_item_replayed_row_001',
          laneSeq: '51',
          sourceRefItemId: 'blinded_mailbox_item_replayed_row_001',
        },
        {
          dedupeKey: 'durable_dedupe_replayed_row_002',
          eventId: 'durable_event_replayed_row_002',
          itemId: 'durable_mailbox_item_replayed_row_002',
          laneSeq: '52',
          sourceRefItemId: 'blinded_mailbox_item_replayed_row_002',
        },
      ]

      const readDeliveryKey = async (localInputIds: readonly [string, string]) => {
        replyMocks.sendAssistantMessage.mockClear()
        const candidates = mailboxRows.map((mailboxRow, index) =>
          createCapturelessAssistantInputCandidate({
            conversationThreadId: fixture.conversationThreadId,
            inputId: localInputIds[index]!,
            mailboxRow,
            occurredAt: `2026-04-08T00:1${index}:00.000Z`,
            receivedAt: `2026-04-08T00:1${index}:01.000Z`,
            replyTarget: fixture.replyTarget,
            source: fixture.source,
            text: `replayed ${fixture.source} row ${index + 1}`,
          })
        )
        const context = reply.createAssistantAutoReplyGroupContext(
          candidates.map(createCapturelessReplyGroupItem),
        )
        if (!context) {
          throw new Error('expected mailbox group context')
        }

        await reply.processAssistantAutoReplyGroup({
          allowSelfAuthored: false,
          context,
          enabledChannels: [fixture.source],
          executionContext: {
            hosted: {
              memberId: 'member_replayed_rows',
              userEnvKeys: [],
            },
          },
          inboxServices: createInboxServices({
            show: vi.fn(),
          }),
          requestId: null,
          sessionMaxAgeMs: null,
          vault: '/tmp/assistant-automation-vault',
        })

        const sendInput = replyMocks.sendAssistantMessage.mock.calls[0]?.[0]
        const key = sendInput?.deliveryIdempotencyKey
        if (typeof key !== 'string') {
          throw new Error('expected hosted delivery idempotency key')
        }
        expect(
          sendInput?.hostedDeliveryIdempotency?.inboundMailboxItemIds,
        ).toEqual([
          'durable_mailbox_item_replayed_row_001',
          'durable_mailbox_item_replayed_row_002',
        ])
        return key
      }

      const firstImportKey = await readDeliveryKey([
        'ain_replayfirst000000000000000001',
        'ain_replayfirst000000000000000002',
      ])
      const afterLocalStateLossKey = await readDeliveryKey([
        'ain_replaysecond00000000000000001',
        'ain_replaysecond00000000000000002',
      ])

      expect(firstImportKey).toMatch(/^sha256:[0-9a-f]{64}$/u)
      expect(afterLocalStateLossKey).toBe(firstImportKey)
    },
  )

  it('changes hosted delivery idempotency keys when route dimensions change', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const readDeliveryKey = async (
      candidate: AssistantInputCandidate,
      enabledChannels: readonly string[],
    ): Promise<string> => {
      replyMocks.sendAssistantMessage.mockClear()
      const context = reply.createAssistantAutoReplyGroupContext([
        createCapturelessReplyGroupItem(candidate),
      ])
      if (!context) {
        throw new Error('expected reply context')
      }
      await reply.processAssistantAutoReplyGroup({
        allowSelfAuthored: false,
        context,
        enabledChannels,
        executionContext: {
          hosted: {
            memberId: 'member_variation',
            userEnvKeys: [],
          },
        },
        inboxServices: createInboxServices({
          show: vi.fn(),
        }),
        requestId: null,
        sessionMaxAgeMs: null,
        vault: '/tmp/assistant-automation-vault',
      })
      const key = replyMocks.sendAssistantMessage.mock.calls[0]?.[0]
        ?.deliveryIdempotencyKey
      if (typeof key !== 'string') {
        throw new Error('expected hosted delivery idempotency key')
      }
      return key
    }

    const base = await readDeliveryKey(
      createCapturelessAssistantInputCandidate({
        conversationThreadId: 'safe_thread_base',
        inputId: 'ain_22222222222222222222222222222222',
        occurredAt: '2026-04-08T00:08:00.000Z',
        receivedAt: '2026-04-08T00:08:01.000Z',
        replyTarget: {
          channel: 'linq',
          messageId: 'real_msg_base',
          threadId: 'real_thread_base',
        },
        source: 'linq',
        text: 'base text',
      }),
      ['linq'],
    )

    const changedRecipient = await readDeliveryKey(
      createCapturelessAssistantInputCandidate({
        conversationThreadId: 'safe_thread_base',
        inputId: 'ain_22222222222222222222222222222222',
        occurredAt: '2026-04-08T00:08:00.000Z',
        receivedAt: '2026-04-08T00:08:01.000Z',
        replyTarget: {
          channel: 'linq',
          messageId: 'real_msg_base',
          threadId: 'real_thread_other',
        },
        source: 'linq',
        text: 'base text',
      }),
      ['linq'],
    )
    const changedChannel = await readDeliveryKey(
      createCapturelessAssistantInputCandidate({
        conversationThreadId: 'safe_thread_base',
        inputId: 'ain_22222222222222222222222222222222',
        occurredAt: '2026-04-08T00:08:00.000Z',
        receivedAt: '2026-04-08T00:08:01.000Z',
        replyTarget: {
          channel: 'telegram',
          messageId: 'real_msg_base',
          threadId: 'real_thread_base',
        },
        source: 'telegram',
        text: 'base text',
      }),
      ['telegram'],
    )
    const changedConversation = await readDeliveryKey(
      createCapturelessAssistantInputCandidate({
        conversationThreadId: 'safe_thread_other',
        inputId: 'ain_22222222222222222222222222222222',
        occurredAt: '2026-04-08T00:08:00.000Z',
        receivedAt: '2026-04-08T00:08:01.000Z',
        replyTarget: {
          channel: 'linq',
          messageId: 'real_msg_base',
          threadId: 'real_thread_base',
        },
        source: 'linq',
        text: 'base text',
      }),
      ['linq'],
    )
    const changedInbound = await readDeliveryKey(
      createCapturelessAssistantInputCandidate({
        conversationThreadId: 'safe_thread_base',
        inputId: 'ain_33333333333333333333333333333333',
        occurredAt: '2026-04-08T00:08:00.000Z',
        receivedAt: '2026-04-08T00:08:01.000Z',
        replyTarget: {
          channel: 'linq',
          messageId: 'real_msg_base',
          threadId: 'real_thread_base',
        },
        source: 'linq',
        text: 'base text',
      }),
      ['linq'],
    )

    expect(new Set([
      base,
      changedRecipient,
      changedChannel,
      changedConversation,
      changedInbound,
    ]).size).toBe(5)
  })

  it('recomputes hosted delivery idempotency keys after active-turn hosted input admission', async () => {
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const initialInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_active',
      inputId: 'ain_44444444444444444444444444444444',
      mailboxRow: {
        dedupeKey: 'dedupe_active_initial',
        eventId: 'event_active_initial',
        itemId: 'raw_mailbox_item_active_initial',
        laneSeq: '42',
        sourceRefItemId: 'blinded_mailbox_item_active_initial',
      },
      occurredAt: '2026-04-08T00:09:00.000Z',
      receivedAt: '2026-04-08T00:09:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_active_initial',
        threadId: 'real_thread_active',
      },
      source: 'linq',
      text: 'initial hosted text',
    })
    const lateInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_active',
      inputId: 'ain_55555555555555555555555555555555',
      mailboxRow: {
        dedupeKey: 'dedupe_active_late',
        eventId: 'event_active_late',
        itemId: 'raw_mailbox_item_active_late',
        laneSeq: '43',
        sourceRefItemId: 'blinded_mailbox_item_active_late',
      },
      occurredAt: '2026-04-08T00:09:10.000Z',
      receivedAt: '2026-04-08T00:09:11.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_active_late',
        threadId: 'real_thread_active',
      },
      source: 'linq',
      text: 'late hosted text',
    })
    const executionContext = {
      hosted: {
        memberId: 'member_active_replay',
        userEnvKeys: [],
      },
    }
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const activeTurnContext = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(initialInput),
      createCapturelessReplyGroupItem(lateInput),
    ])
    if (!activeTurnContext) {
      throw new Error('expected active-turn group context')
    }

    await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context: activeTurnContext,
      enabledChannels: ['linq'],
      executionContext,
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })
    const replayKey = replyMocks.sendAssistantMessage.mock.calls[0]?.[0]
      ?.deliveryIdempotencyKey
    if (typeof replayKey !== 'string') {
      throw new Error('expected replay delivery idempotency key')
    }

    replyMocks.sendAssistantMessage.mockClear()
    replyMocks.sendAssistantMessage.mockImplementation(
      async (input: {
        activeTurnInput?: (
          value: {
            sessionId: string
            turnId: string
            vault: string
          }
        ) => Promise<
          | { kind: 'no-new-input' }
          | {
              deliveryIdempotencyKey?: string | null
              hostedDeliveryIdempotency?: {
                inboundMailboxItemIds?: readonly string[] | null
              } | null
              kind: 'accepted'
            }
        >
        deliveryIdempotencyKey?: string | null
        hostedDeliveryIdempotency?: {
          inboundMailboxItemIds?: readonly string[] | null
        } | null
      }) => {
        expect(input.deliveryIdempotencyKey).toMatch(/^sha256:[0-9a-f]{64}$/u)
        expect(input.deliveryIdempotencyKey).not.toBe(replayKey)
        expect(input.hostedDeliveryIdempotency?.inboundMailboxItemIds).toEqual([
          'raw_mailbox_item_active_initial',
        ])
        const admitted = await input.activeTurnInput?.({
          sessionId: 'session-1',
          turnId: 'turn-1',
          vault: '/tmp/assistant-automation-vault',
        })
        if (admitted?.kind !== 'accepted') {
          throw new Error('expected active input admission')
        }
        expect(admitted.deliveryIdempotencyKey).toBe(replayKey)
        expect(admitted.hostedDeliveryIdempotency?.inboundMailboxItemIds).toEqual([
          'raw_mailbox_item_active_initial',
          'raw_mailbox_item_active_late',
        ])
        return {
          delivery: {
            channel: 'linq',
            target: 'target-1',
            sentAt: '2026-04-08T00:10:00.000Z',
          },
          deliveryDeferred: false,
          deliveryError: null,
          deliveryIntentId: 'intent-1',
          response: 'response with late input',
          session: {
            sessionId: 'session-1',
          },
        }
      },
    )
    const initialContext = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(initialInput),
    ])
    if (!initialContext) {
      throw new Error('expected initial context')
    }
    const inputSource = {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
      async listNewConversationInputs() {
        return {
          inputs: [lateInput],
          nextCursor: lateInput.event.cursor,
        }
      },
    }

    await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context: initialContext,
      enabledChannels: ['linq'],
      executionContext,
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })
  })

  it.each([
    [
      'assistant input id',
      'ain_0123456789abcdef0123456789abcdef',
      'ain_11111111111111111111111111111111',
    ],
    [
      'hashed identity id',
      'hid_0123456789abcdef',
      'ain_22222222222222222222222222222222',
    ],
    [
      'hashed blind id',
      'hbid:linq.message:v1:opaque',
      'ain_33333333333333333333333333333333',
    ],
    [
      'hashed blind index id',
      'hbidx:linq.message:v1:opaque',
      'ain_44444444444444444444444444444444',
    ],
    [
      'provider-prefixed assistant input id',
      'linq:ain_0123456789abcdef0123456789abcdef',
      'ain_55555555555555555555555555555555',
    ],
    [
      'provider-prefixed hashed identity id',
      'linq:hid_0123456789abcdef',
      'ain_66666666666666666666666666666666',
    ],
    [
      'provider-prefixed hashed blind id',
      'linq:hbid:linq.message:v1:opaque',
      'ain_77777777777777777777777777777777',
    ],
    [
      'provider-prefixed hashed blind index id',
      'linq:hbidx:linq.message:v1:opaque',
      'ain_78787878787878787878787878787878',
    ],
  ])('ignores %s captureless replyTarget values for delivery', async (
    _label,
    routeValue,
    inputId,
  ) => {
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_minimized',
      inputId,
      occurredAt: '2026-04-08T00:06:00.000Z',
      receivedAt: '2026-04-08T00:06:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: routeValue,
        threadId: routeValue,
      },
      source: 'linq',
      text: 'captureless minimized target text',
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
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

    const messageInput = replyMocks.sendAssistantMessage.mock.calls[0]?.[0]
    expect(result.replied).toBe(1)
    expect(inboxServices.show).not.toHaveBeenCalled()
    expect(messageInput).toEqual(
      expect.objectContaining({
        conversation: expect.objectContaining({
          threadId: 'safe_thread_minimized',
        }),
        deliveryReplyToMessageId: null,
        deliveryTarget: null,
      }),
    )
    expect(messageInput).not.toEqual(
      expect.objectContaining({
        threadId: routeValue,
      }),
    )
  })

  it('uses captureless email replyTarget thread authority without inbox projection', async () => {
    const hostedEmailThreadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<real-email-msg-initial@example.test>',
      references: ['<real-email-msg-root@example.test>'],
      subject: 'Captureless email',
      to: ['sender@example.test'],
    })
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_email_thread_initial',
      inputId: 'ain_88888888888888888888888888888888',
      occurredAt: '2026-04-08T00:06:00.000Z',
      receivedAt: '2026-04-08T00:06:01.000Z',
      replyTarget: {
        channel: 'email',
        messageId: '<real-email-msg-initial@example.test>',
        threadId: hostedEmailThreadTarget,
      },
      source: 'email',
      text: 'captureless email initial text',
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['email'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(inboxServices.show).not.toHaveBeenCalled()
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryReplyToMessageId: '<real-email-msg-initial@example.test>',
        deliveryTarget: hostedEmailThreadTarget,
        bindingDeliveryTarget: hostedEmailThreadTarget,
      }),
    )
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          inputIds: [hostedInput.event.inputId],
          outcome: 'result',
        }),
      )
  })

  it('sends degraded captureless hosted email auto-reply when body text is unavailable', async () => {
    const hostedEmailThreadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<real-email-msg-placeholder@example.test>',
      references: ['<real-email-msg-root@example.test>'],
      subject: 'Captureless email',
      to: ['sender@example.test'],
    })
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_email_thread_placeholder',
      inputId: 'ain_99999999999999999999999999999999',
      occurredAt: '2026-04-08T00:06:00.000Z',
      receivedAt: '2026-04-08T00:06:01.000Z',
      replyTarget: {
        channel: 'email',
        messageId: '<real-email-msg-placeholder@example.test>',
        threadId: hostedEmailThreadTarget,
      },
      source: 'email',
      sourceMetadata: {
        kind: 'email',
        promptReady: false,
        promptUnavailableReason: 'email.body_unavailable',
      },
      text: 'Received an email message.',
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['email'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(inboxServices.show).not.toHaveBeenCalled()
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'reply prompt',
      }),
    )
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .not.toHaveBeenCalled()
  })

  it('admits degraded hosted email from active-turn late input admission', async () => {
    const initialThreadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<real-email-msg-initial@example.test>',
      references: ['<real-email-msg-root@example.test>'],
      subject: 'Initial email',
      to: ['sender@example.test'],
    })
    const lateThreadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<real-email-msg-late@example.test>',
      references: ['<real-email-msg-root@example.test>'],
      subject: 'Late email',
      to: ['sender@example.test'],
    })
    const initialInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_email_thread_initial',
      inputId: 'ain_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      occurredAt: '2026-04-08T00:06:00.000Z',
      receivedAt: '2026-04-08T00:06:01.000Z',
      replyTarget: {
        channel: 'email',
        messageId: '<real-email-msg-initial@example.test>',
        threadId: initialThreadTarget,
      },
      source: 'email',
      sourceMetadata: {
        kind: 'email',
        promptReady: true,
        promptUnavailableReason: null,
      },
      text: 'captureless email initial text',
    })
    const lateInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_email_thread_late',
      inputId: 'ain_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      occurredAt: '2026-04-08T00:07:00.000Z',
      receivedAt: '2026-04-08T00:07:01.000Z',
      replyTarget: {
        channel: 'email',
        messageId: '<real-email-msg-late@example.test>',
        threadId: lateThreadTarget,
      },
      source: 'email',
      sourceMetadata: {
        kind: 'email',
        promptReady: false,
        promptUnavailableReason: 'email.body_unavailable',
      },
      text: 'Received an email message.',
    })
    const inputSource = {
      checkpointAcceptedInput: vi.fn(async () => undefined),
      listNewConversationInputs: vi.fn(async () => ({
        inputs: [lateInput],
        nextCursor: lateInput.event.cursor,
      })),
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
    }
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
    }) => {
      await input.activeTurnInput?.({
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      return {
        delivery: {
          channel: 'email',
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
      }
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(initialInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['email'],
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage.mock.calls[0]?.[0])
      .toEqual(expect.objectContaining({
        activeTurnInput: expect.any(Function),
      }))
    expect(inputSource.checkpointAcceptedInput).not.toHaveBeenCalled()
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledTimes(1)
  })

  it('uses active-turn mailbox admission for hosted queue-only auto-replies without receipt fallback', async () => {
    const inputSource = {
      checkpointAcceptedInput: vi.fn(async () => undefined),
      listNewConversationInputs: vi.fn(async () => ({
        inputs: [],
        nextCursor: null,
      })),
      refresh: vi.fn(async () => {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      }),
    }
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: unknown
      activeTurnInput?: unknown
      deliveryDispatchMode?: string
    }) => {
      expect(input.activeTurnCheckpoint).toBeTypeOf('function')
      expect(input.activeTurnInput).toBeTypeOf('function')
      expect(input.deliveryDispatchMode).toBe('queue-only')
      return {
        delivery: null,
        deliveryDeferred: true,
        deliveryError: null,
        deliveryIntentId: 'intent-queue-only',
        response: 'queued response text',
        session: {
          sessionId: 'session-1',
        },
      }
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
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
      deliveryDispatchMode: 'queue-only',
      enabledChannels: ['telegram'],
      executionContext: {
        hosted: {
          memberId: 'member-test',
          userEnvKeys: [],
        },
      },
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(inputSource.checkpointAcceptedInput).not.toHaveBeenCalled()
    expect(inputSource.refresh).not.toHaveBeenCalled()
    expect(inputSource.listNewConversationInputs).not.toHaveBeenCalled()
    // Receipts are read to drive cross-session context suppression even
    // when the terminal receipt fallback is gated off.
    expect(replyMocks.listAssistantTurnReceipts).toHaveBeenCalled()
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledTimes(1)
  })

  it('skips replayed hosted queue-only Linq replies once reply-intent evidence exists', async () => {
    const hostedInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_queue_only_replay',
      inputId: 'ain_queue_only_replay_0000000001',
      mailboxRow: {
        dedupeKey: 'dedupe_queue_only_replay',
        eventId: 'evt_queue_only_replay',
        itemId: 'mailbox_item_queue_only_replay',
        laneSeq: '101',
      },
      occurredAt: '2026-04-08T00:08:00.000Z',
      receivedAt: '2026-04-08T00:08:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_queue_only_replay',
        threadId: 'real_thread_queue_only_replay',
      },
      source: 'linq',
      text: 'queued hosted Linq replay text',
    })
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      deliveryDispatchMode?: string
      deliveryIdempotencyKey?: string | null
    }) => {
      expect(input.deliveryDispatchMode).toBe('queue-only')
      expect(input.deliveryIdempotencyKey).toMatch(/^sha256:[0-9a-f]{64}$/u)
      return {
        delivery: null,
        deliveryDeferred: true,
        deliveryError: null,
        deliveryIntentId: 'intent-queue-only-replay',
        response: 'queued hosted response text',
        session: {
          sessionId: 'session-queue-only-replay',
        },
      }
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(hostedInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const first = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      deliveryDispatchMode: 'queue-only',
      enabledChannels: ['linq'],
      executionContext: {
        hosted: {
          memberId: 'member_queue_only_replay',
          userEnvKeys: [],
        },
      },
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })
    const firstSend = replyMocks.sendAssistantMessage.mock.calls[0]?.[0]

    expect(first).toMatchObject({
      advanceCursor: true,
      checkpointRequired: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(firstSend?.deliveryIdempotencyKey).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        inputIds: [hostedInput.event.inputId],
        outcome: 'deferred',
      }))

    replyMocks.sendAssistantMessage.mockClear()
    evidenceMocks.readAssistantAutoReplyTerminalEvidenceByEvidenceId.mockResolvedValue(
      createTerminalEvidence({
        captureId: hostedInput.event.inputId,
        groupCaptureIds: [hostedInput.event.inputId],
        terminal: {
          deliveryIntentId: 'intent-queue-only-replay',
          kind: 'reply_intent_committed',
          sessionId: 'session-queue-only-replay',
        },
      }),
    )

    const replay = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      deliveryDispatchMode: 'queue-only',
      enabledChannels: ['linq'],
      executionContext: {
        hosted: {
          memberId: 'member_queue_only_replay',
          userEnvKeys: [],
        },
      },
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(replay).toMatchObject({
      advanceCursor: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).not.toHaveBeenCalled()
  })

  it('keeps degraded hosted email in mixed retry groups before prompt construction', async () => {
    const promptReadyThreadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<real-email-msg-ready@example.test>',
      references: ['<real-email-msg-root@example.test>'],
      subject: 'Ready email',
      to: ['sender@example.test'],
    })
    const unavailableThreadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<real-email-msg-unavailable@example.test>',
      references: ['<real-email-msg-root@example.test>'],
      subject: 'Unavailable email',
      to: ['sender@example.test'],
    })
    const promptReadyInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_email_thread_ready',
      inputId: 'ain_cccccccccccccccccccccccccccccccc',
      occurredAt: '2026-04-08T00:06:00.000Z',
      receivedAt: '2026-04-08T00:06:01.000Z',
      replyTarget: {
        channel: 'email',
        messageId: '<real-email-msg-ready@example.test>',
        threadId: promptReadyThreadTarget,
      },
      source: 'email',
      sourceMetadata: {
        kind: 'email',
        promptReady: true,
        promptUnavailableReason: null,
      },
      text: 'prompt-ready email body',
    })
    const unavailableInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_email_thread_unavailable',
      inputId: 'ain_dddddddddddddddddddddddddddddddd',
      occurredAt: '2026-04-08T00:07:00.000Z',
      receivedAt: '2026-04-08T00:07:01.000Z',
      replyTarget: {
        channel: 'email',
        messageId: '<real-email-msg-unavailable@example.test>',
        threadId: unavailableThreadTarget,
      },
      source: 'email',
      sourceMetadata: {
        kind: 'email',
        promptReady: false,
        promptUnavailableReason: 'email.body_unavailable',
      },
      text: 'Received an email message.',
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(promptReadyInput),
      createCapturelessReplyGroupItem(unavailableInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      enabledChannels: ['email'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(replyMocks.sendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedTurnInput: {
          initialInputs: [
            expect.objectContaining({
              id: promptReadyInput.event.inputId,
            }),
            expect.objectContaining({
              id: unavailableInput.event.inputId,
            }),
          ],
        },
      }),
    )
    expect(replyMocks.sendAssistantMessage.mock.calls[0]?.[0].acceptedTurnInput.initialInputs)
      .toHaveLength(2)
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          inputIds: [
            promptReadyInput.event.inputId,
            unavailableInput.event.inputId,
          ],
          outcome: 'result',
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
        message: 'delivery channel is out of credits',
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
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
  })

  it('treats explicit no-reply assistant decisions as terminal skips', async () => {
    replyMocks.sendAssistantMessage.mockResolvedValue({
      delivery: null,
      deliveryDeferred: false,
      deliveryError: null,
      deliveryIntentId: null,
      response: '',
      responseDisposition: 'none',
      session: {
        sessionId: 'session-no-reply',
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
      checkpointRequired: true,
      failed: 0,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        reason: 'assistant finished without a reply',
      }))
  })

  it('writes no-reply suppression evidence only for the accepted input prefix before later active-turn failure', async () => {
    const initialInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_no_reply_prefix',
      inputId: 'ain_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa10',
      occurredAt: '2026-04-08T00:09:00.000Z',
      receivedAt: '2026-04-08T00:09:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_no_reply_initial',
        threadId: 'real_thread_no_reply_prefix',
      },
      source: 'linq',
      text: 'initial no-reply side effect input',
    })
    const lateInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_no_reply_prefix',
      inputId: 'ain_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb10',
      occurredAt: '2026-04-08T00:09:10.000Z',
      receivedAt: '2026-04-08T00:09:11.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_no_reply_late',
        threadId: 'real_thread_no_reply_prefix',
      },
      source: 'linq',
      text: 'later input should remain pending',
    })
    const inputSource = {
      checkpointAcceptedInput: vi.fn(async () => undefined),
      listNewConversationInputs: vi.fn(async () => ({
        inputs: [lateInput],
        nextCursor: lateInput.event.cursor,
      })),
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
    }
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: AssistantActiveTurnInputCheckpointInput) => Promise<void>
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
      onFinishWithoutReplyAccepted?: (event: {
        acceptedInputIds: readonly string[]
        deliveryContextOrdinal: number
      }) => Promise<void>
    }) => {
      await input.onFinishWithoutReplyAccepted?.({
        acceptedInputIds: [initialInput.event.inputId],
        deliveryContextOrdinal: 0,
      })
      const admitted = await input.activeTurnInput?.({
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      expect(admitted).toMatchObject({
        acceptedInputs: [
          expect.objectContaining({
            id: lateInput.event.inputId,
          }),
        ],
        kind: 'accepted',
      })
      await input.activeTurnCheckpoint?.({
        acceptedInputIds: [initialInput.event.inputId, lateInput.event.inputId],
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      throw new Error('provider failed after later active-turn input')
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(initialInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      deliveryDispatchMode: 'queue-only',
      enabledChannels: ['linq'],
      executionContext: {
        hosted: {
          memberId: 'member_no_reply_prefix',
          userEnvKeys: [],
        },
      },
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: false,
      failed: 1,
      stopScanning: true,
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledTimes(1)
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        inputIds: [initialInput.event.inputId],
        linqMessageIds: ['real_msg_no_reply_initial'],
        reason: 'assistant finished without a reply',
      }))
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .not.toHaveBeenCalledWith(expect.objectContaining({
        inputIds: [initialInput.event.inputId, lateInput.event.inputId],
      }))
  })

  it('preserves no-reply suppression evidence when a later active-turn input succeeds', async () => {
    const initialInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_no_reply_then_reply',
      inputId: 'ain_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11',
      occurredAt: '2026-04-08T00:10:00.000Z',
      receivedAt: '2026-04-08T00:10:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_no_reply_then_reply_initial',
        threadId: 'real_thread_no_reply_then_reply',
      },
      source: 'linq',
      text: 'initial no-reply side effect input',
    })
    const lateInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_no_reply_then_reply',
      inputId: 'ain_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb11',
      occurredAt: '2026-04-08T00:10:10.000Z',
      receivedAt: '2026-04-08T00:10:11.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'real_msg_no_reply_then_reply_late',
        threadId: 'real_thread_no_reply_then_reply',
      },
      source: 'linq',
      text: 'later input should receive the reply evidence',
    })
    const inputSource = {
      checkpointAcceptedInput: vi.fn(async () => undefined),
      listNewConversationInputs: vi.fn(async () => ({
        inputs: [lateInput],
        nextCursor: lateInput.event.cursor,
      })),
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input' as const,
        }
      },
    }
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      activeTurnCheckpoint?: (checkpoint: AssistantActiveTurnInputCheckpointInput) => Promise<void>
      activeTurnInput?: (admission: {
        sessionId: string
        turnId: string
        vault: string
      }) => Promise<unknown>
      onFinishWithoutReplyAccepted?: (event: {
        acceptedInputIds: readonly string[]
        deliveryContextOrdinal: number
      }) => Promise<void>
    }) => {
      await input.onFinishWithoutReplyAccepted?.({
        acceptedInputIds: [initialInput.event.inputId],
        deliveryContextOrdinal: 0,
      })
      const admitted = await input.activeTurnInput?.({
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      expect(admitted).toMatchObject({
        acceptedInputs: [
          expect.objectContaining({
            id: lateInput.event.inputId,
          }),
        ],
        kind: 'accepted',
      })
      await input.activeTurnCheckpoint?.({
        acceptedInputIds: [initialInput.event.inputId, lateInput.event.inputId],
        providerRequestOrdinal: 0,
        sessionId: 'session-1',
        turnId: 'turn-1',
        vault: '/tmp/assistant-automation-vault',
      })
      return {
        delivery: {
          channel: 'linq',
          target: 'real_thread_no_reply_then_reply',
          sentAt: '2026-04-08T00:10:20.000Z',
        },
        deliveryDeferred: false,
        deliveryError: null,
        deliveryIntentId: null,
        response: 'reply to the later input',
        session: {
          sessionId: 'session-1',
        },
      }
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(initialInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      deliveryDispatchMode: 'queue-only',
      enabledChannels: ['linq'],
      executionContext: {
        hosted: {
          memberId: 'member_no_reply_then_reply',
          userEnvKeys: [],
        },
      },
      inboxServices,
      inputSource,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledTimes(1)
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        inputIds: [initialInput.event.inputId],
        linqMessageIds: ['real_msg_no_reply_then_reply_initial'],
        reason: 'assistant finished without a reply',
      }))
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .toHaveBeenCalledTimes(1)
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        inputIds: [lateInput.event.inputId],
        linqMessageIds: ['real_msg_no_reply_then_reply_late'],
        outcome: 'result',
      }))
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .not.toHaveBeenCalledWith(expect.objectContaining({
        inputIds: [initialInput.event.inputId, lateInput.event.inputId],
      }))
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .not.toHaveBeenCalledWith(expect.objectContaining({
        inputIds: [initialInput.event.inputId],
      }))
  })

  it('defers reaction-capable no-reply suppression evidence until delivery work is committed', async () => {
    const telegramInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_reaction_only_no_reply',
      inputId: 'ain_reaction_only_no_reply_0000000001',
      occurredAt: '2026-04-08T00:11:00.000Z',
      receivedAt: '2026-04-08T00:11:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: '77',
        threadId: 'safe_telegram_thread_reaction_only',
      },
      source: 'telegram',
      text: 'reaction-only no-reply input',
    })
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      onFinishWithoutReplyAccepted?: (event: {
        acceptedInputIds: readonly string[]
        deliveryContextOrdinal: number
        messageReactionsAvailable?: boolean | null
      }) => Promise<void>
    }) => {
      await input.onFinishWithoutReplyAccepted?.({
        acceptedInputIds: [telegramInput.event.inputId],
        deliveryContextOrdinal: 0,
        messageReactionsAvailable: true,
      })
      expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
        .not.toHaveBeenCalled()
      return {
        delivery: null,
        deliveryDeferred: true,
        deliveryError: null,
        deliveryIntentId: 'intent-reaction-only',
        response: '',
        responseDisposition: 'none' as const,
        session: {
          sessionId: 'session-reaction-only',
        },
      }
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(telegramInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      deliveryDispatchMode: 'queue-only',
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      currentTurnDeliveryIntentIds: ['intent-reaction-only'],
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledTimes(1)
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        inputIds: [telegramInput.event.inputId],
        linqMessageIds: [],
        reason: 'assistant finished without a reply',
      }))
  })

  it('consumes reaction-only no-reply inputs when the committed reaction intent terminally fails', async () => {
    const telegramInput = createCapturelessAssistantInputCandidate({
      conversationThreadId: 'safe_thread_reaction_only_failed',
      inputId: 'ain_reaction_only_failed_0000000001',
      occurredAt: '2026-04-08T00:12:00.000Z',
      receivedAt: '2026-04-08T00:12:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: '88',
        threadId: 'safe_telegram_thread_reaction_failed',
      },
      source: 'telegram',
      text: 'reaction-only terminal failure input',
    })
    replyMocks.sendAssistantMessage.mockImplementation(async (input: {
      onFinishWithoutReplyAccepted?: (event: {
        acceptedInputIds: readonly string[]
        deliveryContextOrdinal: number
        messageReactionsAvailable?: boolean | null
      }) => Promise<void>
    }) => {
      await input.onFinishWithoutReplyAccepted?.({
        acceptedInputIds: [telegramInput.event.inputId],
        deliveryContextOrdinal: 0,
        messageReactionsAvailable: true,
      })
      expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
        .not.toHaveBeenCalled()
      return {
        delivery: null,
        deliveryDeferred: false,
        deliveryError: {
          code: 'ASSISTANT_TELEGRAM_REACTION_FAILED',
          message: 'Telegram rejected the reaction.',
          retryable: false,
        },
        deliveryIntentId: 'intent-reaction-terminal-failed',
        response: '',
        responseDisposition: 'none' as const,
        session: {
          sessionId: 'session-reaction-terminal-failed',
        },
      }
    })
    const inboxServices = createInboxServices({
      show: vi.fn(),
    })
    const reply = await vi.importActual<typeof import('../src/assistant/automation/reply.ts')>(
      '../src/assistant/automation/reply.ts',
    )
    const context = reply.createAssistantAutoReplyGroupContext([
      createCapturelessReplyGroupItem(telegramInput),
    ])

    if (!context) {
      throw new Error('expected reply context')
    }

    const result = await reply.processAssistantAutoReplyGroup({
      allowSelfAuthored: false,
      context,
      deliveryDispatchMode: 'immediate',
      enabledChannels: ['telegram'],
      inboxServices,
      requestId: null,
      sessionMaxAgeMs: null,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      advanceCursor: true,
      currentTurnDeliveryIntentIds: ['intent-reaction-terminal-failed'],
      failed: 0,
      replied: 1,
      skipped: 0,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence)
      .not.toHaveBeenCalled()
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledTimes(1)
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence)
      .toHaveBeenCalledWith(expect.objectContaining({
        inputIds: [telegramInput.event.inputId],
        linqMessageIds: [],
        reason: 'assistant finished without a reply',
      }))
  })

  it('keeps rejected delivery quota failures out of provider usage-limit suppression', async () => {
    const deliveryError = Object.assign(
      new Error('delivery channel is out of credits'),
      {
        code: 'ASSISTANT_DELIVERY_FAILED',
        outboxIntentId: 'intent-2',
      },
    )
    replyMocks.sendAssistantMessage.mockRejectedValue(deliveryError)
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
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
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
      checkpointRequired: true,
      failed: 0,
      nextWakeAt: null,
      replied: 0,
      skipped: 1,
      stopScanning: false,
    })
    expect(evidenceMocks.writeAssistantAutoReplyReplyTerminalEvidence).toHaveBeenCalledWith(expect.objectContaining({
      captureIds: ['capture-1'],
      deliveryIntentId: 'intent-receipt',
      inputIds: [expect.stringMatching(/^ain_[0-9a-f]{32}$/u)],
      linqMessageIds: [],
      outcome: 'deferred',
      recordedAt: '2026-04-08T00:11:00.000Z',
      sessionId: 'session-receipt',
      vault: '/tmp/assistant-automation-vault',
    }))
    expect(evidenceMocks.writeAssistantAutoReplySuppressionEvidence).not.toHaveBeenCalled()
  })

  it('rethrows terminal evidence write failures for successful outcomes', async () => {
    evidenceMocks.writeAssistantAutoReplyReplyIntentEvidence.mockRejectedValue(
      new Error('terminal evidence write failed'),
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
    ).rejects.toThrow('terminal evidence write failed')
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
      signal: expect.any(AbortSignal),
    })
    expect(runLoopMocks.processDueAssistantCronJobs).toHaveBeenCalledOnce()
    expect(runLoopMocks.recordAssistantDiagnosticEvent).toHaveBeenCalledOnce()
    expect(runLoopMocks.maybeRunAssistantRuntimeMaintenance).toHaveBeenCalledWith({
      vault: '/tmp/assistant-automation-vault',
    })
    expect(
      runLoopMocks.maybeRunAssistantRuntimeMaintenance.mock.invocationCallOrder[0],
    ).toBeLessThan(
      runLoopMocks.recordAssistantDiagnosticEvent.mock.invocationCallOrder[0] ?? 0,
    )
    expect(release).toHaveBeenCalledOnce()
  })

  it('runs the normal scanner before due cron jobs in a pass', async () => {
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

    expect(runLoopMocks.scanAssistantAutomationOnce).toHaveBeenCalledOnce()
    expect(runLoopMocks.processDueAssistantCronJobs).toHaveBeenCalledOnce()
    expect(
      runLoopMocks.scanAssistantAutomationOnce.mock.invocationCallOrder[0],
    ).toBeLessThan(
      runLoopMocks.processDueAssistantCronJobs.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('passes hosted turn environment into due cron processing', async () => {
    const inboxServices = createInboxServices({
      run: vi.fn().mockResolvedValue(undefined),
    })
    const turnEnvironment = {
      currentWorkingDirectory: null,
      env: {
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        PATH: '/bin',
      },
    }
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    await runLoop.runAssistantAutomation({
      drainOutbox: true,
      inboxServices,
      once: true,
      startDaemon: false,
      turnEnvironment,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(runLoopMocks.processDueAssistantCronJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        turnEnvironment,
      }),
    )
  })

  it('passes hosted provider trace callbacks into due cron processing', async () => {
    const inboxServices = createInboxServices({
      run: vi.fn().mockResolvedValue(undefined),
    })
    const onTraceEvent = vi.fn()
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    await runLoop.runAssistantAutomation({
      drainOutbox: true,
      inboxServices,
      once: true,
      onTraceEvent,
      startDaemon: false,
      vault: '/tmp/assistant-automation-vault',
    })

    expect(runLoopMocks.processDueAssistantCronJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        onTraceEvent,
      }),
    )
  })

  it('can finish a document-preservation retry pass without replying or outbox work', async () => {
    runLoopMocks.scanAssistantAutomationOnce.mockResolvedValueOnce({
      currentTurnDeliveryIntentIds: [],
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

  it('treats terminal evidence writes as pass progress for hosted checkpointing', async () => {
    runLoopMocks.scanAssistantAutomationOnce.mockResolvedValueOnce({
      currentTurnDeliveryIntentIds: [],
      routing: {
        considered: 0,
        failed: 0,
        nextWakeAt: null,
        noAction: 0,
        routed: 0,
        skipped: 0,
      },
      replies: {
        checkpointRequired: true,
        considered: 1,
        failed: 0,
        nextWakeAt: null,
        replied: 1,
        skipped: 0,
      },
    })
    const runLoop = await vi.importActual<typeof import('../src/assistant/automation/run-loop.ts')>(
      '../src/assistant/automation/run-loop.ts',
    )

    const result = await runLoop.runAssistantAutomationPass({
      requestId: 'request-terminal-evidence',
      vault: '/tmp/assistant-automation-vault',
    })

    expect(result).toMatchObject({
      progressed: true,
      replies: {
        checkpointRequired: true,
        considered: 1,
        replied: 1,
      },
    })
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

  it('stages local imported captures as assistant input before the wake-driven scan', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const context = await createTempVaultContext('assistant-local-input-stage-')
    tempRoots.push(context.parentRoot)
    const externalAbort = new AbortController()
    const stagedInputs: AssistantInputCandidate[] = []
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
              capture: {
                accountId: 'acct-local',
                actor: {
                  id: 'actor-local',
                  isSelf: false,
                },
                attachments: [
                  {
                    byteSize: 2048,
                    externalId: 'photo-local',
                    fileName: 'private-photo.jpg',
                    kind: 'image',
                    mime: 'image/jpeg',
                  },
                ],
                externalId: 'msg-local',
                occurredAt: '2026-04-09T00:00:10.000Z',
                raw: {
                  media_group_id: 'group-local-1',
                  message_id: 101,
                  reply_context_preview: 'Replying to: earlier Telegram message',
                  schema: 'murph.telegram-capture.v1',
                },
                source: 'telegram',
                text: 'local input staged from inbox import',
                thread: {
                  id: 'thread-local',
                  isDirect: true,
                },
              },
              connectorId: 'telegram',
              persisted: {
                captureId: 'capture-local',
                createdAt: '2026-04-09T00:00:11.000Z',
                deduped: false,
                envelopePath: 'raw/inbox/telegram/capture-local/envelope.json',
                eventId: 'event-local',
              },
              source: 'telegram',
              type: 'capture.imported',
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
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(async (input) => {
      scanStartedAt.push(Date.now())
      if (scanStartedAt.length === 2) {
        const batch = await input.inputSource.listInputCandidates({
          afterCursor: null,
          limit: 10,
        })
        stagedInputs.push(...batch.inputs)
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
      vault: context.vaultRoot,
    })

    await vi.advanceTimersByTimeAsync(10)
    const result = await resultPromise

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(stagedInputs.map((candidate) => candidate.event.text)).toEqual([
      'local input staged from inbox import',
    ])
    expect(stagedInputs[0]?.event.attachmentDescriptors).toEqual([
      {
        attachmentId: expect.stringMatching(/^lid_[0-9a-f]{32}$/u),
        contentType: 'image/jpeg',
        fileName: 'private-photo.jpg',
        kind: 'image',
        sizeBytes: 2048,
      },
    ])
    expect(stagedInputs[0]?.event.attachmentEvidence).toMatchObject({
      optionalInboxCaptureId: 'capture-local',
      reasonCode: 'attachment.evidence_partial',
      source: 'local-inbox-import',
      status: 'partial',
    })
    expect(stagedInputs[0]?.event.attachmentEvidence.attachments).toEqual([
      expect.objectContaining({
        descriptorAttachmentId: expect.stringMatching(/^lid_[0-9a-f]{32}$/u),
        fileName: 'private-photo.jpg',
        kind: 'image',
        mime: 'image/jpeg',
        raw: null,
        sourceAttachmentId: 'attachment-1',
      }),
    ])
    expect(stagedInputs[0]?.event.replyTarget).toEqual({
      channel: 'telegram',
      messageId: '101',
      threadId: 'thread-local',
    })
    expect(stagedInputs[0]?.event.sourceMetadata).toEqual({
      kind: 'telegram',
      mediaGroupId: expect.stringMatching(/^lid_[0-9a-f]{32}$/u),
      replyContext: 'Replying to: earlier Telegram message',
    })
    expect(JSON.stringify(stagedInputs[0]?.event)).not.toContain(
      'photo-local',
    )
    expect(JSON.stringify(stagedInputs[0]?.event)).not.toContain(
      'group-local-1',
    )
  })

  it('stages local Linq imported captures with reaction eligibility metadata', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const context = await createTempVaultContext('assistant-local-linq-input-stage-')
    tempRoots.push(context.parentRoot)
    const externalAbort = new AbortController()
    const stagedInputs: AssistantInputCandidate[] = []
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
              capture: {
                accountId: 'acct-local',
                actor: {
                  id: 'actor-local',
                  isSelf: false,
                },
                attachments: [],
                externalId: 'linq:msg-local-linq',
                occurredAt: '2026-04-09T00:00:10.000Z',
                raw: {
                  chat_id: 'chat-local-linq',
                  is_from_me: false,
                  link_part_count: 0,
                  media_part_count: 0,
                  message_id: 'msg-local-linq',
                  reaction_eligible: true,
                  schema: 'murph.linq-capture.v1',
                  service: 'iMessage',
                  text_part_count: 1,
                  voice_memo_part_count: 0,
                },
                source: 'linq',
                text: 'local linq input staged from inbox import',
                thread: {
                  id: 'chat-local-linq',
                  isDirect: true,
                },
              },
              connectorId: 'linq',
              persisted: {
                captureId: 'capture-local-linq',
                createdAt: '2026-04-09T00:00:11.000Z',
                deduped: false,
                envelopePath: 'raw/inbox/linq/capture-local-linq/envelope.json',
                eventId: 'event-local-linq',
              },
              source: 'linq',
              type: 'capture.imported',
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
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(async (input) => {
      scanStartedAt.push(Date.now())
      if (scanStartedAt.length === 2) {
        const batch = await input.inputSource.listInputCandidates({
          afterCursor: null,
          limit: 10,
        })
        stagedInputs.push(...batch.inputs)
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
      vault: context.vaultRoot,
    })

    await vi.advanceTimersByTimeAsync(10)
    const result = await resultPromise

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(stagedInputs).toHaveLength(1)
    expect(stagedInputs[0]?.event.replyTarget).toEqual({
      channel: 'linq',
      messageId: 'msg-local-linq',
      threadId: 'chat-local-linq',
    })
    expect(stagedInputs[0]?.event.sourceMetadata).toEqual({
      kind: 'linq',
      partCount: 1,
      reactionEligible: true,
      replyToMessageId: null,
      service: 'iMessage',
    })
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

  it('refreshes staged attachment evidence after parser jobs drain', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const context = await createTempVaultContext('assistant-local-input-refresh-')
    tempRoots.push(context.parentRoot)
    await writeVaultFile(
      context.vaultRoot,
      'raw/inbox/telegram/capture-refresh/attachments/01__voice.mp3',
      Buffer.from('audio-bytes'),
    )
    await stageInboxCaptureAssistantInputEvent({
      attachmentDescriptors: [
        {
          attachmentId: 'descriptor_audio_1',
          contentType: 'audio/mpeg',
          fileName: null,
          kind: 'audio',
          sizeBytes: 128,
        },
      ],
      capture: createCaptureDetail({
        attachmentCount: 1,
        captureId: 'capture-refresh',
        source: 'telegram',
        text: 'input before parser drain',
      }),
      vault: context.vaultRoot,
    })
    const externalAbort = new AbortController()
    const stagedInputs: AssistantInputCandidate[] = []
    const scanStartedAt: number[] = []
    const inboxServices = createInboxServices({
      show: vi.fn().mockResolvedValue(
        createShowResult(
          createCaptureDetail({
            attachmentCount: 1,
            captureId: 'capture-refresh',
            source: 'telegram',
            text: 'input before parser drain',
            attachments: [
              {
                attachmentId: 'att_audio_1',
                byteSize: 128,
                derivedPath:
                  'derived/inbox/capture-refresh/attachments/att_audio_1/manifest.json',
                externalId: null,
                extractedText: null,
                fileName: 'voice.mp3',
                kind: 'audio',
                mime: 'audio/mpeg',
                ordinal: 1,
                originalPath: null,
                parseState: 'succeeded',
                parserProviderId: null,
                sha256: null,
                storedPath:
                  'raw/inbox/telegram/capture-refresh/attachments/01__voice.mp3',
                transcriptText: 'Parsed voice note.',
              },
            ],
          }),
        ),
      ),
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
                captureIds: ['capture-refresh', 'capture-refresh'],
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
    runLoopMocks.scanAssistantAutomationOnce.mockImplementation(async (input) => {
      scanStartedAt.push(Date.now())
      if (scanStartedAt.length === 2) {
        const batch = await input.inputSource.listInputCandidates({
          afterCursor: null,
          limit: 10,
        })
        stagedInputs.push(...batch.inputs)
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
      vault: context.vaultRoot,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(scanStartedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10)
    const result = await resultPromise

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(inboxServices.show).toHaveBeenCalledTimes(1)
    expect(inboxServices.show).toHaveBeenCalledWith({
      captureId: 'capture-refresh',
      requestId: null,
      vault: context.vaultRoot,
    })
    expect(stagedInputs[0]?.event.attachmentEvidence).toMatchObject({
      optionalInboxCaptureId: 'capture-refresh',
      reasonCode: null,
      source: 'local-parser-drain',
      status: 'available',
    })
    expect(stagedInputs[0]?.event.attachmentEvidence.attachments).toEqual([
      expect.objectContaining({
        derived: {
          allowedRoot: 'derived/inbox/capture-refresh/attachments/att_audio_1',
          kind: 'parser-manifest',
          manifestPath:
            'derived/inbox/capture-refresh/attachments/att_audio_1/manifest.json',
        },
        inlineFragments: [
          {
            kind: 'attachment_transcript',
            label: 'attachment-1-transcript',
            text: 'Parsed voice note.',
            truncated: false,
          },
        ],
        raw: {
          byteSize: 128,
          kind: 'vault-relative-file',
          mediaType: 'audio/mpeg',
          path: 'raw/inbox/telegram/capture-refresh/attachments/01__voice.mp3',
          sha256: null,
        },
        descriptorAttachmentId: 'descriptor_audio_1',
        sourceAttachmentId: 'att_audio_1',
      }),
    ])
  })

  it('keeps parser drain evidence refresh failures nonblocking', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'))

    const context = await createTempVaultContext('assistant-local-input-refresh-failed-')
    tempRoots.push(context.parentRoot)
    const stored = await stageInboxCaptureAssistantInputEvent({
      capture: createCaptureDetail({
        attachmentCount: 1,
        captureId: 'capture-refresh-failed',
        source: 'telegram',
        text: 'input before failed parser drain',
      }),
      vault: context.vaultRoot,
    })
    const externalAbort = new AbortController()
    const events: Record<string, unknown>[] = []
    const scanStartedAt: number[] = []
    const error = new Error('projection unavailable')
    Object.defineProperty(error, 'code', {
      value: 'E_ATTACHMENT_REFRESH',
    })
    const inboxServices = createInboxServices({
      show: vi.fn().mockRejectedValue(error),
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
                captureIds: ['capture-refresh-failed'],
                failed: 1,
                processed: 1,
                succeeded: 0,
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
      onEvent: (event) => {
        events.push(toSnapshotRecord(event))
      },
      signal: externalAbort.signal,
      startDaemon: true,
      vault: context.vaultRoot,
    })

    await vi.advanceTimersByTimeAsync(10)
    const result = await resultPromise

    expect(result.reason).toBe('signal')
    expect(scanStartedAt).toHaveLength(2)
    expect(inboxServices.show).toHaveBeenCalledWith({
      captureId: 'capture-refresh-failed',
      requestId: null,
      vault: context.vaultRoot,
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        captureId: 'capture-refresh-failed',
        errorCode: 'E_ATTACHMENT_REFRESH',
        inputId: stored.inputId,
        providerKind: 'status',
        providerState: 'completed',
        safeDetails: 'attachment_evidence_refresh_failed_nonblocking',
        type: 'input.reply-progress',
      }),
    )
  })

  it('waits for the scanner retry deadline instead of rescanning immediately on failures', async () => {
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
          nextWakeAt: '2026-04-09T00:00:10.000Z',
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
        }) => Promise<void>
      }) => {
        scanStartedAt.push(Date.now())
        if (scanStartedAt.length === 1) {
          await input.onStateProgress({
            autoReply: createAutoReplyEntries(['telegram'], createAssistantInputCursor({
              inputId: 'capture-auto-reply',
              occurredAt: '2026-04-09T00:00:00.000Z',
            })),
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
        }) => Promise<void>
      }) => {
        await input.onStateProgress({
          autoReply: createAutoReplyEntries(['telegram'], createAssistantInputCursor({
            inputId: 'capture-auto-reply',
            occurredAt: '2026-04-08T00:01:00.000Z',
          })),
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
        autoReply: createAutoReplyEntries(['telegram'], createAssistantInputCursor({
          inputId: 'capture-auto-reply',
          occurredAt: '2026-04-08T00:01:00.000Z',
        })),
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
