import type {
  AssistantAutomationCursor,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantUserMessageContentPart } from '../model-harness.js'
import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import {
  conversationCaptureRefFromCapture,
  isSameAssistantConversationCapture,
  type AssistantConversationCaptureRef,
} from './conversation-ref.js'
import { cursorFromCapture } from './automation/shared.js'

const DEFAULT_TURN_INPUT_QUERY_LIMIT = 100

type AssistantInboxCaptureSummary = InboxListResult['items'][number]

export type AssistantTurnInputRefreshPhase =
  | 'before_provider'
  | 'after_tool_result'
  | 'after_provider'
  | 'commit_barrier'

export interface AssistantTurnInputRefreshInput {
  phase: AssistantTurnInputRefreshPhase
  signal?: AbortSignal
}

export interface AssistantTurnInputRefreshResult {
  progressed: boolean
  reason:
    | 'no_port'
    | 'no_new_input'
    | 'ingested_input'
    | 'source_unavailable'
}

export interface AssistantTurnConversationCaptureQuery {
  afterCursor: AssistantAutomationCursor
  conversation: AssistantConversationCaptureRef
  knownCaptureIds?: readonly string[]
  limit?: number
  signal?: AbortSignal
}

export interface AssistantTurnConversationCaptureBatch {
  captures: AssistantInboxCaptureSummary[]
  nextCursor: AssistantAutomationCursor
}

export interface AssistantTurnInputPort {
  checkpointAcceptedInput?(
    input: AssistantActiveTurnInputCheckpointInput,
  ): Promise<void>
  refresh(
    input: AssistantTurnInputRefreshInput,
  ): Promise<AssistantTurnInputRefreshResult>
  listNewConversationCaptures(
    input: AssistantTurnConversationCaptureQuery,
  ): Promise<AssistantTurnConversationCaptureBatch>
}

export interface AssistantActiveTurnInputAdmissionBaseInput {
  response: string
  sessionId: string
  turnId: string
  vault: string
}

export interface AssistantActiveTurnInputAdmissionInput
  extends AssistantActiveTurnInputAdmissionBaseInput {
  phase: 'request_boundary' | 'commit_barrier'
  providerRequestOrdinal: number
}

export type AssistantActiveTurnInputAdmissionResult =
  | {
      kind: 'no-new-input'
    }
  | {
      acceptedInputs?: readonly AssistantAcceptedTurnInputItemInput[] | null
      deliveryReplyToMessageId?: string | null
      prompt: string
      receiptMetadata?: Record<string, string> | null
      transcriptText?: string | null
      userMessageContent?: AssistantUserMessageContentPart[] | null
      kind: 'accepted'
    }

export type AssistantActiveTurnInputAdmissionHook = (
  input: AssistantActiveTurnInputAdmissionInput,
) => Promise<AssistantActiveTurnInputAdmissionResult>

export interface AssistantActiveTurnInputCheckpointInput {
  acceptedInputIds: readonly string[]
  providerRequestOrdinal: number
  sessionId: string
  signal?: AbortSignal
  turnId: string
  vault: string
}

export type AssistantActiveTurnInputCheckpointHook = (
  input: AssistantActiveTurnInputCheckpointInput,
) => Promise<void>

export class AssistantActiveTurnInputBudgetExceededError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Active turn input kept arriving during the turn; retry the expanded turn later.',
    )
    this.name = 'AssistantActiveTurnInputBudgetExceededError'
  }
}

export class AssistantActiveTurnInputUnavailableError extends
  AssistantActiveTurnInputBudgetExceededError {
  constructor(message?: string) {
    super(
      message ??
        'Active turn input source is temporarily unavailable; retry the turn later.',
    )
    this.name = 'AssistantActiveTurnInputUnavailableError'
  }
}

export class AssistantActiveTurnInputCheckpointRejectedError extends
  AssistantActiveTurnInputUnavailableError {
  constructor(message?: string) {
    super(
      message ??
        'Active turn input checkpoint was rejected; retry from the last durable checkpoint.',
    )
    this.name = 'AssistantActiveTurnInputCheckpointRejectedError'
  }
}

export function isAssistantActiveTurnInputBudgetExceededError(
  value: unknown,
): value is AssistantActiveTurnInputBudgetExceededError {
  return (
    value instanceof AssistantActiveTurnInputBudgetExceededError ||
    (value instanceof Error &&
      value.name === 'AssistantActiveTurnInputBudgetExceededError')
  )
}

export function isAssistantActiveTurnInputUnavailableError(
  value: unknown,
): value is AssistantActiveTurnInputUnavailableError {
  return (
    value instanceof AssistantActiveTurnInputUnavailableError ||
    (value instanceof Error &&
      value.name === 'AssistantActiveTurnInputUnavailableError')
  )
}

export function isAssistantActiveTurnInputCheckpointRejectedError(
  value: unknown,
): value is AssistantActiveTurnInputCheckpointRejectedError {
  return (
    value instanceof AssistantActiveTurnInputCheckpointRejectedError ||
    (value instanceof Error &&
      value.name === 'AssistantActiveTurnInputCheckpointRejectedError')
  )
}

export function createNoopAssistantTurnInputPort(): AssistantTurnInputPort {
  return {
    async refresh() {
      return {
        progressed: false,
        reason: 'no_port',
      }
    },
    async listNewConversationCaptures(input) {
      return {
        captures: [],
        nextCursor: input.afterCursor,
      }
    },
  }
}

export function createInboxBackedAssistantTurnInputPort(input: {
  inboxServices: InboxServices
  requestId?: string | null
  vault: string
}): AssistantTurnInputPort {
  return {
    async refresh() {
      return {
        progressed: false,
        reason: 'no_new_input',
      }
    },
    async listNewConversationCaptures(query) {
      const knownCaptureIds = new Set(query.knownCaptureIds ?? [])
      const captureLimit = normalizeTurnInputQueryLimit(query.limit)
      const fetchLimit = normalizeTurnInputFetchLimit(query.limit)
      const captures: AssistantInboxCaptureSummary[] = []
      let cursor = query.afterCursor

      while (captures.length < captureLimit) {
        const listed = await input.inboxServices.list({
          vault: input.vault,
          requestId: input.requestId ?? null,
          limit: fetchLimit,
          sourceId: null,
          afterCreatedAt: cursor.createdAt ?? null,
          afterOccurredAt: cursor.occurredAt,
          afterCaptureId: cursor.captureId,
          oldestFirst: true,
        })
        const listedItems = [...listed.items].sort(compareAssistantTurnInputCaptureOrder)
        if (listedItems.length === 0) {
          break
        }

        captures.push(
          ...listedItems
            .filter((capture) => !knownCaptureIds.has(capture.captureId))
            .filter((capture) =>
              isSameAssistantConversationCapture(
                conversationCaptureRefFromCapture(capture),
                query.conversation,
              ),
            ),
        )

        const lastListed = listedItems[listedItems.length - 1]
        cursor = lastListed ? cursorFromCapture(lastListed) : cursor
        if (listedItems.length < fetchLimit) {
          break
        }
      }

      const matchingCaptures = captures.slice(0, captureLimit)
      const nextCursor = matchingCaptures[0]
        ? cursorFromCapture(matchingCaptures[matchingCaptures.length - 1]!)
        : query.afterCursor

      return {
        captures: matchingCaptures,
        nextCursor,
      }
    },
  }
}

function normalizeTurnInputQueryLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_TURN_INPUT_QUERY_LIMIT
  }

  return Math.max(1, Math.trunc(limit))
}

function normalizeTurnInputFetchLimit(limit?: number): number {
  return Math.max(
    DEFAULT_TURN_INPUT_QUERY_LIMIT,
    normalizeTurnInputQueryLimit(limit),
  )
}

function compareAssistantTurnInputCaptureOrder(
  left: AssistantInboxCaptureSummary,
  right: AssistantInboxCaptureSummary,
): number {
  const leftCursor = cursorFromCapture(left)
  const rightCursor = cursorFromCapture(right)
  const leftTimestamp =
    leftCursor.createdAt && rightCursor.createdAt
      ? leftCursor.createdAt
      : leftCursor.occurredAt
  const rightTimestamp =
    leftCursor.createdAt && rightCursor.createdAt
      ? rightCursor.createdAt
      : rightCursor.occurredAt

  return leftTimestamp === rightTimestamp
    ? leftCursor.captureId.localeCompare(rightCursor.captureId)
    : leftTimestamp.localeCompare(rightTimestamp)
}
