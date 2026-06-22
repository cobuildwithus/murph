import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantUserMessageContentPart } from '../content-types.js'
import type { AssistantAcceptedTurnInputItemInput } from '../active-turn-input-journal.js'
import { getAssistantChannelAdapter } from '../channel-adapters.js'
import { conversationRefFromAssistantInputConversation } from '../conversation-ref.js'
import type { AssistantOperatorAuthority } from '../operator-authority.js'
import type { AssistantExecutionContext } from '../execution-context.js'
import { createHostedDeliveryId } from '../hosted-delivery-id.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import {
  isAssistantProviderConnectionLostError,
  isAssistantProviderStalledError,
} from '../provider-failure-diagnostics.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import type { AssistantTurnEnvironment } from '../service-contracts.js'
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
import {
  compareAssistantInputCursors,
  type AssistantInputConversationRef,
} from '../input-store.js'
import {
  listAssistantTranscriptEntries,
  resolveAssistantSession,
} from '../store.js'
import {
  writeAssistantChatErrorArtifacts,
} from './artifacts.js'
import {
  readAssistantAutoReplyTerminalEvidenceByEvidenceId,
  type AssistantAutoReplyTerminalEvidence,
  writeAssistantAutoReplyReplyIntentEvidence,
  writeAssistantAutoReplyReplyTerminalEvidence,
  writeAssistantAutoReplyRetryExhaustedEvidence,
  writeAssistantAutoReplySuppressionEvidence,
} from './evidence.js'
import {
  AUTO_REPLY_RECEIPT_INPUT_ID_KEY,
  AUTO_REPLY_RECEIPT_INPUT_IDS_KEY,
  compareAssistantAutoReplyReceiptRecency,
  computeAssistantAutoReplyRetryAt,
  isAssistantAutoReplyRepairableConfigError,
  isAssistantProviderCapacityError,
  isAssistantProviderUsageLimitError,
} from './auto-reply-retry.js'
import {
  describeAssistantAutoReplyFailure,
  normalizeAssistantSafeFailureContext,
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
  readTelegramAutoReplyMetadataFromAssistantInput,
  renderAssistantInputAttachmentDescriptorPromptSection,
  type AssistantAutoReplyPromptInput,
} from './prompt-builder.js'
import {
  assistantAutomationInputSummaryFromCandidate,
  compareAssistantInputSummaryOrder,
  type AssistantAutomationInputSummary,
} from './input-summary.js'
import {
  computeAssistantAutomationRetryAt,
  earliestAssistantAutomationWakeAt,
  type AssistantAutoReplyScanResult,
  type AssistantRunEvent,
} from './shared.js'
import { buildAssistantAutomationTurnEnvelope } from './turn-envelope.js'

const SELF_AUTHORED_ECHO_WINDOW_MS = 10 * 60 * 1000
const ASSISTANT_AUTO_REPLY_DEFERRED_RETRY_DELAY_MS = 30 * 1000
const ASSISTANT_AUTO_REPLY_RECEIPT_SCAN_LIMIT = Number.MAX_SAFE_INTEGER
const ASSISTANT_AUTO_REPLY_DELIVERY_FAILED_CODE =
  'ASSISTANT_AUTO_REPLY_DELIVERY_FAILED'
const ASSISTANT_PROVIDER_EMPTY_RESPONSE_CODE =
  'ASSISTANT_PROVIDER_EMPTY_RESPONSE'
const ASSISTANT_PROVIDER_USAGE_LIMIT_SUPPRESSION_REASON =
  'assistant provider usage limit reached; auto-reply suppressed until usage is restored.'
const ASSISTANT_NO_REPLY_SUPPRESSION_REASON =
  'assistant finished without a reply'

type AssistantAutoReplyReceiptRecord =
  Awaited<ReturnType<typeof listAssistantTurnReceipts>>[number]

export interface AssistantAutoReplyReceiptReader {
  readReceipts(): Promise<readonly AssistantAutoReplyReceiptRecord[]>
}

export interface AssistantAutoReplyGroupContext {
  firstInputId: string
  firstItem: AssistantAutoReplyGroupItem
  inputCount: number
  inputIds: string[]
  items: readonly AssistantAutoReplyGroupItem[]
  lastInputCursor: AssistantInputCandidate['event']['cursor']
  optionalInboxCaptureIds: string[]
}

interface AssistantAutoReplyReplyDecision {
  deliveryTarget: string | null
  deliveryMessageReactionsAvailable: boolean | null
  deliveryReplyToMessageId: string | null
  kind: 'reply'
  operatorAuthority: AssistantOperatorAuthority
  primaryInput: AssistantAutoReplyPrimaryInput
  prompt: string
  userMessageContent: AssistantUserMessageContentPart[] | null
}

interface AssistantAutoReplyPrimaryInput {
  actorIsSelf: boolean
  conversation: AssistantInputConversationRef
  inputId: string
  occurredAt: string
  receivedAt: string | null
  replyTarget: AssistantAutoReplyPromptInput['replyTarget']
  source: string
  text: string | null
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

interface AssistantAutoReplySuppressionEvidenceDraft {
  captureIds: readonly string[]
  inputIds: readonly string[]
  linqMessageIds: readonly string[]
  reason: string
}

interface AssistantAutoReplyResolvedGroupOutcome {
  context: AssistantAutoReplyGroupContext
  deferredTerminalSuppressionEvidence: AssistantAutoReplySuppressionEvidenceDraft[]
  outcome: AssistantAutoReplyGroupOutcome
  terminalSuppressedInputIds: string[]
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
      failureContext?: Record<string, boolean | number | string | null>
      safeDetails?: string
      safeErrorMessage?: string
      type:
        | 'assistant.reply.intent_created'
        | 'assistant.delivery.sent'
        | 'input.reply-failed'
        | 'input.reply-skipped'
        | 'input.replied'
    }
  | null

type AssistantAutoReplyOutcomeArtifact =
  | { kind: 'none' }
  | { kind: 'deferred'; result: AssistantAutoReplySendResult }
  | {
      kind: 'error'
      error: unknown
      failure: AssistantAutoReplyFailureSnapshot
      terminalRetryExhausted?: {
        failedAttempts: number
        maxFailedAttempts: number
        reason: string
      }
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
  currentTurnDeliveryIntentIds?: string[]
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
    firstInputId: firstItem.summary.inputId,
    firstItem,
    inputCount: items.length,
    inputIds: items.map((item) => item.inputCandidate!.event.inputId),
    items,
    lastInputCursor: lastItem.inputCandidate!.event.cursor,
    optionalInboxCaptureIds: items
      .map((item) => item.summary.optionalInboxCaptureId)
      .filter((captureId): captureId is string => captureId !== null),
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
  onProviderRequestStarted?: AssistantAutoReplyProviderRequestStartHook | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  receiptReader?: AssistantAutoReplyReceiptReader
  requestId: string | null
  signal?: AbortSignal
  sessionMaxAgeMs: number | null
  turnEnvironment?: AssistantTurnEnvironment | null
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
      deferredTerminalSuppressionEvidence:
        resolved.deferredTerminalSuppressionEvidence,
      onEvent: input.onEvent,
      outcome: resolved.outcome,
      terminalSuppressedInputIds: resolved.terminalSuppressedInputIds,
      vault: input.vault,
    })
  } catch (error) {
    if (shouldRethrowAssistantAutoReplyAbort(error, input.signal)) {
      throw error
    }

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
          inputCount: latestContext.inputCount,
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
        inputCount: latestContext.inputCount,
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
  onEvent?: (event: AssistantRunEvent) => void
  onProviderRequestStarted?: AssistantAutoReplyProviderRequestStartHook | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  onAcceptedContext?: (context: AssistantAutoReplyGroupContext) => void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  receiptReader?: AssistantAutoReplyReceiptReader
  requestId: string | null
  signal?: AbortSignal
  sessionMaxAgeMs: number | null
  turnEnvironment?: AssistantTurnEnvironment | null
  inputSource?: AssistantActiveTurnInputSource
  vault: string
}): Promise<AssistantAutoReplyResolvedGroupOutcome> {
  let context = input.context

  const decision = await evaluateAssistantAutoReplyGroup({
    allowSelfAuthored: input.allowSelfAuthored,
    enabledChannels: input.enabledChannels,
    executionContext: input.executionContext,
    group: context,
    onEvent: input.onEvent,
    receiptReader: input.receiptReader,
    receiptFallbackEnabled: shouldUseAssistantAutoReplyReceiptFallback({
      deliveryDispatchMode: input.deliveryDispatchMode,
      executionContext: input.executionContext,
    }),
    requestId: input.requestId,
    signal: input.signal,
    vault: input.vault,
  })
  if (decision.kind === 'ignore') {
    return {
      context,
      deferredTerminalSuppressionEvidence: [],
      outcome: createIgnoredGroupOutcome(),
      terminalSuppressedInputIds: [],
    }
  }
  if (decision.kind === 'skip') {
    return {
      context,
      deferredTerminalSuppressionEvidence: [],
      outcome: createSkippedDecisionOutcome({
        inputCount: context.inputCount,
        decision,
      }),
      terminalSuppressedInputIds: [],
    }
  }

  let acceptedContext = context
  const deferredTerminalSuppressionEvidence:
    AssistantAutoReplySuppressionEvidenceDraft[] = []
  const terminalSuppressedInputIds = new Set<string>()
  input.onEvent?.({
    type: 'input.reply-started',
    inputId: primaryAutoReplyInputId(context),
    details: 'assistant provider turn started',
  })
  const activeTurnHooks = input.inputSource
    ? createAssistantAutoReplyActiveTurnInputHooks({
        context,
        deliveryTarget: decision.deliveryTarget,
        executionContext: input.executionContext,
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
      inputSummaries: context.items.map((item) => item.summary),
      inputCandidates: context.items.map((item) => item.inputCandidate ?? null),
    }),
    bindingDeliveryTarget: decision.deliveryTarget,
    captureIds: context.optionalInboxCaptureIds,
    inputIds: context.inputIds,
    deliveryDispatchMode: input.deliveryDispatchMode,
    deliveryIdempotencyKey: createHostedAutoReplyDeliveryIdempotencyKey({
      context,
      deliveryTarget: decision.deliveryTarget,
      executionContext: input.executionContext,
    }),
    deliveryTarget: decision.deliveryTarget,
    ...(decision.deliveryMessageReactionsAvailable === null
      ? {}
      : {
          deliveryMessageReactionsAvailable:
            decision.deliveryMessageReactionsAvailable,
        }),
    deliveryReplyToMessageId: decision.deliveryReplyToMessageId,
    executionContext: input.executionContext,
    providerHeartbeatMs: input.providerHeartbeatMs,
    providerLongRunningCommandStallTimeoutMs:
      input.providerLongRunningCommandStallTimeoutMs,
    providerStallTimeoutMs: input.providerStallTimeoutMs,
    signal: input.signal,
    maxSessionAgeMs: input.sessionMaxAgeMs,
    onEvent: input.onEvent,
    onProviderRequestStarted: input.onProviderRequestStarted ?? null,
    onTraceEvent: input.onTraceEvent,
    onFinishWithoutReplyAccepted: async (event) => {
      const acceptedInputIds = [...new Set(event.acceptedInputIds)]
      if (acceptedInputIds.length === 0) {
        return
      }
      const noReplyContext = selectAssistantAutoReplyContextByInputIds({
        context: acceptedContext,
        inputIds: acceptedInputIds,
      })
      const evidenceDraft: AssistantAutoReplySuppressionEvidenceDraft = {
        captureIds: noReplyContext?.optionalInboxCaptureIds ?? [],
        inputIds: acceptedInputIds,
        linqMessageIds: noReplyContext
          ? resolveAutoReplyLinqProviderMessageIdsFromContext(noReplyContext)
          : [],
        reason: ASSISTANT_NO_REPLY_SUPPRESSION_REASON,
      }
      if (event.messageReactionsAvailable === true) {
        deferredTerminalSuppressionEvidence.push(evidenceDraft)
      } else {
        await writeAssistantAutoReplySuppressionEvidence({
          ...evidenceDraft,
          vault: input.vault,
        })
      }
      for (const inputId of acceptedInputIds) {
        terminalSuppressedInputIds.add(inputId)
      }
    },
    operatorAuthority: decision.operatorAuthority,
    conversationRef: decision.primaryInput.conversation,
    prompt: decision.prompt,
    replyInputId: primaryAutoReplyInputId(context),
    activeTurnInput: activeTurnHooks?.admit,
    activeTurnCheckpoint: activeTurnHooks?.checkpoint,
    source: context.firstItem.summary.source,
    turnEnvironment: input.turnEnvironment ?? null,
    userMessageContent: decision.userMessageContent,
    vault: input.vault,
  })
  if (isAssistantNoReplyWithoutDeliveryWork(result)) {
    return {
      context: acceptedContext,
      deferredTerminalSuppressionEvidence,
      outcome: createSkippedGroupOutcome({
        inputCount: acceptedContext.inputCount,
        reason: ASSISTANT_NO_REPLY_SUPPRESSION_REASON,
        terminalSuppression: true,
      }),
      terminalSuppressedInputIds: [...terminalSuppressedInputIds],
    }
  }
  if (
    result.deliveryDeferred ||
    isAssistantNoReplyWithCommittedDeliveryWork(result)
  ) {
    return {
      context: acceptedContext,
      deferredTerminalSuppressionEvidence,
      outcome: createDeferredDeliveryGroupOutcome(result),
      terminalSuppressedInputIds: [...terminalSuppressedInputIds],
    }
  }

  return {
    context: acceptedContext,
    deferredTerminalSuppressionEvidence,
    outcome: createSuccessfulReplyGroupOutcome(result),
    terminalSuppressedInputIds: [...terminalSuppressedInputIds],
  }
}

async function commitAssistantAutoReplyGroupOutcome(input: {
  context: AssistantAutoReplyGroupContext
  deferredTerminalSuppressionEvidence?: readonly AssistantAutoReplySuppressionEvidenceDraft[]
  onEvent?: (event: AssistantRunEvent) => void
  outcome: AssistantAutoReplyGroupOutcome
  terminalSuppressedInputIds?: readonly string[]
  vault: string
}): Promise<AssistantAutoReplyProcessResult> {
  const artifactResult = await writeAssistantAutoReplyOutcomeArtifacts(input).catch((error) => {
    if (input.outcome.artifact.kind === 'error') {
      return { checkpointRequired: false }
    }
    throw error
  })
  const deferredSuppressionCheckpointRequired =
    await writeDeferredAssistantAutoReplySuppressionEvidence(input)
  emitAssistantAutoReplyOutcomeEvent(input)

  return {
    advanceCursor: input.outcome.advanceCursor,
    ...(input.outcome.checkpointRequired ||
      artifactResult.checkpointRequired ||
      deferredSuppressionCheckpointRequired
      ? { checkpointRequired: true }
      : {}),
    currentTurnDeliveryIntentIds:
      collectAssistantAutoReplyOutcomeDeliveryIntentIds(input.outcome),
    failed: input.outcome.summary.failed,
    lastInputCursor: input.context.lastInputCursor,
    nextWakeAt: input.outcome.nextWakeAt,
    replied: input.outcome.summary.replied,
    skipped: input.outcome.summary.skipped,
    stopScanning: input.outcome.stopScanning,
  }
}

async function writeDeferredAssistantAutoReplySuppressionEvidence(input: {
  deferredTerminalSuppressionEvidence?: readonly AssistantAutoReplySuppressionEvidenceDraft[]
  outcome: AssistantAutoReplyGroupOutcome
  vault: string
}): Promise<boolean> {
  const evidence = input.deferredTerminalSuppressionEvidence ?? []
  if (
    evidence.length === 0 ||
    (
      input.outcome.artifact.kind !== 'result' &&
      input.outcome.artifact.kind !== 'deferred'
    )
  ) {
    return false
  }

  for (const draft of evidence) {
    await writeAssistantAutoReplySuppressionEvidence({
      ...draft,
      vault: input.vault,
    })
  }
  return true
}

function collectAssistantAutoReplyOutcomeDeliveryIntentIds(
  outcome: AssistantAutoReplyGroupOutcome,
): string[] {
  const result =
    outcome.artifact.kind === 'result' || outcome.artifact.kind === 'deferred'
      ? outcome.artifact.result
      : null
  return result?.deliveryIntentId ? [result.deliveryIntentId] : []
}

async function writeAssistantAutoReplyOutcomeArtifacts(input: {
  context: AssistantAutoReplyGroupContext
  outcome: AssistantAutoReplyGroupOutcome
  terminalSuppressedInputIds?: readonly string[]
  vault: string
}): Promise<{ checkpointRequired: boolean }> {
  switch (input.outcome.artifact.kind) {
    case 'none':
      if (input.outcome.kind === 'skipped' && input.outcome.terminalSuppression) {
        await writeAssistantAutoReplySuppressionEvidence({
          captureIds: input.context.optionalInboxCaptureIds,
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
      const evidenceContext = selectAssistantAutoReplyContextExcludingInputIds({
        context: input.context,
        inputIds: input.terminalSuppressedInputIds ?? [],
      })
      if (!evidenceContext) {
        return { checkpointRequired: false }
      }

      await writeAssistantAutoReplyReplyIntentEvidence({
        captureIds: evidenceContext.optionalInboxCaptureIds,
        inputIds: evidenceContext.inputIds,
        linqMessageIds: resolveAutoReplyLinqProviderMessageIdsFromContext(evidenceContext),
        outcome: 'result',
        recordedAt: delivery.sentAt,
        result: input.outcome.artifact.result,
        vault: input.vault,
      })
      return { checkpointRequired: true }
    }
    case 'deferred': {
      const queuedAt = new Date().toISOString()
      const evidenceContext = selectAssistantAutoReplyContextExcludingInputIds({
        context: input.context,
        inputIds: input.terminalSuppressedInputIds ?? [],
      })
      if (!evidenceContext) {
        return { checkpointRequired: false }
      }
      await writeAssistantAutoReplyReplyIntentEvidence({
        captureIds: evidenceContext.optionalInboxCaptureIds,
        inputIds: evidenceContext.inputIds,
        linqMessageIds: resolveAutoReplyLinqProviderMessageIdsFromContext(evidenceContext),
        outcome: 'deferred',
        recordedAt: queuedAt,
        result: input.outcome.artifact.result,
        vault: input.vault,
      })
      return { checkpointRequired: true }
    }
    case 'error':
      await writeAssistantChatErrorArtifacts({
        captureIds: input.context.optionalInboxCaptureIds,
        failure: input.outcome.artifact.failure,
        vault: input.vault,
      })
      if (input.outcome.artifact.terminalRetryExhausted) {
        await writeAssistantAutoReplyRetryExhaustedEvidence({
          captureIds: input.context.optionalInboxCaptureIds,
          inputIds: input.context.inputIds,
          linqMessageIds: resolveAutoReplyLinqProviderMessageIdsFromContext(input.context),
          vault: input.vault,
          ...input.outcome.artifact.terminalRetryExhausted,
        })
        return { checkpointRequired: true }
      }
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
    inputId: primaryAutoReplyInputId(input.context),
    details: input.outcome.event.details,
    errorCode: input.outcome.event.errorCode,
    failureContext: input.outcome.event.failureContext,
    safeDetails: input.outcome.event.safeDetails,
    safeErrorMessage: input.outcome.event.safeErrorMessage,
  })
}

function primaryAutoReplyInputId(
  context: AssistantAutoReplyGroupContext,
): string {
  return context.inputIds[0] ?? context.firstInputId
}

function buildAutoReplyReceiptInputIds(input: {
  acceptedInputs?: readonly AssistantAcceptedTurnInputItemInput[]
  context: AssistantAutoReplyGroupContext
}): string[] {
  return [...new Set([
    ...input.context.inputIds,
    ...(input.acceptedInputs ?? []).map((item) => item.id),
  ])]
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
  inputCount: number
  decision: AssistantAutoReplySkipDecision
}): AssistantAutoReplyGroupOutcome {
  if (input.decision.advanceCursor) {
    const outcome = createSkippedGroupOutcome({
      inputCount: input.inputCount,
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
    inputCount: input.inputCount,
    nextWakeAt: input.decision.nextWakeAt,
    reason: input.decision.reason,
    stopScanning: input.decision.stopScanning,
  })
}

function createSkippedGroupOutcome(input: {
  inputCount: number
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
      type: 'input.reply-skipped',
    },
    kind: 'skipped',
    nextWakeAt: input.nextWakeAt ?? null,
    stopScanning: input.stopScanning ?? false,
    summary: createAssistantAutoReplyOutcomeSummary({
      skipped: input.inputCount,
    }),
    terminalSuppression: input.terminalSuppression,
  }
}

function createDeferredGroupOutcome(input: {
  inputCount: number
  nextWakeAt?: string | null
  reason: string
  stopScanning: boolean
}): AssistantAutoReplyGroupOutcome {
  return {
    advanceCursor: false,
    artifact: { kind: 'none' },
    event: {
      details: input.reason,
      type: 'input.reply-skipped',
    },
    kind: 'deferred',
    nextWakeAt: input.nextWakeAt ?? null,
    stopScanning: input.stopScanning,
    summary: createAssistantAutoReplyOutcomeSummary({
      skipped: input.inputCount,
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
        ? `assistant reply intent created as ${result.deliveryIntentId}`
        : 'assistant reply intent created',
      safeDetails: 'reply intent created',
      type: 'assistant.reply.intent_created',
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
      details: 'delivery sent',
      safeDetails: 'delivery sent',
      type: 'assistant.delivery.sent',
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
  failure?: AssistantAutoReplyFailureSnapshot
  nextWakeAt?: string | null
  stopScanning?: boolean
  terminalRetryExhausted?: true
}): AssistantAutoReplyGroupOutcome {
  const failure = input.failure ?? describeAssistantAutoReplyFailure(input.error)
  const failureContext = normalizeAssistantSafeFailureContext(failure.context)

  return {
    advanceCursor: input.advanceCursor,
    artifact: {
      kind: 'error',
      error: input.error,
      failure,
      ...(input.terminalRetryExhausted
        ? {
            terminalRetryExhausted: {
              failedAttempts: 1,
              maxFailedAttempts: 1,
              reason: failure.safeSummary,
            },
          }
        : {}),
    },
    event: {
      details: failure.message,
      errorCode: failure.code ?? undefined,
      ...(failureContext ? { failureContext } : {}),
      safeDetails: failure.safeSummary,
      safeErrorMessage: failure.message,
      type: 'input.reply-failed',
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
  executionContext?: AssistantExecutionContext | null
  group: AssistantAutoReplyGroupContext
  onEvent?: (event: AssistantRunEvent) => void
  receiptReader?: AssistantAutoReplyReceiptReader
  receiptFallbackEnabled: boolean
  requestId: string | null
  signal?: AbortSignal
  vault: string
}): Promise<AssistantAutoReplyDecision> {
  if (!input.enabledChannels.includes(input.group.firstItem.summary.source)) {
    return createAdvancingSkipDecision(
      'channel not enabled for assistant auto-reply',
    )
  }

  if (input.group.firstItem.summary.actorIsSelf && !input.allowSelfAuthored) {
    return createAdvancingSkipDecision('input is self-authored')
  }

  const existingTerminalEvidence = await Promise.all(
    input.group.items.map((item) => {
      const inputId = item.inputCandidate!.event.inputId
      return readAssistantAutoReplyTerminalEvidenceByEvidenceId(input.vault, inputId).then(
        (evidence) =>
          evidence ??
          readAssistantAutoReplyTerminalEvidenceByEvidenceId(
            input.vault,
            item.summary.optionalInboxCaptureId ?? inputId,
          ),
      )
    }),
  )
  const repairEvidence = input.group.optionalInboxCaptureIds.length === input.group.items.length
    ? findRepairableTerminalEvidenceForGroup(
      input.group.optionalInboxCaptureIds,
      existingTerminalEvidence,
    )
    : null
  if (repairEvidence) {
    const repairCaptureIds = resolveTerminalEvidenceRepairCaptureIds({
      captureIds: input.group.optionalInboxCaptureIds,
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
      'assistant reply terminal evidence is incomplete; will retry this input after evidence is rebuilt.',
    )
  }

  const promptInputs = await loadAssistantAutoReplyPromptInputs({
    group: input.group,
  })
  const primaryInput = promptInputs[0]
  if (!primaryInput) {
    return { kind: 'ignore' }
  }
  const primaryReplyInput = createAssistantAutoReplyPrimaryInput(primaryInput)
  const receipts = await readAssistantAutoReplyReceiptRecords(input)

  if (input.receiptFallbackEnabled) {
    const handledReceipt = findHandledAutoReplyReceiptForGroup({
      captureIds: input.group.optionalInboxCaptureIds,
      inputIds: input.group.inputIds,
      receipts,
    })
    if (handledReceipt) {
      await backfillAssistantAutoReplyTerminalEvidenceFromTerminalSnapshot({
        captureIds: input.group.optionalInboxCaptureIds,
        context: input.group,
        snapshot: handledReceipt,
        vault: input.vault,
      })
      return createAdvancingSkipDecision('assistant reply already handled', {
        checkpointRequired: true,
        terminalSuppression: false,
      })
    }
  }

  const channelAdapter = getAssistantChannelAdapter(primaryReplyInput.source)
  const autoReplySkipReason = channelAdapter?.canAutoReply({
    source: primaryReplyInput.source,
    threadIsDirect: primaryReplyInput.conversation.threadIsDirect,
  }) ?? null
  if (autoReplySkipReason) {
    return createAdvancingSkipDecision(autoReplySkipReason)
  }

  const preparedInput = await prepareAssistantAutoReplyInputWithContext({
    executionContext: input.executionContext,
    inputs: promptInputs,
    onEvent: input.onEvent,
    vault: input.vault,
  })
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
      input: primaryReplyInput,
    }))
  ) {
    return createAdvancingSkipDecision(
      'capture matches a recent assistant delivery',
    )
  }

  const deliveryTarget = readAutoReplyDeliveryTarget(input.group)
  if (
    input.executionContext?.hosted &&
    primaryReplyInput.source === 'telegram' &&
    deliveryTarget === null &&
    shouldSuppressHostedTelegramAutoReplyMissingDeliveryTarget(input.group)
  ) {
    return createAdvancingSkipDecision(
      'hosted Telegram auto-reply is missing a provider delivery target',
    )
  }

  return {
    deliveryTarget,
    deliveryMessageReactionsAvailable:
      readAutoReplyDeliveryMessageReactionsAvailable({
        context: input.group,
      }),
    deliveryReplyToMessageId: readAutoReplyDeliveryReplyToMessageId({
      inputs: promptInputs,
      context: input.group,
    }),
    kind: 'reply',
    operatorAuthority: 'direct-operator',
    primaryInput: primaryReplyInput,
    prompt: preparedInput.prompt,
    userMessageContent: preparedInput.userMessageContent,
  }
}

async function loadAssistantAutoReplyPromptInputs(input: {
  group: AssistantAutoReplyGroupContext
}): Promise<AssistantAutoReplyPromptInput[]> {
  return input.group.items.map((item) =>
    createAssistantAutoReplyPromptInputFromEvent(item),
  )
}

function createAssistantAutoReplyPromptInputFromEvent(
  item: AssistantAutoReplyGroupItem,
): AssistantAutoReplyPromptInput {
  const candidate = item.inputCandidate
  if (!candidate) {
    throw new Error('Assistant auto-reply prompt input requires an assistant input candidate.')
  }
  const event = candidate.event
  const conversation = event.conversation ?? item.summary.conversation

  return {
    actorIsSelf: conversation.actorIsSelf,
    attachmentDescriptors: event.attachmentDescriptors,
    attachmentEvidence: event.attachmentEvidence,
    conversation,
    inputId: event.inputId,
    occurredAt: event.occurredAt,
    projection: {
      optionalInboxCaptureId: candidate.projection.captureId,
      reasonCode: candidate.projection.reasonCode,
      status: candidate.projection.status,
    },
    receivedAt: event.receivedAt,
    replyTarget: event.replyTarget,
    sourceMetadata: event.sourceMetadata,
    source: event.source,
    telegramMetadata:
      item.telegramMetadata ??
      readTelegramAutoReplyMetadataFromAssistantInput({
        replyTarget: event.replyTarget,
        sourceMetadata: event.sourceMetadata,
      }),
    text:
      event.transcriptText ??
      event.text ??
      item.summary.text,
  }
}

function shouldRethrowAssistantAutoReplyAbort(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function createAssistantAutoReplyPrimaryInput(
  input: AssistantAutoReplyPromptInput,
): AssistantAutoReplyPrimaryInput {
  return {
    actorIsSelf: input.actorIsSelf,
    conversation: input.conversation,
    inputId: input.inputId,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    replyTarget: input.replyTarget,
    source: input.source,
    text: input.text,
  }
}

function createHostedAutoReplyDeliveryIdempotencyKey(input: {
  context: AssistantAutoReplyGroupContext
  deliveryTarget: string | null
  executionContext?: AssistantExecutionContext | null
}): string | null {
  const userId = normalizeNullableString(input.executionContext?.hosted?.memberId)
  if (!userId) {
    return null
  }

  const candidates = autoReplyInputCandidatesFromContext(input.context)
  if (candidates.length === 0) {
    return null
  }

  const inboundMailboxItemIds: string[] = []
  for (const candidate of candidates) {
    if (candidate.event.sourceRef.kind !== 'hosted-mailbox') {
      return null
    }
    inboundMailboxItemIds.push(candidate.event.sourceRef.itemId)
  }

  const channel = normalizeNullableString(input.context.firstItem.summary.source)
  if (!channel) {
    return null
  }

  return createHostedDeliveryId({
    assistantTurnOrdinal: 'auto-reply:1',
    channel,
    conversationId: stringifyHostedAutoReplyDeliveryKeyParts([
      channel,
      input.context.firstItem.summary.conversation.source,
      input.context.firstItem.summary.conversation.accountId,
      input.context.firstItem.summary.conversation.threadId,
      input.context.firstItem.summary.conversation.threadIsDirect,
    ]),
    inboundMailboxItemIds,
    recipientKey: stringifyHostedAutoReplyDeliveryKeyParts([
      channel,
      input.deliveryTarget,
      input.context.firstItem.summary.conversation.accountId,
      input.context.firstItem.summary.conversation.actorId,
      input.context.firstItem.summary.conversation.threadId,
    ]),
    userId,
  })
}

function stringifyHostedAutoReplyDeliveryKeyParts(
  parts: readonly (boolean | null | string | undefined)[],
): string {
  return JSON.stringify(parts.map((part) => part ?? null))
}

async function prepareAssistantAutoReplyInputWithContext(input: {
  executionContext?: AssistantExecutionContext | null
  inputs: readonly AssistantAutoReplyPromptInput[]
  onEvent?: ((event: AssistantRunEvent) => void) | null
  vault: string
}): Promise<Awaited<ReturnType<typeof prepareAssistantAutoReplyInput>>> {
  const materializeWorkspaceArtifacts =
    input.executionContext?.hosted?.materializeWorkspaceArtifacts ?? null
  const options = {
    ...(materializeWorkspaceArtifacts ? { materializeWorkspaceArtifacts } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  }
  return Object.keys(options).length > 0
    ? await prepareAssistantAutoReplyInput(input.inputs, input.vault, options)
    : await prepareAssistantAutoReplyInput(input.inputs, input.vault)
}

async function executeAssistantAutoReply(input: {
  acceptedTurnInputInitialInputs?: readonly AssistantAcceptedTurnInputItemInput[] | null
  activeTurnCheckpoint?: AssistantActiveTurnInputCheckpointHook
  activeTurnInput?: AssistantActiveTurnInputAdmissionHook
  bindingDeliveryTarget: string | null
  captureIds: readonly string[]
  inputIds: readonly string[]
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  deliveryIdempotencyKey: string | null
  deliveryTarget: string | null
  deliveryMessageReactionsAvailable?: boolean | null
  deliveryReplyToMessageId: string | null
  executionContext?: AssistantExecutionContext | null
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  signal?: AbortSignal
  maxSessionAgeMs: number | null
  onEvent?: (event: AssistantRunEvent) => void
  onFinishWithoutReplyAccepted?: ((event: {
    acceptedInputIds: readonly string[]
    deliveryContextOrdinal: number
    messageReactionsAvailable?: boolean | null
  }) => Promise<void> | void) | null
  onProviderRequestStarted?: AssistantAutoReplyProviderRequestStartHook | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  operatorAuthority: AssistantOperatorAuthority
  conversationRef: AssistantInputConversationRef
  prompt: string
  replyInputId: string
  source: string
  turnEnvironment?: AssistantTurnEnvironment | null
  userMessageContent: AssistantUserMessageContentPart[] | null
  vault: string
}): Promise<Awaited<ReturnType<typeof sendAssistantMessage>>> {
  const watchdog = createAssistantProviderWatchdog(input)
  const conversation = conversationRefFromAssistantInputConversation(
    input.conversationRef,
  )

  try {
    const automationTurn = buildAssistantAutomationTurnEnvelope({
      deliveryDispatchMode: input.deliveryDispatchMode,
      executionContext: input.executionContext,
      signal: watchdog.signal,
      turnEnvironment: input.turnEnvironment ?? null,
      turnTrigger: 'automation-auto-reply',
    })
    const result = await sendAssistantMessage({
      vault: input.vault,
      ...automationTurn,
      acceptedTurnInput: {
        initialInputs: input.acceptedTurnInputInitialInputs ?? null,
      },
      channel: input.source,
      conversation,
      activeTurnCheckpoint: input.activeTurnCheckpoint,
      activeTurnInput: input.activeTurnInput,
      operatorAuthority: input.operatorAuthority,
      persistUserPromptOnFailure: false,
      prompt: input.prompt,
      userMessageContent: input.userMessageContent,
      includeEarlySessionOnboarding: true,
      deliverResponse: true,
      onFinishWithoutReplyAccepted:
        input.onFinishWithoutReplyAccepted ?? null,
      bindingDeliveryTarget: input.bindingDeliveryTarget,
      deliveryIdempotencyKey: input.deliveryIdempotencyKey,
      ...(input.deliveryMessageReactionsAvailable === undefined
        || input.deliveryMessageReactionsAvailable === null
        ? {}
        : {
            deliveryMessageReactionsAvailable:
              input.deliveryMessageReactionsAvailable,
          }),
      deliveryTarget: input.deliveryTarget,
      deliveryReplyToMessageId: input.deliveryReplyToMessageId,
      receiptMetadata: {
        [AUTO_REPLY_RECEIPT_INPUT_ID_KEY]:
          input.inputIds[0] ?? input.replyInputId,
        [AUTO_REPLY_RECEIPT_INPUT_IDS_KEY]: input.inputIds.join(','),
      },
      maxSessionAgeMs: input.maxSessionAgeMs,
      onProviderEvent: watchdog.onProviderEvent,
      onProviderRequestStarted: input.onProviderRequestStarted
        ? (event) => input.onProviderRequestStarted?.({
            ...(event.admissionMs === undefined ? {} : { admissionMs: event.admissionMs }),
            assistantInputIds: event.acceptedInputIds,
            ...(event.preProviderSetupMs === undefined
              ? {}
              : { preProviderSetupMs: event.preProviderSetupMs }),
            ...(event.promptBuildMs === undefined ? {} : { promptBuildMs: event.promptBuildMs }),
            providerRequestOrdinal: event.providerRequestOrdinal,
            ...(event.sessionResolveMs === undefined
              ? {}
              : { sessionResolveMs: event.sessionResolveMs }),
            source: input.source,
            startedAt: event.startedAt,
            ...(event.turnLockWaitMs === undefined
              ? {}
              : { turnLockWaitMs: event.turnLockWaitMs }),
          })
        : null,
      onTraceEvent: input.onTraceEvent,
    })
    return resolveAssistantAutoReplySendResult({
      onEvent: input.onEvent,
      replyInputId: input.replyInputId,
      result,
    })
  } catch (error) {
    throw markAssistantAutoReplyDeliveryFailureIfNeeded(
      watchdog.normalizeError(error),
    )
  } finally {
    watchdog.dispose()
  }
}

export type AssistantAutoReplyProviderRequestStartHook = (event: {
  admissionMs?: number
  assistantInputIds: readonly string[]
  preProviderSetupMs?: number
  promptBuildMs?: number
  providerRequestOrdinal: number
  sessionResolveMs?: number
  source: string
  startedAt: string
  turnLockWaitMs?: number
}) => Promise<void> | void

function shouldUseAssistantAutoReplyReceiptFallback(input: {
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
}): boolean {
  return !(
    input.executionContext?.hosted != null &&
    input.deliveryDispatchMode === 'queue-only'
  )
}

interface AssistantAutoReplyActiveTurnPendingAcceptance {
  acceptedInputIds: readonly string[]
  captureIds: readonly string[]
  items: readonly AssistantAutoReplyGroupItem[]
  lastInputCursor: AssistantInputCandidate['event']['cursor']
  apply(): void
}

function createAssistantAutoReplyActiveTurnInputHooks(input: {
  context: AssistantAutoReplyGroupContext
  deliveryTarget: string | null
  executionContext?: AssistantExecutionContext | null
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
  let conversation = readAutoReplyConversationRef(context)
  const pendingAcceptances: AssistantAutoReplyActiveTurnPendingAcceptance[] = []

  const admit: AssistantActiveTurnInputAdmissionHook = async (admissionInput) => {
    const refreshResult = await input.inputSource.refresh({
      signal: admissionInput.signal,
    })
    if (refreshResult.reason === 'source_unavailable') {
      throw new AssistantActiveTurnInputUnavailableError(
        'same-conversation input source is temporarily unavailable during the active turn; will retry later.',
      )
    }

    const knownProjectionCaptureIds = [
      ...context.optionalInboxCaptureIds,
      ...pendingAcceptances.flatMap((pending) => pending.captureIds),
      ...(admissionInput.knownProjectionCaptureIds ?? []),
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
      knownProjectionCaptureIds,
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
        deliveryTarget: input.deliveryTarget,
        executionContext: input.executionContext,
        getContext: () => context,
        inputSourceCursor: lateInputs.nextCursor,
        lateInputs: lateCapturelessCandidates,
        onAcceptedContext(nextContext) {
          context = nextContext
          conversation = readAutoReplyConversationRef(nextContext)
          input.onAcceptedContext(nextContext)
        },
        onEvent: input.onEvent,
        pendingAcceptances,
      })
    }

    const lateInputSummaries = loadAssistantInputCandidateSummaries({
      candidates: lateCaptureCandidates,
    })
    const lateInputCandidatesByInputId = new Map(
      lateCaptureCandidates.map((candidate) => [
        candidate.event.inputId,
        candidate,
      ] as const),
    )
    const nextContext = await mergeAssistantAutoReplyGroupContext({
      context,
      inputCandidatesByInputId: lateInputCandidatesByInputId,
      lateInputSummaries,
      vault: input.vault,
    })
    if (!nextContext) {
      throw new AssistantActiveTurnInputBudgetExceededError(
        'new same-conversation input could not be materialized into the active turn; will retry later.',
      )
    }
    if (nextContext.inputCount <= context.inputCount) {
      return {
        kind: 'no-new-input',
      }
    }

    const acceptedInputContext = await createAssistantAutoReplyContextForInputSummaries({
      inputSummaries: lateInputSummaries,
      inputCandidatesByInputId: lateInputCandidatesByInputId,
      vault: input.vault,
    })
    if (!acceptedInputContext) {
      throw new AssistantActiveTurnInputBudgetExceededError(
        'new same-conversation input could not be materialized into the active turn; will retry later.',
      )
    }
    const shownAcceptedInput = await loadAssistantAutoReplyPromptInputs({
      group: acceptedInputContext,
    })
    const preparedInput = await prepareAssistantAutoReplyInputWithContext({
      executionContext: input.executionContext,
      inputs: shownAcceptedInput,
      onEvent: input.onEvent,
      vault: input.vault,
    })
    if (preparedInput.kind !== 'ready') {
      throw new AssistantActiveTurnInputBudgetExceededError(
        preparedInput.reason,
      )
    }

    const captureAcceptedInputs = buildAutoReplyAcceptedTurnInputItems({
      inputSummaries: lateInputSummaries,
      inputCandidates: lateCaptureCandidates,
    })
    const capturelessAcceptedInputs = buildCapturelessAcceptedTurnInputItems(
      lateCapturelessCandidates,
    )
    const acceptedInputs = [
      ...captureAcceptedInputs,
      ...capturelessAcceptedInputs,
    ]
    const acceptedInputReplyTargetCandidate =
      readLatestAssistantInputReplyTargetCandidate({
        candidates: lateInputs.inputs,
        expectedChannel: context.firstItem.summary.source,
      })
    const acceptedInputReplyToMessageId =
      readAssistantInputCandidateReplyTargetMessageId(
        acceptedInputReplyTargetCandidate,
      )
    const acceptedInputDeliveryTarget = readAssistantInputReplyTargetDeliveryTarget(
      acceptedInputReplyTargetCandidate?.event.replyTarget ?? null,
    )
    const acceptedInputMessageReactionsAvailable =
      readAssistantInputCandidateMessageReactionsAvailable({
        candidate: acceptedInputReplyTargetCandidate,
        expectedChannel: context.firstItem.summary.source,
      })
    const acceptedInputDeliveryTargetForIdempotency =
      acceptedInputDeliveryTarget ?? readLatestAssistantInputDeliveryTarget({
        candidates: lateInputs.inputs,
        expectedChannel: context.firstItem.summary.source,
      })
    const lateItems = [
      ...nextContext.items,
      ...lateCapturelessCandidates.map(
        assistantAutoReplyGroupItemFromInputCandidate,
      ),
    ]
    const finalContext = mergeAssistantAutoReplyContextItems({
      context,
      items: [
        ...pendingAcceptances.flatMap((pending) => pending.items),
        ...lateItems,
      ],
      lastInputCursor: lateInputs.nextCursor ?? nextContext.lastInputCursor,
    })
    input.onEvent?.({
      type: 'input.reply-progress',
      inputId: primaryAutoReplyInputId(context),
      details: `new input queued for active turn with ${lateInputs.inputs.length} additional input(s)`,
      providerKind: 'status',
      providerState: 'running',
    })
    pendingAcceptances.push({
      acceptedInputIds: acceptedInputs.map((item) => item.id),
      captureIds: lateInputSummaries
        .map((summary) => summary.optionalInboxCaptureId)
        .filter((captureId): captureId is string => captureId !== null),
      items: lateItems,
      lastInputCursor: lateInputs.nextCursor ?? nextContext.lastInputCursor,
      apply() {
        context = mergeAssistantAutoReplyContextItems({
          context,
          items: lateItems,
          lastInputCursor: lateInputs.nextCursor ?? nextContext.lastInputCursor,
        })
        conversation = readAutoReplyConversationRef(context)
        input.onAcceptedContext(context)
        input.onEvent?.({
          type: 'input.reply-progress',
          inputId: primaryAutoReplyInputId(context),
          details: `new input committed to active turn with ${lateInputs.inputs.length} additional input(s)`,
          providerKind: 'status',
          providerState: 'running',
        })
      },
    })

    const result: AssistantActiveTurnInputAdmissionResult = {
      acceptedInputs,
      deliveryIdempotencyKey: createHostedAutoReplyDeliveryIdempotencyKey({
        context: finalContext,
        deliveryTarget: acceptedInputDeliveryTargetForIdempotency ?? input.deliveryTarget,
        executionContext: input.executionContext,
      }),
      ...(acceptedInputDeliveryTarget !== null
        ? { deliveryTarget: acceptedInputDeliveryTarget }
        : {}),
      ...(acceptedInputMessageReactionsAvailable === null
        ? {}
        : {
            deliveryMessageReactionsAvailable:
              acceptedInputMessageReactionsAvailable,
          }),
      ...(acceptedInputReplyToMessageId !== undefined
        ? { deliveryReplyToMessageId: acceptedInputReplyToMessageId }
        : {}),
      kind: 'accepted',
      prompt: appendCapturelessAssistantInputPrompt({
        basePrompt: preparedInput.prompt,
        capturelessInputs: lateCapturelessCandidates,
      }),
      receiptMetadata: {
        [AUTO_REPLY_RECEIPT_INPUT_ID_KEY]: nextContext.firstInputId,
        [AUTO_REPLY_RECEIPT_INPUT_IDS_KEY]: buildAutoReplyReceiptInputIds({
          acceptedInputs,
          context: nextContext,
        }).join(','),
      },
      transcriptText: buildAutoReplyAcceptedInputTranscriptText(
        lateInputs.inputs,
        lateInputSummaries,
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
  conversation: AssistantInputConversationRef
  inputSource: AssistantActiveTurnInputSource
  knownProjectionCaptureIds: readonly string[]
  knownInputIds: readonly string[]
  signal?: AbortSignal
}): Promise<AssistantInputCandidateBatch> {
  const strict = await input.inputSource.listNewConversationInputs({
    afterCursor: input.afterCursor,
    conversation: input.conversation,
    knownProjectionCaptureIds: input.knownProjectionCaptureIds,
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
  const knownInputIds = new Set(input.knownInputIds)
  const knownProjectionCaptureIds = new Set(input.knownProjectionCaptureIds)
  const routeInputs = routeListed.inputs
    .filter((candidate) => !knownInputIds.has(candidate.event.inputId))
    .filter((candidate) =>
      candidate.projection.captureId
        ? !knownProjectionCaptureIds.has(candidate.projection.captureId)
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

function loadAssistantInputCandidateSummaries(input: {
  candidates: readonly AssistantInputCandidate[]
}): AssistantAutomationInputSummary[] {
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
      item.inputCandidate?.event.inputId ?? item.summary.inputId,
    ),
  )
  const appendedItems = [...input.items]
    .filter((item) => {
      const key = item.inputCandidate?.event.inputId ?? item.summary.inputId
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

function selectAssistantAutoReplyContextByInputIds(input: {
  context: AssistantAutoReplyGroupContext
  inputIds: readonly string[]
}): AssistantAutoReplyGroupContext | null {
  const selectedInputIds = new Set(input.inputIds)
  const selectedItems = input.context.items.filter((item) => {
    const inputId = item.inputCandidate?.event.inputId ?? item.summary.inputId
    return selectedInputIds.has(inputId)
  })
  if (selectedItems.length === 0) {
    return null
  }

  return createAssistantAutoReplyGroupContext(selectedItems)
}

function selectAssistantAutoReplyContextExcludingInputIds(input: {
  context: AssistantAutoReplyGroupContext
  inputIds: readonly string[]
}): AssistantAutoReplyGroupContext | null {
  const excludedInputIds = new Set(input.inputIds)
  if (excludedInputIds.size === 0) {
    return input.context
  }

  const selectedItems = input.context.items.filter((item) => {
    const inputId = item.inputCandidate?.event.inputId ?? item.summary.inputId
    return !excludedInputIds.has(inputId)
  })
  if (selectedItems.length === 0) {
    return null
  }

  return createAssistantAutoReplyGroupContext(selectedItems)
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
  return compareAssistantInputSummaryOrder(left.summary, right.summary)
}

function assistantAutoReplyGroupItemFromInputCandidate(
  candidate: AssistantInputCandidate,
): AssistantAutoReplyGroupItem {
  return {
    inputCandidate: candidate,
    summary: assistantAutomationInputSummaryFromCandidate(candidate),
    telegramMetadata: readTelegramAutoReplyMetadataFromAssistantInput({
      replyTarget: candidate.event.replyTarget,
      sourceMetadata: candidate.event.sourceMetadata,
    }),
  }
}

function admitCapturelessAssistantInputs(input: {
  deliveryTarget: string | null
  executionContext?: AssistantExecutionContext | null
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
  const lateItems = input.lateInputs.map(assistantAutoReplyGroupItemFromInputCandidate)
  const nextContext = mergeAssistantAutoReplyContextItems({
    context: queuedContext,
    items: [
      ...input.pendingAcceptances.flatMap((pending) => pending.items),
      ...lateItems,
    ],
    lastInputCursor: input.inputSourceCursor ?? queuedContext.lastInputCursor,
  })

  input.onEvent?.({
    type: 'input.reply-progress',
    inputId: primaryAutoReplyInputId(queuedContext),
    details: `new input queued for active turn with ${acceptedInputIds.length} additional input(s)`,
    providerKind: 'status',
    providerState: 'running',
  })
  input.pendingAcceptances.push({
    acceptedInputIds,
    captureIds: [],
    items: lateItems,
    lastInputCursor: input.inputSourceCursor ?? queuedContext.lastInputCursor,
    apply() {
      const currentContext = input.getContext()
      input.onAcceptedContext(mergeAssistantAutoReplyContextItems({
        context: currentContext,
        items: lateItems,
        lastInputCursor: input.inputSourceCursor ?? currentContext.lastInputCursor,
      }))
      input.onEvent?.({
        type: 'input.reply-progress',
        inputId: primaryAutoReplyInputId(nextContext),
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
  const deliveryTarget = readLatestAssistantInputDeliveryTarget({
    candidates: input.lateInputs,
    expectedChannel: queuedContext.firstItem.summary.source,
  })

  return {
    acceptedInputs,
    deliveryIdempotencyKey: createHostedAutoReplyDeliveryIdempotencyKey({
      context: nextContext,
      deliveryTarget: deliveryTarget ?? input.deliveryTarget,
      executionContext: input.executionContext,
    }),
    ...(deliveryReplyToMessageId !== undefined
      ? { deliveryReplyToMessageId }
      : {}),
    ...(deliveryTarget !== null ? { deliveryTarget } : {}),
    ...(() => {
      const deliveryMessageReactionsAvailable =
        readAutoReplyDeliveryMessageReactionsAvailable({
          context: nextContext,
        })
      return deliveryMessageReactionsAvailable === null
        ? {}
        : { deliveryMessageReactionsAvailable }
    })(),
    kind: 'accepted',
    prompt,
    receiptMetadata: {
      [AUTO_REPLY_RECEIPT_INPUT_ID_KEY]: queuedContext.firstInputId,
      [AUTO_REPLY_RECEIPT_INPUT_IDS_KEY]: buildAutoReplyReceiptInputIds({
        acceptedInputs,
        context: queuedContext,
      }).join(','),
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
      const attachmentContext = renderAssistantInputAttachmentDescriptorPromptSection({
        attachments: candidate.event.attachmentEvidence.attachments,
        descriptors: candidate.event.attachmentDescriptors,
        evidenceReasonCode: candidate.event.attachmentEvidence.reasonCode,
        evidenceStatus: candidate.event.attachmentEvidence.status,
        projectionReasonCode: candidate.projection.reasonCode,
        projectionStatus: candidate.projection.status,
      })
      const sections = [
        `Source: ${candidate.event.source}
Occurred at: ${candidate.event.occurredAt}`,
        transcript
          ? `Message text:
${transcript}`
          : null,
        attachmentContext
          ? `Attachment context:
${attachmentContext}`
          : null,
      ].filter((section): section is string => section !== null)
      if (sections.length <= 1) {
        return null
      }
      const prefix = candidates.length > 1 ? `Input ${index + 1}:\n` : ''
      return `${prefix}${sections.join('\n\n')}`
    })
    .filter((section): section is string => section !== null)

  return sections.length > 0 ? sections.join('\n\n') : null
}

function appendCapturelessAssistantInputPrompt(input: {
  basePrompt: string
  capturelessInputs: readonly AssistantInputCandidate[]
}): string {
  const capturelessPrompt = buildCapturelessAssistantInputPrompt(
    input.capturelessInputs,
  )
  return capturelessPrompt
    ? `${input.basePrompt}\n\nAdditional same-conversation input:\n${capturelessPrompt}`
    : input.basePrompt
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
  inputSummaries: readonly AssistantAutoReplyGroupItem['summary'][],
): string | null {
  const lines = inputSummaries
    .map(buildAutoReplyAcceptedInputSummaryTranscriptText)
    .filter((text): text is string => text !== null)
  return lines.length > 0 ? lines.join('\n\n') : null
}

function buildAutoReplyAcceptedInputTranscriptText(
  candidates: readonly AssistantInputCandidate[],
  fallbackInputSummaries: readonly AssistantAutoReplyGroupItem['summary'][],
): string | null {
  const lines: string[] = []
  let fallbackInputIndex = 0
  for (const candidate of candidates) {
    const fallbackInputSummary = candidate.projection.captureId
      ? fallbackInputSummaries[fallbackInputIndex++]
      : null
    const text =
      buildAssistantInputCandidateTranscriptText(candidate) ??
      (fallbackInputSummary
        ? buildAutoReplyAcceptedInputSummaryTranscriptText(fallbackInputSummary)
        : null)
    if (text) {
      lines.push(text)
    }
  }
  return lines.length > 0 ? lines.join('\n\n') : null
}

function buildAutoReplyAcceptedInputSummaryTranscriptText(
  summary: AssistantAutoReplyGroupItem['summary'],
): string | null {
  const text = normalizeNullableString(summary.text)
  if (text) {
    return text
  }

  if (summary.attachmentCount > 0) {
    return summary.attachmentCount === 1
      ? 'User sent an attachment.'
      : `User sent ${summary.attachmentCount} attachments.`
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
  inputSummaries: readonly AssistantAutoReplyGroupItem['summary'][]
  inputCandidates: readonly (AssistantInputCandidate | null)[]
}): readonly AssistantAcceptedTurnInputItemInput[] {
  return input.inputSummaries.map((summary, index) => {
    const candidate = input.inputCandidates?.[index] ?? null
    if (!candidate) {
      throw new TypeError(
        'Assistant auto-reply accepted input requires an assistant input event candidate.',
      )
    }
    const base = candidate.acceptedInput
    const baseCaptureIds = base.captureIds ?? []
    const optionalInboxCaptureIds = summary.optionalInboxCaptureId
      ? [summary.optionalInboxCaptureId]
      : []
    return {
      ...base,
      captureIds: baseCaptureIds.length > 0 ? baseCaptureIds : optionalInboxCaptureIds,
      promptFallbackReason: base.promptFallbackReason ?? 'system-input',
      promptFallbackText:
        base.promptFallbackText ??
        buildAssistantInputCandidateTranscriptText(candidate) ??
        buildAutoReplyAcceptedInputSummaryTranscriptText(summary),
    }
  })
}

async function mergeAssistantAutoReplyGroupContext(input: {
  context: AssistantAutoReplyGroupContext
  inputCandidatesByInputId: ReadonlyMap<string, AssistantInputCandidate>
  lateInputSummaries: readonly AssistantAutoReplyGroupItem['summary'][]
  vault: string
}): Promise<AssistantAutoReplyGroupContext | null> {
  const itemsByInputId = new Map(
    input.context.items.map((item) => [item.summary.inputId, item] as const),
  )
  const lateItems = await loadAssistantAutoReplyGroupItems({
    inputSummaries: input.lateInputSummaries,
    inputCandidatesByInputId: input.inputCandidatesByInputId,
    vault: input.vault,
  })

  for (const item of lateItems) {
    itemsByInputId.set(item.summary.inputId, item)
  }

  const items = [...itemsByInputId.values()].sort((left, right) =>
    compareAssistantInputSummaryOrder(left.summary, right.summary),
  )

  return createAssistantAutoReplyGroupContext(items)
}

async function createAssistantAutoReplyContextForInputSummaries(input: {
  inputSummaries: readonly AssistantAutoReplyGroupItem['summary'][]
  inputCandidatesByInputId?: ReadonlyMap<string, AssistantInputCandidate>
  vault: string
}): Promise<AssistantAutoReplyGroupContext | null> {
  const items = await loadAssistantAutoReplyGroupItems({
    inputSummaries: input.inputSummaries,
    inputCandidatesByInputId: input.inputCandidatesByInputId,
    vault: input.vault,
  })

  return createAssistantAutoReplyGroupContext(items)
}

function readAutoReplyDeliveryReplyToMessageId(input: {
  context: AssistantAutoReplyGroupContext
  inputs: readonly AssistantAutoReplyPromptInput[]
}): string | null {
  const inputReplyToMessageId = readLatestAssistantInputReplyTargetMessageId({
    candidates: autoReplyInputCandidatesFromContext(input.context),
    expectedChannel: input.context.firstItem.summary.source,
  })
  if (inputReplyToMessageId !== undefined) {
    return inputReplyToMessageId
  }

  const primaryInput = input.inputs[0]
  if (!primaryInput) {
    return null
  }

  if (primaryInput.source === 'linq') {
    for (let index = input.inputs.length - 1; index >= 0; index -= 1) {
      const messageId = readPromptInputReplyTargetMessageId({
        expectedChannel: primaryInput.source,
        input: input.inputs[index] ?? null,
      })
      if (messageId) {
        return messageId
      }
    }
    return null
  }

  if (primaryInput.source !== 'telegram') {
    return null
  }

  for (let index = input.inputs.length - 1; index >= 0; index -= 1) {
    const messageId = normalizeNullableString(
      input.inputs[index]?.telegramMetadata?.messageId,
    )
    if (messageId) {
      return messageId
    }
  }

  return null
}

function readAutoReplyDeliveryMessageReactionsAvailable(input: {
  context: AssistantAutoReplyGroupContext
}): boolean | null {
  const candidates = autoReplyInputCandidatesFromContext(input.context)
  const candidate = readLatestAssistantInputReplyTargetCandidate({
    candidates,
    expectedChannel: input.context.firstItem.summary.source,
  })
  return readAssistantInputCandidateMessageReactionsAvailable({
    candidate,
    expectedChannel: input.context.firstItem.summary.source,
  })
}

function readAssistantInputCandidateMessageReactionsAvailable(input: {
  candidate: AssistantInputCandidate | null
  expectedChannel: string | null
}): boolean | null {
  const expectedChannel = normalizeNullableString(input.expectedChannel)
  if (expectedChannel !== 'linq') {
    return null
  }

  const candidate = input.candidate
  const replyTarget = candidate?.event.replyTarget ?? null
  if (
    !candidate ||
    normalizeNullableString(replyTarget?.channel) !== 'linq' ||
    readAssistantInputCandidateChannel(candidate) !== 'linq'
  ) {
    return false
  }

  const messageId = readProviderRouteScalar(replyTarget?.messageId)
  if (!messageId) {
    return false
  }

  const metadata = candidate.event.sourceMetadata
  return metadata?.kind === 'linq' && metadata.reactionEligible === true
}

function readPromptInputReplyTargetMessageId(input: {
  expectedChannel: string | null
  input: AssistantAutoReplyPromptInput | null
}): string | null {
  const expectedChannel = normalizeNullableString(input.expectedChannel)
  const replyTarget = input.input?.replyTarget
  if (!expectedChannel || normalizeNullableString(replyTarget?.channel) !== expectedChannel) {
    return null
  }

  return readProviderRouteScalar(replyTarget?.messageId)
}

function readAutoReplyDeliveryTarget(
  context: AssistantAutoReplyGroupContext,
): string | null {
  const replyTarget = readLatestAssistantInputReplyTarget({
    candidates: autoReplyInputCandidatesFromContext(context),
    expectedChannel: context.firstItem.summary.source,
  })
  return readAssistantInputReplyTargetDeliveryTarget(replyTarget)
}

function shouldSuppressHostedTelegramAutoReplyMissingDeliveryTarget(
  context: AssistantAutoReplyGroupContext,
): boolean {
  if (normalizeNullableString(context.firstItem.summary.source) !== 'telegram') {
    return false
  }

  const candidates = autoReplyInputCandidatesFromContext(context)
  const hasTelegramReplyTarget = candidates.some((candidate) => {
    const replyTarget = candidate.event.replyTarget
    return Boolean(
      replyTarget &&
      normalizeNullableString(replyTarget.channel) === 'telegram' &&
      readAssistantInputCandidateChannel(candidate) === 'telegram',
    )
  })
  if (hasTelegramReplyTarget) {
    return true
  }

  return readProviderRouteScalar(
    context.firstItem.summary.conversation.threadId,
  ) === null
}

function readLatestAssistantInputDeliveryTarget(input: {
  candidates: readonly AssistantInputCandidate[]
  expectedChannel: string | null
}): string | null {
  return readAssistantInputReplyTargetDeliveryTarget(
    readLatestAssistantInputReplyTarget(input),
  )
}

function readAssistantInputReplyTargetDeliveryTarget(
  replyTarget: AssistantInputCandidate['event']['replyTarget'],
): string | null {
  if (!replyTargetUsesThreadAsExplicitDeliveryTarget(replyTarget)) {
    return null
  }
  return readProviderRouteScalar(replyTarget?.threadId)
}

function readAutoReplyConversationRef(
  context: AssistantAutoReplyGroupContext,
): AssistantInputConversationRef {
  return context.firstItem.summary.conversation
}

function replyTargetUsesThreadAsExplicitDeliveryTarget(
  replyTarget: AssistantInputCandidate['event']['replyTarget'],
): boolean {
  const channel = normalizeNullableString(replyTarget?.channel)
  return channel === 'linq'
    || channel === 'telegram'
    || channel === 'email'
    || channel === 'whatsapp'
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
  return readLatestAssistantInputReplyTargetCandidate(input)?.event.replyTarget ?? null
}

function readLatestAssistantInputReplyTargetCandidate(input: {
  candidates: readonly AssistantInputCandidate[]
  expectedChannel: string | null
}): AssistantInputCandidate | null {
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
      return candidate
    }
  }

  return null
}

function readLatestAssistantInputReplyTargetMessageId(input: {
  candidates: readonly AssistantInputCandidate[]
  expectedChannel: string | null
}): string | undefined {
  return readAssistantInputCandidateReplyTargetMessageId(
    readLatestAssistantInputReplyTargetCandidate(input),
  )
}

function readAssistantInputCandidateReplyTargetMessageId(
  candidate: AssistantInputCandidate | null,
): string | undefined {
  return readProviderRouteScalar(candidate?.event.replyTarget?.messageId) ?? undefined
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

function resolveAssistantAutoReplySendResult(input: {
  onEvent?: (event: AssistantRunEvent) => void
  replyInputId: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
}): Awaited<ReturnType<typeof sendAssistantMessage>> {
  if (isAssistantNoReplyWithoutDeliveryWork(input.result)) {
    return input.result
  }

  if (input.result.deliveryDeferred) {
    return input.result
  }

  if (isAssistantNoReplyWithCommittedDeliveryWork(input.result)) {
    return input.result
  }

  if (input.result.deliveryError || input.result.delivery === null) {
    const error = new Error(
      input.result.deliveryError?.message ??
        'assistant generated a response, but the outbound delivery channel did not confirm the send',
    )
    Object.defineProperty(error, 'code', {
      configurable: true,
      enumerable: false,
      value: ASSISTANT_AUTO_REPLY_DELIVERY_FAILED_CODE,
      writable: true,
    })
    if (input.result.deliveryIntentId) {
      Object.defineProperty(error, 'outboxIntentId', {
        configurable: true,
        enumerable: false,
        value: input.result.deliveryIntentId,
        writable: true,
      })
    }
    throw markAssistantAutoReplyDeliveryFailure(error)
  }

  return input.result
}

function isAssistantNoReplyWithoutDeliveryWork(
  result: Pick<
    Awaited<ReturnType<typeof sendAssistantMessage>>,
    | 'delivery'
    | 'deliveryDeferred'
    | 'deliveryError'
    | 'deliveryIntentId'
    | 'responseDisposition'
  >,
): boolean {
  return result.responseDisposition === 'none' &&
    result.delivery === null &&
    !result.deliveryDeferred &&
    result.deliveryError === null &&
    result.deliveryIntentId === null
}

function isAssistantNoReplyWithCommittedDeliveryWork(
  result: Pick<
    Awaited<ReturnType<typeof sendAssistantMessage>>,
    | 'delivery'
    | 'deliveryDeferred'
    | 'deliveryError'
    | 'deliveryIntentId'
    | 'responseDisposition'
  >,
): boolean {
  return result.responseDisposition === 'none' &&
    result.delivery === null &&
    !result.deliveryDeferred &&
    result.deliveryIntentId !== null &&
    result.deliveryError !== null
}

function markAssistantAutoReplyDeliveryFailureIfNeeded(error: unknown): unknown {
  if (!isAssistantAutoReplyDeliveryFailureCandidate(error)) {
    return error
  }
  return markAssistantAutoReplyDeliveryFailure(error)
}

function markAssistantAutoReplyDeliveryFailure(error: unknown): unknown {
  if (!error || typeof error !== 'object') {
    return error
  }

  const context = readAssistantAutoReplyErrorContext(error)
  try {
    Object.defineProperty(error, 'context', {
      configurable: true,
      enumerable: false,
      value: {
        ...(context ?? {}),
        assistantDeliveryFailure: true,
      },
      writable: true,
    })
  } catch {
    return error
  }

  return error
}

function isAssistantAutoReplyDeliveryFailureCandidate(error: unknown): boolean {
  const code = readAssistantAutoReplyErrorCode(error)
  return (
    code.includes('DELIVERY') ||
    code.includes('OUTBOX') ||
    hasAssistantAutoReplyOutboxIntentId(error)
  )
}

function readAssistantAutoReplyErrorCode(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code.toUpperCase()
    : ''
}

function readAssistantAutoReplyErrorContext(
  error: unknown,
): Record<string, unknown> | null {
  if (
    !error ||
    typeof error !== 'object' ||
    !('context' in error) ||
    typeof (error as { context?: unknown }).context !== 'object' ||
    (error as { context?: unknown }).context === null ||
    Array.isArray((error as { context?: unknown }).context)
  ) {
    return null
  }

  return (error as { context: Record<string, unknown> }).context
}

function hasAssistantAutoReplyOutboxIntentId(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'outboxIntentId' in error &&
      typeof (error as { outboxIntentId?: unknown }).outboxIntentId === 'string',
  )
}

function classifyAssistantAutoReplyFailure(input: {
  inputCount: number
  error: unknown
}): AssistantAutoReplyGroupOutcome {
  if (isAssistantProviderStalledError(input.error)) {
    return createDeferredGroupOutcome({
      inputCount: input.inputCount,
      nextWakeAt: computeAssistantAutoReplyRetryAt(input.error),
      reason: AUTO_REPLY_PROVIDER_STALLED_DETAIL,
      stopScanning: true,
    })
  }

  const detail = errorMessage(input.error)
  if (isAssistantProviderConnectionLostError(input.error)) {
    return createDeferredGroupOutcome({
      inputCount: input.inputCount,
      nextWakeAt: computeAssistantAutoReplyRetryAt(input.error),
      reason: `${detail} Will retry this input after the provider reconnects.`,
      stopScanning: true,
    })
  }

  if (isAssistantProviderUsageLimitError(input.error)) {
    return {
      ...createSkippedGroupOutcome({
        inputCount: input.inputCount,
        reason: ASSISTANT_PROVIDER_USAGE_LIMIT_SUPPRESSION_REASON,
        stopScanning: true,
        terminalSuppression: true,
      }),
      checkpointRequired: true,
    }
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

  const failure = describeAssistantAutoReplyFailure(input.error)
  if (shouldExhaustAssistantAutoReplyFailure(failure)) {
    return createFailedGroupOutcome({
      advanceCursor: false,
      error: input.error,
      failure,
      stopScanning: true,
      terminalRetryExhausted: true,
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

function shouldExhaustAssistantAutoReplyFailure(
  failure: AssistantAutoReplyFailureSnapshot,
): boolean {
  return failure.code === ASSISTANT_PROVIDER_EMPTY_RESPONSE_CODE
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
  if (captureIds.length === 0) {
    return null
  }
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
      readAssistantAutoReplyTerminalEvidenceByEvidenceId(vault, captureId),
    ),
  )
  return evidence.every((item) => item !== null)
}

async function backfillAssistantAutoReplyTerminalEvidenceFromTerminalEvidence(input: {
  captureIds: readonly string[]
  evidence: AssistantAutoReplyTerminalEvidence
  vault: string
}): Promise<void> {
  if (
    input.evidence.terminal.kind === 'suppressed' ||
    input.evidence.terminal.kind === 'retry_exhausted'
  ) {
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
    inputIds: input.context.inputIds,
    linqMessageIds: resolveAutoReplyLinqProviderMessageIdsFromContext(input.context),
    outcome: input.snapshot.outcome,
    recordedAt: input.snapshot.recordedAt,
    sessionId: input.snapshot.sessionId,
    vault: input.vault,
  })
}

export function createAssistantAutoReplyReceiptReader(input: {
  vault: string
}): AssistantAutoReplyReceiptReader {
  let receipts:
    | Promise<readonly AssistantAutoReplyReceiptRecord[]>
    | null = null

  return {
    readReceipts() {
      receipts ??= listAssistantTurnReceipts(
        input.vault,
        ASSISTANT_AUTO_REPLY_RECEIPT_SCAN_LIMIT,
      )
      return receipts
    },
  }
}

async function readAssistantAutoReplyReceiptRecords(input: {
  receiptFallbackEnabled: boolean
  receiptReader?: AssistantAutoReplyReceiptReader
  vault: string
}): Promise<readonly AssistantAutoReplyReceiptRecord[]> {
  if (!input.receiptFallbackEnabled) {
    return []
  }

  if (input.receiptReader) {
    return input.receiptReader.readReceipts()
  }

  return listAssistantTurnReceipts(
    input.vault,
    ASSISTANT_AUTO_REPLY_RECEIPT_SCAN_LIMIT,
  )
}

function findHandledAutoReplyReceiptForGroup(input: {
  captureIds?: readonly string[]
  inputIds: readonly string[]
  receipts: readonly AssistantAutoReplyReceiptRecord[]
}): AssistantAutoReplyTerminalSnapshot | null {
  const captureIds = input.captureIds ?? []
  let latestReceipt: AssistantAutoReplyReceiptRecord | null = null
  for (const receipt of input.receipts) {
    if (!(receipt.status === 'completed' || receipt.status === 'deferred')) {
      continue
    }

    if (!assistantAutoReplyReceiptMatchesGroup({
      captureIds,
      inputIds: input.inputIds,
      receipt,
    })) {
      continue
    }

    if (
      !latestReceipt ||
      compareAssistantAutoReplyReceiptRecency(receipt, latestReceipt) > 0
    ) {
      latestReceipt = receipt
    }
  }

  if (
    !latestReceipt
  ) {
    return null
  }

  return {
    deliveryIntentId: normalizeNullableString(latestReceipt.deliveryIntentId),
    groupCaptureIds: [...captureIds],
    outcome: latestReceipt.status === 'deferred' ? 'deferred' : 'result',
    recordedAt: latestReceipt.completedAt ?? latestReceipt.updatedAt,
    sessionId: latestReceipt.sessionId,
  }
}

function assistantAutoReplyReceiptMatchesGroup(input: {
  captureIds: readonly string[]
  inputIds: readonly string[]
  receipt: AssistantAutoReplyReceiptRecord
}): boolean {
  const primaryInputId = input.inputIds[0]
  if (!primaryInputId) {
    return false
  }

  const receiptInputIds = new Set<string>()
  const legacyReceiptCaptureIds = new Set<string>()
  for (const event of input.receipt.timeline) {
    if (
      event.kind !== 'turn.started' &&
      event.kind !== 'turn.input.accepted'
    ) {
      continue
    }

    if (event.metadata[AUTO_REPLY_RECEIPT_INPUT_ID_KEY] === primaryInputId) {
      receiptInputIds.add(primaryInputId)
    }

    const groupedInputIds = event.metadata[AUTO_REPLY_RECEIPT_INPUT_IDS_KEY]
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    for (const inputId of groupedInputIds ?? []) {
      receiptInputIds.add(inputId)
    }

    const legacyPrimaryCaptureId = event.metadata.autoReplyCaptureId
    if (legacyPrimaryCaptureId) {
      legacyReceiptCaptureIds.add(legacyPrimaryCaptureId)
    }
    const legacyGroupedCaptureIds = event.metadata.autoReplyCaptureIds
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    for (const captureId of legacyGroupedCaptureIds ?? []) {
      legacyReceiptCaptureIds.add(captureId)
    }
  }

  return input.inputIds.every((inputId) =>
    receiptInputIds.has(inputId),
  ) || (
    input.captureIds.length > 0 &&
    input.captureIds.every((captureId) =>
      legacyReceiptCaptureIds.has(captureId),
    )
  )
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
  input: AssistantAutoReplyPrimaryInput
  vault: string
}): Promise<boolean> {
  const inputText = normalizeNullableString(input.input.text)
  if (!inputText) {
    return false
  }

  let resolved: Awaited<ReturnType<typeof resolveAssistantSession>>
  try {
    resolved = await resolveAssistantSession({
      vault: input.vault,
      createIfMissing: false,
      conversation: conversationRefFromAssistantInputConversation(
        input.input.conversation,
      ),
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
  const inputTime = Date.parse(input.input.occurredAt)
  if (!Number.isFinite(referenceTime) || !Number.isFinite(inputTime)) {
    return false
  }

  if (
    inputTime < referenceTime ||
    inputTime - referenceTime > SELF_AUTHORED_ECHO_WINDOW_MS
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
    normalizeComparableText(inputText)
  )
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}
