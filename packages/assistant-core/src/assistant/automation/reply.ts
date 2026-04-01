import type { AssistantAutomationCursor } from '../../assistant-cli-contracts.js'
import type { InboxShowResult } from '../../inbox-cli-contracts.js'
import type { InboxServices } from '../../inbox-services.js'
import { getAssistantChannelAdapter } from '../channel-adapters.js'
import { conversationRefFromCapture } from '../conversation-ref.js'
import {
  resolveAcceptedInboundMessageOperatorAuthority,
  type AssistantOperatorAuthority,
} from '../operator-authority.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import {
  isAssistantProviderConnectionLostError,
  isAssistantProviderStalledError,
} from '../provider-turn-recovery.js'
import { listAssistantTurnReceipts } from '../receipts.js'
import { errorMessage, normalizeNullableString } from '../shared.js'
import { sendAssistantMessage } from '../service.js'
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
  describeAssistantAutoReplyFailure,
  type AssistantAutoReplyFailureSnapshot,
} from './failure-observability.js'
import {
  collectAssistantAutoReplyGroup,
  type AssistantAutoReplyGroupItem,
} from './grouping.js'
import {
  AUTO_REPLY_PROVIDER_STALLED_DETAIL,
  createAssistantProviderWatchdog,
} from './provider-watchdog.js'
import {
  buildAssistantAutoReplyPrompt,
  type AssistantAutoReplyPromptCapture,
} from './prompt-builder.js'
import {
  createEmptyAutoReplyScanResult,
  cursorFromCapture,
  normalizeEnabledChannels,
  normalizeScanLimit,
  type AssistantAutoReplyScanResult,
  type AssistantAutomationStateProgress,
  type AssistantRunEvent,
} from './shared.js'

const SELF_AUTHORED_ECHO_WINDOW_MS = 10 * 60 * 1000
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
}

interface AssistantAutoReplySkipDecision {
  kind: 'skip'
  advanceCursor: boolean
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
  kind: 'blocked' | 'deferred' | 'failed' | 'ignored' | 'replied' | 'skipped'
  stopScanning: boolean
  summary: AssistantAutoReplyOutcomeSummary
}

type AssistantAutoReplyGroupArtifactStatus = 'complete' | 'none' | 'partial'

export interface AssistantAutoReplyProcessResult {
  advanceCursor: boolean
  failed: number
  replied: number
  skipped: number
  stopScanning: boolean
}

export async function scanAssistantAutoReplyOnce(input: {
  afterCursor?: AssistantAutomationCursor | null
  allowSelfAuthored?: boolean
  autoReplyPrimed?: boolean
  backlogChannels?: readonly string[]
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  enabledChannels: readonly string[]
  inboxServices: InboxServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onStateProgress?: (
    state: AssistantAutomationStateProgress,
  ) => Promise<void> | void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  requestId?: string | null
  signal?: AbortSignal
  sessionMaxAgeMs?: number | null
  vault: string
}): Promise<AssistantAutoReplyScanResult> {
  const enabledChannels = normalizeEnabledChannels(input.enabledChannels)
  const backlogChannels = normalizeEnabledChannels(input.backlogChannels ?? [])
  const backlogActive = backlogChannels.length > 0
  if (enabledChannels.length === 0) {
    return createEmptyAutoReplyScanResult()
  }

  if (!(input.autoReplyPrimed ?? true) && !backlogActive) {
    const latest = await input.inboxServices.list({
      vault: input.vault,
      requestId: input.requestId ?? null,
      limit: 1,
      sourceId: null,
      afterOccurredAt: null,
      afterCaptureId: null,
      oldestFirst: false,
    })
    const latestCapture = [...latest.items].sort((left, right) =>
      left.occurredAt === right.occurredAt
        ? right.captureId.localeCompare(left.captureId)
        : right.occurredAt.localeCompare(left.occurredAt),
    )[0]
    const nextCursor = latestCapture
      ? {
          occurredAt: latestCapture.occurredAt,
          captureId: latestCapture.captureId,
        }
      : input.afterCursor ?? null

    await input.onStateProgress?.({
      cursor: nextCursor,
      primed: true,
    })
    input.onEvent?.({
      type: 'reply.scan.primed',
      details:
        nextCursor === null
          ? 'no existing captures yet; auto-reply will start with the next inbound message'
          : `starting after ${nextCursor.captureId}`,
    })

    return createEmptyAutoReplyScanResult()
  }

  if (backlogActive) {
    input.onEvent?.({
      type: 'reply.scan.primed',
      details: `processing existing ${backlogChannels.join(', ')} backlog before switching to new inbound messages`,
    })
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

  if (backlogActive && captures.length === 0) {
    await input.onStateProgress?.({
      cursor: input.afterCursor ?? null,
      backlogChannels: [],
      primed: true,
    })
    return createEmptyAutoReplyScanResult()
  }

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
      providerHeartbeatMs: input.providerHeartbeatMs,
      providerLongRunningCommandStallTimeoutMs:
        input.providerLongRunningCommandStallTimeoutMs,
      providerStallTimeoutMs: input.providerStallTimeoutMs,
      requestId: input.requestId ?? null,
      signal: input.signal,
      sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
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
    cursor: scanState.cursor,
    primed: true,
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
  input.summary.replied += input.result.replied
  input.summary.skipped += input.result.skipped
  if (input.result.advanceCursor) {
    input.updateCursor(input.context.lastCursor)
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
  inboxServices: InboxServices
  onEvent?: (event: AssistantRunEvent) => void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  requestId: string | null
  signal?: AbortSignal
  sessionMaxAgeMs: number | null
  vault: string
}): Promise<AssistantAutoReplyProcessResult> {
  const outcome = await resolveAssistantAutoReplyGroupOutcome(input)
  return commitAssistantAutoReplyGroupOutcome({
    context: input.context,
    onEvent: input.onEvent,
    outcome,
    vault: input.vault,
  })
}

async function resolveAssistantAutoReplyGroupOutcome(input: {
  allowSelfAuthored: boolean
  context: AssistantAutoReplyGroupContext
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  enabledChannels: readonly string[]
  inboxServices: InboxServices
  onEvent?: (event: AssistantRunEvent) => void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  requestId: string | null
  signal?: AbortSignal
  sessionMaxAgeMs: number | null
  vault: string
}): Promise<AssistantAutoReplyGroupOutcome> {
  try {
    const decision = await evaluateAssistantAutoReplyGroup({
      allowSelfAuthored: input.allowSelfAuthored,
      enabledChannels: input.enabledChannels,
      group: input.context,
      inboxServices: input.inboxServices,
      requestId: input.requestId,
      vault: input.vault,
    })
    if (decision.kind === 'ignore') {
      return createIgnoredGroupOutcome()
    }
    if (decision.kind === 'skip') {
      return createSkippedDecisionOutcome({
        captureCount: input.context.captureCount,
        decision,
      })
    }

    input.onEvent?.({
      type: 'capture.reply-started',
      captureId: input.context.firstCaptureId,
      details: 'assistant provider turn started',
    })
    const result = await executeAssistantAutoReply({
      captureIds: input.context.captureIds,
      deliveryDispatchMode: input.deliveryDispatchMode,
      deliveryReplyToMessageId: decision.deliveryReplyToMessageId,
      providerHeartbeatMs: input.providerHeartbeatMs,
      providerLongRunningCommandStallTimeoutMs:
        input.providerLongRunningCommandStallTimeoutMs,
      providerStallTimeoutMs: input.providerStallTimeoutMs,
      signal: input.signal,
      maxSessionAgeMs: input.sessionMaxAgeMs,
      onEvent: input.onEvent,
      operatorAuthority: decision.operatorAuthority,
      primaryCapture: decision.primaryCapture,
      prompt: decision.prompt,
      replyCaptureId: input.context.firstCaptureId,
      vault: input.vault,
    })
    if (result.status === 'blocked') {
      return createBlockedGroupOutcome({
        captureCount: input.context.captureCount,
        reason: result.blocked?.message ?? 'assistant reply was blocked',
      })
    }
    if (result.deliveryDeferred) {
      return createDeferredDeliveryGroupOutcome(result)
    }

    return createSuccessfulReplyGroupOutcome(result)
  } catch (error) {
    return classifyAssistantAutoReplyFailure({
      captureCount: input.context.captureCount,
      error,
    })
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
    failed: input.outcome.summary.failed,
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
      stopScanning: input.decision.stopScanning,
    })
  }

  return createDeferredGroupOutcome({
    captureCount: input.captureCount,
    reason: input.decision.reason,
    stopScanning: input.decision.stopScanning,
  })
}

function createSkippedGroupOutcome(input: {
  captureCount: number
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
    stopScanning: input.stopScanning ?? false,
    summary: createAssistantAutoReplyOutcomeSummary({
      skipped: input.captureCount,
    }),
  }
}

function createBlockedGroupOutcome(input: {
  captureCount: number
  reason: string
}): AssistantAutoReplyGroupOutcome {
  return {
    advanceCursor: true,
    artifact: { kind: 'none' },
    event: {
      details: input.reason,
      type: 'capture.reply-skipped',
    },
    kind: 'blocked',
    stopScanning: false,
    summary: createAssistantAutoReplyOutcomeSummary({
      skipped: input.captureCount,
    }),
  }
}

function createDeferredGroupOutcome(input: {
  captureCount: number
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
    stopScanning: false,
    summary: createAssistantAutoReplyOutcomeSummary({
      replied: 1,
    }),
  }
}

function createFailedGroupOutcome(input: {
  advanceCursor: boolean
  error: unknown
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
    stopScanning: false,
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

  const prompt = buildAssistantAutoReplyPrompt(shownGroup)
  if (prompt.kind === 'defer') {
    return createDeferredSkipDecision(prompt.reason)
  }
  if (prompt.kind === 'skip') {
    return createAdvancingSkipDecision(prompt.reason)
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
    operatorAuthority: resolveAcceptedInboundMessageOperatorAuthority(),
    primaryCapture,
    prompt: prompt.prompt,
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
  captureIds: readonly string[]
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  deliveryReplyToMessageId: string | null
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  signal?: AbortSignal
  maxSessionAgeMs: number | null
  onEvent?: (event: AssistantRunEvent) => void
  operatorAuthority: AssistantOperatorAuthority
  primaryCapture: InboxShowResult['capture']
  prompt: string
  replyCaptureId: string
  vault: string
}): Promise<Awaited<ReturnType<typeof sendAssistantMessage>>> {
  const watchdog = createAssistantProviderWatchdog(input)

  try {
    const result = await sendAssistantMessage({
      vault: input.vault,
      conversation: conversationRefFromCapture(input.primaryCapture),
      abortSignal: watchdog.signal,
      enableFirstTurnOnboarding: true,
      operatorAuthority: input.operatorAuthority,
      persistUserPromptOnFailure: false,
      prompt: input.prompt,
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

function readAutoReplyDeliveryReplyToMessageId(
  captures: readonly AssistantAutoReplyPromptCapture[],
): string | null {
  const primaryCapture = captures[0]?.capture
  if (!primaryCapture) {
    return null
  }

  if (primaryCapture.source === 'linq') {
    return readLinqReplyToMessageId(primaryCapture)
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

  return normalizeNullableString(externalId.slice('linq:'.length))
}

function resolveAssistantAutoReplySendResult(input: {
  onEvent?: (event: AssistantRunEvent) => void
  replyCaptureId: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
}): Awaited<ReturnType<typeof sendAssistantMessage>> {
  if (input.result.status === 'blocked') {
    return input.result
  }

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
      reason: AUTO_REPLY_PROVIDER_STALLED_DETAIL,
      stopScanning: true,
    })
  }

  const detail = errorMessage(input.error)
  if (isAssistantProviderConnectionLostError(input.error)) {
    return createDeferredGroupOutcome({
      captureCount: input.captureCount,
      reason: `${detail} Will retry this capture after the provider reconnects.`,
      stopScanning: true,
    })
  }

  return createFailedGroupOutcome({
    advanceCursor: true,
    error: input.error,
  })
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

    const startedEvent = receipt.timeline.find((event) => event.kind === 'turn.started')
    if (!startedEvent) {
      return false
    }

    if (startedEvent.metadata[AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY] === primaryCaptureId) {
      return true
    }

    const groupedCaptureIds = startedEvent.metadata[AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    return groupedCaptureIds?.includes(primaryCaptureId) ?? false
  })
}

function createDeferredSkipDecision(
  reason: string,
): AssistantAutoReplySkipDecision {
  return {
    advanceCursor: false,
    kind: 'skip',
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
