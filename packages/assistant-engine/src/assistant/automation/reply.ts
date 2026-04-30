import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantUserMessageContentPart } from '../content-types.js'
import type { AssistantAcceptedTurnInputItemInput } from '../active-turn-input-journal.js'
import { getAssistantChannelAdapter } from '../channel-adapters.js'
import {
  conversationCaptureRefFromCapture,
  conversationRefFromCapture,
  type AssistantConversationCaptureRef,
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
import { sanitizeAssistantPortableStateString } from '../redaction.js'
import { errorMessage, normalizeNullableString } from '../shared.js'
import { sendAssistantMessage } from '../service.js'
import {
  AssistantActiveTurnInputBudgetExceededError,
  AssistantActiveTurnInputUnavailableError,
  isAssistantActiveTurnInputBudgetExceededError,
  isAssistantActiveTurnInputCheckpointRejectedError,
  isAssistantActiveTurnInputUnavailableError,
  type AssistantActiveTurnInputCheckpointHook,
  type AssistantActiveTurnInputCheckpointInput,
  type AssistantActiveTurnInputAdmissionResult,
  type AssistantActiveTurnInputAdmissionHook,
} from '../turn-input.js'
import type {
  AssistantInputCandidateBatch,
  AssistantInputCandidate,
  AssistantInputSource,
} from '../input-source.js'
import { compareAssistantInputCursors } from '../input-store.js'
import {
  listAssistantTranscriptEntries,
  resolveAssistantSession,
} from '../store.js'
import {
  writeAssistantChatErrorArtifacts,
} from './artifacts.js'
import {
  readAssistantAutoReplyTerminalEvidence,
  type AssistantAutoReplyTerminalEvidence,
  writeAssistantAutoReplyReplyIntentEvidence,
  writeAssistantAutoReplyReplyTerminalEvidence,
  writeAssistantAutoReplySuppressionEvidence,
} from './evidence.js'
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
  earliestAssistantAutomationWakeAt,
  type AssistantAutoReplyScanResult,
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
  inputIds: string[]
  items: readonly AssistantAutoReplyGroupItem[]
  lastInputCursor: AssistantInputCandidate['event']['cursor']
}

interface AssistantAutoReplyReplyDecision {
  deliveryTarget: string | null
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
  checkpointRequired?: true
  nextWakeAt: string | null
  reason: string
  stopScanning: boolean
  terminalSuppression: boolean
}

type AssistantAutoReplyDecision =
  | { kind: 'ignore' }
  | AssistantAutoReplyReplyDecision
  | AssistantAutoReplySkipDecision

type AssistantActiveTurnInputSource = Pick<
  AssistantInputSource,
  'checkpointAcceptedInput' | 'listNewConversationInputs' | 'refresh'
> & Partial<Pick<AssistantInputSource, 'listInputCandidates'>>

type AssistantAutoReplySendResult = Awaited<
  ReturnType<typeof sendAssistantMessage>
>

interface AssistantAutoReplyResolvedGroupOutcome {
  context: AssistantAutoReplyGroupContext
  outcome: AssistantAutoReplyGroupOutcome
}

interface AssistantAutoReplyTerminalSnapshot {
  deliveryIntentId: string | null
  groupCaptureIds: string[] | null
  outcome: 'deferred' | 'result'
  recordedAt: string
  sessionId: string
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
  checkpointRequired?: true
  event: AssistantAutoReplyOutcomeEvent
  kind: 'deferred' | 'failed' | 'ignored' | 'replied' | 'skipped'
  nextWakeAt: string | null
  stopScanning: boolean
  summary: AssistantAutoReplyOutcomeSummary
  terminalSuppression: boolean
}

export interface AssistantAutoReplyProcessResult {
  advanceCursor: boolean
  checkpointRequired?: true
  failed: number
  lastInputCursor: AssistantInputCandidate['event']['cursor']
  nextWakeAt: string | null
  replied: number
  skipped: number
  stopScanning: boolean
}

export function applyAssistantAutoReplyProcessResult(input: {
  context: AssistantAutoReplyGroupContext
  result: AssistantAutoReplyProcessResult
  summary: AssistantAutoReplyScanResult
}): boolean {
  if (input.result.checkpointRequired) {
    input.summary.checkpointRequired = true
  }
  input.summary.failed += input.result.failed
  input.summary.nextWakeAt = earliestAssistantAutomationWakeAt(
    input.summary.nextWakeAt,
    input.result.nextWakeAt,
  )
  input.summary.replied += input.result.replied
  input.summary.skipped += input.result.skipped

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
  if (items.some((item) => !item.inputCandidate)) {
    return null
  }

  return {
    captureCount: items.length,
    captureIds: items.map((item) => item.summary.captureId),
    firstCaptureId: firstItem.summary.captureId,
    firstItem,
    inputIds: items.map((item) => item.inputCandidate!.event.inputId),
    items,
    lastInputCursor: lastItem.inputCandidate!.event.cursor,
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
  inputSource?: AssistantActiveTurnInputSource
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
    if (isAssistantActiveTurnInputCheckpointRejectedError(error)) {
      throw error
    }

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
  inputSource?: AssistantActiveTurnInputSource
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
  const activeTurnHooks = input.inputSource
    ? createAssistantAutoReplyActiveTurnInputHooks({
        context: input.context,
        inboxServices: input.inboxServices,
        onAcceptedContext(nextContext) {
          acceptedContext = nextContext
          input.onAcceptedContext?.(nextContext)
        },
        onEvent: input.onEvent,
        inputSource: input.inputSource,
        requestId: input.requestId,
        vault: input.vault,
      })
    : null
  const result = await executeAssistantAutoReply({
    acceptedTurnInputInitialInputs: buildAutoReplyAcceptedTurnInputItems({
      captures: input.context.items.map((item) => item.summary),
      inputCandidates: input.context.items.map((item) => item.inputCandidate ?? null),
    }),
    captureIds: input.context.captureIds,
    deliveryDispatchMode: input.deliveryDispatchMode,
    deliveryTarget: decision.deliveryTarget,
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
    activeTurnInput: activeTurnHooks?.admit,
    activeTurnCheckpoint: activeTurnHooks?.checkpoint,
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
  const artifactResult = await writeAssistantAutoReplyOutcomeArtifacts(input).catch((error) => {
    if (input.outcome.artifact.kind === 'error') {
      return { checkpointRequired: false }
    }
    throw error
  })
  emitAssistantAutoReplyOutcomeEvent(input)

  return {
    advanceCursor: input.outcome.advanceCursor,
    ...(input.outcome.checkpointRequired || artifactResult.checkpointRequired
      ? { checkpointRequired: true }
      : {}),
    failed: input.outcome.summary.failed,
    lastInputCursor: input.context.lastInputCursor,
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
}): Promise<{ checkpointRequired: boolean }> {
  switch (input.outcome.artifact.kind) {
    case 'none':
      if (input.outcome.kind === 'skipped' && input.outcome.terminalSuppression) {
        await writeAssistantAutoReplySuppressionEvidence({
          captureIds: input.context.captureIds,
          inputIds: input.context.inputIds,
          linqMessageIds: resolveAutoReplyLinqProviderMessageIdsFromContext(input.context),
          reason: sanitizeAssistantAutoReplySuppressionReason(
            input.outcome.event?.details,
          ),
          vault: input.vault,
        })
        return { checkpointRequired: true }
      }
      return { checkpointRequired: false }
    case 'result': {
      const delivery = input.outcome.artifact.result.delivery
      if (!delivery) {
        throw new Error(
          'assistant auto-reply delivery was missing after delivery confirmation',
        )
      }

      await writeAssistantAutoReplyReplyIntentEvidence({
        captureIds: input.context.captureIds,
        inputIds: input.context.inputIds,
        linqMessageIds: resolveAutoReplyLinqProviderMessageIdsFromContext(input.context),
        outcome: 'result',
        recordedAt: delivery.sentAt,
        result: input.outcome.artifact.result,
        vault: input.vault,
      })
      return { checkpointRequired: true }
    }
    case 'deferred': {
      const queuedAt = new Date().toISOString()
      await writeAssistantAutoReplyReplyIntentEvidence({
        captureIds: input.context.captureIds,
        inputIds: input.context.inputIds,
        linqMessageIds: resolveAutoReplyLinqProviderMessageIdsFromContext(input.context),
        outcome: 'deferred',
        recordedAt: queuedAt,
        result: input.outcome.artifact.result,
        vault: input.vault,
      })
      return { checkpointRequired: true }
    }
    case 'error':
      await writeAssistantChatErrorArtifacts({
        captureIds: input.context.captureIds,
        failure: input.outcome.artifact.failure,
        vault: input.vault,
      })
      return { checkpointRequired: false }
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
    terminalSuppression: false,
  }
}

function createSkippedDecisionOutcome(input: {
  captureCount: number
  decision: AssistantAutoReplySkipDecision
}): AssistantAutoReplyGroupOutcome {
  if (input.decision.advanceCursor) {
    const outcome = createSkippedGroupOutcome({
      captureCount: input.captureCount,
      reason: input.decision.reason,
      nextWakeAt: input.decision.nextWakeAt,
      stopScanning: input.decision.stopScanning,
      terminalSuppression: input.decision.terminalSuppression,
    })
    return {
      ...outcome,
      ...(input.decision.checkpointRequired ? { checkpointRequired: true } : {}),
    }
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
  terminalSuppression: boolean
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
    terminalSuppression: input.terminalSuppression,
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
    terminalSuppression: false,
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
      safeDetails: 'delivery queued for retry',
      type: 'capture.replied',
    },
    kind: 'deferred',
    nextWakeAt: null,
    stopScanning: false,
    summary: createAssistantAutoReplyOutcomeSummary({
      replied: 1,
    }),
    terminalSuppression: false,
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
      details: 'delivery confirmed',
      safeDetails: 'delivery confirmed',
      type: 'capture.replied',
    },
    kind: 'replied',
    nextWakeAt: null,
    stopScanning: false,
    summary: createAssistantAutoReplyOutcomeSummary({
      replied: 1,
    }),
    terminalSuppression: false,
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
    terminalSuppression: false,
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

  const existingTerminalEvidence = await Promise.all(
    input.group.inputIds.map((inputId, index) =>
      readAssistantAutoReplyTerminalEvidence(input.vault, inputId).then(
        (evidence) =>
          evidence ??
          readAssistantAutoReplyTerminalEvidence(
            input.vault,
            input.group.captureIds[index] ?? inputId,
          ),
      ),
    ),
  )
  const repairEvidence = findRepairableTerminalEvidenceForGroup(
    input.group.captureIds,
    existingTerminalEvidence,
  )
  if (repairEvidence) {
    const repairCaptureIds = resolveTerminalEvidenceRepairCaptureIds({
      captureIds: input.group.captureIds,
      evidence: repairEvidence,
    })
    if (
      !(await terminalEvidenceExistsForEveryCapture(input.vault, repairCaptureIds))
    ) {
      await backfillAssistantAutoReplyTerminalEvidenceFromTerminalEvidence({
        captureIds: repairCaptureIds,
        evidence: repairEvidence,
        vault: input.vault,
      })
      return createAdvancingSkipDecision('assistant reply already handled', {
        checkpointRequired: true,
        terminalSuppression: false,
      })
    }

    return createAdvancingSkipDecision('assistant reply already handled', {
      terminalSuppression: false,
    })
  }

  if (existingTerminalEvidence.every((evidence) => evidence !== null)) {
    return createAdvancingSkipDecision('assistant reply already handled', {
      terminalSuppression: false,
    })
  }

  if (existingTerminalEvidence.some((evidence) => evidence !== null)) {
    return createDeferredSkipDecision(
      'assistant reply terminal evidence is incomplete; will retry this capture after evidence is rebuilt.',
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
  const handledReceipt = await resolveAssistantAutoReplyHandledTurnReceipt(
    input.vault,
    input.group.captureIds,
  )
  if (handledReceipt) {
    await backfillAssistantAutoReplyTerminalEvidenceFromTerminalSnapshot({
      captureIds: input.group.captureIds,
      context: input.group,
      snapshot: handledReceipt,
      vault: input.vault,
    })
    return createAdvancingSkipDecision('assistant reply already handled', {
      checkpointRequired: true,
      terminalSuppression: false,
    })
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
    deliveryTarget: readAutoReplyDeliveryTarget(input.group),
    deliveryReplyToMessageId: readAutoReplyDeliveryReplyToMessageId({
      captures: shownGroup,
      context: input.group,
    }),
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
    input.group.items.map(async (item) => {
      if (item.inputCandidate) {
        return createAssistantAutoReplyPromptCaptureFromInput(item)
      }

      return {
        capture: (
          await input.inboxServices.show({
            vault: input.vault,
            requestId: input.requestId,
            captureId: item.summary.captureId,
          })
        ).capture,
        telegramMetadata: item.telegramMetadata,
      }
    }),
  )
}

function createAssistantAutoReplyPromptCaptureFromInput(
  item: AssistantAutoReplyGroupItem,
): AssistantAutoReplyPromptCapture {
  const candidate = item.inputCandidate
  return {
    capture: {
      ...item.summary,
      attachments: [],
      createdAt:
        item.summary.createdAt ??
        item.summary.receivedAt ??
        item.summary.occurredAt,
      text:
        candidate?.event.transcriptText ??
        candidate?.event.text ??
        item.summary.text,
    },
    telegramMetadata: item.telegramMetadata,
  }
}

async function executeAssistantAutoReply(input: {
  acceptedTurnInputInitialInputs?: readonly AssistantAcceptedTurnInputItemInput[] | null
  activeTurnCheckpoint?: AssistantActiveTurnInputCheckpointHook
  activeTurnInput?: AssistantActiveTurnInputAdmissionHook
  captureIds: readonly string[]
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  deliveryTarget: string | null
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
  const conversation = conversationRefFromCapture(input.primaryCapture)

  try {
    const result = await sendAssistantMessage({
      vault: input.vault,
      acceptedTurnInput: {
        initialInputs: input.acceptedTurnInputInitialInputs ?? null,
      },
      conversation,
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
      deliveryTarget: input.deliveryTarget,
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

interface AssistantAutoReplyActiveTurnPendingAcceptance {
  acceptedInputIds: readonly string[]
  captureIds: readonly string[]
  apply(): void
}

function createAssistantAutoReplyActiveTurnInputHooks(input: {
  context: AssistantAutoReplyGroupContext
  inboxServices: InboxServices
  onAcceptedContext(context: AssistantAutoReplyGroupContext): void
  onEvent?: (event: AssistantRunEvent) => void
  inputSource: AssistantActiveTurnInputSource
  requestId: string | null
  vault: string
}): {
  admit: AssistantActiveTurnInputAdmissionHook
  checkpoint?: AssistantActiveTurnInputCheckpointHook
} {
  let context = input.context
  let conversation = readAutoReplyConversationCaptureRef(context)
  const pendingAcceptances: AssistantAutoReplyActiveTurnPendingAcceptance[] = []

  const admit: AssistantActiveTurnInputAdmissionHook = async (admissionInput) => {
    const refreshResult = await input.inputSource.refresh({
      phase: admissionInput.phase,
      signal: admissionInput.signal,
    })
    if (refreshResult.reason === 'source_unavailable') {
      throw new AssistantActiveTurnInputUnavailableError(
        'same-conversation input source is temporarily unavailable during the active turn; will retry later.',
      )
    }

    const knownCaptureIds = [
      ...context.captureIds,
      ...pendingAcceptances.flatMap((pending) => pending.captureIds),
      ...(admissionInput.knownCaptureIds ?? []),
    ]
    const knownInputIds = [
      ...context.inputIds,
      ...pendingAcceptances.flatMap((pending) => pending.acceptedInputIds),
      ...(admissionInput.knownInputIds ?? []),
    ]
    const lateInputs = await listAutoReplyActiveTurnInputs({
      afterCursor: context.lastInputCursor,
      conversation,
      context,
      inputSource: input.inputSource,
      knownCaptureIds,
      knownInputIds,
      signal: admissionInput.signal,
    })
    if (lateInputs.inputs.length === 0) {
      return {
        kind: 'no-new-input',
      }
    }

    const lateCaptureCandidates = lateInputs.inputs.filter(
      (candidate) => candidate.projection.captureId !== null,
    )
    const lateCapturelessCandidates = lateInputs.inputs.filter(
      (candidate) => candidate.projection.captureId === null,
    )
    if (lateCaptureCandidates.length === 0) {
      return admitCapturelessAssistantInputs({
        getContext: () => context,
        inputSourceCursor: lateInputs.nextCursor,
        lateInputs: lateCapturelessCandidates,
        onAcceptedContext(nextContext) {
          context = nextContext
          conversation = readAutoReplyConversationCaptureRef(nextContext)
          input.onAcceptedContext(nextContext)
        },
        onEvent: input.onEvent,
        pendingAcceptances,
      })
    }

    const lateCaptures = await loadAssistantInputCandidateCaptureSummaries({
      candidates: lateCaptureCandidates,
    })
    const lateInputCandidatesByCaptureId = new Map(
      lateCaptureCandidates.flatMap((candidate) =>
        candidate.projection.captureId
          ? [[candidate.projection.captureId, candidate] as const]
          : [],
      ),
    )
    const nextContext = await mergeAssistantAutoReplyGroupContext({
      context,
      inputCandidatesByCaptureId: lateInputCandidatesByCaptureId,
      lateCaptures,
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
      captures: lateCaptures,
      inputCandidatesByCaptureId: lateInputCandidatesByCaptureId,
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

    const captureAcceptedInputs = buildAutoReplyAcceptedTurnInputItems({
      captures: lateCaptures,
      inputCandidates: lateCaptureCandidates,
    })
    const capturelessAcceptedInputs = buildCapturelessAcceptedTurnInputItems(
      lateCapturelessCandidates,
    )
    const acceptedInputs = [
      ...captureAcceptedInputs,
      ...capturelessAcceptedInputs,
    ]
    const acceptedInputReplyToMessageId =
      readLatestAssistantInputReplyTargetMessageId({
        candidates: lateInputs.inputs,
        expectedChannel: context.firstItem.summary.source,
      })
    input.onEvent?.({
      type: 'capture.reply-progress',
      captureId: context.firstCaptureId,
      details: `new input queued for active turn with ${lateInputs.inputs.length} additional input(s)`,
      providerKind: 'status',
      providerState: 'running',
    })
    pendingAcceptances.push({
      acceptedInputIds: acceptedInputs.map((item) => item.id),
      captureIds: lateCaptures.map((capture) => capture.captureId),
      apply() {
        context = mergeAssistantAutoReplyContextItems({
          context,
          items: [
            ...nextContext.items,
            ...lateCapturelessCandidates.map(
              assistantAutoReplyGroupItemFromInputCandidate,
            ),
          ],
          lastInputCursor: lateInputs.nextCursor ?? nextContext.lastInputCursor,
        })
        conversation = readAutoReplyConversationCaptureRef(context)
        input.onAcceptedContext(context)
        input.onEvent?.({
          type: 'capture.reply-progress',
          captureId: context.firstCaptureId,
          details: `new input committed to active turn with ${lateInputs.inputs.length} additional input(s)`,
          providerKind: 'status',
          providerState: 'running',
        })
      },
    })

    const result: AssistantActiveTurnInputAdmissionResult = {
      acceptedInputs,
      deliveryReplyToMessageId:
        acceptedInputReplyToMessageId ??
        readAutoReplyDeliveryReplyToMessageId({
          captures: shownFinalGroup,
          context: nextContext,
        }),
      kind: 'accepted',
      prompt: appendCapturelessAssistantInputPrompt({
        capturePrompt: preparedInput.prompt,
        capturelessInputs: lateCapturelessCandidates,
      }),
      receiptMetadata: {
        [AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY]: nextContext.firstCaptureId,
        [AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]: nextContext.captureIds.join(','),
      },
      transcriptText: buildAutoReplyAcceptedInputTranscriptText(
        lateInputs.inputs,
        lateCaptures,
      ),
      userMessageContent: mergeAssistantUserMessageContent(
        preparedInput.userMessageContent,
        lateCapturelessCandidates.flatMap(
          (candidate) => candidate.event.userMessageContent ?? [],
        ),
      ),
    }
    return result
  }

  return {
    admit,
    checkpoint: createAssistantAutoReplyActiveTurnCheckpointHook({
      pendingAcceptances,
      inputSource: input.inputSource,
    }),
  }
}

async function listAutoReplyActiveTurnInputs(input: {
  afterCursor: AssistantInputCandidate['event']['cursor']
  context: AssistantAutoReplyGroupContext
  conversation: AssistantConversationCaptureRef
  inputSource: AssistantActiveTurnInputSource
  knownCaptureIds: readonly string[]
  knownInputIds: readonly string[]
  signal?: AbortSignal
}): Promise<AssistantInputCandidateBatch> {
  const strict = await input.inputSource.listNewConversationInputs({
    afterCursor: input.afterCursor,
    conversation: input.conversation,
    knownCaptureIds: input.knownCaptureIds,
    knownInputIds: input.knownInputIds,
    signal: input.signal,
  })
  const expectedChannel = normalizeNullableString(input.context.firstItem.summary.source)
  const deliveryTarget = readAutoReplyDeliveryTarget(input.context)
  if (!input.inputSource.listInputCandidates || !expectedChannel || !deliveryTarget) {
    return strict
  }

  const routeListed = await input.inputSource.listInputCandidates({
    afterCursor: input.afterCursor,
    knownInputIds: [
      ...input.knownInputIds,
      ...strict.inputs.map((candidate) => candidate.event.inputId),
    ],
    limit: 100,
    signal: input.signal,
    sourceId: expectedChannel,
  })
  const knownCaptureIds = new Set(input.knownCaptureIds)
  const routeInputs = routeListed.inputs
    .filter((candidate) =>
      candidate.projection.captureId
        ? !knownCaptureIds.has(candidate.projection.captureId)
        : true,
    )
    .filter((candidate) =>
      isSameAutoReplyDeliveryRoute({
        candidate,
        expectedChannel,
        threadId: deliveryTarget,
      }),
    )

  return mergeAssistantInputCandidateBatches([
    strict,
    {
      inputs: routeInputs,
      nextCursor: routeInputs[0]
        ? routeInputs[routeInputs.length - 1]!.event.cursor
        : strict.nextCursor,
    },
  ])
}

function mergeAssistantInputCandidateBatches(
  batches: readonly AssistantInputCandidateBatch[],
): AssistantInputCandidateBatch {
  const byInputId = new Map<string, AssistantInputCandidate>()
  for (const batch of batches) {
    for (const candidate of batch.inputs) {
      byInputId.set(candidate.event.inputId, candidate)
    }
  }
  const inputs = [...byInputId.values()].sort((left, right) =>
    compareAssistantInputCursors(left.event.cursor, right.event.cursor),
  )
  const cursorCandidates = [
    ...batches.map((batch) => batch.nextCursor).filter(
      (cursor): cursor is AssistantInputCandidate['event']['cursor'] =>
        cursor !== null,
    ),
    ...inputs.map((candidate) => candidate.event.cursor),
  ]
  const nextCursor = cursorCandidates.reduce<
    AssistantInputCandidate['event']['cursor'] | null
  >(
    (latest, cursor) =>
      !latest || compareAssistantInputCursors(cursor, latest) > 0
        ? cursor
        : latest,
    null,
  )
  return {
    inputs,
    nextCursor,
  }
}

function isSameAutoReplyDeliveryRoute(input: {
  candidate: AssistantInputCandidate
  expectedChannel: string
  threadId: string
}): boolean {
  const replyTarget = input.candidate.event.replyTarget
  return (
    normalizeNullableString(replyTarget?.channel) === input.expectedChannel &&
    normalizeNullableString(input.candidate.event.source) === input.expectedChannel &&
    readProviderRouteScalar(replyTarget?.threadId) === input.threadId
  )
}

async function loadAssistantInputCandidateCaptureSummaries(input: {
  candidates: readonly AssistantInputCandidate[]
}): Promise<AssistantAutoReplyGroupItem['summary'][]> {
  return input.candidates.map((candidate) =>
    assistantAutoReplyGroupItemFromInputCandidate(candidate).summary
  )
}

function mergeAssistantAutoReplyContextItems(input: {
  context: AssistantAutoReplyGroupContext
  items: readonly AssistantAutoReplyGroupItem[]
  lastInputCursor: AssistantInputCandidate['event']['cursor']
}): AssistantAutoReplyGroupContext {
  const seenInputIds = new Set(
    input.context.items.map((item) =>
      item.inputCandidate?.event.inputId ?? item.summary.captureId,
    ),
  )
  const appendedItems = [...input.items]
    .filter((item) => {
      const key = item.inputCandidate?.event.inputId ?? item.summary.captureId
      if (seenInputIds.has(key)) {
        return false
      }
      seenInputIds.add(key)
      return true
    })
    .sort(compareAssistantAutoReplyItemOrder)
  const next = createAssistantAutoReplyGroupContext([
    ...input.context.items,
    ...appendedItems,
  ])
  if (!next) {
    return input.context
  }

  const lastInputCursor = compareAssistantInputCursors(
    input.lastInputCursor,
    next.lastInputCursor,
  ) > 0
    ? input.lastInputCursor
    : next.lastInputCursor

  return {
    ...next,
    lastInputCursor,
  }
}

function compareAssistantAutoReplyItemOrder(
  left: AssistantAutoReplyGroupItem,
  right: AssistantAutoReplyGroupItem,
): number {
  const leftCursor = left.inputCandidate?.event.cursor ?? null
  const rightCursor = right.inputCandidate?.event.cursor ?? null
  if (leftCursor && rightCursor) {
    return compareAssistantInputCursors(leftCursor, rightCursor)
  }
  return compareAssistantCaptureOrder(left.summary, right.summary)
}

function assistantAutoReplyGroupItemFromInputCandidate(
  candidate: AssistantInputCandidate,
): AssistantAutoReplyGroupItem {
  const conversation = candidate.event.conversation
  const captureId = candidate.projection.captureId ?? candidate.event.inputId
  return {
    inputCandidate: candidate,
    summary: {
      accountId: conversation?.accountId ?? null,
      actorId: conversation?.actorId ?? null,
      actorIsSelf: conversation?.actorIsSelf ?? false,
      actorName: null,
      attachmentCount: candidate.event.attachmentCount,
      captureId,
      createdAt: candidate.event.receivedAt ?? candidate.event.occurredAt,
      envelopePath: `assistant-input-events/${candidate.event.inputId}.json`,
      eventId: candidate.event.inputId,
      externalId: candidate.event.inputId,
      occurredAt: candidate.event.occurredAt,
      promotions: [],
      receivedAt: candidate.event.receivedAt,
      source: candidate.event.source,
      text: candidate.event.transcriptText ?? candidate.event.text,
      threadId: conversation?.threadId ?? candidate.event.inputId,
      threadIsDirect: conversation?.threadIsDirect ?? false,
      threadTitle: null,
    },
    telegramMetadata: null,
  }
}

function admitCapturelessAssistantInputs(input: {
  getContext(): AssistantAutoReplyGroupContext
  inputSourceCursor: AssistantInputCandidate['event']['cursor'] | null
  lateInputs: readonly AssistantInputCandidate[]
  onAcceptedContext(context: AssistantAutoReplyGroupContext): void
  onEvent?: (event: AssistantRunEvent) => void
  pendingAcceptances: AssistantAutoReplyActiveTurnPendingAcceptance[]
}): AssistantActiveTurnInputAdmissionResult {
  const queuedContext = input.getContext()
  const prompt = buildCapturelessAssistantInputPrompt(input.lateInputs)
  if (!prompt) {
    throw new AssistantActiveTurnInputBudgetExceededError(
      'new same-conversation input had no prompt-ready text; will retry later.',
    )
  }
  const acceptedInputs = buildCapturelessAcceptedTurnInputItems(input.lateInputs)
  const acceptedInputIds = acceptedInputs.map((item) => item.id)

  input.onEvent?.({
    type: 'capture.reply-progress',
    captureId: queuedContext.firstCaptureId,
    details: `new input queued for active turn with ${acceptedInputIds.length} additional input(s)`,
    providerKind: 'status',
    providerState: 'running',
  })
  input.pendingAcceptances.push({
    acceptedInputIds,
    captureIds: [],
    apply() {
      const currentContext = input.getContext()
      const nextContext = mergeAssistantAutoReplyContextItems({
        context: currentContext,
        items: input.lateInputs.map(assistantAutoReplyGroupItemFromInputCandidate),
        lastInputCursor: input.inputSourceCursor ?? currentContext.lastInputCursor,
      })
      input.onAcceptedContext(nextContext)
      input.onEvent?.({
        type: 'capture.reply-progress',
        captureId: nextContext.firstCaptureId,
        details: `new input committed to active turn with ${acceptedInputIds.length} additional input(s)`,
        providerKind: 'status',
        providerState: 'running',
      })
    },
  })

  const transcriptText = input.lateInputs
    .map(buildAssistantInputCandidateTranscriptText)
    .filter((text): text is string => text !== null)
    .join('\n\n')

  const deliveryReplyToMessageId = readLatestAssistantInputReplyTargetMessageId({
    candidates: input.lateInputs,
    expectedChannel: queuedContext.firstItem.summary.source,
  })

  return {
    acceptedInputs,
    ...(deliveryReplyToMessageId !== undefined
      ? { deliveryReplyToMessageId }
      : {}),
    kind: 'accepted',
    prompt,
    receiptMetadata: {
      [AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY]: queuedContext.firstCaptureId,
      [AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]: queuedContext.captureIds.join(','),
    },
    transcriptText: transcriptText || null,
    userMessageContent: input.lateInputs.flatMap(
      (candidate) => candidate.event.userMessageContent ?? [],
    ),
  }
}

function buildCapturelessAcceptedTurnInputItems(
  candidates: readonly AssistantInputCandidate[],
): readonly AssistantAcceptedTurnInputItemInput[] {
  return candidates.map((candidate) => ({
    ...candidate.acceptedInput,
    promptFallbackReason:
      candidate.acceptedInput.promptFallbackReason ?? 'system-input',
    promptFallbackText:
      candidate.acceptedInput.promptFallbackText ??
      buildAssistantInputCandidateTranscriptText(candidate),
  }))
}

function buildCapturelessAssistantInputPrompt(
  candidates: readonly AssistantInputCandidate[],
): string | null {
  const sections = candidates
    .map((candidate, index) => {
      const transcript = buildAssistantInputCandidateTranscriptText(candidate)
      if (!transcript) {
        return null
      }
      const prefix = candidates.length > 1 ? `Input ${index + 1}:\n` : ''
      return `${prefix}Source: ${candidate.event.source}
Occurred at: ${candidate.event.occurredAt}

Message text:
${transcript}`
    })
    .filter((section): section is string => section !== null)

  return sections.length > 0 ? sections.join('\n\n') : null
}

function appendCapturelessAssistantInputPrompt(input: {
  capturePrompt: string
  capturelessInputs: readonly AssistantInputCandidate[]
}): string {
  const capturelessPrompt = buildCapturelessAssistantInputPrompt(
    input.capturelessInputs,
  )
  return capturelessPrompt
    ? `${input.capturePrompt}\n\nAdditional same-conversation input:\n${capturelessPrompt}`
    : input.capturePrompt
}

function mergeAssistantUserMessageContent(
  current: AssistantUserMessageContentPart[] | null,
  additional: readonly AssistantUserMessageContentPart[],
): AssistantUserMessageContentPart[] | null {
  const merged = [
    ...(current ?? []),
    ...additional,
  ]
  return merged.length > 0 ? merged : null
}

function buildAssistantInputCandidateTranscriptText(
  candidate: AssistantInputCandidate,
): string | null {
  const text = (candidate.event.userMessageContent ?? [])
    .map((part) =>
      part.type === 'text' ? normalizeNullableString(part.text) : null,
    )
    .filter((partText): partText is string => partText !== null)
    .join('\n\n')
  if (text) {
    return text
  }

  const fallbackText = normalizeNullableString(
    candidate.event.transcriptText ?? candidate.event.text,
  )
  if (fallbackText) {
    return fallbackText
  }

  if (candidate.event.attachmentCount > 0) {
    return candidate.event.attachmentCount === 1
      ? 'User sent an attachment.'
      : `User sent ${candidate.event.attachmentCount} attachments.`
  }

  return null
}

function buildAutoReplyAcceptedTurnTranscriptText(
  captures: readonly AssistantAutoReplyGroupItem['summary'][],
): string | null {
  const lines = captures
    .map(buildAutoReplyAcceptedCaptureTranscriptText)
    .filter((text): text is string => text !== null)
  return lines.length > 0 ? lines.join('\n\n') : null
}

function buildAutoReplyAcceptedInputTranscriptText(
  candidates: readonly AssistantInputCandidate[],
  fallbackCaptures: readonly AssistantAutoReplyGroupItem['summary'][],
): string | null {
  const lines: string[] = []
  let fallbackCaptureIndex = 0
  for (const candidate of candidates) {
    const fallbackCapture = candidate.projection.captureId
      ? fallbackCaptures[fallbackCaptureIndex++]
      : null
    const text =
      buildAssistantInputCandidateTranscriptText(candidate) ??
      (fallbackCapture
        ? buildAutoReplyAcceptedCaptureTranscriptText(fallbackCapture)
        : null)
    if (text) {
      lines.push(text)
    }
  }
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

function createAssistantAutoReplyActiveTurnCheckpointHook(input: {
  pendingAcceptances: AssistantAutoReplyActiveTurnPendingAcceptance[]
  inputSource?: AssistantActiveTurnInputSource
}): AssistantActiveTurnInputCheckpointHook | undefined {
  const checkpointAcceptedInput =
    input.inputSource?.checkpointAcceptedInput?.bind(input.inputSource)

  return async (checkpointInput: AssistantActiveTurnInputCheckpointInput) => {
    await checkpointAcceptedInput?.(checkpointInput)
    const acceptedInputIds = new Set(checkpointInput.acceptedInputIds)
    let applied = 0
    for (const pending of input.pendingAcceptances) {
      if (!pending.acceptedInputIds.every((id) => acceptedInputIds.has(id))) {
        break
      }
      pending.apply()
      applied += 1
    }
    if (applied > 0) {
      input.pendingAcceptances.splice(0, applied)
    }
  }
}

function buildAutoReplyAcceptedTurnInputItems(input: {
  captures: readonly AssistantAutoReplyGroupItem['summary'][]
  inputCandidates: readonly (AssistantInputCandidate | null)[]
}): readonly AssistantAcceptedTurnInputItemInput[] {
  return input.captures.map((capture, index) => {
    const candidate = input.inputCandidates?.[index] ?? null
    if (!candidate) {
      throw new TypeError(
        'Assistant auto-reply accepted input requires an assistant input event candidate.',
      )
    }
    const base = candidate.acceptedInput
    const baseCaptureIds = base.captureIds ?? []
    return {
      ...base,
      captureIds: baseCaptureIds.length > 0 ? baseCaptureIds : [capture.captureId],
      promptFallbackReason: base.promptFallbackReason ?? 'system-input',
      promptFallbackText:
        base.promptFallbackText ??
        buildAssistantInputCandidateTranscriptText(candidate) ??
        buildAutoReplyAcceptedCaptureTranscriptText(capture),
    }
  })
}

async function mergeAssistantAutoReplyGroupContext(input: {
  context: AssistantAutoReplyGroupContext
  inputCandidatesByCaptureId: ReadonlyMap<string, AssistantInputCandidate>
  lateCaptures: readonly AssistantAutoReplyGroupItem['summary'][]
  vault: string
}): Promise<AssistantAutoReplyGroupContext | null> {
  const itemsByCaptureId = new Map(
    input.context.items.map((item) => [item.summary.captureId, item] as const),
  )
  const lateItems = await loadAssistantAutoReplyGroupItems({
    captures: input.lateCaptures,
    inputCandidatesByCaptureId: input.inputCandidatesByCaptureId,
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
  inputCandidatesByCaptureId?: ReadonlyMap<string, AssistantInputCandidate>
  vault: string
}): Promise<AssistantAutoReplyGroupContext | null> {
  const items = await loadAssistantAutoReplyGroupItems({
    captures: input.captures,
    inputCandidatesByCaptureId: input.inputCandidatesByCaptureId,
    vault: input.vault,
  })

  return createAssistantAutoReplyGroupContext(items)
}

function readAutoReplyDeliveryReplyToMessageId(input: {
  captures: readonly AssistantAutoReplyPromptCapture[]
  context: AssistantAutoReplyGroupContext
}): string | null {
  const inputReplyToMessageId = readLatestAssistantInputReplyTargetMessageId({
    candidates: autoReplyInputCandidatesFromContext(input.context),
    expectedChannel: input.context.firstItem.summary.source,
  })
  if (inputReplyToMessageId !== undefined) {
    return inputReplyToMessageId
  }

  const primaryCapture = input.captures[0]?.capture
  if (!primaryCapture) {
    return null
  }

  if (primaryCapture.source === 'linq') {
    for (let index = input.captures.length - 1; index >= 0; index -= 1) {
      const messageId = readLinqReplyToMessageId(input.captures[index]?.capture)
      if (messageId) {
        return messageId
      }
    }
    return null
  }

  if (primaryCapture.source !== 'telegram') {
    return null
  }

  for (let index = input.captures.length - 1; index >= 0; index -= 1) {
    const messageId = normalizeNullableString(
      input.captures[index]?.telegramMetadata?.messageId,
    )
    if (messageId) {
      return messageId
    }
  }

  return null
}

function readAutoReplyDeliveryTarget(
  context: AssistantAutoReplyGroupContext,
): string | null {
  const replyTarget = readLatestAssistantInputReplyTarget({
    candidates: autoReplyInputCandidatesFromContext(context),
    expectedChannel: context.firstItem.summary.source,
  })
  if (!replyTargetUsesThreadAsExplicitDeliveryTarget(replyTarget)) {
    return null
  }
  return readProviderRouteScalar(replyTarget?.threadId)
}

function readAutoReplyConversationCaptureRef(
  context: AssistantAutoReplyGroupContext,
): AssistantConversationCaptureRef {
  return conversationCaptureRefFromCapture(context.firstItem.summary)
}

function replyTargetUsesThreadAsExplicitDeliveryTarget(
  replyTarget: AssistantInputCandidate['event']['replyTarget'],
): boolean {
  const channel = normalizeNullableString(replyTarget?.channel)
  return channel === 'linq' || channel === 'telegram' || channel === 'email'
}

function autoReplyInputCandidatesFromContext(
  context: AssistantAutoReplyGroupContext,
): AssistantInputCandidate[] {
  return context.items
    .map((item) => item.inputCandidate ?? null)
    .filter((candidate): candidate is AssistantInputCandidate => candidate !== null)
}

function readLatestAssistantInputReplyTarget(input: {
  candidates: readonly AssistantInputCandidate[]
  expectedChannel: string | null
}): AssistantInputCandidate['event']['replyTarget'] | null {
  const expectedChannel = normalizeNullableString(input.expectedChannel)
  for (let index = input.candidates.length - 1; index >= 0; index -= 1) {
    const candidate = input.candidates[index]
    if (!candidate) {
      continue
    }
    const replyTarget = candidate.event.replyTarget
    const replyTargetChannel = normalizeNullableString(replyTarget?.channel)
    if (
      replyTarget &&
      replyTargetChannel &&
      replyTargetChannel === expectedChannel &&
      replyTargetChannel === readAssistantInputCandidateChannel(candidate) &&
      (
        readProviderRouteScalar(replyTarget.threadId) ||
        readProviderRouteScalar(replyTarget.messageId)
      )
    ) {
      return replyTarget
    }
  }

  return null
}

function readLatestAssistantInputReplyTargetMessageId(input: {
  candidates: readonly AssistantInputCandidate[]
  expectedChannel: string | null
}): string | undefined {
  const replyTarget = readLatestAssistantInputReplyTarget(input)
  return readProviderRouteScalar(replyTarget?.messageId) ?? undefined
}

function readProviderRouteScalar(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value)
  if (
    !normalized ||
    /(?:^|:)ain_/u.test(normalized) ||
    /(?:^|:)hid_/u.test(normalized) ||
    normalized.includes('hbid:') ||
    normalized.includes('hbidx:')
  ) {
    return null
  }
  return normalized
}

function readAssistantInputCandidateChannel(
  candidate: AssistantInputCandidate,
): string | null {
  return (
    normalizeNullableString(candidate.event.conversation?.source) ??
    normalizeNullableString(candidate.event.source)
  )
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
  if (!messageId) {
    return null
  }

  return readProviderRouteScalar(messageId)
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
    advanceCursor: false,
    error: input.error,
    nextWakeAt: computeAssistantAutomationRetryAt(
      ASSISTANT_AUTO_REPLY_DEFERRED_RETRY_DELAY_MS,
    ),
    stopScanning: true,
  })
}

function shouldAssistantAutoReplyHoldCursorOnFailure(error: unknown): boolean {
  return isAssistantAutoReplyRepairableConfigError(error)
}

function createAdvancingSkipDecision(
  reason: string,
  input?: {
    checkpointRequired?: true
    terminalSuppression?: boolean
  },
): AssistantAutoReplySkipDecision {
  return {
    advanceCursor: true,
    ...(input?.checkpointRequired ? { checkpointRequired: true } : {}),
    kind: 'skip',
    nextWakeAt: null,
    reason,
    stopScanning: false,
    terminalSuppression: input?.terminalSuppression ?? true,
  }
}

function sanitizeAssistantAutoReplySuppressionReason(
  reason: string | null | undefined,
): string {
  return sanitizeAssistantPortableStateString(
    reason ?? 'assistant auto-reply suppressed',
    240,
  ) || 'assistant auto-reply suppressed'
}

function resolveAutoReplyLinqProviderMessageIdsFromContext(
  context: AssistantAutoReplyGroupContext,
): string[] {
  const messageIds: string[] = []
  for (const item of context.items) {
    if (item.summary.source !== 'linq') {
      continue
    }
    const replyTargetMessageId = readLinqProviderMessageId(
      item.inputCandidate?.event.replyTarget?.channel === 'linq'
        ? item.inputCandidate.event.replyTarget.messageId
        : null,
    )
    if (replyTargetMessageId) {
      messageIds.push(replyTargetMessageId)
    }
    const externalId = normalizeNullableString(item.summary.externalId)
    if (!externalId?.startsWith('linq:')) {
      continue
    }
    const messageId = readLinqProviderMessageId(externalId.slice('linq:'.length))
    if (!messageId) {
      continue
    }
    messageIds.push(messageId)
  }
  return [...new Set(messageIds)]
}

function readLinqProviderMessageId(value: string | null | undefined): string | null {
  return readProviderRouteScalar(value)
}

function findRepairableTerminalEvidenceForGroup(
  captureIds: readonly string[],
  evidence: readonly (AssistantAutoReplyTerminalEvidence | null)[],
): AssistantAutoReplyTerminalEvidence | null {
  return evidence.find((item) => {
    if (!item) {
      return false
    }
    return captureIds.every((captureId) => item.groupCaptureIds.includes(captureId))
  }) ?? null
}

function resolveTerminalEvidenceRepairCaptureIds(input: {
  captureIds: readonly string[]
  evidence: AssistantAutoReplyTerminalEvidence
}): string[] {
  return [...new Set([
    ...input.evidence.groupCaptureIds,
    ...input.captureIds,
  ])]
}

async function terminalEvidenceExistsForEveryCapture(
  vault: string,
  captureIds: readonly string[],
): Promise<boolean> {
  const evidence = await Promise.all(
    captureIds.map((captureId) =>
      readAssistantAutoReplyTerminalEvidence(vault, captureId),
    ),
  )
  return evidence.every((item) => item !== null)
}

async function backfillAssistantAutoReplyTerminalEvidenceFromTerminalEvidence(input: {
  captureIds: readonly string[]
  evidence: AssistantAutoReplyTerminalEvidence
  vault: string
}): Promise<void> {
  if (input.evidence.terminal.kind === 'suppressed') {
    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: input.captureIds,
      linqMessageIds: input.evidence.providerCleanup.linqMessageIds,
      reason: input.evidence.terminal.reason,
      recordedAt: input.evidence.recordedAt,
      vault: input.vault,
    })
    return
  }

  await writeAssistantAutoReplyReplyTerminalEvidence({
    captureIds: input.captureIds,
    deliveryIntentId: input.evidence.terminal.deliveryIntentId,
    linqMessageIds: input.evidence.providerCleanup.linqMessageIds,
    outcome: input.evidence.terminal.kind === 'replied' ? 'result' : 'deferred',
    recordedAt: input.evidence.recordedAt,
    sessionId: input.evidence.terminal.sessionId,
    terminalKind: input.evidence.terminal.kind,
    vault: input.vault,
  })
}

async function backfillAssistantAutoReplyTerminalEvidenceFromTerminalSnapshot(input: {
  captureIds: readonly string[]
  context: AssistantAutoReplyGroupContext
  snapshot: AssistantAutoReplyTerminalSnapshot
  vault: string
}): Promise<void> {
  await writeAssistantAutoReplyReplyTerminalEvidence({
    captureIds: input.captureIds,
    deliveryIntentId: input.snapshot.deliveryIntentId,
    linqMessageIds: resolveAutoReplyLinqProviderMessageIdsFromContext(input.context),
    outcome: input.snapshot.outcome,
    recordedAt: input.snapshot.recordedAt,
    sessionId: input.snapshot.sessionId,
    vault: input.vault,
  })
}

async function resolveAssistantAutoReplyHandledTurnReceipt(
  vault: string,
  captureIds: readonly string[],
): Promise<AssistantAutoReplyTerminalSnapshot | null> {
  const primaryCaptureId = captureIds[0]
  if (!primaryCaptureId) {
    return null
  }

  const recentReceipts = await listAssistantTurnReceipts(vault, 200)
  for (const receipt of recentReceipts) {
    if (!(receipt.status === 'completed' || receipt.status === 'deferred')) {
      continue
    }

    const receiptCaptureIds = new Set<string>()
    for (const event of receipt.timeline) {
      if (
        event.kind !== 'turn.started' &&
        event.kind !== 'turn.input.accepted'
      ) {
        continue
      }

      if (event.metadata[AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY] === primaryCaptureId) {
        receiptCaptureIds.add(primaryCaptureId)
      }

      const groupedCaptureIds = event.metadata[AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]
        ?.split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)

      for (const captureId of groupedCaptureIds ?? []) {
        receiptCaptureIds.add(captureId)
      }
    }
    const receiptMatches = captureIds.every((captureId) =>
      receiptCaptureIds.has(captureId),
    )
    if (!receiptMatches) {
      continue
    }

    return {
      deliveryIntentId: normalizeNullableString(receipt.deliveryIntentId),
      groupCaptureIds: [...captureIds],
      outcome: receipt.status === 'deferred' ? 'deferred' : 'result',
      recordedAt: receipt.completedAt ?? receipt.updatedAt,
      sessionId: receipt.sessionId,
    }
  }

  return null
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
    terminalSuppression: false,
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
