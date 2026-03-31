import type { AssistantAutomationState } from '../../assistant-cli-contracts.js'
import type { InboxServices } from '../../inbox-services.js'
import type { AssistantModelSpec } from '../../model-harness.js'
import type { VaultServices } from '../../vault-services.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
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
  createEmptyAutoReplyScanResult,
  createEmptyInboxScanResult,
  cursorFromCapture,
  normalizeEnabledChannels,
  normalizeScanLimit,
  type AssistantAutomationScanResult,
  type AssistantAutomationScanStateProgress,
  type AssistantRunEvent,
} from './shared.js'

type AssistantInboxCaptureSummary = Awaited<
  ReturnType<InboxServices['list']>
>['items'][number]
type AssistantInboxListResult = Awaited<ReturnType<InboxServices['list']>>

interface AssistantAutomationCandidate {
  replyPending: boolean
  routingPending: boolean
  summary: AssistantInboxCaptureSummary
}

export async function scanAssistantAutomationOnce(input: {
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
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
  state: Pick<
    AssistantAutomationState,
    | 'autoReplyBacklogChannels'
    | 'autoReplyChannels'
    | 'autoReplyPrimed'
    | 'autoReplyScanCursor'
    | 'inboxScanCursor'
  >
  vault: string
  vaultServices?: VaultServices
}): Promise<AssistantAutomationScanResult> {
  const routing = createEmptyInboxScanResult()
  const replies = createEmptyAutoReplyScanResult()
  const scanState = cloneAutomationScanState(input.state)
  let persistedState = cloneAutomationScanState(scanState)
  const routingModelSpec = input.modelSpec?.model ? input.modelSpec : null
  const routingEnabled = routingModelSpec !== null
  const replyBacklogActive = scanState.autoReplyBacklogChannels.length > 0
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
  const replyChannels = normalizeEnabledChannels(
    replyBacklogActive
      ? scanState.autoReplyBacklogChannels
      : input.state.autoReplyChannels,
  )

  if (!routingEnabled && replyChannels.length === 0) {
    return {
      replies,
      routing,
    }
  }

  if (replyBacklogActive) {
    // Once backlog replay starts, the current reply cursor becomes authoritative.
    scanState.autoReplyPrimed = true
  }

  if (replyChannels.length > 0 && !scanState.autoReplyPrimed && !replyBacklogActive) {
    scanState.autoReplyScanCursor = await primeAssistantAutoReplyCursor({
      afterCursor: scanState.autoReplyScanCursor,
      inboxServices: input.inboxServices,
      requestId: input.requestId ?? null,
      vault: input.vault,
    })
    scanState.autoReplyPrimed = true
    await persistScanState()
    input.onEvent?.({
      type: 'reply.scan.primed',
      details:
        scanState.autoReplyScanCursor === null
          ? 'no existing captures yet; auto-reply will start with the next inbound message'
          : `starting after ${scanState.autoReplyScanCursor.captureId}`,
    })
  }

  const candidateBatches = await listAssistantAutomationCandidates({
    inboxServices: input.inboxServices,
    maxPerScan: input.maxPerScan,
    restrictReplyToChannels: replyBacklogActive,
    replyChannels,
    requestId: input.requestId ?? null,
    routingEnabled,
    scanState,
    vault: input.vault,
  })

  if (replyBacklogActive && candidateBatches.reply.length === 0) {
    scanState.autoReplyBacklogChannels = []
    // Once the configured backlog is drained, continue from the current
    // reply cursor instead of re-priming to the newest capture.
    scanState.autoReplyPrimed = true
    await persistScanState()
  }

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
  let routingCursorBlocked = false
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

  for (let index = 0; index < candidates.length; index += 1) {
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
        if (!groupCandidate?.routingPending || !routingModelSpec) {
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
          scanState.autoReplyScanCursor = cursor
        },
      })

      await persistScanState()

      if (stopReplyScan) {
        break
      }

      continue
    }

    if (!candidate.routingPending || !routingModelSpec) {
      continue
    }

    await routeCandidate(candidate)
    await persistScanState()
  }

  return {
    replies,
    routing,
  }
}

async function primeAssistantAutoReplyCursor(input: {
  afterCursor: AssistantAutomationScanStateProgress['autoReplyScanCursor']
  inboxServices: InboxServices
  requestId: string | null
  vault: string
}): Promise<AssistantAutomationScanStateProgress['autoReplyScanCursor']> {
  const latest = await input.inboxServices.list({
    vault: input.vault,
    requestId: input.requestId,
    limit: 1,
    sourceId: null,
    afterOccurredAt: null,
    afterCaptureId: null,
    oldestFirst: false,
  })
  const latestCapture = [...latest.items].sort(compareAssistantCaptureOrder).pop()
  return latestCapture ? cursorFromCapture(latestCapture) : input.afterCursor
}

async function listAssistantAutomationCandidates(input: {
  inboxServices: InboxServices
  maxPerScan?: number
  restrictReplyToChannels: boolean
  replyChannels: readonly string[]
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
      inboxServices: input.inboxServices,
      limit,
      replyChannels: input.replyChannels,
      requestId: input.requestId,
      restrictReplyToChannels: input.restrictReplyToChannels,
      scanCursor: input.scanState.autoReplyScanCursor,
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
          createEmptyAssistantInboxListResult(input.vault, limit, input.scanState.inboxScanCursor),
        ),
  ])

  return {
    reply,
    routing: [...routingListed.items].sort(compareAssistantCaptureOrder),
  }
}

async function listAssistantReplyCandidates(input: {
  inboxServices: InboxServices
  limit: number
  replyChannels: readonly string[]
  requestId: string | null
  restrictReplyToChannels: boolean
  scanCursor: AssistantAutomationScanStateProgress['autoReplyScanCursor']
  vault: string
}): Promise<AssistantInboxCaptureSummary[]> {
  if (input.replyChannels.length === 0) {
    return []
  }

  if (!input.restrictReplyToChannels) {
    const listed = await input.inboxServices.list({
      vault: input.vault,
      requestId: input.requestId,
      limit: input.limit,
      sourceId: null,
      afterOccurredAt: input.scanCursor?.occurredAt ?? null,
      afterCaptureId: input.scanCursor?.captureId ?? null,
      oldestFirst: true,
    })
    return [...listed.items].sort(compareAssistantCaptureOrder)
  }

  const backlogCandidates: AssistantInboxCaptureSummary[] = []
  let cursor = input.scanCursor

  while (backlogCandidates.length < input.limit) {
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

    backlogCandidates.push(
      ...listedItems.filter((capture) => input.replyChannels.includes(capture.source)),
    )

    const lastListed = listedItems[listedItems.length - 1]
    cursor = lastListed ? cursorFromCapture(lastListed) : cursor
    if (listedItems.length < input.limit) {
      break
    }
  }

  return backlogCandidates.slice(0, input.limit)
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
  cursor: AssistantAutomationScanStateProgress['autoReplyScanCursor'],
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
  state: Pick<
    AssistantAutomationScanStateProgress,
    | 'autoReplyBacklogChannels'
    | 'autoReplyPrimed'
    | 'autoReplyScanCursor'
    | 'inboxScanCursor'
  >,
): AssistantAutomationScanStateProgress {
  return {
    autoReplyBacklogChannels: [...state.autoReplyBacklogChannels],
    autoReplyPrimed: state.autoReplyPrimed,
    autoReplyScanCursor: state.autoReplyScanCursor,
    inboxScanCursor: state.inboxScanCursor,
  }
}

function assistantAutomationScanStateEqual(
  left: AssistantAutomationScanStateProgress,
  right: AssistantAutomationScanStateProgress,
): boolean {
  return (
    left.autoReplyPrimed === right.autoReplyPrimed &&
    sameCursor(left.autoReplyScanCursor, right.autoReplyScanCursor) &&
    sameCursor(left.inboxScanCursor, right.inboxScanCursor) &&
    sameStringArray(left.autoReplyBacklogChannels, right.autoReplyBacklogChannels)
  )
}

function sameCursor(
  left: AssistantAutomationScanStateProgress['autoReplyScanCursor'],
  right: AssistantAutomationScanStateProgress['autoReplyScanCursor'],
): boolean {
  return (
    left?.captureId === right?.captureId &&
    left?.occurredAt === right?.occurredAt
  )
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
