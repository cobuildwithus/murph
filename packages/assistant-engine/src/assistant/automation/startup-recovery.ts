import type {
  AssistantAutomationState,
  AssistantTurnReceipt,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import {
  assistantInputCandidateFromStoredEvent,
  type AssistantInputCandidate,
  type AssistantInputSource,
} from '../input-source.js'
import {
  createAssistantInputEventId,
  readAssistantInputEvent,
} from '../input-store.js'
import { listAssistantTurnReceipts } from '../receipts.js'
import { readAssistantAutoReplyTerminalEvidence } from './evidence.js'
import { readAssistantAutoReplyRetryAt } from './auto-reply-retry.js'
import {
  type AssistantAutoReplyGroupItem,
  shouldGroupAdjacentConversationCapture,
} from './grouping.js'
import { loadTelegramAutoReplyMetadata } from './prompt-builder.js'
import {
  createAssistantAutoReplyGroupContext,
  processAssistantAutoReplyGroup,
} from './reply.js'
import {
  compareAssistantCaptureOrder,
  createEmptyAutoReplyScanResult,
  normalizeEnabledChannels,
  normalizeScanLimit,
  type AssistantAutoReplyScanResult,
  type AssistantRunEvent,
  earliestAssistantAutomationWakeAt,
} from './shared.js'

const AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY = 'autoReplyCaptureId'
const AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY = 'autoReplyCaptureIds'
const FAILED_RECEIPT_RECOVERY_RECEIPT_LIMIT = 200
const TERMINAL_PROVIDER_VALIDATION_FAILURE_PATTERNS = [
  /\binput\.\d+\.output:\s*Invalid input\b/iu,
  /\bInvalid\s+'previous_response_id'/iu,
] as const

export interface RecoverAssistantAutoRepliesInput {
  allowSelfAuthored: boolean
  autoReply?: AssistantAutomationState['autoReply']
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  enabledChannels?: readonly string[]
  executionContext?: AssistantExecutionContext | null
  inboxServices: InboxServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  requestId?: string | null
  signal?: AbortSignal
  sessionMaxAgeMs?: number | null
  inputSource?: AssistantInputSource
  vault: string
}

interface AutoReplyRecoveryCandidate {
  captureIds: readonly string[]
  primaryCaptureId: string
}

export interface AssistantAutoReplyRecoveryResult
  extends AssistantAutoReplyScanResult {
  progressed: boolean
}

export async function recoverAssistantAutoReplies(
  input: RecoverAssistantAutoRepliesInput,
): Promise<AssistantAutoReplyRecoveryResult> {
  const autoReply =
    input.autoReply ??
    normalizeEnabledChannels(input.enabledChannels ?? []).map((channel) => ({
      channel,
      eligibleAfter: null,
      enabledAt: new Date().toISOString(),
    }))
  const enabledChannels = normalizeEnabledChannels(
    autoReply.map((entry) => entry.channel),
  )
  const autoReplyByChannel = new Map<
    string,
    AssistantAutomationState['autoReply'][number]
  >(autoReply.map((entry) => [entry.channel, entry] as const))
  if (
    enabledChannels.length === 0 ||
    input.signal?.aborted
  ) {
    return {
      ...createEmptyAutoReplyScanResult(),
      progressed: false,
    }
  }

  const groupLimit = normalizeScanLimit(input.maxPerScan)
  const candidateListing = await listReceiptRecoveryCandidates({
    limit: groupLimit,
    vault: input.vault,
  })
  if (candidateListing.candidates.length === 0 || input.signal?.aborted) {
    return {
      ...createEmptyAutoReplyScanResult(),
      nextWakeAt: candidateListing.nextWakeAt,
      progressed: false,
    }
  }

  const summary = createEmptyAutoReplyScanResult()
  summary.nextWakeAt = candidateListing.nextWakeAt
  let resolvedGroups = 0
  input.onEvent?.({
    type: 'reply.scan.started',
    details: `retrying up to ${candidateListing.candidates.length} failed auto-reply capture(s) from persisted receipts`,
  })

  for (const candidate of candidateListing.candidates) {
    if (input.signal?.aborted) {
      break
    }

    const context = await loadAutoReplyRecoveryContext({
      candidate,
      inboxServices: input.inboxServices,
      requestId: input.requestId ?? null,
      vault: input.vault,
    })
    if (!context) {
      continue
    }

    const recoverySource = context.firstItem.summary.source
    const channelState = autoReplyByChannel.get(recoverySource)
    if (!channelState || !enabledChannels.includes(recoverySource)) {
      continue
    }
    summary.considered += context.captureCount
    const result = await processAssistantAutoReplyGroup({
      allowSelfAuthored: input.allowSelfAuthored,
      context,
      deliveryDispatchMode: input.deliveryDispatchMode,
      enabledChannels,
      executionContext: input.executionContext,
      inboxServices: input.inboxServices,
      onEvent: input.onEvent,
      onTraceEvent: input.onTraceEvent,
      requestId: input.requestId ?? null,
      signal: input.signal,
      sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
      inputSource: input.inputSource,
      vault: input.vault,
    })
    summary.failed += result.failed
    if (result.checkpointRequired) {
      summary.checkpointRequired = true
    }
    summary.nextWakeAt = earliestAssistantAutomationWakeAt(
      summary.nextWakeAt,
      result.nextWakeAt,
    )
    summary.replied += result.replied
    summary.skipped += result.skipped
    if (result.replied > 0 || result.skipped > 0) {
      resolvedGroups += 1
    }

    if (result.stopScanning) {
      break
    }
  }

  if (resolvedGroups > 0 && candidateListing.hasMoreDueCandidates) {
    summary.nextWakeAt = earliestAssistantAutomationWakeAt(
      new Date().toISOString(),
      summary.nextWakeAt,
    )
  }

  return {
    ...summary,
    progressed: resolvedGroups > 0,
  }
}

async function listReceiptRecoveryCandidates(input: {
  limit: number
  vault: string
}): Promise<{
  candidates: AutoReplyRecoveryCandidate[]
  hasMoreDueCandidates: boolean
  nextWakeAt: string | null
}> {
  if (input.limit <= 0) {
    return {
      candidates: [],
      hasMoreDueCandidates: false,
      nextWakeAt: null,
    }
  }

  const receipts = await listAssistantTurnReceipts(
    input.vault,
    FAILED_RECEIPT_RECOVERY_RECEIPT_LIMIT,
  )
  const seenCaptureIds = new Set<string>()
  const recoverable: AutoReplyRecoveryCandidate[] = []
  let hasMoreDueCandidates = false
  let nextWakeAt: string | null = null
  const nowMs = Date.now()

  for (const receipt of receipts) {
    const metadata = readAutoReplyReceiptMetadata(receipt)
    if (!metadata) {
      continue
    }
    if (seenCaptureIds.has(metadata.primaryCaptureId)) {
      continue
    }
    seenCaptureIds.add(metadata.primaryCaptureId)
    if (receipt.status !== 'failed') {
      continue
    }
    if (hasTerminalProviderValidationFailure(receipt)) {
      continue
    }
    const retryAt = readAssistantAutoReplyRetryAt(receipt)
    if (retryAt && Date.parse(retryAt) > nowMs) {
      nextWakeAt = earliestAssistantAutomationWakeAt(nextWakeAt, retryAt)
      continue
    }
    if (hasUnsafeDeliveryEvidence(receipt)) {
      continue
    }
    if (await hasTerminalHandlingEvidence(input.vault, metadata.captureIds)) {
      continue
    }

    if (recoverable.length === input.limit) {
      hasMoreDueCandidates = true
      break
    }

    recoverable.push({
      captureIds: metadata.captureIds,
      primaryCaptureId: metadata.primaryCaptureId,
    })
  }

  return {
    candidates: recoverable,
    hasMoreDueCandidates,
    nextWakeAt,
  }
}

function hasTerminalProviderValidationFailure(
  receipt: AssistantTurnReceipt,
): boolean {
  const messages = [
    receipt.lastError?.message ?? null,
    ...receipt.timeline.map((event) => event.detail),
  ]

  return messages.some(
    (message) =>
      typeof message === 'string' &&
      TERMINAL_PROVIDER_VALIDATION_FAILURE_PATTERNS.some((pattern) =>
        pattern.test(message),
      ),
  )
}

async function loadAutoReplyRecoveryContext(input: {
  candidate: AutoReplyRecoveryCandidate
  inboxServices: InboxServices
  requestId: string | null
  vault: string
}) {
  const groupItems = (
    await Promise.all(
      input.candidate.captureIds.map((captureId) =>
        loadAutoReplyRecoveryGroupItem({
          captureId,
          inboxServices: input.inboxServices,
          requestId: input.requestId,
          vault: input.vault,
        }),
      ),
    )
  )
    .filter((item): item is AssistantAutoReplyGroupItem => item !== null)
    .sort((left, right) =>
      compareAssistantCaptureOrder(left.summary, right.summary),
    )

  if (groupItems.length === 0) {
    return null
  }

  const primaryItem = groupItems.find(
    (item) => item.summary.captureId === input.candidate.primaryCaptureId,
  )
  if (!primaryItem || groupItems[0]?.summary.captureId !== primaryItem.summary.captureId) {
    return null
  }
  if (
    groupItems.some(
      (item) =>
        !shouldGroupAdjacentConversationCapture(primaryItem.summary, item.summary),
    )
  ) {
    return null
  }

  return createAssistantAutoReplyGroupContext(groupItems)
}

async function loadAutoReplyRecoveryGroupItem(input: {
  captureId: string
  inboxServices: InboxServices
  requestId: string | null
  vault: string
}): Promise<AssistantAutoReplyGroupItem | null> {
  try {
    const shown = await input.inboxServices.show({
      captureId: input.captureId,
      requestId: input.requestId,
      vault: input.vault,
    })
    const inputId = createAssistantInputEventId({
      sourceRef: {
        captureId: shown.capture.captureId,
        kind: 'inbox-capture',
        source: shown.capture.source,
        version: null,
      },
    })
    const storedInput = await readAssistantInputEvent({
      inputId,
      vault: input.vault,
    })
    if (!storedInput) {
      return null
    }
    const candidate = assistantInputCandidateFromStoredEvent(storedInput)
    return {
      inputCandidate: candidate,
      summary: shown.capture,
      telegramMetadata: await loadTelegramAutoReplyMetadata(
        input.vault,
        shown.capture.source === 'telegram' ? shown.capture.envelopePath : null,
      ),
    }
  } catch (error) {
    if (!isInboxCaptureNotFoundError(error)) {
      throw error
    }
  }

  if (!isAssistantInputEventId(input.captureId)) {
    return null
  }
  const storedInput = await readAssistantInputEvent({
    inputId: input.captureId,
    vault: input.vault,
  })
  if (!storedInput) {
    return null
  }

  const candidate = assistantInputCandidateFromStoredEvent(storedInput)
  return {
    inputCandidate: candidate,
    summary: assistantRecoverySummaryFromInputCandidate(candidate),
    telegramMetadata: null,
  }
}

function isAssistantInputEventId(value: string): boolean {
  return /^ain_[0-9a-f]{32}$/u.test(value)
}

function assistantRecoverySummaryFromInputCandidate(
  input: AssistantInputCandidate,
): AssistantAutoReplyGroupItem['summary'] {
  const conversation = input.event.conversation
  const captureId = input.projection.captureId ?? input.event.inputId
  return {
    accountId: conversation?.accountId ?? null,
    actorId: conversation?.actorId ?? null,
    actorIsSelf: conversation?.actorIsSelf ?? false,
    actorName: null,
    attachmentCount: input.event.attachmentCount,
    captureId,
    createdAt: input.event.receivedAt ?? input.event.occurredAt,
    envelopePath: `assistant-input-events/${input.event.inputId}.json`,
    eventId: input.event.inputId,
    externalId: input.event.inputId,
    occurredAt: input.event.occurredAt,
    promotions: [],
    receivedAt: input.event.receivedAt,
    source: input.event.source,
    text: input.event.transcriptText ?? input.event.text,
    threadId: conversation?.threadId ?? input.event.inputId,
    threadIsDirect: conversation?.threadIsDirect ?? false,
    threadTitle: null,
  }
}

function readAutoReplyReceiptMetadata(
  receipt: AssistantTurnReceipt,
): { captureIds: readonly string[]; primaryCaptureId: string } | null {
  const captureIds: string[] = []
  let primaryCaptureId: string | null = null

  for (const event of receipt.timeline) {
    if (
      event.kind !== 'turn.started' &&
      event.kind !== 'turn.input.accepted'
    ) {
      continue
    }

    const groupedCaptureIds = event.metadata[AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0) ?? []
    const eventPrimaryCaptureId =
      event.metadata[AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY]?.trim() ||
      groupedCaptureIds[0] ||
      null
    if (eventPrimaryCaptureId && !captureIds.includes(eventPrimaryCaptureId)) {
      captureIds.push(eventPrimaryCaptureId)
    }
    for (const captureId of groupedCaptureIds) {
      if (!captureIds.includes(captureId)) {
        captureIds.push(captureId)
      }
    }
    if (primaryCaptureId === null && eventPrimaryCaptureId !== null) {
      primaryCaptureId = eventPrimaryCaptureId
    }
  }

  const resolvedPrimaryCaptureId = primaryCaptureId ?? captureIds[0] ?? null
  return resolvedPrimaryCaptureId
    ? {
        captureIds:
          captureIds.length > 0 ? captureIds : [resolvedPrimaryCaptureId],
        primaryCaptureId: resolvedPrimaryCaptureId,
      }
    : null
}

function hasUnsafeDeliveryEvidence(receipt: AssistantTurnReceipt): boolean {
  if (receipt.responsePreview !== null) {
    return true
  }

  return receipt.timeline.some((event) =>
    event.kind === 'delivery.attempt.started' ||
    event.kind === 'delivery.failed' ||
    event.kind === 'delivery.queued' ||
    event.kind === 'delivery.retry-scheduled' ||
    event.kind === 'delivery.sent',
  )
}

async function hasTerminalHandlingEvidence(
  vault: string,
  captureIds: readonly string[],
): Promise<boolean> {
  const existingEvidence = await Promise.all(
    captureIds.map((captureId) =>
      readAssistantAutoReplyTerminalEvidence(vault, captureId),
    ),
  )
  return existingEvidence.every((evidence) => evidence !== null)
}

function isInboxCaptureNotFoundError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'INBOX_CAPTURE_NOT_FOUND'
  )
}
