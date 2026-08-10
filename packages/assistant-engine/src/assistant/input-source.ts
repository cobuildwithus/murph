import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import type {
  HostedGroupRunningBitProjection,
} from '@murphai/hosted-execution/runtime-control'
import {
  readHostedMailboxAssistantInputItemDetails,
} from './hosted-mailbox-input-items.js'
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
  groupParticipantAdded?: true
  groupReactionContext?: string
  groupRunningBit?: HostedGroupRunningBitProjection
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
  usageRunningLow?: true
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

export interface AssistantInputCandidateByIdQuery
  extends AssistantInputCandidateQuery {
  inputIds: readonly string[]
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
  listInputCandidatesByIds?(
    input: AssistantInputCandidateByIdQuery,
  ): Promise<AssistantInputCandidateBatch>
  listNewConversationInputs(
    input: AssistantTurnConversationInputQuery,
  ): Promise<AssistantInputCandidateBatch>
  // Exact admission sources may intentionally put a trusted system completion
  // before a newer conversation input. Generic sources remain cursor ordered.
  preserveInputCandidateOrder?: boolean
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
      signal: input.signal,
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

  const hostedMailboxItems = await readHostedMailboxAssistantInputItemDetails({
    inputIds: selected.map((event) => event.inputId),
    signal: input.signal,
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
        ...(hostedMailboxItem?.groupReactionContext
          ? { groupReactionContext: hostedMailboxItem.groupReactionContext }
          : {}),
        ...(hostedMailboxItem?.groupRunningBit
          ? { groupRunningBit: hostedMailboxItem.groupRunningBit }
          : {}),
        hostedMailboxItemId: hostedMailboxItem?.mailboxItemId ?? null,
        ...(hostedMailboxItem?.usageRunningLow === true
          ? { usageRunningLow: true as const }
          : {}),
      })
    }),
    nextCursor,
  }
}

export function assistantInputCandidateFromStoredEvent(
  event: AssistantInputEventRecord,
  input?: {
    groupParticipantAdded?: true
    groupReactionContext?: string
    groupRunningBit?: HostedGroupRunningBitProjection
    hostedMailboxItemId?: string | null
    usageRunningLow?: true
  },
): AssistantInputCandidate {
  return assistantInputCandidateFromStoredEventWithHostedMailboxItem({
    event,
    ...(input?.groupParticipantAdded === true
      ? { groupParticipantAdded: input.groupParticipantAdded }
      : {}),
    ...(input?.groupReactionContext
      ? { groupReactionContext: input.groupReactionContext }
      : {}),
    ...(input?.groupRunningBit
      ? { groupRunningBit: input.groupRunningBit }
      : {}),
    hostedMailboxItemId: input?.hostedMailboxItemId ?? null,
    ...(input?.usageRunningLow === true
      ? { usageRunningLow: true as const }
      : {}),
  })
}

function assistantInputCandidateFromStoredEventWithHostedMailboxItem(input: {
  event: AssistantInputEventRecord
  groupParticipantAdded?: true
  groupReactionContext?: string
  groupRunningBit?: HostedGroupRunningBitProjection
  hostedMailboxItemId: string | null
  usageRunningLow?: true
}): AssistantInputCandidate {
  const event = input.event
  const captureIds = event.projection.captureId ? [event.projection.captureId] : []
  const groupParticipantAdded = input.groupParticipantAdded === true &&
    event.sourceMetadata?.kind === 'linq' &&
    event.sourceMetadata.externalThreadRouteAuthorityPresent === true &&
    event.conversation?.threadIsDirect === false
  const groupReactionContext =
    input.groupReactionContext &&
    event.sourceMetadata?.kind === 'linq' &&
    event.sourceMetadata.externalThreadRouteAuthorityPresent === true &&
    event.conversation?.threadIsDirect === false
      ? input.groupReactionContext
      : null
  const groupRunningBit =
    input.groupRunningBit &&
    (
      event.sourceMetadata?.kind === 'linq' ||
      event.sourceMetadata?.kind === 'telegram'
    ) &&
    event.sourceMetadata.externalThreadRouteAuthorityPresent === true &&
    event.conversation?.threadIsDirect === false
      ? input.groupRunningBit
      : null
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
      ...(groupReactionContext ? { groupReactionContext } : {}),
      ...(groupRunningBit ? { groupRunningBit } : {}),
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
      ...(input.usageRunningLow === true
        ? { usageRunningLow: true as const }
        : {}),
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
