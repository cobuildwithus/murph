import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import {
  readHostedMailboxAssistantInputItemDetails,
} from './hosted-mailbox-input-items.js'
import {
  listAssistantInputEvents,
  isAssistantInputEventOnDeliveryRoute,
  type AssistantInputAttachmentEvidence,
  type AssistantInputAttachmentDescriptor,
  type AssistantInputConversationRef,
  type AssistantInputCursor,
  type AssistantInputDeliveryRoute,
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
  AssistantInputDeliveryRoute,
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
  groupParticipantAdded?: true
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
  actionableLimit?: number
  afterCursor?: AssistantInputCursor | null
  deliveryRoute?: AssistantInputDeliveryRoute | null
  knownInputIds?: readonly string[]
  knownProjectionCaptureIds?: readonly string[]
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
        actionableLimit: query.actionableLimit,
        afterCursor: query.afterCursor ?? null,
        deliveryRoute: query.deliveryRoute ?? null,
        knownProjectionCaptureIds: query.knownProjectionCaptureIds,
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
  actionableLimit?: number
  afterCursor: AssistantInputCursor | null
  conversation?: AssistantInputConversationRef
  deliveryRoute?: AssistantInputDeliveryRoute | null
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
  const listed = await listAssistantInputEvents({
    actionableLimit: input.actionableLimit,
    afterCursor: input.afterCursor,
    conversation: input.conversation,
    deliveryRoute: input.deliveryRoute,
    excludeInputIds: [...knownInputIds],
    excludeProjectionCaptureIds: [...knownProjectionCaptureIds],
    limit: candidateLimit,
    signal: input.signal,
    source: input.sourceId,
    vault: input.vault,
  })
  assertAssistantInputSignalNotAborted(input.signal)
  const selected = listed.events

  const hostedMailboxItems = await readHostedMailboxAssistantInputItemDetails({
    inputIds: selected.map((event) => event.inputId),
    vault: input.vault,
  })

  return {
    inputs: selected.map((event) => {
      const hostedMailboxItem = hostedMailboxItems.get(event.inputId)
      return assistantInputCandidateFromStoredEventWithHostedMailboxItem({
        event,
        ...(hostedMailboxItem?.groupParticipantAdded === true
          ? { groupParticipantAdded: hostedMailboxItem.groupParticipantAdded }
          : {}),
        hostedMailboxItemId: hostedMailboxItem?.mailboxItemId ?? null,
      })
    }),
    nextCursor: listed.nextCursor,
  }
}

export function assistantInputCandidateMatchesDeliveryRoute(input: {
  candidate: AssistantInputCandidate
  deliveryRoute: AssistantInputDeliveryRoute
}): boolean {
  return isAssistantInputEventOnDeliveryRoute(
    input.candidate.event,
    input.deliveryRoute,
  )
}

export function assistantInputCandidateFromStoredEvent(
  event: AssistantInputEventRecord,
  input?: {
    groupParticipantAdded?: true
    hostedMailboxItemId?: string | null
  },
): AssistantInputCandidate {
  return assistantInputCandidateFromStoredEventWithHostedMailboxItem({
    event,
    ...(input?.groupParticipantAdded === true
      ? { groupParticipantAdded: input.groupParticipantAdded }
      : {}),
    hostedMailboxItemId: input?.hostedMailboxItemId ?? null,
  })
}

function assistantInputCandidateFromStoredEventWithHostedMailboxItem(input: {
  event: AssistantInputEventRecord
  groupParticipantAdded?: true
  hostedMailboxItemId: string | null
}): AssistantInputCandidate {
  const event = input.event
  const captureIds = event.projection.captureId ? [event.projection.captureId] : []
  const groupParticipantAdded = input.groupParticipantAdded === true &&
    event.sourceMetadata?.kind === 'linq' &&
    event.sourceMetadata.externalThreadRouteAuthorityPresent === true &&
    event.conversation?.threadIsDirect === false
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
      ...(groupParticipantAdded
        ? { groupParticipantAdded: true }
        : {}),
      hostedMailboxItemId: input.hostedMailboxItemId,
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
