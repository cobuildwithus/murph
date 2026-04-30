import type { AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import {
  assistantInputIdFromInboxCaptureId,
  createInboxBackedAssistantInputSource,
  type AssistantInputCandidate,
  type AssistantInputCursor,
  type AssistantInputSource,
} from '../input-source.js'
import { collectAssistantAutoReplyGroup } from './grouping.js'
import {
  readAssistantAutoReplyTerminalEvidence,
  type AssistantAutoReplyTerminalEvidence,
} from './evidence.js'
import {
  applyAssistantAutoReplyProcessResult,
  createAssistantAutoReplyGroupContext,
  processAssistantAutoReplyGroup,
} from './reply.js'
import {
  compareAssistantCaptureOrder,
  createEmptyAutoReplyScanResult,
  createEmptyInboxScanResult,
  cursorFromCapture,
  normalizeScanLimit,
  type AssistantAutomationScanResult,
  type AssistantAutomationScanStateProgress,
  type AssistantRunEvent,
} from './shared.js'

type AssistantInboxCaptureSummary = Awaited<
  ReturnType<InboxServices['list']>
>['items'][number]
type AssistantPreserveDocumentAttachmentsResult = Awaited<
  ReturnType<NonNullable<InboxServices['preserveDocumentAttachments']>>
>

interface AssistantAutomationCandidate {
  inputCandidate: AssistantInputCandidate
  summary: AssistantInboxCaptureSummary
}

export async function scanAssistantAutomationOnce(input: {
  applyCanonicalWrites?: boolean
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  inboxServices: InboxServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  onStateProgress?: (
    state: AssistantAutomationScanStateProgress,
  ) => Promise<void> | void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  requestId?: string | null
  signal?: AbortSignal
  sessionMaxAgeMs?: number | null
  state: Pick<AssistantAutomationState, 'autoReply' | 'inboxScanCursor'>
  inputSource?: AssistantInputSource
  vault: string
  vaultServices?: VaultServices
}): Promise<AssistantAutomationScanResult> {
  const routing = createEmptyInboxScanResult()
  const replies = createEmptyAutoReplyScanResult()
  const applyCanonicalWrites = input.applyCanonicalWrites ?? true
  const scanState = cloneAutomationScanState(input.state)
  let persistedState = cloneAutomationScanState(scanState)
  void input.vaultServices
  const replyChannels = applyCanonicalWrites
    ? scanState.autoReply.map((entry) => entry.channel)
    : []
  const persistScanState = async () => {
    await persistAssistantAutomationScanState({
      onStateProgress: input.onStateProgress,
      persistedState,
      scanState,
      updatePersistedState: (next) => {
        persistedState = next
      },
    })
  }

  if (replyChannels.length === 0) {
    return {
      replies,
      routing,
    }
  }

  const inputSource =
    input.inputSource ??
    createInboxBackedAssistantInputSource({
      inboxServices: input.inboxServices,
      requestId: input.requestId ?? null,
      vault: input.vault,
    })
  const candidates = await listAssistantReplyCandidates({
    autoReply: applyCanonicalWrites ? scanState.autoReply : [],
    inputSource,
    limit: normalizeScanLimit(input.maxPerScan),
    requestId: input.requestId ?? null,
    vault: input.vault,
  })
  if (candidates.length === 0) {
    return {
      replies,
      routing,
    }
  }

  input.onEvent?.({
    type: 'scan.started',
    details: `${candidates.length} capture(s)`,
  })

  const candidateSummaries = candidates.map((candidate) => candidate.summary)
  const candidatesByCaptureId = new Map(
    candidates.map((candidate) => [candidate.summary.captureId, candidate] as const),
  )
  const preservedCaptureResults = new Map<
    string,
    AssistantPreserveDocumentAttachmentsResult
  >()

  const preserveCandidateDocumentsBestEffort = async (
    candidate: AssistantAutomationCandidate,
  ): Promise<void> => {
    if (!applyCanonicalWrites) {
      return
    }

    if (candidate.summary.attachmentCount === 0) {
      return
    }
    if (
      candidate.inputCandidate.projection.captureId === null ||
      candidate.inputCandidate.projection.captureId !== candidate.summary.captureId
    ) {
      return
    }

    const existing = preservedCaptureResults.get(candidate.summary.captureId)
    if (existing) {
      return
    }

    try {
      const preserved = await input.inboxServices.preserveDocumentAttachments?.({
        vault: input.vault,
        requestId: input.requestId ?? null,
        captureId: candidate.summary.captureId,
      })
      if (preserved) {
        preservedCaptureResults.set(candidate.summary.captureId, preserved)
      }
    } catch {
      input.onEvent?.({
        type: 'capture.reply-progress',
        captureId: candidate.summary.captureId,
        details: 'nonblocking document preservation failed',
        safeDetails: 'document_preservation_failed_nonblocking',
        providerKind: 'status',
        providerState: 'completed',
      })
    }
  }

  for (let index = 0; index < candidates.length; index += 1) {
    if (input.signal?.aborted) {
      break
    }

    const candidate = candidates[index]
    if (!candidate) {
      continue
    }

    const group = await collectAssistantAutoReplyGroup({
      captures: candidateSummaries,
      startIndex: index,
      vault: input.vault,
    })
    index = group.endIndex
    const groupItems = group.items.map((item) => ({
      ...item,
      inputCandidate:
        candidatesByCaptureId.get(item.summary.captureId)?.inputCandidate ??
        item.inputCandidate ??
        null,
    }))

    const context = createAssistantAutoReplyGroupContext(groupItems)
    if (!context) {
      continue
    }

    replies.considered += context.captureCount
    const replyResult = await processAssistantAutoReplyGroup({
      allowSelfAuthored: input.allowSelfAuthored ?? false,
      context,
      deliveryDispatchMode: input.deliveryDispatchMode,
      enabledChannels: replyChannels,
      executionContext: input.executionContext,
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
      inputSource,
      vault: input.vault,
    })
    const stopReplyScan = applyAssistantAutoReplyProcessResult({
      context,
      result: replyResult,
      summary: replies,
      updateCursor: () => undefined,
    })

    await persistScanState()

    for (const item of context.items) {
      const groupCandidate = candidatesByCaptureId.get(item.summary.captureId)
      if (!groupCandidate) {
        continue
      }

      await preserveCandidateDocumentsBestEffort(groupCandidate)
    }

    if (stopReplyScan) {
      break
    }
  }

  return {
    replies,
    routing,
  }
}

async function listAssistantReplyCandidates(input: {
  autoReply: AssistantAutomationScanStateProgress['autoReply']
  inputSource: AssistantInputSource
  limit: number
  requestId: string | null
  vault: string
}): Promise<AssistantAutomationCandidate[]> {
  if (input.autoReply.length === 0) {
    return []
  }

  const terminalEvidenceCache = new Map<
    string,
    Promise<AssistantAutoReplyTerminalEvidence | null>
  >()
  const readTerminalEvidence = (candidate: AssistantInputCandidate) => {
    const evidenceId = candidate.event.inputId
    let cached = terminalEvidenceCache.get(evidenceId)
    if (!cached) {
      cached = readAssistantAutoReplyTerminalEvidence(input.vault, evidenceId)
        .then((evidence) =>
          evidence ??
          (candidate.projection.captureId
            ? readAssistantAutoReplyTerminalEvidence(
                input.vault,
                candidate.projection.captureId,
              )
            : null),
        )
      terminalEvidenceCache.set(evidenceId, cached)
    }
    return cached
  }
  const terminalEvidenceGroupComplete = async (
    evidence: AssistantAutoReplyTerminalEvidence,
  ) => {
    const groupInputIds = [
      ...new Set(
        evidence.groupInputIds && evidence.groupInputIds.length > 0
          ? evidence.groupInputIds
          : evidence.groupCaptureIds.map(assistantInputIdFromInboxCaptureId),
      ),
    ]
    if (groupInputIds.length === 0) {
      return true
    }

    const groupEvidence = await Promise.all(
      groupInputIds.map((inputId) =>
        readAssistantAutoReplyTerminalEvidence(input.vault, inputId),
      ),
    )
    return groupEvidence.every((item) => item !== null)
  }

  const candidates = await Promise.all(
    input.autoReply.map(async (channelState) => {
      const channelCandidates: AssistantAutomationCandidate[] = []
      let cursor = assistantInputCursorFromAutomationCursor(
        channelState.eligibleAfter,
      )

      while (channelCandidates.length < input.limit) {
        const listed = await input.inputSource.listInputCandidates({
          afterCursor: cursor,
          limit: input.limit,
          sourceId: channelState.channel,
        })
        const listedItems = listed.inputs
        if (listedItems.length === 0) {
          break
        }

        for (const candidate of listedItems) {
          if (candidate.event.source !== channelState.channel) {
            continue
          }
          const evidence = await readTerminalEvidence(candidate)
          if (evidence && await terminalEvidenceGroupComplete(evidence)) {
            continue
          }
          channelCandidates.push(assistantAutomationCandidateFromInput(candidate))
        }

        cursor = listed.nextCursor ?? cursor
        if (listedItems.length < input.limit || !listed.nextCursor) {
          break
        }
      }

      return channelCandidates.slice(0, input.limit)
    }),
  )

  return candidates
    .flat()
    .sort((left, right) => compareAssistantCaptureOrder(left.summary, right.summary))
    .slice(0, input.limit)
}

function assistantAutomationCandidateFromInput(
  input: AssistantInputCandidate,
): AssistantAutomationCandidate {
  return {
    inputCandidate: input,
    summary: assistantInboxSummaryFromInputCandidate(input),
  }
}

function assistantInboxSummaryFromInputCandidate(
  input: AssistantInputCandidate,
): AssistantInboxCaptureSummary {
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
    externalId: input.event.replyTarget?.messageId
      ? `${input.event.source}:${input.event.replyTarget.messageId}`
      : input.event.inputId,
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

function assistantInputCursorFromAutomationCursor(
  cursor: ReturnType<typeof cursorFromCapture> | null,
): AssistantInputCursor | null {
  if (!cursor) {
    return null
  }
  return {
    createdAt: cursor.createdAt ?? null,
    inputId: assistantInputIdFromInboxCaptureId(cursor.captureId),
    occurredAt: cursor.occurredAt,
    sourceKind: 'inbox-capture',
  }
}

async function persistAssistantAutomationScanState(input: {
  onStateProgress?: (
    state: AssistantAutomationScanStateProgress,
  ) => Promise<void> | void
  persistedState: AssistantAutomationScanStateProgress
  scanState: AssistantAutomationScanStateProgress
  updatePersistedState: (state: AssistantAutomationScanStateProgress) => void
}): Promise<void> {
  if (assistantAutomationScanStateEqual(input.persistedState, input.scanState)) {
    return
  }

  const next = cloneAutomationScanState(input.scanState)
  await input.onStateProgress?.(next)
  input.updatePersistedState(next)
}

function cloneAutomationScanState(
  state: Pick<AssistantAutomationScanStateProgress, 'autoReply' | 'inboxScanCursor'>,
): AssistantAutomationScanStateProgress {
  return {
    autoReply: state.autoReply.map((entry) => ({
      channel: entry.channel,
      eligibleAfter: entry.eligibleAfter,
      enabledAt: entry.enabledAt,
    })),
    inboxScanCursor: state.inboxScanCursor,
  }
}

function assistantAutomationScanStateEqual(
  left: AssistantAutomationScanStateProgress,
  right: AssistantAutomationScanStateProgress,
): boolean {
  return (
    sameAutoReplyState(left.autoReply, right.autoReply) &&
    sameCursor(left.inboxScanCursor, right.inboxScanCursor)
  )
}

function sameAutoReplyState(
  left: AssistantAutomationScanStateProgress['autoReply'],
  right: AssistantAutomationScanStateProgress['autoReply'],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index]
      return (
        other?.channel === entry.channel &&
        other.enabledAt === entry.enabledAt &&
        sameCursor(other.eligibleAfter, entry.eligibleAfter)
      )
    })
  )
}

function sameCursor(
  left: ReturnType<typeof cursorFromCapture> | null,
  right: ReturnType<typeof cursorFromCapture> | null,
): boolean {
  return (
    left?.captureId === right?.captureId &&
    left?.occurredAt === right?.occurredAt
  )
}
