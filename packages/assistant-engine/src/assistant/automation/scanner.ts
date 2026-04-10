import type { AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantModelSpec } from '../../model-harness.js'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import { errorMessage } from '../shared.js'
import { collectAssistantAutoReplyGroup } from './grouping.js'
import {
  applyAssistantAutoReplyProcessResult,
  createAssistantAutoReplyGroupContext,
  processAssistantAutoReplyGroup,
} from './reply.js'
import {
  applyRoutingOutcome,
  routeAssistantInboxCapture,
} from './routing.js'
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
type AssistantInboxListResult = Awaited<ReturnType<InboxServices['list']>>
type AssistantPreserveDocumentAttachmentsResult = Awaited<
  ReturnType<NonNullable<InboxServices['preserveDocumentAttachments']>>
>

interface AssistantAutomationCandidate {
  replyPending: boolean
  routingPending: boolean
  summary: AssistantInboxCaptureSummary
}

const ASSISTANT_DOCUMENT_PRESERVATION_RETRY_DELAY_MS = 30 * 1000

export async function scanAssistantAutomationOnce(input: {
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  inboxServices: InboxServices
  maxPerScan?: number
  modelSpec?: AssistantModelSpec
  onEvent?: (event: AssistantRunEvent) => void
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
  vault: string
  vaultServices?: VaultServices
}): Promise<AssistantAutomationScanResult> {
  const routing = createEmptyInboxScanResult()
  const replies = createEmptyAutoReplyScanResult()
  const scanState = cloneAutomationScanState(input.state)
  let persistedState = cloneAutomationScanState(scanState)
  const routingModelSpec = input.modelSpec?.model ? input.modelSpec : null
  const routingEnabled = routingModelSpec !== null
  const replyChannels = scanState.autoReply.map((entry) => entry.channel)
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

  if (!routingEnabled && replyChannels.length === 0) {
    return {
      replies,
      routing,
    }
  }

  const candidateBatches = await listAssistantAutomationCandidates({
    autoReply: scanState.autoReply,
    inboxServices: input.inboxServices,
    maxPerScan: input.maxPerScan,
    requestId: input.requestId ?? null,
    routingEnabled,
    scanState,
    vault: input.vault,
  })

  const candidates = constrainAssistantAutomationCandidates({
    candidates: mergeAssistantAutomationCandidates(candidateBatches),
    maxPerScan: input.maxPerScan,
    reply: candidateBatches.reply,
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
  let routingCursorBlocked = false

  const preserveCandidateDocuments = async (
    candidate: AssistantAutomationCandidate,
  ): Promise<boolean> => {
    if (candidate.summary.attachmentCount === 0) {
      return true
    }

    const existing = preservedCaptureResults.get(candidate.summary.captureId)
    if (existing) {
      return true
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
      return true
    } catch (error) {
      const nextWakeAt = computeAssistantAutomationRetryAt(
        ASSISTANT_DOCUMENT_PRESERVATION_RETRY_DELAY_MS,
      )
      if (candidate.replyPending || !candidate.routingPending) {
        replies.nextWakeAt = earliestAssistantAutomationWakeAt(
          replies.nextWakeAt,
          nextWakeAt,
        )
      }
      if (candidate.routingPending || !candidate.replyPending) {
        routing.nextWakeAt = earliestAssistantAutomationWakeAt(
          routing.nextWakeAt,
          nextWakeAt,
        )
      }
      input.onEvent?.({
        type: 'capture.failed',
        captureId: candidate.summary.captureId,
        details: `automatic document preservation failed: ${errorMessage(error)}`,
      })
      return false
    }
  }

  const routeCandidate = async (candidate: AssistantAutomationCandidate) => {
    if (!routingModelSpec) {
      return
    }

    routing.considered += 1
    const outcome = await routeAssistantInboxCapture({
      capture: candidate.summary,
      inboxServices: input.inboxServices,
      modelSpec: routingModelSpec,
      requestId: input.requestId,
      vault: input.vault,
      vaultServices: input.vaultServices,
    })
    applyRoutingOutcome({
      captureId: candidate.summary.captureId,
      onEvent: input.onEvent,
      outcome,
      summary: routing,
    })
    if (!outcome.advanceCursor) {
      routingCursorBlocked = true
      return
    }

    if (!routingCursorBlocked) {
      scanState.inboxScanCursor = cursorFromCapture(candidate.summary)
    }
  }

  scanLoop: for (let index = 0; index < candidates.length; index += 1) {
    if (input.signal?.aborted) {
      break
    }

    const candidate = candidates[index]
    if (!candidate) {
      continue
    }

    if (candidate.replyPending) {
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

      for (const item of context.items) {
        const groupCandidate = candidatesByCaptureId.get(item.summary.captureId)
        if (!groupCandidate) {
          continue
        }

        if (!(await preserveCandidateDocuments(groupCandidate))) {
          break scanLoop
        }

        if (!groupCandidate.routingPending || !routingModelSpec) {
          continue
        }

        await routeCandidate(groupCandidate)
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
        providerHeartbeatMs: input.providerHeartbeatMs,
        providerLongRunningCommandStallTimeoutMs:
          input.providerLongRunningCommandStallTimeoutMs,
        providerStallTimeoutMs: input.providerStallTimeoutMs,
        requestId: input.requestId ?? null,
        signal: input.signal,
        sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
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

      await persistScanState()

      if (stopReplyScan) {
        break
      }

      continue
    }

    if (!candidate.routingPending || !routingModelSpec) {
      if (!(await preserveCandidateDocuments(candidate))) {
        break
      }
      continue
    }

    if (!(await preserveCandidateDocuments(candidate))) {
      break
    }

    await routeCandidate(candidate)
    await persistScanState()
  }

  return {
    replies,
    routing,
  }
}

async function listAssistantAutomationCandidates(input: {
  autoReply: AssistantAutomationScanStateProgress['autoReply']
  inboxServices: InboxServices
  maxPerScan?: number
  requestId: string | null
  routingEnabled: boolean
  scanState: AssistantAutomationScanStateProgress
  vault: string
}): Promise<{
  reply: AssistantInboxCaptureSummary[]
  routing: AssistantInboxCaptureSummary[]
}> {
  const limit = normalizeScanLimit(input.maxPerScan)
  const [reply, routingListed] = await Promise.all([
    listAssistantReplyCandidates({
      autoReply: input.autoReply,
      inboxServices: input.inboxServices,
      limit,
      requestId: input.requestId,
      vault: input.vault,
    }),
    input.routingEnabled
      ? input.inboxServices.list({
          vault: input.vault,
          requestId: input.requestId,
          limit,
          sourceId: null,
          afterOccurredAt: input.scanState.inboxScanCursor?.occurredAt ?? null,
          afterCaptureId: input.scanState.inboxScanCursor?.captureId ?? null,
          oldestFirst: true,
        })
      : Promise.resolve(
          createEmptyAssistantInboxListResult(
            input.vault,
            limit,
            input.scanState.inboxScanCursor,
          ),
        ),
  ])

  return {
    reply,
    routing: [...routingListed.items].sort(compareAssistantCaptureOrder),
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

function mergeAssistantAutomationCandidates(input: {
  reply: readonly AssistantInboxCaptureSummary[]
  routing: readonly AssistantInboxCaptureSummary[]
}): AssistantAutomationCandidate[] {
  const merged = new Map<string, AssistantAutomationCandidate>()

  for (const capture of input.routing) {
    merged.set(capture.captureId, {
      replyPending: false,
      routingPending: true,
      summary: capture,
    })
  }

  for (const capture of input.reply) {
    const existing = merged.get(capture.captureId)
    if (existing) {
      existing.replyPending = true
      existing.summary = capture
      continue
    }

    merged.set(capture.captureId, {
      replyPending: true,
      routingPending: false,
      summary: capture,
    })
  }

  return [...merged.values()].sort((left, right) =>
    compareAssistantCaptureOrder(left.summary, right.summary),
  )
}

function createEmptyAssistantInboxListResult(
  vault: string,
  limit: number,
  cursor: AssistantAutomationScanStateProgress['inboxScanCursor'],
): AssistantInboxListResult {
  return {
    vault,
    filters: {
      sourceId: null,
      limit,
      afterOccurredAt: cursor?.occurredAt ?? null,
      afterCaptureId: cursor?.captureId ?? null,
      oldestFirst: true,
    },
    items: [],
  }
}

function constrainAssistantAutomationCandidates(input: {
  candidates: readonly AssistantAutomationCandidate[]
  maxPerScan?: number
  reply: readonly AssistantInboxCaptureSummary[]
}): AssistantAutomationCandidate[] {
  const limit = normalizeScanLimit(input.maxPerScan)
  if (input.reply.length === 0 || input.reply.length < limit) {
    return [...input.candidates]
  }

  const replyBoundary = input.reply[input.reply.length - 1]
  if (!replyBoundary) {
    return [...input.candidates]
  }

  return input.candidates.filter(
    (candidate) =>
      candidate.replyPending ||
      compareAssistantCaptureOrder(candidate.summary, replyBoundary) <= 0,
  )
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
