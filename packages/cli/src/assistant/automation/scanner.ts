import type { AssistantAutomationCursor } from '../../assistant-cli-contracts.js'
import type { InboxShowResult } from '../../inbox-cli-contracts.js'
import type { InboxCliServices } from '../../inbox-services.js'
import { routeInboxCaptureWithModel } from '../../inbox-model-harness.js'
import { shouldBypassParserWaitForRouting } from '../../inbox-routing-vision.js'
import type { AssistantModelSpec } from '../../model-harness.js'
import type { VaultCliServices } from '../../vault-cli-services.js'
import type { AssistantProviderProgressEvent } from '../../chat-provider.js'
import { getAssistantChannelAdapter } from '../channel-adapters.js'
import {
  conversationRefFromCapture,
} from '../conversation-ref.js'
import { sendAssistantMessage } from '../service.js'
import {
  listAssistantTranscriptEntries,
  resolveAssistantSession,
} from '../store.js'
import { errorMessage, normalizeNullableString } from '../shared.js'
import {
  isAssistantProviderConnectionLostError,
  isAssistantProviderStalledError,
} from '../provider-turn-recovery.js'
import {
  assistantChatReplyArtifactExists,
  assistantResultArtifactExists,
  writeAssistantChatDeferredArtifacts,
  writeAssistantChatErrorArtifacts,
  writeAssistantChatResultArtifacts,
} from './artifacts.js'
import {
  collectAssistantAutoReplyGroup,
  type AssistantAutoReplyGroupItem,
} from './grouping.js'
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
  type AssistantInboxScanResult,
  type AssistantRunEvent,
} from './shared.js'

const SELF_AUTHORED_ECHO_WINDOW_MS = 10 * 60 * 1000
export const AUTO_REPLY_PROVIDER_HEARTBEAT_MS = 2 * 60 * 1000
export const AUTO_REPLY_PROVIDER_STALL_TIMEOUT_MS = 10 * 60 * 1000
export const AUTO_REPLY_PROVIDER_LONG_RUNNING_COMMAND_STALL_TIMEOUT_MS =
  150 * 60 * 1000
const AUTO_REPLY_PROVIDER_STALLED_DETAIL =
  'assistant provider stalled without progress; will retry this capture.'

interface AssistantAutoReplyGroupContext {
  captureCount: number
  captureIds: string[]
  firstCaptureId: string
  firstItem: AssistantAutoReplyGroupItem
  items: readonly AssistantAutoReplyGroupItem[]
  lastCursor: AssistantAutomationCursor
}

interface AssistantAutoReplyReplyDecision {
  kind: 'reply'
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

type AssistantAutoReplyFailureDecision =
  | AssistantAutoReplySkipDecision
  | {
      advanceCursor: boolean
      detail: string
      kind: 'failure'
    }

interface AssistantAutoReplyScanState {
  cursor: AssistantAutomationCursor | null
}

interface AssistantAutoReplyLongRunningOperation {
  key: string
  label: string
  startedAtMs: number
}

export async function scanAssistantInboxOnce(input: {
  afterCursor?: AssistantAutomationCursor | null
  inboxServices: InboxCliServices
  maxPerScan?: number
  modelSpec: AssistantModelSpec
  oldestFirst?: boolean
  onCursorProgress?: (cursor: AssistantAutomationCursor | null) => Promise<void> | void
  onEvent?: (event: AssistantRunEvent) => void
  requestId?: string | null
  signal?: AbortSignal
  vault: string
  vaultServices?: VaultCliServices
}): Promise<AssistantInboxScanResult> {
  const listed = await input.inboxServices.list({
    vault: input.vault,
    requestId: input.requestId ?? null,
    limit: normalizeScanLimit(input.maxPerScan),
    sourceId: null,
    afterOccurredAt: input.afterCursor?.occurredAt ?? null,
    afterCaptureId: input.afterCursor?.captureId ?? null,
    oldestFirst: input.oldestFirst ?? false,
  })
  const captures = [...listed.items].sort((left, right) =>
    left.occurredAt === right.occurredAt
      ? left.captureId.localeCompare(right.captureId)
      : left.occurredAt.localeCompare(right.occurredAt),
  )
  input.onEvent?.({
    type: 'scan.started',
    details: `${captures.length} capture(s)`,
  })

  const summary: AssistantInboxScanResult = {
    considered: captures.length,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 0,
  }

  for (const capture of captures) {
    if (input.signal?.aborted) {
      break
    }

    try {
      const existingArtifact = await assistantResultArtifactExists(
        input.vault,
        capture.captureId,
      )
      if (existingArtifact) {
        summary.skipped += 1
        input.onEvent?.({
          type: 'capture.skipped',
          captureId: capture.captureId,
          details: 'assistant result already exists',
        })
        continue
      }

      if (capture.promotions.length > 0) {
        summary.skipped += 1
        input.onEvent?.({
          type: 'capture.skipped',
          captureId: capture.captureId,
          details: 'capture already promoted',
        })
        continue
      }

      const shown = await input.inboxServices.show({
        vault: input.vault,
        requestId: input.requestId ?? null,
        captureId: capture.captureId,
      })

      const waitingForParser = shown.capture.attachments.some((attachment) => {
        if (
          attachment.parseState !== 'pending' &&
          attachment.parseState !== 'running'
        ) {
          return false
        }

        return !shouldBypassParserWaitForRouting(attachment)
      })
      if (waitingForParser) {
        summary.skipped += 1
        input.onEvent?.({
          type: 'capture.skipped',
          captureId: capture.captureId,
          details: 'waiting for parser completion',
        })
        continue
      }

      const result = await routeInboxCaptureWithModel({
        inboxServices: input.inboxServices,
        requestId: input.requestId ?? undefined,
        captureId: capture.captureId,
        vault: input.vault,
        vaultServices: input.vaultServices,
        apply: true,
        modelSpec: input.modelSpec,
      })

      if (result.plan.actions.length === 0) {
        summary.noAction += 1
        input.onEvent?.({
          type: 'capture.noop',
          captureId: capture.captureId,
          details: 'model chose no canonical writes',
        })
        continue
      }

      summary.routed += 1
      input.onEvent?.({
        type: 'capture.routed',
        captureId: capture.captureId,
        tools: result.plan.actions.map((action) => action.tool),
      })
    } catch (error) {
      summary.failed += 1
      input.onEvent?.({
        type: 'capture.failed',
        captureId: capture.captureId,
        details: errorMessage(error),
      })
    }
  }

  await input.onCursorProgress?.(
    captures.length > 0
      ? {
          occurredAt: captures[captures.length - 1]!.occurredAt,
          captureId: captures[captures.length - 1]!.captureId,
        }
      : input.afterCursor ?? null,
  )

  return summary
}

export async function scanAssistantAutoReplyOnce(input: {
  afterCursor?: AssistantAutomationCursor | null
  allowSelfAuthored?: boolean
  autoReplyPrimed?: boolean
  backlogChannels?: readonly string[]
  enabledChannels: readonly string[]
  inboxServices: InboxCliServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onStateProgress?: (state: AssistantAutomationStateProgress) => Promise<void> | void
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

    try {
      const decision = await evaluateAssistantAutoReplyGroup({
        allowSelfAuthored: input.allowSelfAuthored ?? false,
        enabledChannels,
        group: context,
        inboxServices: input.inboxServices,
        requestId: input.requestId ?? null,
        vault: input.vault,
      })
      if (decision.kind === 'ignore') {
        continue
      }
      if (decision.kind === 'skip') {
        applySkippedGroup({
          context,
          onEvent: input.onEvent,
          reason: decision.reason,
          scanState,
          summary,
          advanceCursor: decision.advanceCursor,
        })
        if (decision.stopScanning) {
          break
        }
        continue
      }

      input.onEvent?.({
        type: 'capture.reply-started',
        captureId: context.firstCaptureId,
        details: 'assistant provider turn started',
      })
      const result = await executeAssistantAutoReply({
        providerHeartbeatMs: input.providerHeartbeatMs,
        providerLongRunningCommandStallTimeoutMs:
          input.providerLongRunningCommandStallTimeoutMs,
        providerStallTimeoutMs: input.providerStallTimeoutMs,
        signal: input.signal,
        maxSessionAgeMs: input.sessionMaxAgeMs ?? null,
        onEvent: input.onEvent,
        primaryCapture: decision.primaryCapture,
        prompt: decision.prompt,
        replyCaptureId: context.firstCaptureId,
        vault: input.vault,
      })
      if (result.deliveryDeferred) {
        await applyDeferredReply({
          context,
          onEvent: input.onEvent,
          result,
          scanState,
          summary,
          vault: input.vault,
        })
      } else {
        await applySuccessfulReply({
          context,
          onEvent: input.onEvent,
          result,
          scanState,
          summary,
          vault: input.vault,
        })
      }
    } catch (error) {
      const failureDecision = classifyAssistantAutoReplyFailure(error)
      if (failureDecision.kind === 'skip') {
        applySkippedGroup({
          context,
          onEvent: input.onEvent,
          reason: failureDecision.reason,
          scanState,
          summary,
          advanceCursor: failureDecision.advanceCursor,
        })
        if (failureDecision.stopScanning) {
          break
        }
        continue
      }

      await applyFailedGroup({
        advanceCursor: failureDecision.advanceCursor,
        context,
        vault: input.vault,
        error,
        onEvent: input.onEvent,
        scanState,
        summary,
        detail: failureDecision.detail,
      })
      continue
    }
  }

  await input.onStateProgress?.({
    cursor: scanState.cursor,
    primed: true,
  })

  return summary
}

function createAssistantAutoReplyGroupContext(
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

async function evaluateAssistantAutoReplyGroup(input: {
  allowSelfAuthored: boolean
  enabledChannels: readonly string[]
  group: AssistantAutoReplyGroupContext
  inboxServices: InboxCliServices
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

  const existingArtifact = await Promise.all(
    input.group.captureIds.map((captureId) =>
      assistantChatReplyArtifactExists(input.vault, captureId),
    ),
  )
  if (existingArtifact.some(Boolean)) {
    return createAdvancingSkipDecision('assistant reply already exists')
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
    kind: 'reply',
    primaryCapture,
    prompt: prompt.prompt,
  }
}

async function loadAssistantAutoReplyCaptures(input: {
  group: AssistantAutoReplyGroupContext
  inboxServices: InboxCliServices
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
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  signal?: AbortSignal
  maxSessionAgeMs: number | null
  onEvent?: (event: AssistantRunEvent) => void
  primaryCapture: InboxShowResult['capture']
  prompt: string
  replyCaptureId: string
  vault: string
}): Promise<Awaited<ReturnType<typeof sendAssistantMessage>>> {
  const abortController = new AbortController()
  const cleanupAbortBridge = bridgeUpstreamAbortSignal(
    abortController,
    input.signal,
  )
  const startedAtMs = Date.now()
  const heartbeatMs = normalizeAutoReplyWatchdogMs(
    input.providerHeartbeatMs,
    AUTO_REPLY_PROVIDER_HEARTBEAT_MS,
  )
  const stallTimeoutMs = normalizeAutoReplyWatchdogMs(
    input.providerStallTimeoutMs,
    AUTO_REPLY_PROVIDER_STALL_TIMEOUT_MS,
  )
  const longRunningCommandStallTimeoutMs = Math.max(
    stallTimeoutMs,
    normalizeAutoReplyWatchdogMs(
      input.providerLongRunningCommandStallTimeoutMs,
      AUTO_REPLY_PROVIDER_LONG_RUNNING_COMMAND_STALL_TIMEOUT_MS,
    ),
  )
  let lastProgressAtMs = startedAtMs
  let stalled = false
  let activeLongRunningOperation: AssistantAutoReplyLongRunningOperation | null =
    null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let stallTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimers = () => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
      stallTimer = null
    }
  }

  const resetStallTimer = () => {
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
    }
    const currentStallTimeoutMs = resolveAutoReplyProviderStallTimeoutMs({
      defaultTimeoutMs: stallTimeoutMs,
      longRunningCommandTimeoutMs: longRunningCommandStallTimeoutMs,
      operation: activeLongRunningOperation,
    })
    stallTimer = setTimeout(() => {
      if (abortController.signal.aborted) {
        return
      }

      stalled = true
      const stalledDetailSuffix = activeLongRunningOperation
        ? ` during ${activeLongRunningOperation.label}`
        : ''
      input.onEvent?.({
        type: 'capture.reply-progress',
        captureId: input.replyCaptureId,
        details: `assistant provider stalled after ${formatAutoReplyDuration(
          Date.now() - startedAtMs,
        )}${stalledDetailSuffix}; last provider activity ${formatAutoReplyDuration(
          Date.now() - lastProgressAtMs,
        )} ago; aborting and scheduling retry`,
        providerKind: 'status',
        providerState: 'running',
      })
      abortController.abort()
    }, currentStallTimeoutMs)
  }

  heartbeatTimer = setInterval(() => {
    if (abortController.signal.aborted) {
      return
    }

    const now = Date.now()
    if (now - lastProgressAtMs < heartbeatMs) {
      return
    }
    const longRunningDetail = formatAutoReplyLongRunningHeartbeatDetail(
      activeLongRunningOperation,
      now,
    )
    input.onEvent?.({
      type: 'capture.reply-progress',
      captureId: input.replyCaptureId,
      details: `assistant still running after ${formatAutoReplyDuration(
        now - startedAtMs,
      )}${longRunningDetail}; last provider activity ${formatAutoReplyDuration(
        now - lastProgressAtMs,
      )} ago`,
      providerKind: 'status',
      providerState: 'running',
    })
  }, heartbeatMs)
  resetStallTimer()

  try {
    const result = await sendAssistantMessage({
      vault: input.vault,
      conversation: conversationRefFromCapture(input.primaryCapture),
      abortSignal: abortController.signal,
      enableFirstTurnOnboarding: true,
      persistUserPromptOnFailure: false,
      prompt: input.prompt,
      deliverResponse: true,
      turnTrigger: 'automation-auto-reply',
      maxSessionAgeMs: input.maxSessionAgeMs,
      onProviderEvent: (event) => {
        const eventReceivedAtMs = Date.now()
        lastProgressAtMs = eventReceivedAtMs
        activeLongRunningOperation = applyAssistantAutoReplyLongRunningOperationEvent(
          activeLongRunningOperation,
          event,
          eventReceivedAtMs,
        )
        resetStallTimer()

        const runEvent = createAssistantAutoReplyProgressEvent(
          input.replyCaptureId,
          event,
        )
        if (runEvent) {
          input.onEvent?.(runEvent)
        }
      },
    })

    if (result.deliveryDeferred) {
      input.onEvent?.({
        type: 'capture.reply-progress',
        captureId: input.replyCaptureId,
        details: result.deliveryIntentId
          ? `assistant queued outbound delivery for retry as ${result.deliveryIntentId}`
          : 'assistant queued outbound delivery for retry',
        providerKind: 'status',
        providerState: 'completed',
      })
      return result
    }

    if (result.deliveryError || result.delivery === null) {
      throw new Error(
        result.deliveryError?.message ??
          'assistant generated a response, but the outbound delivery channel did not confirm the send',
      )
    }

    return result
  } catch (error) {
    if (stalled) {
      markAssistantProviderStalled(error)
    }
    throw error
  } finally {
    clearTimers()
    cleanupAbortBridge()
  }
}

function createAssistantAutoReplyProgressEvent(
  captureId: string,
  event: AssistantProviderProgressEvent,
): AssistantRunEvent | null {
  if (event.kind === 'message') {
    return null
  }

  return {
    type: 'capture.reply-progress',
    captureId,
    details: event.text,
    providerKind: event.kind,
    providerState: event.state,
  }
}

function bridgeUpstreamAbortSignal(
  controller: AbortController,
  signal?: AbortSignal,
): () => void {
  if (!signal) {
    return () => {}
  }

  const abort = () => controller.abort()
  if (signal.aborted) {
    controller.abort()
    return () => {}
  }

  signal.addEventListener('abort', abort, { once: true })
  return () => {
    signal.removeEventListener('abort', abort)
  }
}

function markAssistantProviderStalled(error: unknown): void {
  if (!error || typeof error !== 'object') {
    return
  }

  const currentContext =
    'context' in error &&
    (error as { context?: unknown }).context &&
    typeof (error as { context?: unknown }).context === 'object' &&
    !Array.isArray((error as { context?: unknown }).context)
      ? ((error as { context?: Record<string, unknown> }).context ?? {})
      : {}

  ;(error as { context?: Record<string, unknown> }).context = {
    ...currentContext,
    providerStalled: true,
    retryable: true,
  }
}

function formatAutoReplyDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes <= 0) {
    return `${seconds}s`
  }

  if (seconds === 0) {
    return `${minutes}m`
  }

  return `${minutes}m ${seconds}s`
}

function resolveAutoReplyProviderStallTimeoutMs(input: {
  defaultTimeoutMs: number
  longRunningCommandTimeoutMs: number
  operation: AssistantAutoReplyLongRunningOperation | null
}): number {
  return input.operation
    ? input.longRunningCommandTimeoutMs
    : input.defaultTimeoutMs
}

function formatAutoReplyLongRunningHeartbeatDetail(
  operation: AssistantAutoReplyLongRunningOperation | null,
  nowMs: number,
): string {
  if (!operation) {
    return ''
  }

  return `; ${operation.label} active for ${formatAutoReplyDuration(
    nowMs - operation.startedAtMs,
  )}`
}

function normalizeAutoReplyWatchdogMs(
  value: number | null | undefined,
  fallback: number,
): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return fallback
  }

  return Math.max(1, Math.trunc(value))
}

function applyAssistantAutoReplyLongRunningOperationEvent(
  current: AssistantAutoReplyLongRunningOperation | null,
  event: AssistantProviderProgressEvent,
  eventReceivedAtMs: number,
): AssistantAutoReplyLongRunningOperation | null {
  const matchedOperation = matchAssistantAutoReplyLongRunningOperation(event)
  if (!matchedOperation) {
    return current
  }

  if (event.state === 'completed') {
    if (!current) {
      return null
    }

    return current.key === matchedOperation.key || current.label === matchedOperation.label
      ? null
      : current
  }

  return {
    ...matchedOperation,
    startedAtMs: eventReceivedAtMs,
  }
}

function matchAssistantAutoReplyLongRunningOperation(
  event: AssistantProviderProgressEvent,
): Omit<AssistantAutoReplyLongRunningOperation, 'startedAtMs'> | null {
  if (event.kind === 'command') {
    return matchAssistantAutoReplyLongRunningCommand(event)
  }

  if (event.kind === 'tool') {
    return matchAssistantAutoReplyLongRunningTool(event)
  }

  return null
}

function matchAssistantAutoReplyLongRunningCommand(
  event: Pick<AssistantProviderProgressEvent, 'id' | 'text'>,
): Omit<AssistantAutoReplyLongRunningOperation, 'startedAtMs'> | null {
  const commandText = normalizeNullableString(
    event.text.replace(/^\$\s*/u, ''),
  )
  if (!commandText) {
    return null
  }

  const cliCommandMatch = /(?:^|\s)(?:[^\s]+\/)?(?:vault-cli|healthybob)\s+(research|deepthink)(?:\s|$)/iu.exec(
    commandText,
  )
  if (cliCommandMatch) {
    const commandName = cliCommandMatch[1]!.toLowerCase()
    return {
      key: event.id ?? `command:${commandName}`,
      label: `${commandName} command`,
    }
  }

  if (/(?:^|\s)(?:[^\s]+\/)?(?:pnpm|npm|yarn)\s+review:gpt(?:\s|$)/iu.test(commandText)) {
    return {
      key: event.id ?? 'command:review:gpt',
      label: 'review:gpt run',
    }
  }

  return /\breview:gpt\b/iu.test(commandText)
    ? {
        key: event.id ?? 'command:review:gpt',
        label: 'review:gpt run',
      }
    : null
}

function matchAssistantAutoReplyLongRunningTool(
  event: Pick<AssistantProviderProgressEvent, 'id' | 'text'>,
): Omit<AssistantAutoReplyLongRunningOperation, 'startedAtMs'> | null {
  const toolText = normalizeNullableString(event.text)
  if (!toolText || !/^tool\b/iu.test(toolText)) {
    return null
  }

  if (/\bdeepthink\b/iu.test(toolText)) {
    return {
      key: event.id ?? 'tool:deepthink',
      label: 'deepthink tool',
    }
  }

  return /\bresearch\b/iu.test(toolText)
    ? {
        key: event.id ?? 'tool:research',
        label: 'research tool',
      }
    : null
}

function classifyAssistantAutoReplyFailure(
  error: unknown,
): AssistantAutoReplyFailureDecision {
  if (isAssistantProviderStalledError(error)) {
    return createDeferredSkipDecision(AUTO_REPLY_PROVIDER_STALLED_DETAIL)
  }

  const detail = errorMessage(error)
  if (isAssistantProviderConnectionLostError(error)) {
    return createDeferredSkipDecision(
      `${detail} Will retry this capture after the provider reconnects.`,
    )
  }

  return {
    advanceCursor: true,
    detail,
    kind: 'failure',
  }
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

// Deferred skips intentionally leave the cursor in place so the same grouped
// capture can be retried after parser/provider state recovers.
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

function applySkippedGroup(input: {
  advanceCursor: boolean
  context: AssistantAutoReplyGroupContext
  onEvent?: (event: AssistantRunEvent) => void
  reason: string
  scanState: AssistantAutoReplyScanState
  summary: AssistantAutoReplyScanResult
}): void {
  input.summary.skipped += input.context.captureCount
  if (input.advanceCursor) {
    input.scanState.cursor = input.context.lastCursor
  }
  input.onEvent?.({
    type: 'capture.reply-skipped',
    captureId: input.context.firstCaptureId,
    details: input.reason,
  })
}

async function applySuccessfulReply(input: {
  context: AssistantAutoReplyGroupContext
  onEvent?: (event: AssistantRunEvent) => void
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
  scanState: AssistantAutoReplyScanState
  summary: AssistantAutoReplyScanResult
  vault: string
}): Promise<void> {
  const delivery = input.result.delivery
  if (!delivery) {
    throw new Error(
      'assistant auto-reply delivery was missing after delivery confirmation',
    )
  }

  await writeAssistantChatResultArtifacts({
    captureIds: input.context.captureIds,
    respondedAt: delivery.sentAt,
    result: input.result,
    vault: input.vault,
  })
  input.summary.replied += 1
  input.scanState.cursor = input.context.lastCursor
  input.onEvent?.({
    type: 'capture.replied',
    captureId: input.context.firstCaptureId,
    details: `${delivery.channel} -> ${delivery.target}`,
  })
}

async function applyDeferredReply(input: {
  context: AssistantAutoReplyGroupContext
  onEvent?: (event: AssistantRunEvent) => void
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
  scanState: AssistantAutoReplyScanState
  summary: AssistantAutoReplyScanResult
  vault: string
}): Promise<void> {
  const queuedAt = new Date().toISOString()
  await writeAssistantChatDeferredArtifacts({
    captureIds: input.context.captureIds,
    queuedAt,
    result: input.result,
    vault: input.vault,
  })
  input.summary.replied += 1
  input.scanState.cursor = input.context.lastCursor
  input.onEvent?.({
    type: 'capture.replied',
    captureId: input.context.firstCaptureId,
    details: input.result.deliveryIntentId
      ? `delivery queued for retry as ${input.result.deliveryIntentId}`
      : 'delivery queued for retry',
  })
}

async function applyFailedGroup(input: {
  advanceCursor: boolean
  context: AssistantAutoReplyGroupContext
  detail: string
  error: unknown
  onEvent?: (event: AssistantRunEvent) => void
  scanState: AssistantAutoReplyScanState
  summary: AssistantAutoReplyScanResult
  vault: string
}): Promise<void> {
  input.summary.failed += 1
  if (input.advanceCursor) {
    input.scanState.cursor = input.context.lastCursor
  }
  await writeAssistantChatErrorArtifacts({
    captureIds: input.context.captureIds,
    error: input.error,
    vault: input.vault,
  }).catch(() => {})
  input.onEvent?.({
    type: 'capture.reply-failed',
    captureId: input.context.firstCaptureId,
    details: input.detail,
  })
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
