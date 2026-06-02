import type { AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import {
  assistantInputIdFromInboxCaptureId,
  type AssistantInputCandidate,
  type AssistantInputSource,
} from '../input-source.js'
import { compareAssistantInputCursors } from '../input-store.js'
import { sameAssistantAutoReplyState } from '../automation-state.js'
import { collectAssistantAutoReplyGroup } from './grouping.js'
import {
  assistantAutomationInputSummaryFromCandidate,
  type AssistantAutomationInputSummary,
} from './input-summary.js'
import {
  readAssistantAutoReplyTerminalEvidenceByEvidenceId,
  type AssistantAutoReplyTerminalEvidence,
} from './evidence.js'
import {
  applyAssistantAutoReplyProcessResult,
  createAssistantAutoReplyGroupContext,
  createAssistantAutoReplyReceiptReader,
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
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onProviderRequestStarted?: AssistantAutoReplyProviderRequestStartHook | null
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
  inputSource: AssistantInputSource
  vault: string
  vaultServices?: VaultServices
}): Promise<AssistantAutomationScanResult> {
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
      currentTurnDeliveryIntentIds,
      replies,
      routing,
    }
  }

  const candidates = await listAssistantReplyCandidates({
    autoReply: applyCanonicalWrites ? scanState.autoReply : [],
    inputSource: input.inputSource,
    limit: normalizeScanLimit(input.maxPerScan),
    requestId: input.requestId ?? null,
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

  const receiptReader = createAssistantAutoReplyReceiptReader({
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
    const replyResult = await processAssistantAutoReplyGroup({
      allowSelfAuthored: input.allowSelfAuthored ?? false,
      context,
      deliveryDispatchMode: input.deliveryDispatchMode,
      enabledChannels: replyChannels,
      executionContext: input.executionContext,
      inboxServices: input.inboxServices,
      onEvent: input.onEvent,
      onProviderRequestStarted: input.onProviderRequestStarted ?? null,
      onTraceEvent: input.onTraceEvent,
      providerHeartbeatMs: input.providerHeartbeatMs,
      providerLongRunningCommandStallTimeoutMs:
        input.providerLongRunningCommandStallTimeoutMs,
      providerStallTimeoutMs: input.providerStallTimeoutMs,
      receiptReader,
      requestId: input.requestId ?? null,
      signal: input.signal,
      sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
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
      advanceAssistantAutoReplyChannelCursor({
        autoReply: scanState.autoReply,
        channel: context.firstItem.summary.source,
        cursor: replyResult.lastInputCursor ?? context.lastInputCursor,
      })
    }

    await persistScanState()

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
      cached = readAssistantAutoReplyTerminalEvidenceByEvidenceId(input.vault, evidenceId)
        .then((evidence) =>
          evidence ??
          (candidate.projection.captureId
            ? readAssistantAutoReplyTerminalEvidenceByEvidenceId(
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
        readAssistantAutoReplyTerminalEvidenceByEvidenceId(input.vault, inputId),
      ),
    )
    return groupEvidence.every((item) => item !== null)
  }

  const candidates = await Promise.all(
    input.autoReply.map(async (channelState) => {
      const channelCandidates: AssistantAutomationCandidate[] = []
      let cursor = channelState.eligibleAfter

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
