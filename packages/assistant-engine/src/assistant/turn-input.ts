import type {
  AssistantAutomationCursor,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import type { AssistantUserMessageContentPart } from '../model-harness.js'
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
  | 'before_delivery'

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
  refresh(
    input: AssistantTurnInputRefreshInput,
  ): Promise<AssistantTurnInputRefreshResult>
  listNewConversationCaptures(
    input: AssistantTurnConversationCaptureQuery,
  ): Promise<AssistantTurnConversationCaptureBatch>
}

export interface AssistantTurnBeforeDeliveryInput {
  response: string
  sessionId: string
  turnId: string
  vault: string
}

export type AssistantTurnBeforeDeliveryHook = (
  input: AssistantTurnBeforeDeliveryInput,
) => Promise<void>

export interface AssistantActiveTurnInputAdmissionInput
  extends AssistantTurnBeforeDeliveryInput {
  providerRequestOrdinal: number
}

export type AssistantActiveTurnInputAdmissionResult =
  | {
      kind: 'no-new-input'
    }
  | {
      deliveryReplyToMessageId?: string | null
      prompt: string
      receiptMetadata?: Record<string, string> | null
      userMessageContent?: AssistantUserMessageContentPart[] | null
      kind: 'accepted'
    }

export type AssistantActiveTurnInputAdmissionHook = (
  input: AssistantActiveTurnInputAdmissionInput,
) => Promise<AssistantActiveTurnInputAdmissionResult>

export class AssistantTurnRevisionRequiredError extends Error {
  readonly captures: readonly AssistantInboxCaptureSummary[]
  readonly nextCursor: AssistantAutomationCursor

  constructor(input: {
    captures: readonly AssistantInboxCaptureSummary[]
    message?: string
    nextCursor: AssistantAutomationCursor
  }) {
    super(
      input.message ??
        'New same-conversation captures arrived before delivery, so the pending draft must be revised.',
    )
    this.name = 'AssistantTurnRevisionRequiredError'
    this.captures = [...input.captures]
    this.nextCursor = input.nextCursor
  }
}

export class AssistantActiveTurnInputBudgetExceededError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Active turn input kept arriving before delivery; retry the expanded turn later.',
    )
    this.name = 'AssistantActiveTurnInputBudgetExceededError'
  }
}

export function isAssistantTurnRevisionRequiredError(
  value: unknown,
): value is AssistantTurnRevisionRequiredError {
  return value instanceof AssistantTurnRevisionRequiredError
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

export function createAssistantTurnBeforeDeliveryHook(input: {
  afterCursor: AssistantAutomationCursor
  conversation: AssistantConversationCaptureRef
  knownCaptureIds: readonly string[]
  port: AssistantTurnInputPort
}): AssistantTurnBeforeDeliveryHook {
  return async () => {
    await input.port.refresh({
      phase: 'before_delivery',
    })

    const lateCaptures = await input.port.listNewConversationCaptures({
      afterCursor: input.afterCursor,
      conversation: input.conversation,
      knownCaptureIds: input.knownCaptureIds,
    })
    if (lateCaptures.captures.length === 0) {
      return
    }

    throw new AssistantTurnRevisionRequiredError({
      captures: lateCaptures.captures,
      nextCursor: lateCaptures.nextCursor,
    })
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
