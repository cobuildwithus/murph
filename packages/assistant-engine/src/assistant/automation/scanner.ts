import type { AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantAutomationOperationScope } from './operation-scope.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import type { AssistantProviderProgressEvent } from '../provider-progress.js'
import type {
  AssistantBeforeProviderAcceptedInputsHook,
  AssistantTurnEnvironment,
} from '../service-contracts.js'
import {
  type AssistantInputCandidate,
  type AssistantInputSource,
} from '../input-source.js'
import { compareAssistantInputCursors } from '../input-store.js'
import { sameAssistantAutoReplyState } from '../automation-state.js'
import { emitHostedAssistantTurnTimingTrace } from '../hosted-turn-timing.js'
import { collectAssistantAutoReplyGroup } from './grouping.js'
import {
  assistantAutomationInputSummaryFromCandidate,
  type AssistantAutomationInputSummary,
} from './input-summary.js'
import {
  hasCompleteAssistantAutoReplyTerminalEvidence,
} from './evidence.js'
import {
  decideAssistantGroupBurstHold,
} from './group-burst-hold.js'
import {
  applyAssistantAutoReplyProcessResult,
  createAssistantAutoReplyGroupContext,
  createAssistantAutoReplyHistoryReader,
  processAssistantAutoReplyGroup,
  type AssistantAutoReplyProviderRequestStartHook,
} from './reply.js'
import {
  createEmptyAutoReplyScanResult,
  createEmptyInboxScanResult,
  normalizeScanLimit,
  type AssistantAutomationScanResult,
  type AssistantAutomationScanStateProgress,
  type AssistantRunEvent,
  waitForAbortOrTimeout,
} from './shared.js'

interface AssistantAutomationCandidate {
  inputCandidate: AssistantInputCandidate
  summary: AssistantAutomationInputSummary
}

export async function scanAssistantAutomationOnce(input: {
  applyCanonicalWrites?: boolean
  allowSelfAuthored?: boolean
  beforeProviderAcceptedInputs?: AssistantBeforeProviderAcceptedInputsHook | null
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  operationScope?: AssistantAutomationOperationScope | null
  inboxServices: InboxServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onProviderRequestStarted?: AssistantAutoReplyProviderRequestStartHook | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  onStateProgress?: (
    state: AssistantAutomationScanStateProgress,
  ) => Promise<void> | void
  now?: () => number
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  requestId?: string | null
  signal?: AbortSignal
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
  sessionMaxAgeMs?: number | null
  state: Pick<AssistantAutomationState, 'autoReply'>
  turnEnvironment?: AssistantTurnEnvironment | null
  inputSource: AssistantInputSource
  vault: string
  vaultServices?: VaultServices
}): Promise<AssistantAutomationScanResult> {
  const scanStartedAt = Date.now()
  const routing = createEmptyInboxScanResult()
  const replies = createEmptyAutoReplyScanResult()
  const currentTurnDeliveryIntentIds: string[] = []
  const applyCanonicalWrites = input.applyCanonicalWrites ?? true
  const scanState = cloneAutomationScanState(input.state)
  let persistedState = cloneAutomationScanState(scanState)
  void input.vaultServices
  const replyChannels = applyCanonicalWrites
    ? scanState.autoReply.map((entry) => entry.channel)
    : []
  const persistScanState = async (): Promise<boolean> => {
    return await persistAssistantAutomationScanState({
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
      currentTurnDeliveryIntentIds,
      replies,
      routing,
    }
  }

  let candidates = await listAssistantReplyCandidates({
    autoReply: applyCanonicalWrites ? scanState.autoReply : [],
    inputSource: input.inputSource,
    limit: normalizeScanLimit(input.maxPerScan),
    signal: input.signal,
    vault: input.vault,
  })
  if (candidates.length === 0) {
    return {
      currentTurnDeliveryIntentIds,
      replies,
      routing,
    }
  }

  input.onEvent?.({
    type: 'scan.started',
    details: `${candidates.length} input(s)`,
  })

  const historyReader = createAssistantAutoReplyHistoryReader({
    vault: input.vault,
  })
  const processGroupItems = async (
    groupItems: Awaited<
      ReturnType<typeof collectAssistantAutoReplyGroup>
    >['items'],
  ): Promise<boolean> => {
    const context = createAssistantAutoReplyGroupContext(groupItems)
    if (!context) {
      return false
    }

    replies.considered += context.inputCount
    const processGroup = async (
      executionContext: AssistantExecutionContext | null | undefined,
      turnEnvironment: AssistantTurnEnvironment | null,
    ) => await processAssistantAutoReplyGroup({
      allowSelfAuthored: input.allowSelfAuthored ?? false,
      ...(input.beforeProviderAcceptedInputs
        ? { beforeProviderAcceptedInputs: input.beforeProviderAcceptedInputs }
        : {}),
      context,
      deliveryDispatchMode: input.deliveryDispatchMode,
      enabledChannels: replyChannels,
      executionContext,
      inboxServices: input.inboxServices,
      onEvent: input.onEvent,
      onProviderEvent: input.onProviderEvent ?? null,
      onProviderRequestStarted: input.onProviderRequestStarted ?? null,
      onTraceEvent: input.onTraceEvent,
      providerHeartbeatMs: input.providerHeartbeatMs,
      providerLongRunningCommandStallTimeoutMs:
        input.providerLongRunningCommandStallTimeoutMs,
      providerStallTimeoutMs: input.providerStallTimeoutMs,
      historyReader,
      requestId: input.requestId ?? null,
      signal: input.signal,
      sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
      turnEnvironment,
      inputSource: input.inputSource,
      vault: input.vault,
    })
    const replyResult = input.operationScope && input.executionContext
      ? await input.operationScope.runAutoReplyGroup({
          executionContext: input.executionContext,
          inputIds: context.inputIds,
          operation: processGroup,
          turnEnvironment: input.turnEnvironment ?? null,
        })
      : await processGroup(input.executionContext, input.turnEnvironment ?? null)
    const stopReplyScan = applyAssistantAutoReplyProcessResult({
      context,
      result: replyResult,
      summary: replies,
    })
    currentTurnDeliveryIntentIds.push(
      ...(replyResult.currentTurnDeliveryIntentIds ?? []),
    )
    if (replyResult.advanceCursor) {
      advanceAssistantAutoReplyChannelCursor({
        autoReply: scanState.autoReply,
        channel: context.firstItem.summary.source,
        cursor: replyResult.lastInputCursor ?? context.lastInputCursor,
      })
    }

    const scanStatePersistStartedAt = Date.now()
    const scanStateChanged = await persistScanState()
    emitHostedAssistantTurnTimingTrace({
      currentTurnDeliveryIntentCount: currentTurnDeliveryIntentIds.length,
      elapsedMs: elapsedSince(scanStartedAt),
      executionContext: input.executionContext ?? null,
      onTraceEvent: input.onTraceEvent ?? null,
      scanStateChanged,
      stage: 'scan-state-persisted',
      stepElapsedMs: elapsedSince(scanStatePersistStartedAt),
    })

    return stopReplyScan
  }

  const parkedChannelResumeAt = new Map<string, number>()
  let stopReplyScan = false
  let candidateIndex = indexAssistantAutomationCandidates(candidates)
  for (let index = 0; index < candidates.length; index += 1) {
    if (input.signal?.aborted) {
      break
    }

    const candidate = candidates[index]
    if (!candidate) {
      continue
    }
    const channel = candidate.summary.source
    if (parkedChannelResumeAt.has(channel)) {
      continue
    }

    const group = await collectAssistantAutoReplyGroup({
      inputSummaries: candidateIndex.inputSummaries,
      inputCandidatesByInputId: candidateIndex.inputCandidatesByInputId,
      startIndex: index,
      vault: input.vault,
    })
    const groupItems = hydrateAssistantAutoReplyGroupItems({
      candidatesByInputId: candidateIndex.candidatesByInputId,
      items: group.items,
    })
    index = group.endIndex
    const holdDecision = decideAssistantGroupBurstHoldForItems({
      items: groupItems,
      now: input.now?.() ?? Date.now(),
    })
    if (!holdDecision.ready) {
      parkedChannelResumeAt.set(channel, holdDecision.resumeAt)
      continue
    }

    stopReplyScan = await processGroupItems(groupItems)
    if (stopReplyScan) {
      break
    }
  }

  while (
    !stopReplyScan &&
    parkedChannelResumeAt.size > 0 &&
    input.signal?.aborted !== true
  ) {
    const now = input.now?.() ?? Date.now()
    let earliestParkedChannel: string | null = null
    let earliestResumeAt = Number.POSITIVE_INFINITY
    for (const [channel, resumeAt] of parkedChannelResumeAt) {
      if (resumeAt < earliestResumeAt) {
        earliestParkedChannel = channel
        earliestResumeAt = resumeAt
      }
    }
    if (earliestParkedChannel === null) {
      break
    }

    await (input.sleep ?? sleepForAssistantGroupBurstHold)(
      Math.max(0, earliestResumeAt - now),
      input.signal,
    )
    if (input.signal?.aborted) {
      break
    }

    candidates = await listAssistantReplyCandidates({
      autoReply: applyCanonicalWrites
        ? scanState.autoReply.filter(
            (entry) => entry.channel === earliestParkedChannel,
          )
        : [],
      inputSource: input.inputSource,
      limit: normalizeScanLimit(input.maxPerScan),
      signal: input.signal,
      vault: input.vault,
    })
    candidateIndex = indexAssistantAutomationCandidates(candidates)
    const phaseChannels = new Set([earliestParkedChannel])
    const blockedChannels = new Set<string>()
    const seenChannels = new Set<string>()
    for (let index = 0; index < candidates.length; index += 1) {
      if (input.signal?.aborted) {
        break
      }

      const candidate = candidates[index]
      if (!candidate) {
        continue
      }
      const channel = candidate.summary.source
      if (!phaseChannels.has(channel) || blockedChannels.has(channel)) {
        continue
      }
      seenChannels.add(channel)

      const group = await collectAssistantAutoReplyGroup({
        inputSummaries: candidateIndex.inputSummaries,
        inputCandidatesByInputId: candidateIndex.inputCandidatesByInputId,
        startIndex: index,
        vault: input.vault,
      })
      const groupItems = hydrateAssistantAutoReplyGroupItems({
        candidatesByInputId: candidateIndex.candidatesByInputId,
        items: group.items,
      })
      index = group.endIndex
      const holdDecision = decideAssistantGroupBurstHoldForItems({
        items: groupItems,
        now: input.now?.() ?? Date.now(),
      })
      if (!holdDecision.ready) {
        parkedChannelResumeAt.set(channel, holdDecision.resumeAt)
        blockedChannels.add(channel)
        continue
      }

      parkedChannelResumeAt.delete(channel)
      stopReplyScan = await processGroupItems(groupItems)
      if (stopReplyScan) {
        break
      }
    }

    for (const channel of phaseChannels) {
      if (!seenChannels.has(channel)) {
        parkedChannelResumeAt.delete(channel)
      }
    }
  }

  return {
    currentTurnDeliveryIntentIds,
    replies,
    routing,
  }
}

function decideAssistantGroupBurstHoldForItems(input: {
  items: Awaited<ReturnType<typeof collectAssistantAutoReplyGroup>>['items']
  now: number
}): ReturnType<typeof decideAssistantGroupBurstHold> {
  return decideAssistantGroupBurstHold({
    items: input.items.map((item) => ({
      ...(item.inputCandidate?.event.groupParticipantAdded === true
        ? { groupParticipantAdded: true as const }
        : {}),
      sourceRef: item.inputCandidate?.event.sourceRef ?? null,
      summary: item.summary,
    })),
    now: input.now,
  })
}

function indexAssistantAutomationCandidates(
  candidates: readonly AssistantAutomationCandidate[],
): {
  candidatesByInputId: ReadonlyMap<string, AssistantAutomationCandidate>
  inputCandidatesByInputId: ReadonlyMap<string, AssistantInputCandidate>
  inputSummaries: AssistantAutomationInputSummary[]
} {
  return {
    candidatesByInputId: new Map(
      candidates.map((candidate) => [
        candidate.summary.inputId,
        candidate,
      ] as const),
    ),
    inputCandidatesByInputId: new Map(
      candidates.map((candidate) => [
        candidate.summary.inputId,
        candidate.inputCandidate,
      ] as const),
    ),
    inputSummaries: candidates.map((candidate) => candidate.summary),
  }
}

function hydrateAssistantAutoReplyGroupItems(input: {
  candidatesByInputId: ReadonlyMap<string, AssistantAutomationCandidate>
  items: Awaited<ReturnType<typeof collectAssistantAutoReplyGroup>>['items']
}): Awaited<ReturnType<typeof collectAssistantAutoReplyGroup>>['items'] {
  return input.items.map((item) => ({
    ...item,
    inputCandidate:
      input.candidatesByInputId.get(item.summary.inputId)?.inputCandidate ??
      item.inputCandidate ??
      null,
  }))
}

async function sleepForAssistantGroupBurstHold(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal) {
    await waitForAbortOrTimeout(signal, delayMs)
    return
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

export async function hasPendingAssistantAutoReplyInput(input: {
  inputSource: AssistantInputSource
  state: Pick<AssistantAutomationState, 'autoReply'>
  signal?: AbortSignal
  vault: string
}): Promise<boolean> {
  const candidates = await listAssistantReplyCandidates({
    autoReply: input.state.autoReply,
    inputSource: input.inputSource,
    limit: 1,
    signal: input.signal,
    vault: input.vault,
  })
  return candidates.length > 0
}

async function listAssistantReplyCandidates(input: {
  autoReply: AssistantAutomationScanStateProgress['autoReply']
  inputSource: AssistantInputSource
  limit: number
  signal?: AbortSignal
  vault: string
}): Promise<AssistantAutomationCandidate[]> {
  if (input.autoReply.length === 0) {
    return []
  }

  const terminalEvidenceCache = new Map<string, Promise<boolean>>()
  const terminalEvidenceComplete = (candidate: AssistantInputCandidate) => {
    const evidenceId = `${candidate.event.inputId}\u0000${candidate.projection.captureId ?? ''}`
    let cached = terminalEvidenceCache.get(evidenceId)
    if (!cached) {
      cached = hasCompleteAssistantAutoReplyTerminalEvidence({
        captureId: candidate.projection.captureId,
        inputId: candidate.event.inputId,
        vault: input.vault,
      })
      terminalEvidenceCache.set(evidenceId, cached)
    }
    return cached
  }

  const candidates = await Promise.all(
    input.autoReply.map(async (channelState) => {
      const channelCandidates: AssistantAutomationCandidate[] = []
      let cursor = channelState.eligibleAfter

      while (channelCandidates.length < input.limit) {
        const listed = await input.inputSource.listInputCandidates({
          afterCursor: cursor,
          limit: input.limit,
          signal: input.signal,
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
          if (await terminalEvidenceComplete(candidate)) {
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
    .sort((left, right) =>
      compareAssistantInputCursors(
        left.inputCandidate.event.cursor,
        right.inputCandidate.event.cursor,
      ))
    .slice(0, input.limit)
}

function advanceAssistantAutoReplyChannelCursor(input: {
  autoReply: AssistantAutomationScanStateProgress['autoReply']
  channel: string | null
  cursor: AssistantInputCandidate['event']['cursor']
}): void {
  if (!input.channel) {
    return
  }

  for (const entry of input.autoReply) {
    if (entry.channel !== input.channel) {
      continue
    }
    if (
      !entry.eligibleAfter ||
      compareAssistantInputCursors(input.cursor, entry.eligibleAfter) > 0
    ) {
      entry.eligibleAfter = input.cursor
    }
    return
  }
}

function assistantAutomationCandidateFromInput(
  input: AssistantInputCandidate,
): AssistantAutomationCandidate {
  return {
    inputCandidate: input,
    summary: assistantInputSummaryFromInputCandidate(input),
  }
}

function assistantInputSummaryFromInputCandidate(
  input: AssistantInputCandidate,
): AssistantAutomationInputSummary {
  return assistantAutomationInputSummaryFromCandidate(input)
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

async function persistAssistantAutomationScanState(input: {
  onStateProgress?: (
    state: AssistantAutomationScanStateProgress,
  ) => Promise<void> | void
  persistedState: AssistantAutomationScanStateProgress
  scanState: AssistantAutomationScanStateProgress
  updatePersistedState: (state: AssistantAutomationScanStateProgress) => void
}): Promise<boolean> {
  if (assistantAutomationScanStateEqual(input.persistedState, input.scanState)) {
    return false
  }

  const next = cloneAutomationScanState(input.scanState)
  await input.onStateProgress?.(next)
  input.updatePersistedState(next)
  return true
}

function cloneAutomationScanState(
  state: Pick<AssistantAutomationScanStateProgress, 'autoReply'>,
): AssistantAutomationScanStateProgress {
  return {
    autoReply: state.autoReply.map((entry) => ({
      channel: entry.channel,
      eligibleAfter: entry.eligibleAfter,
      enabledAt: entry.enabledAt,
    })),
  }
}

function assistantAutomationScanStateEqual(
  left: AssistantAutomationScanStateProgress,
  right: AssistantAutomationScanStateProgress,
): boolean {
  return sameAssistantAutoReplyState(left.autoReply, right.autoReply)
}
