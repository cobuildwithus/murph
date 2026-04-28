import type { AssistantAutomationCursor } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantUserMessageContentPart } from '../../model-harness.js'
import type { AssistantAcceptedTurnInputItemInput } from '../active-turn-input-journal.js'
import { getAssistantChannelAdapter } from '../channel-adapters.js'
import {
  conversationCaptureRefFromCapture,
  conversationRefFromCapture,
} from '../conversation-ref.js'
import type { AssistantOperatorAuthority } from '../operator-authority.js'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import {
  isAssistantProviderConnectionLostError,
  isAssistantProviderStalledError,
} from '../provider-turn-recovery.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import { listAssistantTurnReceipts } from '../receipts.js'
import { errorMessage, normalizeNullableString } from '../shared.js'
import { sendAssistantMessage } from '../service.js'
import {
  AssistantActiveTurnInputBudgetExceededError,
  AssistantActiveTurnInputUnavailableError,
  isAssistantActiveTurnInputBudgetExceededError,
  isAssistantActiveTurnInputUnavailableError,
  type AssistantActiveTurnInputCheckpointHook,
  type AssistantActiveTurnInputAdmissionHook,
  type AssistantTurnInputPort,
} from '../turn-input.js'
import {
  listAssistantTranscriptEntries,
  resolveAssistantSession,
} from '../store.js'
import {
  assistantAutoReplyGroupOutcomeArtifactExists,
  assistantChatReplyArtifactExists,
  writeAssistantAutoReplyGroupOutcomeArtifact,
  writeAssistantChatDeferredArtifacts,
  writeAssistantChatErrorArtifacts,
  writeAssistantChatResultArtifacts,
} from './artifacts.js'
import {
  computeAssistantAutoReplyRetryAt,
  isAssistantAutoReplyRepairableConfigError,
  isAssistantProviderCapacityError,
} from './auto-reply-retry.js'
import {
  describeAssistantAutoReplyFailure,
  type AssistantAutoReplyFailureSnapshot,
} from './failure-observability.js'
import {
  collectAssistantAutoReplyGroup,
  loadAssistantAutoReplyGroupItems,
  type AssistantAutoReplyGroupItem,
} from './grouping.js'
import {
  AUTO_REPLY_PROVIDER_STALLED_DETAIL,
  createAssistantProviderWatchdog,
} from './provider-watchdog.js'
import {
  prepareAssistantAutoReplyInput,
  type AssistantAutoReplyPromptCapture,
} from './prompt-builder.js'
import {
  computeAssistantAutomationRetryAt,
  compareAssistantCaptureOrder,
  createEmptyAutoReplyScanResult,
  cursorFromCapture,
  earliestAssistantAutomationWakeAt,
  normalizeEnabledChannels,
  normalizeScanLimit,
  type AssistantAutoReplyScanResult,
  type AssistantAutomationStateProgress,
  type AssistantRunEvent,
} from './shared.js'

const SELF_AUTHORED_ECHO_WINDOW_MS = 10 * 60 * 1000
const ASSISTANT_AUTO_REPLY_DEFERRED_RETRY_DELAY_MS = 30 * 1000
const AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY = 'autoReplyCaptureId'
const AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY = 'autoReplyCaptureIds'

export interface AssistantAutoReplyGroupContext {
  captureCount: number
  captureIds: string[]
  firstCaptureId: string
  firstItem: AssistantAutoReplyGroupItem
  items: readonly AssistantAutoReplyGroupItem[]
  lastCursor: AssistantAutomationCursor
}

interface AssistantAutoReplyReplyDecision {
  deliveryReplyToMessageId: string | null
  kind: 'reply'
  operatorAuthority: AssistantOperatorAuthority
  primaryCapture: InboxShowResult['capture']
  prompt: string
  userMessageContent: AssistantUserMessageContentPart[] | null
}

interface AssistantAutoReplySkipDecision {
  kind: 'skip'
  advanceCursor: boolean
  nextWakeAt: string | null
  reason: string
  stopScanning: boolean
}

type AssistantAutoReplyDecision =
  | { kind: 'ignore' }
  | AssistantAutoReplyReplyDecision
  | AssistantAutoReplySkipDecision

interface AssistantAutoReplyScanState {
  cursor: AssistantAutomationCursor | null
}

type AssistantAutoReplySendResult = Awaited<
  ReturnType<typeof sendAssistantMessage>
>

interface AssistantAutoReplyResolvedGroupOutcome {
  context: AssistantAutoReplyGroupContext
  outcome: AssistantAutoReplyGroupOutcome
}

interface AssistantAutoReplyOutcomeSummary {
  failed: number
  replied: number
  skipped: number
}

type AssistantAutoReplyOutcomeEvent =
  | {
      details: string
      errorCode?: string
      safeDetails?: string
      type: 'capture.reply-failed' | 'capture.reply-skipped' | 'capture.replied'
    }
  | null

type AssistantAutoReplyOutcomeArtifact =
  | { kind: 'none' }
  | { kind: 'deferred'; result: AssistantAutoReplySendResult }
  | {
      kind: 'error'
      error: unknown
      failure: AssistantAutoReplyFailureSnapshot
    }
  | { kind: 'result'; result: AssistantAutoReplySendResult }

interface AssistantAutoReplyGroupOutcome {
  advanceCursor: boolean
  artifact: AssistantAutoReplyOutcomeArtifact
  event: AssistantAutoReplyOutcomeEvent
  kind: 'deferred' | 'failed' | 'ignored' | 'replied' | 'skipped'
  nextWakeAt: string | null
  stopScanning: boolean
  summary: AssistantAutoReplyOutcomeSummary
}

type AssistantAutoReplyGroupArtifactStatus = 'complete' | 'none' | 'partial'

export interface AssistantAutoReplyProcessResult {
  advanceCursor: boolean
  cursor?: AssistantAutomationCursor
  failed: number
  nextWakeAt: string | null
  replied: number
  skipped: number
  stopScanning: boolean
}

export async function scanAssistantAutoReplyOnce(input: {
  afterCursor?: AssistantAutomationCursor | null
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  enabledChannels: readonly string[]
  inboxServices: InboxServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  onStateProgress?: (
    state: AssistantAutomationStateProgress,
  ) => Promise<void> | void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  requestId?: string | null
  signal?: AbortSignal
  sessionMaxAgeMs?: number | null
  turnInputPort?: AssistantTurnInputPort
  vault: string
}): Promise<AssistantAutoReplyScanResult> {
  const enabledChannels = normalizeEnabledChannels(input.enabledChannels)
  if (enabledChannels.length === 0) {
    return createEmptyAutoReplyScanResult()
  }

  const listed = await input.inboxServices.list({
    vault: input.vault,
    requestId: input.requestId ?? null,
    limit: normalizeScanLimit(input.maxPerScan),
    sourceId: null,
    afterOccurredAt: input.afterCursor?.occurredAt ?? null,
    afterCaptureId: input.afterCursor?.captureId ?? null,
    oldestFirst: true,
  })
  const captures = [...listed.items].sort((left, right) =>
    left.occurredAt === right.occurredAt
      ? left.captureId.localeCompare(right.captureId)
      : left.occurredAt.localeCompare(right.occurredAt),
  )
  input.onEvent?.({
    type: 'reply.scan.started',
    details: `${captures.length} capture(s)`,
  })

  const summary = createEmptyAutoReplyScanResult()
  const scanState: AssistantAutoReplyScanState = {
    cursor: input.afterCursor ?? null,
  }

  for (let index = 0; index < captures.length; index += 1) {
    if (input.signal?.aborted) {
      break
    }

    const group = await collectAssistantAutoReplyGroup({
      captures,
      startIndex: index,
      vault: input.vault,
    })
    index = group.endIndex
    summary.considered += group.items.length

    const context = createAssistantAutoReplyGroupContext(group.items)
    if (!context) {
      continue
    }

    const result = await processAssistantAutoReplyGroup({
      allowSelfAuthored: input.allowSelfAuthored ?? false,
      context,
      deliveryDispatchMode: input.deliveryDispatchMode,
      enabledChannels,
      inboxServices: input.inboxServices,
      onEvent: input.onEvent,
      onTraceEvent: input.onTraceEvent,
      providerHeartbeatMs: input.providerHeartbeatMs,
      providerLongRunningCommandStallTimeoutMs:
        input.providerLongRunningCommandStallTimeoutMs,
      providerStallTimeoutMs: input.providerStallTimeoutMs,
      requestId: input.requestId ?? null,
      signal: input.signal,
      sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
      turnInputPort: input.turnInputPort,
      vault: input.vault,
    })
    if (
      applyAssistantAutoReplyProcessResult({
        context,
        result,
        summary,
        updateCursor: (cursor) => {
          scanState.cursor = cursor
        },
      })
    ) {
      break
    }
  }

  await input.onStateProgress?.({
    autoReply: enabledChannels.map((channel) => ({
      channel,
      cursor: scanState.cursor,
    })),
  })

  return summary
}

export function applyAssistantAutoReplyProcessResult(input: {
  context: AssistantAutoReplyGroupContext
  result: AssistantAutoReplyProcessResult
  summary: AssistantAutoReplyScanResult
  updateCursor: (cursor: AssistantAutomationCursor) => void
}): boolean {
  input.summary.failed += input.result.failed
  input.summary.nextWakeAt = earliestAssistantAutomationWakeAt(
    input.summary.nextWakeAt,
    input.result.nextWakeAt,
  )
  input.summary.replied += input.result.replied
  input.summary.skipped += input.result.skipped
  if (input.result.advanceCursor) {
    input.updateCursor(input.result.cursor ?? input.context.lastCursor)
  }

  return input.result.stopScanning
}

export function createAssistantAutoReplyGroupContext(
  items: readonly AssistantAutoReplyGroupItem[],
): AssistantAutoReplyGroupContext | null {
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
    lastCursor: cursorFromCapture(lastItem.summary),
  }
}

export async function processAssistantAutoReplyGroup(input: {
  allowSelfAuthored: boolean
  context: AssistantAutoReplyGroupContext
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  enabledChannels: readonly string[]
  executionContext?: AssistantExecutionContext | null
  inboxServices: InboxServices
  onEvent?: (event: AssistantRunEvent) => void
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  requestId: string | null
  signal?: AbortSignal
  sessionMaxAgeMs: number | null
  turnInputPort?: AssistantTurnInputPort
  vault: string
}): Promise<AssistantAutoReplyProcessResult> {
  let latestContext = input.context
  try {
    const resolved = await resolveAssistantAutoReplyGroupOutcome({
      ...input,
      onAcceptedContext(context) {
        latestContext = context
      },
    })
    return commitAssistantAutoReplyGroupOutcome({
      context: resolved.context,
      onEvent: input.onEvent,
      outcome: resolved.outcome,
      vault: input.vault,
    })
  } catch (error) {
    if (
      isAssistantActiveTurnInputBudgetExceededError(error) ||
      isAssistantActiveTurnInputUnavailableError(error)
    ) {
      const reason = error instanceof Error
        ? error.message
        : 'Active turn input could not be accepted; will retry later.'
      return commitAssistantAutoReplyGroupOutcome({
        context: latestContext,
        onEvent: input.onEvent,
        outcome: createDeferredGroupOutcome({
          captureCount: latestContext.captureCount,
          nextWakeAt: computeAssistantAutomationRetryAt(
            ASSISTANT_AUTO_REPLY_DEFERRED_RETRY_DELAY_MS,
          ),
          reason,
          stopScanning: true,
        }),
        vault: input.vault,
      })
    }

    return commitAssistantAutoReplyGroupOutcome({
      context: latestContext,
      onEvent: input.onEvent,
      outcome: classifyAssistantAutoReplyFailure({
        captureCount: latestContext.captureCount,
        error,
      }),
      vault: input.vault,
    })
  }
}

async function resolveAssistantAutoReplyGroupOutcome(input: {
  allowSelfAuthored: boolean
  context: AssistantAutoReplyGroupContext
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  enabledChannels: readonly string[]
  executionContext?: AssistantExecutionContext | null
  inboxServices: InboxServices
  onEvent?: (event: AssistantRunEvent) => void
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  onAcceptedContext?: (context: AssistantAutoReplyGroupContext) => void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  requestId: string | null
  signal?: AbortSignal
  sessionMaxAgeMs: number | null
  turnInputPort?: AssistantTurnInputPort
  vault: string
}): Promise<AssistantAutoReplyResolvedGroupOutcome> {
  const decision = await evaluateAssistantAutoReplyGroup({
    allowSelfAuthored: input.allowSelfAuthored,
    enabledChannels: input.enabledChannels,
    group: input.context,
    inboxServices: input.inboxServices,
    requestId: input.requestId,
    vault: input.vault,
  })
  if (decision.kind === 'ignore') {
    return {
      context: input.context,
      outcome: createIgnoredGroupOutcome(),
    }
  }
  if (decision.kind === 'skip') {
    return {
      context: input.context,
      outcome: createSkippedDecisionOutcome({
        captureCount: input.context.captureCount,
        decision,
      }),
    }
  }

  let acceptedContext = input.context
  input.onEvent?.({
    type: 'capture.reply-started',
    captureId: input.context.firstCaptureId,
    details: 'assistant provider turn started',
  })
  const result = await executeAssistantAutoReply({
    acceptedTurnInputInitialInputs: buildAutoReplyAcceptedTurnInputItems({
      captures: input.context.items.map((item) => item.summary),
      cursorFrom: null,
      cursorTo: input.context.lastCursor,
    }),
    captureIds: input.context.captureIds,
    deliveryDispatchMode: input.deliveryDispatchMode,
    deliveryReplyToMessageId: decision.deliveryReplyToMessageId,
    executionContext: input.executionContext,
    providerHeartbeatMs: input.providerHeartbeatMs,
    providerLongRunningCommandStallTimeoutMs:
      input.providerLongRunningCommandStallTimeoutMs,
    providerStallTimeoutMs: input.providerStallTimeoutMs,
    signal: input.signal,
    maxSessionAgeMs: input.sessionMaxAgeMs,
    onEvent: input.onEvent,
    onTraceEvent: input.onTraceEvent,
    operatorAuthority: decision.operatorAuthority,
    primaryCapture: decision.primaryCapture,
    prompt: decision.prompt,
    replyCaptureId: input.context.firstCaptureId,
    activeTurnInput: input.turnInputPort
      ? createAssistantAutoReplyActiveTurnInputHook({
          context: input.context,
          inboxServices: input.inboxServices,
          onAcceptedContext(nextContext) {
            acceptedContext = nextContext
            input.onAcceptedContext?.(nextContext)
          },
          onEvent: input.onEvent,
          port: input.turnInputPort,
          requestId: input.requestId,
          vault: input.vault,
        })
      : undefined,
    activeTurnCheckpoint: createAssistantAutoReplyActiveTurnCheckpointHook(
      input.turnInputPort,
    ),
    userMessageContent: decision.userMessageContent,
    vault: input.vault,
  })
  if (result.deliveryDeferred) {
    return {
      context: acceptedContext,
      outcome: createDeferredDeliveryGroupOutcome(result),
    }
  }

  return {
    context: acceptedContext,
    outcome: createSuccessfulReplyGroupOutcome(result),
  }
}

async function commitAssistantAutoReplyGroupOutcome(input: {
  context: AssistantAutoReplyGroupContext
  onEvent?: (event: AssistantRunEvent) => void
  outcome: AssistantAutoReplyGroupOutcome
  vault: string
}): Promise<AssistantAutoReplyProcessResult> {
  await writeAssistantAutoReplyOutcomeArtifacts(input).catch((error) => {
    if (input.outcome.artifact.kind === 'error') {
      return
    }
    throw error
  })
  emitAssistantAutoReplyOutcomeEvent(input)

  return {
    advanceCursor: input.outcome.advanceCursor,
    cursor: input.context.lastCursor,
    failed: input.outcome.summary.failed,
    nextWakeAt: input.outcome.nextWakeAt,
    replied: input.outcome.summary.replied,
    skipped: input.outcome.summary.skipped,
    stopScanning: input.outcome.stopScanning,
  }
}

async function writeAssistantAutoReplyOutcomeArtifacts(input: {
  context: AssistantAutoReplyGroupContext
  outcome: AssistantAutoReplyGroupOutcome
  vault: string
}): Promise<void> {
  switch (input.outcome.artifact.kind) {
    case 'none':
      return
    case 'result': {
      const delivery = input.outcome.artifact.result.delivery
      if (!delivery) {
        throw new Error(
          'assistant auto-reply delivery was missing after delivery confirmation',
        )
      }

      await writeAssistantAutoReplyGroupOutcomeArtifact({
        captureIds: input.context.captureIds,
        outcome: 'result',
        recordedAt: delivery.sentAt,
        result: input.outcome.artifact.result,
        vault: input.vault,
      })
      await writeAssistantChatResultArtifacts({
        captureIds: input.context.captureIds,
        respondedAt: delivery.sentAt,
        result: input.outcome.artifact.result,
        vault: input.vault,
      })
      return
    }
    case 'deferred': {
      const queuedAt = new Date().toISOString()
      await writeAssistantAutoReplyGroupOutcomeArtifact({
        captureIds: input.context.captureIds,
        outcome: 'deferred',
        recordedAt: queuedAt,
        result: input.outcome.artifact.result,
        vault: input.vault,
      })
      await writeAssistantChatDeferredArtifacts({
        captureIds: input.context.captureIds,
        queuedAt,
        result: input.outcome.artifact.result,
        vault: input.vault,
      })
      return
    }
    case 'error':
      await writeAssistantChatErrorArtifacts({
        captureIds: input.context.captureIds,
        failure: input.outcome.artifact.failure,
        vault: input.vault,
      })
      return
  }
}

function emitAssistantAutoReplyOutcomeEvent(input: {
  context: AssistantAutoReplyGroupContext
  onEvent?: (event: AssistantRunEvent) => void
  outcome: AssistantAutoReplyGroupOutcome
}): void {
  if (!input.outcome.event) {
    return
  }

  input.onEvent?.({
    type: input.outcome.event.type,
    captureId: input.context.firstCaptureId,
    details: input.outcome.event.details,
    errorCode: input.outcome.event.errorCode,
    safeDetails: input.outcome.event.safeDetails,
  })
}

function createIgnoredGroupOutcome(): AssistantAutoReplyGroupOutcome {
  return {
    advanceCursor: false,
    artifact: { kind: 'none' },
    event: null,
    kind: 'ignored',
    nextWakeAt: null,
    stopScanning: false,
    summary: createAssistantAutoReplyOutcomeSummary(),
  }
}

function createSkippedDecisionOutcome(input: {
  captureCount: number
  decision: AssistantAutoReplySkipDecision
}): AssistantAutoReplyGroupOutcome {
  if (input.decision.advanceCursor) {
    return createSkippedGroupOutcome({
      captureCount: input.captureCount,
      reason: input.decision.reason,
      nextWakeAt: input.decision.nextWakeAt,
      stopScanning: input.decision.stopScanning,
    })
  }

  return createDeferredGroupOutcome({
    captureCount: input.captureCount,
    nextWakeAt: input.decision.nextWakeAt,
    reason: input.decision.reason,
    stopScanning: input.decision.stopScanning,
  })
}

function createSkippedGroupOutcome(input: {
  captureCount: number
  nextWakeAt?: string | null
  reason: string
  stopScanning?: boolean
}): AssistantAutoReplyGroupOutcome {
  return {
    advanceCursor: true,
    artifact: { kind: 'none' },
    event: {
      details: input.reason,
      type: 'capture.reply-skipped',
    },
    kind: 'skipped',
    nextWakeAt: input.nextWakeAt ?? null,
    stopScanning: input.stopScanning ?? false,
    summary: createAssistantAutoReplyOutcomeSummary({
      skipped: input.captureCount,
    }),
  }
}

function createDeferredGroupOutcome(input: {
  captureCount: number
  nextWakeAt?: string | null
  reason: string
  stopScanning: boolean
}): AssistantAutoReplyGroupOutcome {
  return {
    advanceCursor: false,
    artifact: { kind: 'none' },
    event: {
      details: input.reason,
      type: 'capture.reply-skipped',
    },
    kind: 'deferred',
    nextWakeAt: input.nextWakeAt ?? null,
    stopScanning: input.stopScanning,
    summary: createAssistantAutoReplyOutcomeSummary({
      skipped: input.captureCount,
    }),
  }
}

function createDeferredDeliveryGroupOutcome(
  result: AssistantAutoReplySendResult,
): AssistantAutoReplyGroupOutcome {
  return {
    advanceCursor: true,
    artifact: {
      kind: 'deferred',
      result,
    },
    event: {
      details: result.deliveryIntentId
        ? `delivery queued for retry as ${result.deliveryIntentId}`
        : 'delivery queued for retry',
      type: 'capture.replied',
    },
    kind: 'deferred',
    nextWakeAt: null,
    stopScanning: false,
    summary: createAssistantAutoReplyOutcomeSummary({
      replied: 1,
    }),
  }
}

function createSuccessfulReplyGroupOutcome(
  result: AssistantAutoReplySendResult,
): AssistantAutoReplyGroupOutcome {
  const delivery = result.delivery
  if (!delivery) {
    throw new Error(
      'assistant auto-reply delivery was missing after delivery confirmation',
    )
  }

  return {
    advanceCursor: true,
    artifact: {
      kind: 'result',
      result,
    },
    event: {
      details: `${delivery.channel} -> ${delivery.target}`,
      type: 'capture.replied',
    },
    kind: 'replied',
    nextWakeAt: null,
    stopScanning: false,
    summary: createAssistantAutoReplyOutcomeSummary({
      replied: 1,
    }),
  }
}

function createFailedGroupOutcome(input: {
  advanceCursor: boolean
  error: unknown
  nextWakeAt?: string | null
  stopScanning?: boolean
}): AssistantAutoReplyGroupOutcome {
  const failure = describeAssistantAutoReplyFailure(input.error)

  return {
    advanceCursor: input.advanceCursor,
    artifact: {
      kind: 'error',
      error: input.error,
      failure,
    },
    event: {
      details: failure.message,
      errorCode: failure.code ?? undefined,
      safeDetails: failure.safeSummary,
      type: 'capture.reply-failed',
    },
    kind: 'failed',
    nextWakeAt: input.nextWakeAt ?? null,
    stopScanning: input.stopScanning ?? false,
    summary: createAssistantAutoReplyOutcomeSummary({
      failed: 1,
    }),
  }
}

function createAssistantAutoReplyOutcomeSummary(
  input?: Partial<AssistantAutoReplyOutcomeSummary>,
): AssistantAutoReplyOutcomeSummary {
  return {
    failed: input?.failed ?? 0,
    replied: input?.replied ?? 0,
    skipped: input?.skipped ?? 0,
  }
}

async function evaluateAssistantAutoReplyGroup(input: {
  allowSelfAuthored: boolean
  enabledChannels: readonly string[]
  group: AssistantAutoReplyGroupContext
  inboxServices: InboxServices
  requestId: string | null
  vault: string
}): Promise<AssistantAutoReplyDecision> {
  if (!input.enabledChannels.includes(input.group.firstItem.summary.source)) {
    return createAdvancingSkipDecision(
      'channel not enabled for assistant auto-reply',
    )
  }

  if (input.group.firstItem.summary.actorIsSelf && !input.allowSelfAuthored) {
    return createAdvancingSkipDecision('capture is self-authored')
  }

  const existingGroupOutcome = await assistantAutoReplyGroupOutcomeArtifactExists(
    input.vault,
    input.group.firstCaptureId,
  )
  const existingArtifact = await Promise.all(
    input.group.captureIds.map((captureId) =>
      assistantChatReplyArtifactExists(input.vault, captureId),
    ),
  )
  const existingArtifactStatus = classifyAssistantAutoReplyGroupArtifactStatus(
    existingArtifact,
  )
  if (existingGroupOutcome) {
    if (existingArtifactStatus === 'partial') {
      return createDeferredSkipDecision(
        'assistant reply artifacts are incomplete; will retry this capture after reply artifacts are rebuilt.',
      )
    }
    return createAdvancingSkipDecision('assistant reply already handled')
  }
  if (existingArtifactStatus === 'complete') {
    return createAdvancingSkipDecision('assistant reply already exists')
  }
  if (existingArtifactStatus === 'partial') {
    return createDeferredSkipDecision(
      'assistant reply artifacts are incomplete; will retry this capture after reply artifacts are rebuilt.',
    )
  }

  const shownGroup = await loadAssistantAutoReplyCaptures({
    group: input.group,
    inboxServices: input.inboxServices,
    requestId: input.requestId,
    vault: input.vault,
  })
  const primaryCapture = shownGroup[0]?.capture
  if (!primaryCapture) {
    return { kind: 'ignore' }
  }

  if (await assistantAutoReplyHandledByTurnReceipt(input.vault, input.group.captureIds)) {
    return createAdvancingSkipDecision('assistant reply already handled')
  }

  const channelAdapter = getAssistantChannelAdapter(primaryCapture.source)
  const autoReplySkipReason = channelAdapter?.canAutoReply(primaryCapture) ?? null
  if (autoReplySkipReason) {
    return createAdvancingSkipDecision(autoReplySkipReason)
  }

  const preparedInput = await prepareAssistantAutoReplyInput(
    shownGroup,
    input.vault,
  )
  if (preparedInput.kind === 'defer') {
    return createDeferredSkipDecision(preparedInput.reason)
  }
  if (preparedInput.kind === 'skip') {
    return createAdvancingSkipDecision(preparedInput.reason)
  }

  if (
    input.group.firstItem.summary.actorIsSelf &&
    (await isRecentSelfAuthoredAssistantEcho({
      vault: input.vault,
      capture: primaryCapture,
    }))
  ) {
    return createAdvancingSkipDecision(
      'capture matches a recent assistant delivery',
    )
  }

  return {
    deliveryReplyToMessageId: readAutoReplyDeliveryReplyToMessageId(shownGroup),
    kind: 'reply',
    operatorAuthority: 'direct-operator',
    primaryCapture,
    prompt: preparedInput.prompt,
    userMessageContent: preparedInput.userMessageContent,
  }
}

async function loadAssistantAutoReplyCaptures(input: {
  group: AssistantAutoReplyGroupContext
  inboxServices: InboxServices
  requestId: string | null
  vault: string
}): Promise<AssistantAutoReplyPromptCapture[]> {
  return Promise.all(
    input.group.items.map(async (item) => ({
      capture: (
        await input.inboxServices.show({
          vault: input.vault,
          requestId: input.requestId,
          captureId: item.summary.captureId,
        })
      ).capture,
      telegramMetadata: item.telegramMetadata,
    })),
  )
}

async function executeAssistantAutoReply(input: {
  acceptedTurnInputInitialInputs?: readonly AssistantAcceptedTurnInputItemInput[] | null
  activeTurnCheckpoint?: AssistantActiveTurnInputCheckpointHook
  activeTurnInput?: AssistantActiveTurnInputAdmissionHook
  captureIds: readonly string[]
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  deliveryReplyToMessageId: string | null
  executionContext?: AssistantExecutionContext | null
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  signal?: AbortSignal
  maxSessionAgeMs: number | null
  onEvent?: (event: AssistantRunEvent) => void
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  operatorAuthority: AssistantOperatorAuthority
  primaryCapture: InboxShowResult['capture']
  prompt: string
  replyCaptureId: string
  userMessageContent: AssistantUserMessageContentPart[] | null
  vault: string
}): Promise<Awaited<ReturnType<typeof sendAssistantMessage>>> {
  const watchdog = createAssistantProviderWatchdog(input)

  try {
    const result = await sendAssistantMessage({
      vault: input.vault,
      acceptedTurnInput: {
        initialInputs: input.acceptedTurnInputInitialInputs ?? null,
      },
      conversation: conversationRefFromCapture(input.primaryCapture),
      abortSignal: watchdog.signal,
      activeTurnCheckpoint: input.activeTurnCheckpoint,
      activeTurnInput: input.activeTurnInput,
      executionContext: input.executionContext,
      operatorAuthority: input.operatorAuthority,
      persistUserPromptOnFailure: false,
      prompt: input.prompt,
      userMessageContent: input.userMessageContent,
      includeEarlySessionOnboarding: true,
      deliverResponse: true,
      deliveryDispatchMode: input.deliveryDispatchMode,
      deliveryReplyToMessageId: input.deliveryReplyToMessageId,
      receiptMetadata: {
        [AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY]: input.replyCaptureId,
        [AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]: input.captureIds.join(','),
      },
      turnTrigger: 'automation-auto-reply',
      maxSessionAgeMs: input.maxSessionAgeMs,
      onProviderEvent: watchdog.onProviderEvent,
      onTraceEvent: input.onTraceEvent,
    })
    return resolveAssistantAutoReplySendResult({
      onEvent: input.onEvent,
      replyCaptureId: input.replyCaptureId,
      result,
    })
  } catch (error) {
    throw watchdog.normalizeError(error)
  } finally {
    watchdog.dispose()
  }
}

function createAssistantAutoReplyActiveTurnInputHook(input: {
  context: AssistantAutoReplyGroupContext
  inboxServices: InboxServices
  onAcceptedContext(context: AssistantAutoReplyGroupContext): void
  onEvent?: (event: AssistantRunEvent) => void
  port: AssistantTurnInputPort
  requestId: string | null
  vault: string
}): AssistantActiveTurnInputAdmissionHook {
  let context = input.context

  return async (admissionInput) => {
    let refreshResult: Awaited<ReturnType<AssistantTurnInputPort['refresh']>>
    try {
      refreshResult = await input.port.refresh({
        phase:
          admissionInput.phase === 'commit_barrier'
            ? 'commit_barrier'
            : 'after_provider',
      })
    } catch (error) {
      throw error
    }
    if (refreshResult.reason === 'source_unavailable') {
      throw new AssistantActiveTurnInputUnavailableError(
        'same-conversation input source is temporarily unavailable during the active turn; will retry later.',
      )
    }

    const lateCaptures = await input.port.listNewConversationCaptures({
      afterCursor: context.lastCursor,
      conversation: conversationCaptureRefFromCapture(context.firstItem.summary),
      knownCaptureIds: context.captureIds,
    })
    if (lateCaptures.captures.length === 0) {
      return {
        kind: 'no-new-input',
      }
    }

    const nextContext = await mergeAssistantAutoReplyGroupContext({
      context,
      lateCaptures: lateCaptures.captures,
      vault: input.vault,
    })
    if (!nextContext) {
      throw new AssistantActiveTurnInputBudgetExceededError(
        'new same-conversation input could not be materialized into the active turn; will retry later.',
      )
    }
    if (nextContext.captureIds.length <= context.captureIds.length) {
      return {
        kind: 'no-new-input',
      }
    }

    const acceptedInputContext = await createAssistantAutoReplyContextForCaptures({
      captures: lateCaptures.captures,
      vault: input.vault,
    })
    if (!acceptedInputContext) {
      throw new AssistantActiveTurnInputBudgetExceededError(
        'new same-conversation input could not be materialized into the active turn; will retry later.',
      )
    }
    const shownAcceptedInput = await loadAssistantAutoReplyCaptures({
      group: acceptedInputContext,
      inboxServices: input.inboxServices,
      requestId: input.requestId,
      vault: input.vault,
    })
    const preparedInput = await prepareAssistantAutoReplyInput(
      shownAcceptedInput,
      input.vault,
    )
    if (preparedInput.kind !== 'ready') {
      throw new AssistantActiveTurnInputBudgetExceededError(
        preparedInput.reason,
      )
    }

    const shownFinalGroup = await loadAssistantAutoReplyCaptures({
      group: nextContext,
      inboxServices: input.inboxServices,
      requestId: input.requestId,
      vault: input.vault,
    })

    const previousCursor = context.lastCursor
    context = nextContext
    input.onAcceptedContext(context)
    input.onEvent?.({
      type: 'capture.reply-progress',
      captureId: context.firstCaptureId,
      details: `new input accepted into active turn with ${lateCaptures.captures.length} additional capture(s)`,
      providerKind: 'status',
      providerState: 'running',
    })

    return {
      acceptedInputs: buildAutoReplyAcceptedTurnInputItems({
        captures: lateCaptures.captures,
        cursorFrom: previousCursor,
        cursorTo: lateCaptures.nextCursor,
      }),
      deliveryReplyToMessageId:
        readAutoReplyDeliveryReplyToMessageId(shownFinalGroup),
      kind: 'accepted',
      prompt: preparedInput.prompt,
      receiptMetadata: {
        [AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY]: context.firstCaptureId,
        [AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]: context.captureIds.join(','),
      },
      transcriptText: buildAutoReplyAcceptedTurnTranscriptText(
        lateCaptures.captures,
      ),
      userMessageContent: preparedInput.userMessageContent,
    }
  }
}

function buildAutoReplyAcceptedTurnTranscriptText(
  captures: readonly AssistantAutoReplyGroupItem['summary'][],
): string | null {
  const lines = captures
    .map(buildAutoReplyAcceptedCaptureTranscriptText)
    .filter((text): text is string => text !== null)
  return lines.length > 0 ? lines.join('\n\n') : null
}

function buildAutoReplyAcceptedCaptureTranscriptText(
  capture: AssistantAutoReplyGroupItem['summary'],
): string | null {
  const text = normalizeNullableString(capture.text)
  if (text) {
    return text
  }

  if (capture.attachmentCount > 0) {
    return capture.attachmentCount === 1
      ? 'User sent an attachment.'
      : `User sent ${capture.attachmentCount} attachments.`
  }

  return 'User sent a new message.'
}

function createAssistantAutoReplyActiveTurnCheckpointHook(
  port?: AssistantTurnInputPort,
): AssistantActiveTurnInputCheckpointHook | undefined {
  if (!port?.checkpointAcceptedInput) {
    return undefined
  }
  const checkpointAcceptedInput = port.checkpointAcceptedInput.bind(port)

  return async (checkpointInput) => {
    try {
      await checkpointAcceptedInput(checkpointInput)
    } catch (error) {
      throw error
    }
  }
}

function buildAutoReplyAcceptedTurnInputItems(input: {
  captures: readonly AssistantAutoReplyGroupItem['summary'][]
  cursorFrom: AssistantAutomationCursor | null
  cursorTo: AssistantAutomationCursor | null
}): readonly AssistantAcceptedTurnInputItemInput[] {
  const captureIds = input.captures.map((capture) => capture.captureId)
  return input.captures.map((capture) => ({
    captureIds: [capture.captureId],
    contentRef: {
      kind: 'inbox-capture',
      refId: capture.captureId,
      version: null,
    },
    cursorEffects: [
      {
        captureIds,
        cursorKind: 'auto-reply-channel',
        from: input.cursorFrom,
        source: 'assistant-auto-reply',
        to: input.cursorTo,
      },
    ],
    id: `inbox:${capture.captureId}`,
    promptFallbackReason: 'system-input',
    promptFallbackText: buildAutoReplyAcceptedCaptureTranscriptText(capture),
    source: 'inbox',
  }))
}

async function mergeAssistantAutoReplyGroupContext(input: {
  context: AssistantAutoReplyGroupContext
  lateCaptures: readonly AssistantAutoReplyGroupItem['summary'][]
  vault: string
}): Promise<AssistantAutoReplyGroupContext | null> {
  const itemsByCaptureId = new Map(
    input.context.items.map((item) => [item.summary.captureId, item] as const),
  )
  const lateItems = await loadAssistantAutoReplyGroupItems({
    captures: input.lateCaptures,
    vault: input.vault,
  })

  for (const item of lateItems) {
    itemsByCaptureId.set(item.summary.captureId, item)
  }

  const items = [...itemsByCaptureId.values()].sort((left, right) =>
    compareAssistantCaptureOrder(left.summary, right.summary),
  )

  return createAssistantAutoReplyGroupContext(items)
}

async function createAssistantAutoReplyContextForCaptures(input: {
  captures: readonly AssistantAutoReplyGroupItem['summary'][]
  vault: string
}): Promise<AssistantAutoReplyGroupContext | null> {
  const items = await loadAssistantAutoReplyGroupItems({
    captures: input.captures,
    vault: input.vault,
  })

  return createAssistantAutoReplyGroupContext(items)
}

function readAutoReplyDeliveryReplyToMessageId(
  captures: readonly AssistantAutoReplyPromptCapture[],
): string | null {
  const primaryCapture = captures[0]?.capture
  if (!primaryCapture) {
    return null
  }

  if (primaryCapture.source === 'linq') {
    for (let index = captures.length - 1; index >= 0; index -= 1) {
      const messageId = readLinqReplyToMessageId(captures[index]?.capture)
      if (messageId) {
        return messageId
      }
    }
    return null
  }

  if (primaryCapture.source !== 'telegram') {
    return null
  }

  for (let index = captures.length - 1; index >= 0; index -= 1) {
    const messageId = normalizeNullableString(
      captures[index]?.telegramMetadata?.messageId,
    )
    if (messageId) {
      return messageId
    }
  }

  return null
}

function readLinqReplyToMessageId(capture: InboxShowResult['capture']): string | null {
  if (capture.source !== 'linq') {
    return null
  }

  const externalId = normalizeNullableString(capture.externalId)
  if (!externalId?.startsWith('linq:')) {
    return null
  }

  const messageId = normalizeNullableString(externalId.slice('linq:'.length))
  if (!messageId || messageId.startsWith('hbid:linq.message:')) {
    return null
  }

  return messageId
}

function resolveAssistantAutoReplySendResult(input: {
  onEvent?: (event: AssistantRunEvent) => void
  replyCaptureId: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
}): Awaited<ReturnType<typeof sendAssistantMessage>> {
  if (input.result.deliveryDeferred) {
    input.onEvent?.({
      type: 'capture.reply-progress',
      captureId: input.replyCaptureId,
      details: input.result.deliveryIntentId
        ? `assistant queued outbound delivery for retry as ${input.result.deliveryIntentId}`
        : 'assistant queued outbound delivery for retry',
      providerKind: 'status',
      providerState: 'completed',
    })
    return input.result
  }

  if (input.result.deliveryError || input.result.delivery === null) {
    const error = new Error(
      input.result.deliveryError?.message ??
        'assistant generated a response, but the outbound delivery channel did not confirm the send',
    )
    if (input.result.deliveryIntentId) {
      Object.defineProperty(error, 'outboxIntentId', {
        configurable: true,
        enumerable: false,
        value: input.result.deliveryIntentId,
        writable: true,
      })
    }
    throw error
  }

  return input.result
}

function classifyAssistantAutoReplyFailure(input: {
  captureCount: number
  error: unknown
}): AssistantAutoReplyGroupOutcome {
  if (isAssistantProviderStalledError(input.error)) {
    return createDeferredGroupOutcome({
      captureCount: input.captureCount,
      nextWakeAt: computeAssistantAutoReplyRetryAt(input.error),
      reason: AUTO_REPLY_PROVIDER_STALLED_DETAIL,
      stopScanning: true,
    })
  }

  const detail = errorMessage(input.error)
  if (isAssistantProviderConnectionLostError(input.error)) {
    return createDeferredGroupOutcome({
      captureCount: input.captureCount,
      nextWakeAt: computeAssistantAutoReplyRetryAt(input.error),
      reason: `${detail} Will retry this capture after the provider reconnects.`,
      stopScanning: true,
    })
  }

  if (isAssistantProviderCapacityError(input.error)) {
    return createFailedGroupOutcome({
      advanceCursor: false,
      error: input.error,
      nextWakeAt: computeAssistantAutoReplyRetryAt(input.error),
      stopScanning: true,
    })
  }

  if (shouldAssistantAutoReplyHoldCursorOnFailure(input.error)) {
    return createFailedGroupOutcome({
      advanceCursor: false,
      error: input.error,
      nextWakeAt: computeAssistantAutoReplyRetryAt(input.error),
      stopScanning: true,
    })
  }

  return createFailedGroupOutcome({
    advanceCursor: true,
    error: input.error,
  })
}

function shouldAssistantAutoReplyHoldCursorOnFailure(error: unknown): boolean {
  return isAssistantAutoReplyRepairableConfigError(error)
}

function classifyAssistantAutoReplyGroupArtifactStatus(
  artifacts: readonly boolean[],
): AssistantAutoReplyGroupArtifactStatus {
  if (artifacts.every(Boolean)) {
    return 'complete'
  }
  if (artifacts.some(Boolean)) {
    return 'partial'
  }
  return 'none'
}

function createAdvancingSkipDecision(
  reason: string,
): AssistantAutoReplySkipDecision {
  return {
    advanceCursor: true,
    kind: 'skip',
    nextWakeAt: null,
    reason,
    stopScanning: false,
  }
}

async function assistantAutoReplyHandledByTurnReceipt(
  vault: string,
  captureIds: readonly string[],
): Promise<boolean> {
  const primaryCaptureId = captureIds[0]
  if (!primaryCaptureId) {
    return false
  }

  const recentReceipts = await listAssistantTurnReceipts(vault, 200)
  return recentReceipts.some((receipt) => {
    if (!(receipt.status === 'completed' || receipt.status === 'deferred')) {
      return false
    }

    return receipt.timeline.some((event) => {
      if (
        event.kind !== 'turn.started' &&
        event.kind !== 'turn.input.accepted'
      ) {
        return false
      }

      if (event.metadata[AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY] === primaryCaptureId) {
        return true
      }

      const groupedCaptureIds = event.metadata[AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]
        ?.split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)

      return groupedCaptureIds?.includes(primaryCaptureId) ?? false
    })
  })
}

function createDeferredSkipDecision(
  reason: string,
  input?: {
    nextWakeAt?: string | null
  },
): AssistantAutoReplySkipDecision {
  return {
    advanceCursor: false,
    kind: 'skip',
    nextWakeAt:
      input?.nextWakeAt === undefined
        ? computeAssistantAutomationRetryAt(
            ASSISTANT_AUTO_REPLY_DEFERRED_RETRY_DELAY_MS,
          )
        : input.nextWakeAt,
    reason,
    stopScanning: true,
  }
}

async function isRecentSelfAuthoredAssistantEcho(input: {
  capture: InboxShowResult['capture']
  vault: string
}): Promise<boolean> {
  const captureText = normalizeNullableString(input.capture.text)
  if (!captureText) {
    return false
  }

  let resolved: Awaited<ReturnType<typeof resolveAssistantSession>>
  try {
    resolved = await resolveAssistantSession({
      vault: input.vault,
      createIfMissing: false,
      conversation: conversationRefFromCapture(input.capture),
    })
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null
    if (code === 'ASSISTANT_SESSION_NOT_FOUND') {
      return false
    }
    throw error
  }

  const referenceTimestamp =
    normalizeNullableString(resolved.session.lastTurnAt) ??
    normalizeNullableString(resolved.session.updatedAt) ??
    normalizeNullableString(resolved.session.createdAt)
  if (!referenceTimestamp) {
    return false
  }

  const referenceTime = Date.parse(referenceTimestamp)
  const captureTime = Date.parse(input.capture.occurredAt)
  if (!Number.isFinite(referenceTime) || !Number.isFinite(captureTime)) {
    return false
  }

  if (
    captureTime < referenceTime ||
    captureTime - referenceTime > SELF_AUTHORED_ECHO_WINDOW_MS
  ) {
    return false
  }

  const transcript = await listAssistantTranscriptEntries(
    input.vault,
    resolved.session.sessionId,
  )
  const lastAssistantEntry = [...transcript]
    .reverse()
    .find((entry) => entry.kind === 'assistant')
  if (!lastAssistantEntry) {
    return false
  }

  return (
    normalizeComparableText(lastAssistantEntry.text) ===
    normalizeComparableText(captureText)
  )
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}
