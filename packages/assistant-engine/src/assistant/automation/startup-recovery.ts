import type {
  AssistantAutomationCursor,
  AssistantAutomationState,
  AssistantTurnReceipt,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import { listAssistantTurnReceipts } from '../receipts.js'
import { assistantChatReplyArtifactExists } from './artifacts.js'
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

export interface RecoverAssistantAutoRepliesInput {
  allowSelfAuthored: boolean
  autoReply?: AssistantAutomationState['autoReply']
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  enabledChannels?: readonly string[]
  executionContext?: AssistantExecutionContext | null
  inboxServices: InboxServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  requestId?: string | null
  scanCursor?: AssistantAutomationCursor | null
  signal?: AbortSignal
  sessionMaxAgeMs?: number | null
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
      cursor: input.scanCursor ?? null,
    }))
  const enabledChannels = normalizeEnabledChannels(
    autoReply.map((entry) => entry.channel),
  )
  const autoReplyByChannel = new Map(
    autoReply.map((entry) => [entry.channel, entry] as const),
  )
  if (
    enabledChannels.length === 0 ||
    autoReply.every((entry) => entry.cursor === null) ||
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
    if (!channelState?.cursor || !enabledChannels.includes(recoverySource)) {
      continue
    }
    if (
      compareAssistantCaptureOrder(
        context.firstItem.summary,
        channelState.cursor,
      ) > 0
    ) {
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
      requestId: input.requestId ?? null,
      signal: input.signal,
      sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
      vault: input.vault,
    })
    summary.failed += result.failed
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
    const retryAt = readAssistantAutoReplyRetryAt(receipt)
    if (retryAt && Date.parse(retryAt) > nowMs) {
      nextWakeAt = earliestAssistantAutomationWakeAt(nextWakeAt, retryAt)
      continue
    }
    if (hasUnsafeDeliveryEvidence(receipt)) {
      continue
    }
    if (await hasHandledReplyArtifacts(input.vault, metadata.captureIds)) {
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

async function loadAutoReplyRecoveryContext(input: {
  candidate: AutoReplyRecoveryCandidate
  inboxServices: InboxServices
  requestId: string | null
  vault: string
}) {
  const shownCaptures = (
    await Promise.all(
      input.candidate.captureIds.map(async (captureId) => {
        try {
          return (
            await input.inboxServices.show({
              captureId,
              requestId: input.requestId,
              vault: input.vault,
            })
          ).capture
        } catch (error) {
          if (isInboxCaptureNotFoundError(error)) {
            return null
          }
          throw error
        }
      }),
    )
  )
    .filter((capture): capture is NonNullable<typeof capture> => capture !== null)
    .sort(compareAssistantCaptureOrder)

  if (shownCaptures.length === 0) {
    return null
  }

  const primaryCapture = shownCaptures.find(
    (capture) => capture.captureId === input.candidate.primaryCaptureId,
  )
  if (!primaryCapture || shownCaptures[0]?.captureId !== primaryCapture.captureId) {
    return null
  }
  if (
    shownCaptures.some(
      (capture) =>
        !shouldGroupAdjacentConversationCapture(primaryCapture, capture),
    )
  ) {
    return null
  }

  const groupItems: AssistantAutoReplyGroupItem[] = await Promise.all(
    shownCaptures.map(async (capture) => ({
      summary: capture,
      telegramMetadata: await loadTelegramAutoReplyMetadata(
        input.vault,
        capture.source === 'telegram' ? capture.envelopePath : null,
      ),
    })),
  )

  return createAssistantAutoReplyGroupContext(groupItems)
}

function readAutoReplyReceiptMetadata(
  receipt: AssistantTurnReceipt,
): { captureIds: readonly string[]; primaryCaptureId: string } | null {
  const startedEvent = receipt.timeline.find((event) => event.kind === 'turn.started')
  if (!startedEvent) {
    return null
  }

  const groupedCaptureIds = startedEvent.metadata[AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0) ?? []
  const primaryCaptureId =
    startedEvent.metadata[AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY]?.trim() ||
    groupedCaptureIds[0] ||
    null
  if (!primaryCaptureId) {
    return null
  }

  return {
    captureIds:
      groupedCaptureIds.length > 0 ? groupedCaptureIds : [primaryCaptureId],
    primaryCaptureId,
  }
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

async function hasHandledReplyArtifacts(
  vault: string,
  captureIds: readonly string[],
): Promise<boolean> {
  const existingArtifacts = await Promise.all(
    captureIds.map((captureId) =>
      assistantChatReplyArtifactExists(vault, captureId),
    ),
  )
  return existingArtifacts.some(Boolean)
}

function isInboxCaptureNotFoundError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'INBOX_CAPTURE_NOT_FOUND'
  )
}
