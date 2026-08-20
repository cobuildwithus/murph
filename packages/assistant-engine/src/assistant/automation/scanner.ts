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
  AssistantEarlySessionOnboardingReplyAcceptedHook,
  AssistantTurnEnvironment,
} from '../service-contracts.js'
import {
  stampAssistantProviderStartCriticalPath,
  type AssistantProviderStartCriticalPathContext,
} from '../provider-start-critical-path.js'
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
  readCompleteAssistantAutoReplyTerminalEvidence,
} from './evidence.js'
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
  emitAssistantAutoReplyTerminalNonReplyBestEffort,
  normalizeScanLimit,
  type AssistantAutoReplyTerminalNonReplyHook,
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
  beforeProviderAcceptedInputs?: AssistantBeforeProviderAcceptedInputsHook | null
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  operationScope?: AssistantAutomationOperationScope | null
  inboxServices: InboxServices
  maxPerScan?: number
  onEarlySessionOnboardingReplyAccepted?:
    AssistantEarlySessionOnboardingReplyAcceptedHook | null
  onEvent?: (event: AssistantRunEvent) => void
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onProviderRequestStarted?: AssistantAutoReplyProviderRequestStartHook | null
  onTerminalNonReplyCommitted?: AssistantAutoReplyTerminalNonReplyHook | null
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
  let providerStartCriticalPath = input.providerStartCriticalPath ?? null
  let automationLaneSubdivisionEligible = true
  const onProviderRequestStarted: AssistantAutoReplyProviderRequestStartHook = (
    event,
  ) => {
    providerStartCriticalPath = null
    return input.onProviderRequestStarted?.(event)
  }
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

  const candidates = await listAssistantReplyCandidates({
    autoReply: applyCanonicalWrites ? scanState.autoReply : [],
    inputSource: input.inputSource,
    limit: normalizeScanLimit(input.maxPerScan),
    onTerminalNonReplyCommitted: input.onTerminalNonReplyCommitted,
    signal: input.signal,
    vault: input.vault,
  })
  providerStartCriticalPath = stampAssistantProviderStartCriticalPath(
    providerStartCriticalPath,
    'automationCandidateScanDoneAtMonotonicMs',
  )
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
  const inputSummaries = candidates.map((candidate) => candidate.summary)
  const candidatesByInputId = new Map(
    candidates.map((candidate) => [candidate.summary.inputId, candidate] as const),
  )
  const inputCandidatesByInputId = new Map(
    candidates.map((candidate) => [
      candidate.summary.inputId,
      candidate.inputCandidate,
    ] as const),
  )
  for (let index = 0; index < candidates.length; index += 1) {
    if (input.signal?.aborted) {
      break
    }

    const candidate = candidates[index]
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
    const groupProviderStartCriticalPath =
      providerStartCriticalPath && !automationLaneSubdivisionEligible
        ? {
            ...providerStartCriticalPath,
            automationLaneSubdivisionEligible: false as const,
          }
        : providerStartCriticalPath
    const processGroup = async (
      executionContext: AssistantExecutionContext | null | undefined,
      turnEnvironment: AssistantTurnEnvironment | null,
      scopedProviderStartCriticalPath?:
        AssistantProviderStartCriticalPathContext | null,
    ) => {
      const providerStartAtGroupAndOperationScopeDone =
        scopedProviderStartCriticalPath === undefined
          ? stampAssistantProviderStartCriticalPath(
              groupProviderStartCriticalPath,
              'automationGroupAndOperationScopeDoneAtMonotonicMs',
            )
          : scopedProviderStartCriticalPath
      return await processAssistantAutoReplyGroup({
        allowSelfAuthored: input.allowSelfAuthored ?? false,
        ...(input.beforeProviderAcceptedInputs
          ? { beforeProviderAcceptedInputs: input.beforeProviderAcceptedInputs }
          : {}),
        ...(providerStartAtGroupAndOperationScopeDone
          ? {
              providerStartCriticalPath:
                providerStartAtGroupAndOperationScopeDone,
            }
          : {}),
        context,
        deliveryDispatchMode: input.deliveryDispatchMode,
        enabledChannels: replyChannels,
        executionContext,
        inboxServices: input.inboxServices,
        onEarlySessionOnboardingReplyAccepted:
          input.onEarlySessionOnboardingReplyAccepted ?? null,
        onEvent: input.onEvent,
        onProviderEvent: input.onProviderEvent ?? null,
        onProviderRequestStarted:
          providerStartCriticalPath || input.onProviderRequestStarted
            ? onProviderRequestStarted
            : null,
        onTerminalNonReplyCommitted: input.onTerminalNonReplyCommitted ?? null,
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
    }
    const replyResult = input.operationScope && input.executionContext
      ? await input.operationScope.runAutoReplyGroup({
          executionContext: input.executionContext,
          inputIds: context.inputIds,
          operation: processGroup,
          providerStartCriticalPath: groupProviderStartCriticalPath,
          turnEnvironment: input.turnEnvironment ?? null,
        })
      : await processGroup(
          input.executionContext,
          input.turnEnvironment ?? null,
          stampAssistantProviderStartCriticalPath(
            groupProviderStartCriticalPath,
            'automationGroupAndOperationScopeDoneAtMonotonicMs',
          ),
        )
    automationLaneSubdivisionEligible = false
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
    signal: input.signal,
    vault: input.vault,
  })
  return candidates.length > 0
}

async function listAssistantReplyCandidates(input: {
  autoReply: AssistantAutomationScanStateProgress['autoReply']
  inputSource: AssistantInputSource
  limit: number
  onTerminalNonReplyCommitted?: AssistantAutoReplyTerminalNonReplyHook | null
  signal?: AbortSignal
  vault: string
}): Promise<AssistantAutomationCandidate[]> {
  if (input.autoReply.length === 0) {
    return []
  }

  const terminalEvidenceCache = new Map<
    string,
    ReturnType<typeof readCompleteAssistantAutoReplyTerminalEvidence>
  >()
  const readCompleteTerminalEvidence = (candidate: AssistantInputCandidate) => {
    const evidenceId = `${candidate.event.inputId}\u0000${candidate.projection.captureId ?? ''}`
    let cached = terminalEvidenceCache.get(evidenceId)
    if (!cached) {
      cached = readCompleteAssistantAutoReplyTerminalEvidence({
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
          const terminalEvidence = await readCompleteTerminalEvidence(candidate)
          if (terminalEvidence) {
            if (terminalEvidence.terminal.kind === 'suppressed') {
              emitAssistantAutoReplyTerminalNonReplyBestEffort({
                event: {
                  inputIds: [candidate.event.inputId],
                  recordedAt: terminalEvidence.recordedAt,
                  source: candidate.event.source,
                },
                hook: input.onTerminalNonReplyCommitted,
              })
            }
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

  const flattenedCandidates = candidates.flat()
  return (input.inputSource.preserveInputCandidateOrder === true
    ? flattenedCandidates
    : flattenedCandidates.sort((left, right) =>
        compareAssistantInputCursors(
          left.inputCandidate.event.cursor,
          right.inputCandidate.event.cursor,
        )))
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
