import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import {
  listAssistantInputEvents,
  type AssistantInputAttachmentEvidence,
  type AssistantInputAttachmentDescriptor,
  type AssistantInputConversationRef,
  type AssistantInputCursor,
  type AssistantInputEventRecord,
  type AssistantInputProjectionStatus,
  type AssistantInputSourceMetadata,
  type AssistantInputSourceRef,
} from './input-store.js'
import type { AssistantUserMessageContentPart } from './content-types.js'
import {
  type AssistantActiveTurnInputCheckpointInput,
  type AssistantTurnInputRefreshInput,
  type AssistantTurnInputRefreshResult,
} from './turn-input.js'

const DEFAULT_ASSISTANT_INPUT_QUERY_LIMIT = 100
const INBOX_ASSISTANT_INPUT_ID_PREFIX = 'inbox:'

export type {
  AssistantInputConversationRef,
  AssistantInputCursor,
  AssistantInputProjectionStatus,
  AssistantInputSourceRef,
}

export interface AssistantInputProjection {
  captureId: string | null
  reasonCode: string | null
  status: AssistantInputProjectionStatus
}

export interface AssistantInputEvent {
  attachmentCount: number
  attachmentEvidence: AssistantInputAttachmentEvidence
  attachmentDescriptors: readonly AssistantInputAttachmentDescriptor[]
  conversation: AssistantInputConversationRef | null
  cursor: AssistantInputCursor
  hostedMailboxItemId?: string | null
  inputId: string
  occurredAt: string
  receivedAt: string | null
  replyTarget: AssistantInputEventRecord['replyTarget']
  source: string
  sourceMetadata: AssistantInputSourceMetadata
  sourceRef: AssistantInputSourceRef
  text: string | null
  transcriptText: string | null
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
  knownProjectionCaptureIds?: readonly string[]
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
    input?: AssistantTurnInputRefreshInput,
  ): Promise<AssistantTurnInputRefreshResult>
}

export function assistantInputIdFromInboxCaptureId(captureId: string): string {
  return `${INBOX_ASSISTANT_INPUT_ID_PREFIX}${captureId}`
}

export function createStoreBackedAssistantInputSource(input: {
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
      return listStoredAssistantInputCandidates({
        afterCursor: query.afterCursor ?? null,
        knownInputIds: query.knownInputIds,
        limit: query.limit,
        signal: query.signal,
        sourceId: query.sourceId ?? null,
        vault: input.vault,
      })
    },
    async listNewConversationInputs(query) {
      return listStoredAssistantInputCandidates({
        afterCursor: query.afterCursor ?? null,
        conversation: query.conversation,
        knownProjectionCaptureIds: query.knownProjectionCaptureIds,
        knownInputIds: query.knownInputIds,
        limit: query.limit,
        signal: query.signal,
        sourceId: null,
        vault: input.vault,
      })
    },
  }
}

async function listStoredAssistantInputCandidates(input: {
  afterCursor: AssistantInputCursor | null
  conversation?: AssistantInputConversationRef
  knownProjectionCaptureIds?: readonly string[]
  knownInputIds?: readonly string[]
  limit?: number
  signal?: AbortSignal
  sourceId: string | null
  vault: string
}): Promise<AssistantInputCandidateBatch> {
  assertAssistantInputSignalNotAborted(input.signal)
  const knownInputIds = new Set(input.knownInputIds ?? [])
  const knownProjectionCaptureIds = new Set(input.knownProjectionCaptureIds ?? [])
  const candidateLimit = normalizeAssistantInputQueryLimit(input.limit)
  const scanLimit = Math.max(candidateLimit, DEFAULT_ASSISTANT_INPUT_QUERY_LIMIT)
  const selected: AssistantInputEventRecord[] = []
  let cursor = input.afterCursor
  let nextCursor = input.afterCursor

  while (selected.length < candidateLimit) {
    const listed = await listAssistantInputEvents({
      afterCursor: cursor,
      conversation: input.conversation,
      limit: scanLimit,
      source: null,
      vault: input.vault,
    })
    assertAssistantInputSignalNotAborted(input.signal)
    if (listed.events.length === 0) {
      nextCursor = listed.nextCursor
      break
    }

    for (const event of listed.events
        .filter((candidate) => !knownInputIds.has(candidate.inputId))
        .filter((event) =>
          event.projection.captureId
            ? !knownProjectionCaptureIds.has(event.projection.captureId)
            : true,
        )
        .filter((event) =>
          input.sourceId
            ? (event.conversation?.source ?? event.sourceRef.source) === input.sourceId
            : true,
        )) {
      selected.push(event)
      if (selected.length >= candidateLimit) {
        nextCursor = event.cursor
        break
      }
    }
    cursor = listed.nextCursor
    if (selected.length < candidateLimit) {
      nextCursor = listed.nextCursor
    }
    if (!cursor || listed.events.length < scanLimit) {
      break
    }
  }

  return {
    inputs: selected.map(assistantInputCandidateFromStoredEvent),
    nextCursor,
  }
}

export function assistantInputCandidateFromStoredEvent(
  event: AssistantInputEventRecord,
): AssistantInputCandidate {
  const captureIds = event.projection.captureId ? [event.projection.captureId] : []
  return {
    acceptedInput: {
      id: event.inputId,
      source: 'assistant-input',
      captureIds,
      contentRef: {
        kind: 'assistant-input-event',
        refId: event.inputId,
        version: event.schema,
      },
    },
    event: {
      attachmentCount: event.content.attachmentDescriptors.length,
      attachmentEvidence: event.attachmentEvidence,
      attachmentDescriptors: event.content.attachmentDescriptors,
      conversation: event.conversation,
      cursor: event.cursor,
      hostedMailboxItemId: event.hostedMailboxItemId ?? null,
      inputId: event.inputId,
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
      replyTarget: event.replyTarget,
      source: event.conversation?.source ?? event.sourceRef.source,
      sourceMetadata: event.sourceMetadata,
      sourceRef: event.sourceRef,
      text: event.content.text,
      transcriptText: event.content.transcriptText ?? event.content.text,
      userMessageContent: event.content.userMessageContent,
    },
    projection: {
      captureId: event.projection.captureId,
      reasonCode: event.projection.reasonCode,
      status: event.projection.status,
    },
  }
}

function normalizeAssistantInputQueryLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_ASSISTANT_INPUT_QUERY_LIMIT
  }

  return Math.max(1, Math.trunc(limit))
}

function assertAssistantInputSignalNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Assistant input query was aborted.')
}
