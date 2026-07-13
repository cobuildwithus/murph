import type { AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import type { AssistantProviderProgressEvent } from '../provider-progress.js'
import type { AssistantTurnEnvironment } from '../service-contracts.js'
import {
  type AssistantInputCandidate,
  type AssistantInputSource,
} from '../input-source.js'
import { compareAssistantInputCursors } from '../input-store.js'
import { sameAssistantAutoReplyState } from '../automation-state.js'
import { emitHostedAssistantTurnTimingTrace } from '../hosted-turn-timing.js'
import {
  collectAssistantAutoReplyGroup,
  orderAssistantAutoReplyInputSummaries,
} from './grouping.js'
import {
  assistantAutomationInputSummaryFromCandidate,
  type AssistantAutomationInputSummary,
} from './input-summary.js'
import {
  hasCompleteAssistantAutoReplyTerminalEvidence,
} from './evidence.js'
import {
  applyAssistantAutoReplyProcessResult,
  createAssistantAutoReplyGroupContext,
  createAssistantAutoReplyHistoryReader,
  processAssistantAutoReplyGroup,
  type AssistantAutoReplyDeliveryIntentCommitHook,
  type AssistantAutoReplyProviderRequestStartHook,
} from './reply.js'
import {
  createEmptyAutoReplyScanResult,
  createEmptyInboxScanResult,
  normalizeScanLimit,
  type AssistantAutomationScanResult,
  type AssistantAutomationScanStateProgress,
  type AssistantRunEvent,
} from './shared.js'

interface AssistantAutomationCandidate {
  inputCandidate: AssistantInputCandidate
  summary: AssistantAutomationInputSummary
}

export async function scanAssistantAutomationOnce(input: {
  applyCanonicalWrites?: boolean
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  inboxServices: InboxServices
  inputCandidateQueryLimit?: number
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onProviderRequestStarted?: AssistantAutoReplyProviderRequestStartHook | null
  onBeforeDeliveryIntentCommit?: AssistantAutoReplyDeliveryIntentCommitHook | null
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

  const actionableLimit = normalizeScanLimit(input.maxPerScan)
  const candidates = await listAssistantReplyCandidates({
    autoReply: applyCanonicalWrites ? scanState.autoReply : [],
    inputSource: input.inputSource,
    limit: actionableLimit,
    queryLimit: Math.max(
      actionableLimit,
      normalizeScanLimit(input.inputCandidateQueryLimit ?? actionableLimit),
    ),
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
  const inputSummaries = orderAssistantAutoReplyInputSummaries(
    candidates.map((candidate) => candidate.summary),
  )
  const candidatesByInputId = new Map(
    candidates.map((candidate) => [candidate.summary.inputId, candidate] as const),
  )
  const inputCandidatesByInputId = new Map(
    candidates.map((candidate) => [
      candidate.summary.inputId,
      candidate.inputCandidate,
    ] as const),
  )
  const terminalInputIds = new Set<string>()
  for (let index = 0; index < inputSummaries.length; index += 1) {
    if (input.signal?.aborted) {
      break
    }

    const candidate = candidatesByInputId.get(inputSummaries[index]?.inputId ?? '')
    if (!candidate) {
      continue
    }

    const group = await collectAssistantAutoReplyGroup({
      inputSummaries,
      inputCandidatesByInputId,
      startIndex: index,
      vault: input.vault,
    })
    index = group.endIndex
    const groupItems = group.items.map((item) => ({
      ...item,
      inputCandidate:
        candidatesByInputId.get(item.summary.inputId)?.inputCandidate ??
        item.inputCandidate ??
        null,
    }))

    const context = createAssistantAutoReplyGroupContext(groupItems)
    if (!context) {
      continue
    }

    replies.considered += context.inputCount
    const replyResult = await processAssistantAutoReplyGroup({
      allowSelfAuthored: input.allowSelfAuthored ?? false,
      context,
      deliveryDispatchMode: input.deliveryDispatchMode,
      enabledChannels: replyChannels,
      executionContext: input.executionContext,
      inboxServices: input.inboxServices,
      onEvent: input.onEvent,
      onProviderEvent: input.onProviderEvent ?? null,
      onProviderRequestStarted: input.onProviderRequestStarted ?? null,
      onBeforeDeliveryIntentCommit: input.onBeforeDeliveryIntentCommit ?? null,
      onTraceEvent: input.onTraceEvent,
      providerHeartbeatMs: input.providerHeartbeatMs,
      providerLongRunningCommandStallTimeoutMs:
        input.providerLongRunningCommandStallTimeoutMs,
      providerStallTimeoutMs: input.providerStallTimeoutMs,
      historyReader,
      requestId: input.requestId ?? null,
      signal: input.signal,
      sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
      turnEnvironment: input.turnEnvironment ?? null,
      inputSource: input.inputSource,
      vault: input.vault,
    })
    const stopReplyScan = applyAssistantAutoReplyProcessResult({
      context,
      result: replyResult,
      summary: replies,
    })
    currentTurnDeliveryIntentIds.push(
      ...(replyResult.currentTurnDeliveryIntentIds ?? []),
    )
    if (replyResult.advanceCursor) {
      for (const inputId of context.inputIds) {
        terminalInputIds.add(inputId)
      }
    }
    if (
      replyResult.advanceCursor &&
      canAdvanceAssistantAutoReplyCursor({
        candidates,
        channel: context.firstItem.summary.source,
        cursor: replyResult.lastInputCursor ?? context.lastInputCursor,
        terminalInputIds,
      })
    ) {
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

    if (stopReplyScan) {
      break
    }
  }

  return {
    currentTurnDeliveryIntentIds,
    replies,
    routing,
  }
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
    queryLimit: 1,
    signal: input.signal,
    vault: input.vault,
  })
  return candidates.some((candidate) => !candidate.summary.contextOnly)
}

async function listAssistantReplyCandidates(input: {
  autoReply: AssistantAutomationScanStateProgress['autoReply']
  inputSource: AssistantInputSource
  limit: number
  queryLimit: number
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
      let actionableCandidateCount = 0
      let cursor = channelState.eligibleAfter

      while (actionableCandidateCount < input.limit) {
        const listed = await input.inputSource.listInputCandidates({
          afterCursor: cursor,
          limit: input.queryLimit,
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
          const automationCandidate = assistantAutomationCandidateFromInput(candidate)
          channelCandidates.push(automationCandidate)
          if (!automationCandidate.summary.contextOnly) {
            actionableCandidateCount += 1
          }
        }

        cursor = listed.nextCursor ?? cursor
        if (listedItems.length < input.queryLimit || !listed.nextCursor) {
          break
        }
      }

      return channelCandidates
    }),
  )

  const sortedCandidates = candidates
    .flat()
    .sort((left, right) =>
      compareAssistantInputCursors(
        left.inputCandidate.event.cursor,
        right.inputCandidate.event.cursor,
      ))

  const candidatesByInputId = new Map(
    sortedCandidates.map((candidate) => [candidate.summary.inputId, candidate] as const),
  )
  const semanticallyOrderedCandidates = orderAssistantAutoReplyInputSummaries(
    sortedCandidates.map((candidate) => candidate.summary),
  ).map((summary) => candidatesByInputId.get(summary.inputId))
    .filter((candidate): candidate is AssistantAutomationCandidate => candidate !== undefined)

  const selectedCandidates: AssistantAutomationCandidate[] = []
  let actionableCandidateCount = 0
  for (const candidate of semanticallyOrderedCandidates) {
    selectedCandidates.push(candidate)
    if (candidate.summary.contextOnly) {
      continue
    }
    actionableCandidateCount += 1
    if (actionableCandidateCount >= input.limit) {
      break
    }
  }
  return selectedCandidates
}

function canAdvanceAssistantAutoReplyCursor(input: {
  candidates: readonly AssistantAutomationCandidate[]
  channel: string
  cursor: AssistantInputCandidate['event']['cursor']
  terminalInputIds: ReadonlySet<string>
}): boolean {
  return input.candidates
    .filter((candidate) => candidate.summary.source === input.channel)
    .every((candidate) =>
      compareAssistantInputCursors(
        candidate.inputCandidate.event.cursor,
        input.cursor,
      ) > 0 || input.terminalInputIds.has(candidate.summary.inputId),
    )
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
