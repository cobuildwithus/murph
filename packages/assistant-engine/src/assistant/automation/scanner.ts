import type { AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import type { AssistantTurnInputPort } from '../turn-input.js'
import { errorMessage } from '../shared.js'
import { collectAssistantAutoReplyGroup } from './grouping.js'
import {
  applyAssistantAutoReplyProcessResult,
  createAssistantAutoReplyGroupContext,
  processAssistantAutoReplyGroup,
} from './reply.js'
import {
  compareAssistantCaptureOrder,
  computeAssistantAutomationRetryAt,
  createEmptyAutoReplyScanResult,
  createEmptyInboxScanResult,
  cursorFromCapture,
  earliestAssistantAutomationWakeAt,
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
  summary: AssistantInboxCaptureSummary
}

const ASSISTANT_DOCUMENT_PRESERVATION_RETRY_DELAY_MS = 30 * 1000

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
  turnInputPort?: AssistantTurnInputPort
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

  const candidates = (await listAssistantReplyCandidates({
    autoReply: applyCanonicalWrites ? scanState.autoReply : [],
    inboxServices: input.inboxServices,
    limit: normalizeScanLimit(input.maxPerScan),
    requestId: input.requestId ?? null,
    vault: input.vault,
  })).map((summary) => ({ summary }))
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
    } catch (error) {
      const nextWakeAt = computeAssistantAutomationRetryAt(
        ASSISTANT_DOCUMENT_PRESERVATION_RETRY_DELAY_MS,
      )
      replies.nextWakeAt = earliestAssistantAutomationWakeAt(
        replies.nextWakeAt,
        nextWakeAt,
      )
      input.onEvent?.({
        type: 'capture.failed',
        captureId: candidate.summary.captureId,
        details: `nonblocking document preservation failed: ${errorMessage(error)}`,
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

    const context = createAssistantAutoReplyGroupContext(group.items)
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
      turnInputPort: input.turnInputPort,
      vault: input.vault,
    })
    const stopReplyScan = applyAssistantAutoReplyProcessResult({
      context,
      result: replyResult,
      summary: replies,
      updateCursor: (cursor) => {
        updateAutoReplyChannelCursor(scanState, context.firstItem.summary.source, cursor)
      },
    })

    for (const item of context.items) {
      const groupCandidate = candidatesByCaptureId.get(item.summary.captureId)
      if (!groupCandidate) {
        continue
      }

      await preserveCandidateDocumentsBestEffort(groupCandidate)
    }

    await persistScanState()

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
  inboxServices: InboxServices
  limit: number
  requestId: string | null
  vault: string
}): Promise<AssistantInboxCaptureSummary[]> {
  if (input.autoReply.length === 0) {
    return []
  }

  const candidates = await Promise.all(
    input.autoReply.map(async (channelState) => {
      const channelCandidates: AssistantInboxCaptureSummary[] = []
      let cursor = channelState.cursor

      while (channelCandidates.length < input.limit) {
        const listed = await input.inboxServices.list({
          vault: input.vault,
          requestId: input.requestId,
          limit: input.limit,
          sourceId: null,
          afterCreatedAt: cursor?.createdAt ?? null,
          afterOccurredAt: cursor?.occurredAt ?? null,
          afterCaptureId: cursor?.captureId ?? null,
          oldestFirst: true,
        })
        const listedItems = [...listed.items].sort(compareAssistantCaptureOrder)
        if (listedItems.length === 0) {
          break
        }

        channelCandidates.push(
          ...listedItems.filter((capture) => capture.source === channelState.channel),
        )

        const lastListed = listedItems[listedItems.length - 1]
        cursor = lastListed ? cursorFromCapture(lastListed) : cursor
        if (listedItems.length < input.limit) {
          break
        }
      }

      return channelCandidates.slice(0, input.limit)
    }),
  )

  return candidates
    .flat()
    .sort(compareAssistantCaptureOrder)
    .slice(0, input.limit)
}

function updateAutoReplyChannelCursor(
  scanState: AssistantAutomationScanStateProgress,
  channel: string,
  cursor: ReturnType<typeof cursorFromCapture>,
): void {
  scanState.autoReply = scanState.autoReply.map((entry) =>
    entry.channel === channel
      ? {
          ...entry,
          cursor,
        }
      : entry,
  )
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
      cursor: entry.cursor,
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
      return other?.channel === entry.channel && sameCursor(other.cursor, entry.cursor)
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
