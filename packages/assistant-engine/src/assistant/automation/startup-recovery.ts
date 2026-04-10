import type {
  AssistantAutomationCursor,
  AssistantTurnReceipt,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import { listAssistantTurnReceipts } from '../receipts.js'
import { assistantChatReplyArtifactExists } from './artifacts.js'
import { readAssistantAutoReplyRetryAt } from './auto-reply-retry.js'
import { collectAssistantAutoReplyGroup } from './grouping.js'
import {
  createAssistantAutoReplyGroupContext,
  processAssistantAutoReplyGroup,
} from './reply.js'
import {
  compareAssistantCaptureOrder,
  createEmptyAutoReplyScanResult,
  earliestAssistantAutomationWakeAt,
  normalizeEnabledChannels,
  normalizeScanLimit,
  type AssistantAutoReplyScanResult,
  type AssistantRunEvent,
} from './shared.js'

const AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY = 'autoReplyCaptureId'
const AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY = 'autoReplyCaptureIds'
const STARTUP_RECOVERY_RECEIPT_LIMIT = 200
const STARTUP_RECOVERY_CAPTURE_LIST_LIMIT = 200

export interface RecoverAssistantAutoRepliesOnStartupInput {
  allowSelfAuthored: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  enabledChannels: readonly string[]
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

export async function recoverAssistantAutoRepliesOnStartup(
  input: RecoverAssistantAutoRepliesOnStartupInput,
): Promise<AssistantAutoReplyScanResult> {
  const enabledChannels = normalizeEnabledChannels(input.enabledChannels)
  if (enabledChannels.length === 0 || input.scanCursor == null || input.signal?.aborted) {
    return createEmptyAutoReplyScanResult()
  }

  const groupLimit = Math.min(normalizeScanLimit(input.maxPerScan), 10)
  const candidateListing = await listStartupRecoveryCandidates({
    limit: groupLimit,
    vault: input.vault,
  })
  if (candidateListing.candidates.length === 0 || input.signal?.aborted) {
    return {
      ...createEmptyAutoReplyScanResult(),
      nextWakeAt: candidateListing.nextWakeAt,
    }
  }

  const candidateIds = new Set(
    candidateListing.candidates.map((candidate) => candidate.primaryCaptureId),
  )
  const listed = await input.inboxServices.list({
    vault: input.vault,
    requestId: input.requestId ?? null,
    limit: Math.max(groupLimit * 10, STARTUP_RECOVERY_CAPTURE_LIST_LIMIT),
    sourceId: null,
    afterOccurredAt: null,
    afterCaptureId: null,
    oldestFirst: false,
  })
  const captures = [...listed.items].sort(compareAssistantCaptureOrder)
  if (captures.length === 0) {
    return createEmptyAutoReplyScanResult()
  }

  const summary = createEmptyAutoReplyScanResult()
  summary.nextWakeAt = candidateListing.nextWakeAt
  let recoveredGroups = 0
  input.onEvent?.({
    type: 'reply.scan.started',
    details: `retrying up to ${candidateListing.candidates.length} recent failed auto-reply capture(s) from a previous automation run`,
  })

  for (let index = 0; index < captures.length; index += 1) {
    if (input.signal?.aborted || recoveredGroups >= groupLimit) {
      break
    }

    const capture = captures[index]
    if (!capture || !candidateIds.has(capture.captureId)) {
      continue
    }
    if (compareAssistantCaptureOrder(capture, input.scanCursor) > 0) {
      continue
    }
    if (!enabledChannels.includes(capture.source)) {
      continue
    }

    const group = await collectAssistantAutoReplyGroup({
      captures,
      startIndex: index,
      vault: input.vault,
    })
    index = group.endIndex

    const context = createAssistantAutoReplyGroupContext(group.items)
    if (!context || !candidateIds.has(context.firstCaptureId)) {
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
    recoveredGroups += 1

    if (result.stopScanning) {
      break
    }
  }

  return summary
}

async function listStartupRecoveryCandidates(input: {
  limit: number
  vault: string
}): Promise<{
  candidates: AutoReplyRecoveryCandidate[]
  nextWakeAt: string | null
}> {
  if (input.limit <= 0) {
    return {
      candidates: [],
      nextWakeAt: null,
    }
  }

  const receipts = await listAssistantTurnReceipts(
    input.vault,
    STARTUP_RECOVERY_RECEIPT_LIMIT,
  )
  const seenCaptureIds = new Set<string>()
  const recoverable: AutoReplyRecoveryCandidate[] = []
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

    recoverable.push({
      captureIds: metadata.captureIds,
      primaryCaptureId: metadata.primaryCaptureId,
    })
    if (recoverable.length >= input.limit) {
      break
    }
  }

  return {
    candidates: recoverable,
    nextWakeAt,
  }
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
