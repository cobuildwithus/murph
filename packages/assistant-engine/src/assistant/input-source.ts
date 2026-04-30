import type { InboxServices } from '@murphai/inbox-services'
import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import {
  conversationCaptureRefFromCapture,
  isSameAssistantConversationCapture,
  type AssistantConversationCaptureRef,
} from './conversation-ref.js'
import type { AssistantUserMessageContentPart } from './content-types.js'
import {
  type AssistantActiveTurnInputCheckpointInput,
  type AssistantTurnInputRefreshInput,
  type AssistantTurnInputRefreshResult,
} from './turn-input.js'

const DEFAULT_ASSISTANT_INPUT_QUERY_LIMIT = 100
const INBOX_ASSISTANT_INPUT_ID_PREFIX = 'inbox:'

type AssistantInboxCaptureSummary = InboxListResult['items'][number]

export type AssistantInputConversationRef = AssistantConversationCaptureRef

export type AssistantInputProjectionStatus =
  | 'not_attempted'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'quarantined'

export interface AssistantInputCursor {
  createdAt: string | null
  inputId: string
  sourceKind: AssistantInputSourceRef['kind']
  sourcePosition?: string | null
  occurredAt: string
}

export type AssistantInputSourceRef =
  | {
      captureId: string
      kind: 'inbox-capture'
      source: string
      version: string | null
    }
  | {
      dedupeKey: string | null
      eventId: string
      itemId: string
      kind: 'hosted-mailbox-item'
      lane: 'conversation' | 'system'
      laneSeq: string
      payloadSchema: string
      payloadSource: 'inline' | 'sidecar'
      source: 'hosted-mailbox'
      wakeSchema: string
    }

export interface AssistantInputProjection {
  captureId: string | null
  reasonCode: string | null
  status: AssistantInputProjectionStatus
}

export interface AssistantInputEvent {
  attachmentCount: number
  conversation: AssistantInputConversationRef | null
  cursor: AssistantInputCursor
  inputId: string
  occurredAt: string
  receivedAt: string | null
  source: string
  sourceRef: AssistantInputSourceRef
  userMessageContent: readonly AssistantUserMessageContentPart[] | null
}

export interface AssistantInputCandidate {
  acceptedInput: AssistantAcceptedTurnInputItemInput
  event: AssistantInputEvent
  projection: AssistantInputProjection
}

export interface AssistantInputCandidateQuery {
  afterCursor?: AssistantInputCursor | null
  knownInputIds?: readonly string[]
  limit?: number
  signal?: AbortSignal
  sourceId?: string | null
}

export interface AssistantTurnConversationInputQuery {
  afterCursor?: AssistantInputCursor | null
  conversation: AssistantInputConversationRef
  knownCaptureIds?: readonly string[]
  knownInputIds?: readonly string[]
  limit?: number
  signal?: AbortSignal
}

export interface AssistantInputCandidateBatch {
  inputs: AssistantInputCandidate[]
  nextCursor: AssistantInputCursor | null
}

export interface AssistantInputSource {
  checkpointAcceptedInput?(
    input: AssistantActiveTurnInputCheckpointInput,
  ): Promise<void>
  listInputCandidates(
    input: AssistantInputCandidateQuery,
  ): Promise<AssistantInputCandidateBatch>
  listNewConversationInputs(
    input: AssistantTurnConversationInputQuery,
  ): Promise<AssistantInputCandidateBatch>
  refresh(
    input: AssistantTurnInputRefreshInput,
  ): Promise<AssistantTurnInputRefreshResult>
}

export function assistantInputIdFromInboxCaptureId(captureId: string): string {
  return `${INBOX_ASSISTANT_INPUT_ID_PREFIX}${captureId}`
}

export function inboxCaptureIdFromAssistantInputId(
  inputId: string,
): string | null {
  return inputId.startsWith(INBOX_ASSISTANT_INPUT_ID_PREFIX)
    ? inputId.slice(INBOX_ASSISTANT_INPUT_ID_PREFIX.length)
    : null
}

export function createNoopAssistantInputSource(): AssistantInputSource {
  return {
    async refresh() {
      return {
        progressed: false,
        reason: 'no_port',
      }
    },
    async listInputCandidates(input) {
      return {
        inputs: [],
        nextCursor: input.afterCursor ?? null,
      }
    },
    async listNewConversationInputs(input) {
      return {
        inputs: [],
        nextCursor: input.afterCursor ?? null,
      }
    },
  }
}

export function createInboxBackedAssistantInputSource(input: {
  inboxServices: InboxServices
  requestId?: string | null
  vault: string
}): AssistantInputSource {
  return {
    async refresh() {
      return {
        progressed: false,
        reason: 'no_new_input',
      }
    },
    async listInputCandidates(query) {
      return listInboxAssistantInputCandidates({
        afterCursor: query.afterCursor ?? null,
        inboxServices: input.inboxServices,
        knownInputIds: query.knownInputIds,
        limit: query.limit,
        requestId: input.requestId ?? null,
        signal: query.signal,
        sourceId: query.sourceId ?? null,
        vault: input.vault,
      })
    },
    async listNewConversationInputs(query) {
      return listInboxAssistantInputCandidates({
        afterCursor: query.afterCursor ?? null,
        conversation: query.conversation,
        inboxServices: input.inboxServices,
        knownCaptureIds: query.knownCaptureIds,
        knownInputIds: query.knownInputIds,
        limit: query.limit,
        requestId: input.requestId ?? null,
        signal: query.signal,
        sourceId: null,
        vault: input.vault,
      })
    },
  }
}

async function listInboxAssistantInputCandidates(input: {
  afterCursor: AssistantInputCursor | null
  conversation?: AssistantInputConversationRef
  inboxServices: InboxServices
  knownCaptureIds?: readonly string[]
  knownInputIds?: readonly string[]
  limit?: number
  requestId: string | null
  signal?: AbortSignal
  sourceId: string | null
  vault: string
}): Promise<AssistantInputCandidateBatch> {
  const knownInputIds = new Set(input.knownInputIds ?? [])
  const knownCaptureIds = resolveKnownInboxCaptureIds({
    knownCaptureIds: input.knownCaptureIds,
    knownInputIds: input.knownInputIds,
  })
  const candidateLimit = normalizeAssistantInputQueryLimit(input.limit)
  const fetchLimit = normalizeAssistantInputFetchLimit(input.limit)
  const candidates: AssistantInputCandidate[] = []
  let cursor = input.afterCursor
  let lastScannedCursor = input.afterCursor
  const useCreatedAtCursor = Boolean(input.afterCursor?.createdAt)

  while (candidates.length < candidateLimit) {
    assertAssistantInputSignalNotAborted(input.signal)
    const listed = await input.inboxServices.list({
      vault: input.vault,
      requestId: input.requestId,
      limit: fetchLimit,
      sourceId: input.sourceId,
      afterCreatedAt: cursor?.createdAt ?? null,
      afterOccurredAt: cursor?.occurredAt ?? null,
      afterCaptureId: resolveInboxAfterCaptureId(cursor),
      oldestFirst: true,
    })
    assertAssistantInputSignalNotAborted(input.signal)
    const listedItems = [...listed.items].sort((left, right) =>
      compareAssistantInputCaptureOrder(left, right, {
        useCreatedAtCursor,
      }),
    )
    if (listedItems.length === 0) {
      break
    }

    candidates.push(
      ...listedItems
        .filter((capture) => !knownCaptureIds.has(capture.captureId))
        .map((capture) =>
          assistantInputCandidateFromInboxCapture(capture, {
            useCreatedAtCursor,
          }),
        )
        .filter((candidate) => !knownInputIds.has(candidate.event.inputId))
        .filter((candidate) =>
          input.conversation
            ? candidate.event.conversation
              ? isSameAssistantConversationCapture(
                  candidate.event.conversation,
                  input.conversation,
                )
              : false
            : true,
        ),
    )

    const lastListed = listedItems[listedItems.length - 1]
    cursor = lastListed
      ? assistantInputCursorFromInboxCapture(lastListed, {
          useCreatedAtCursor,
        })
      : cursor
    lastScannedCursor = cursor
    if (listedItems.length < fetchLimit) {
      break
    }
  }

  const matchingCandidates = candidates.slice(0, candidateLimit)
  const nextCursor =
    candidates.length > candidateLimit
      ? matchingCandidates[matchingCandidates.length - 1]!.event.cursor
      : lastScannedCursor

  return {
    inputs: matchingCandidates,
    nextCursor,
  }
}

export function assistantInputCandidateFromInboxCapture(
  capture: AssistantInboxCaptureSummary,
  input: {
    useCreatedAtCursor?: boolean
  } = {},
): AssistantInputCandidate {
  const inputId = assistantInputIdFromInboxCaptureId(capture.captureId)
  return {
    acceptedInput: {
      id: inputId,
      source: 'inbox',
      captureIds: [capture.captureId],
      contentRef: {
        kind: 'inbox-capture',
        refId: capture.captureId,
        version: null,
      },
      cursorEffects: [],
    },
    event: {
      attachmentCount: capture.attachmentCount,
      conversation: conversationCaptureRefFromCapture(capture),
      cursor: assistantInputCursorFromInboxCapture(capture, {
        useCreatedAtCursor: input.useCreatedAtCursor ?? true,
      }),
      inputId,
      occurredAt: capture.occurredAt,
      receivedAt: capture.receivedAt,
      source: capture.source,
      sourceRef: {
        captureId: capture.captureId,
        kind: 'inbox-capture',
        source: capture.source,
        version: null,
      },
      userMessageContent: null,
    },
    projection: {
      captureId: capture.captureId,
      reasonCode: null,
      status: 'succeeded',
    },
  }
}

function assistantInputCursorFromInboxCapture(
  capture: AssistantInboxCaptureSummary,
  input: {
    useCreatedAtCursor: boolean
  },
): AssistantInputCursor {
  return {
    createdAt: input.useCreatedAtCursor ? capture.createdAt ?? null : null,
    inputId: assistantInputIdFromInboxCaptureId(capture.captureId),
    sourceKind: 'inbox-capture',
    occurredAt: capture.occurredAt,
  }
}

function resolveKnownInboxCaptureIds(input: {
  knownCaptureIds?: readonly string[]
  knownInputIds?: readonly string[]
}): Set<string> {
  const knownCaptureIds = new Set(input.knownCaptureIds ?? [])
  for (const inputId of input.knownInputIds ?? []) {
    const captureId = inboxCaptureIdFromAssistantInputId(inputId)
    if (captureId) {
      knownCaptureIds.add(captureId)
    }
  }
  return knownCaptureIds
}

function resolveInboxAfterCaptureId(
  cursor: AssistantInputCursor | null,
): string | null {
  if (!cursor) {
    return null
  }
  if (cursor.sourceKind !== 'inbox-capture') {
    return null
  }
  return inboxCaptureIdFromAssistantInputId(cursor.inputId) ?? cursor.inputId
}

function normalizeAssistantInputQueryLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_ASSISTANT_INPUT_QUERY_LIMIT
  }

  return Math.max(1, Math.trunc(limit))
}

function normalizeAssistantInputFetchLimit(limit?: number): number {
  return Math.max(
    DEFAULT_ASSISTANT_INPUT_QUERY_LIMIT,
    normalizeAssistantInputQueryLimit(limit),
  )
}

function assertAssistantInputSignalNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Assistant input query was aborted.')
}

function compareAssistantInputCaptureOrder(
  left: AssistantInboxCaptureSummary,
  right: AssistantInboxCaptureSummary,
  input: {
    useCreatedAtCursor: boolean
  },
): number {
  const leftTimestamp =
    input.useCreatedAtCursor && left.createdAt && right.createdAt
      ? left.createdAt
      : left.occurredAt
  const rightTimestamp =
    input.useCreatedAtCursor && left.createdAt && right.createdAt
      ? right.createdAt
      : right.occurredAt

  return leftTimestamp === rightTimestamp
    ? left.captureId.localeCompare(right.captureId)
    : leftTimestamp.localeCompare(rightTimestamp)
}
