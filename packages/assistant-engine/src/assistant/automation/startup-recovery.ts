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
  compareAssistantInputCursors,
  createAssistantInputEventId,
  readAssistantInputEvent,
} from '../input-store.js'
import { listAssistantTurnReceipts } from '../receipts.js'
import { readAssistantAutoReplyTerminalEvidenceByEvidenceId } from './evidence.js'
import { readAssistantAutoReplyRetryAt } from './auto-reply-retry.js'
import {
  type AssistantAutoReplyGroupItem,
  shouldGroupAdjacentConversationInput,
} from './grouping.js'
import { readTelegramAutoReplyMetadataFromAssistantInput } from './prompt-builder.js'
import {
  assistantAutomationInputSummaryFromCandidate,
} from './input-summary.js'
import {
  createAssistantAutoReplyGroupContext,
  processAssistantAutoReplyGroup,
} from './reply.js'
import {
  createEmptyAutoReplyScanResult,
  normalizeEnabledChannels,
  normalizeScanLimit,
  type AssistantAutoReplyScanResult,
  type AssistantRunEvent,
  earliestAssistantAutomationWakeAt,
} from './shared.js'

const AUTO_REPLY_RECEIPT_INPUT_ID_KEY = 'autoReplyInputId'
const AUTO_REPLY_RECEIPT_INPUT_IDS_KEY = 'autoReplyInputIds'
const LEGACY_AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY = 'autoReplyCaptureId'
const LEGACY_AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY = 'autoReplyCaptureIds'
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
  inputIds: readonly string[]
  primaryInputId: string
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
    details: `retrying up to ${candidateListing.candidates.length} failed auto-reply input(s) from persisted receipts`,
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
    summary.considered += context.inputCount
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
  const seenInputIds = new Set<string>()
  const recoverable: AutoReplyRecoveryCandidate[] = []
  let hasMoreDueCandidates = false
  let nextWakeAt: string | null = null
  const nowMs = Date.now()

  for (const receipt of receipts) {
    const metadata = readAutoReplyReceiptMetadata(receipt)
    if (!metadata) {
      continue
    }
    if (seenInputIds.has(metadata.primaryInputId)) {
      continue
    }
    seenInputIds.add(metadata.primaryInputId)
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
    if (await hasTerminalHandlingEvidence(input.vault, metadata.inputIds)) {
      continue
    }

    if (recoverable.length === input.limit) {
      hasMoreDueCandidates = true
      break
    }

    recoverable.push({
      inputIds: metadata.inputIds,
      primaryInputId: metadata.primaryInputId,
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
      input.candidate.inputIds.map((inputId) =>
        loadAutoReplyRecoveryGroupItem({
          inputId,
          inboxServices: input.inboxServices,
          requestId: input.requestId,
          vault: input.vault,
        }),
      ),
    )
  )
    .filter((item): item is AssistantAutoReplyGroupItem => item !== null)
    .sort((left, right) =>
      compareAssistantInputCursors(
        left.inputCandidate!.event.cursor,
        right.inputCandidate!.event.cursor,
      ),
    )

  if (groupItems.length === 0) {
    return null
  }

  const primaryItem = groupItems.find(
    (item) => recoveryItemMatchesInputId(item, input.candidate.primaryInputId),
  )
  if (
    !primaryItem ||
    !recoveryItemMatchesInputId(groupItems[0], input.candidate.primaryInputId)
  ) {
    return null
  }
  if (
    groupItems.some(
      (item) =>
        !shouldGroupAdjacentConversationInput(primaryItem.summary, item.summary),
    )
  ) {
    return null
  }

  return createAssistantAutoReplyGroupContext(groupItems)
}

function recoveryItemMatchesInputId(
  item: AssistantAutoReplyGroupItem | undefined,
  inputId: string,
): boolean {
  return item?.summary.inputId === inputId ||
    item?.summary.projectionCaptureId === inputId
}

async function loadAutoReplyRecoveryGroupItem(input: {
  inputId: string
  inboxServices: InboxServices
  requestId: string | null
  vault: string
}): Promise<AssistantAutoReplyGroupItem | null> {
  let inputId = input.inputId
  let legacyCapture: Awaited<ReturnType<InboxServices['show']>>['capture'] | null = null
  if (!isAssistantInputEventId(inputId)) {
    try {
      const shown = await input.inboxServices.show({
        captureId: input.inputId,
        requestId: input.requestId,
        vault: input.vault,
      })
      legacyCapture = shown.capture
      inputId = createAssistantInputEventId({
        sourceRef: {
          captureId: shown.capture.captureId,
          kind: 'inbox-capture',
          source: shown.capture.source,
          version: null,
        },
      })
    } catch (error) {
      if (!isInboxCaptureNotFoundError(error)) {
        throw error
      }
      return null
    }
  }

  const storedInput = await readAssistantInputEvent({
    inputId,
    vault: input.vault,
  })
  if (!storedInput && !legacyCapture) {
    return null
  }

  const candidate = legacyCapture
    ? assistantInputCandidateFromLegacyCapture(legacyCapture, inputId)
    : assistantInputCandidateFromStoredEvent(storedInput!)
  return {
    inputCandidate: candidate,
    summary: assistantAutomationInputSummaryFromCandidate(candidate),
    telegramMetadata: readTelegramAutoReplyMetadataFromAssistantInput({
      replyTarget: candidate.event.replyTarget,
      sourceMetadata: candidate.event.sourceMetadata,
    }),
  }
}

function assistantInputCandidateFromLegacyCapture(
  capture: Awaited<ReturnType<InboxServices['show']>>['capture'],
  inputId: string,
): AssistantInputCandidate {
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
        createdAt: capture.createdAt,
        inputId,
        occurredAt: capture.occurredAt,
        sourceKind: 'inbox-capture',
        sourcePosition: `inbox-capture:${capture.source}:${capture.captureId}`,
      },
      inputId,
      occurredAt: capture.occurredAt,
      receivedAt: capture.receivedAt,
      replyTarget: null,
      source: capture.source,
      sourceMetadata: null,
      sourceRef: {
        captureId: capture.captureId,
        kind: 'inbox-capture',
        source: capture.source,
        version: null,
      },
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

function isAssistantInputEventId(value: string): boolean {
  return /^ain_[0-9a-f]{32}$/u.test(value)
}

function readAutoReplyReceiptMetadata(
  receipt: AssistantTurnReceipt,
): { inputIds: readonly string[]; primaryInputId: string } | null {
  const inputIds: string[] = []
  let primaryInputId: string | null = null

  for (const event of receipt.timeline) {
    if (
      event.kind !== 'turn.started' &&
      event.kind !== 'turn.input.accepted'
    ) {
      continue
    }

    const groupedInputIds = event.metadata[AUTO_REPLY_RECEIPT_INPUT_IDS_KEY]
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0) ?? []
    const legacyGroupedCaptureIds =
      event.metadata[LEGACY_AUTO_REPLY_RECEIPT_CAPTURE_IDS_KEY]
        ?.split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0) ?? []
    const eventPrimaryInputId =
      event.metadata[AUTO_REPLY_RECEIPT_INPUT_ID_KEY]?.trim() ||
      groupedInputIds[0] ||
      event.metadata[LEGACY_AUTO_REPLY_RECEIPT_CAPTURE_ID_KEY]?.trim() ||
      legacyGroupedCaptureIds[0] ||
      null
    if (eventPrimaryInputId && !inputIds.includes(eventPrimaryInputId)) {
      inputIds.push(eventPrimaryInputId)
    }
    for (const inputId of [...groupedInputIds, ...legacyGroupedCaptureIds]) {
      if (!inputIds.includes(inputId)) {
        inputIds.push(inputId)
      }
    }
    if (primaryInputId === null && eventPrimaryInputId !== null) {
      primaryInputId = eventPrimaryInputId
    }
  }

  const resolvedPrimaryInputId = primaryInputId ?? inputIds[0] ?? null
  return resolvedPrimaryInputId
    ? {
        inputIds:
          inputIds.length > 0 ? inputIds : [resolvedPrimaryInputId],
        primaryInputId: resolvedPrimaryInputId,
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
  inputIds: readonly string[],
): Promise<boolean> {
  const existingEvidence = await Promise.all(
    inputIds.map((inputId) =>
      readAssistantAutoReplyTerminalEvidenceByEvidenceId(vault, inputId),
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
