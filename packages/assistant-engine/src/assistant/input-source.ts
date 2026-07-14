import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import {
  readHostedMailboxAssistantInputItemDetails,
} from './hosted-mailbox-input-items.js'
import {
  compareAssistantInputCursors,
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

/**
 * Lists the contiguous same-actor prefix for one concrete delivery route.
 *
 * Group-chat cursors are shared by every actor on the route. Implementations
 * must therefore page through unrelated routes, stop before the first input
 * from another actor on this route, and never return a progress cursor beyond
 * that barrier.
 */
export interface AssistantTurnRouteActorInputQuery
  extends AssistantTurnConversationInputQuery {
  deliveryRoute: {
    channel: string
    threadId: string
  }
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
  listNewConversationActorInputs?(
    input: AssistantTurnRouteActorInputQuery,
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
    async listNewConversationActorInputs(query) {
      return listStoredAssistantRouteActorInputs({
        ...query,
        afterCursor: query.afterCursor ?? null,
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

async function listStoredAssistantRouteActorInputs(input: {
  afterCursor: AssistantInputCursor | null
  conversation: AssistantInputConversationRef
  deliveryRoute: AssistantTurnRouteActorInputQuery['deliveryRoute']
  knownProjectionCaptureIds?: readonly string[]
  knownInputIds?: readonly string[]
  limit?: number
  signal?: AbortSignal
  vault: string
}): Promise<AssistantInputCandidateBatch> {
  assertAssistantInputSignalNotAborted(input.signal)
  const knownInputIds = new Set(input.knownInputIds ?? [])
  const knownProjectionCaptureIds = new Set(input.knownProjectionCaptureIds ?? [])
  const candidateLimit = normalizeAssistantInputQueryLimit(input.limit)
  const selected: AssistantInputEventRecord[] = []
  let pageCursor = input.afterCursor
  let progressCursor = input.afterCursor
  let stopped = false

  while (!stopped && selected.length < candidateLimit) {
    const listed = await listAssistantInputEvents({
      afterCursor: pageCursor,
      limit: DEFAULT_ASSISTANT_INPUT_QUERY_LIMIT,
      source: null,
      vault: input.vault,
    })
    assertAssistantInputSignalNotAborted(input.signal)
    if (listed.events.length === 0) {
      break
    }

    for (const event of listed.events) {
      if (!assistantInputEventMatchesDeliveryRoute({
        accountId: input.conversation.accountId,
        conversation: event.conversation,
        deliveryRoute: input.deliveryRoute,
        replyTarget: event.replyTarget,
        source: event.conversation?.source ?? event.sourceRef.source,
        threadIsDirect: input.conversation.threadIsDirect,
      })) {
        continue
      }
      if (!assistantInputEventMatchesConversationActor({
        candidate: event.conversation,
        expected: input.conversation,
      })) {
        stopped = true
        break
      }

      progressCursor = event.cursor
      if (
        knownInputIds.has(event.inputId) ||
        (event.projection.captureId &&
          knownProjectionCaptureIds.has(event.projection.captureId))
      ) {
        continue
      }
      selected.push(event)
      if (selected.length >= candidateLimit) {
        stopped = true
        break
      }
    }

    if (stopped || listed.events.length < DEFAULT_ASSISTANT_INPUT_QUERY_LIMIT) {
      break
    }
    const nextPageCursor = listed.nextCursor
    if (!nextPageCursor) {
      break
    }
    if (
      !pageCursor ||
      compareAssistantInputCursors(nextPageCursor, pageCursor) > 0
    ) {
      pageCursor = nextPageCursor
      continue
    }
    break
  }

  const hostedMailboxItems = await readHostedMailboxAssistantInputItems({
    inputIds: selected.map((event) => event.inputId),
    vault: input.vault,
  })
  return {
    inputs: selected.map((event) =>
      assistantInputCandidateFromStoredEventWithHostedMailboxItem({
        event,
        hostedMailboxItemId: hostedMailboxItems.get(event.inputId) ?? null,
      }),
    ),
    nextCursor: progressCursor,
  }
}

export function selectContiguousAssistantRouteActorInputBatch(input: {
  candidates: readonly AssistantInputCandidate[]
  query: AssistantTurnRouteActorInputQuery
}): AssistantInputCandidateBatch {
  const knownInputIds = new Set(input.query.knownInputIds ?? [])
  const knownProjectionCaptureIds = new Set(
    input.query.knownProjectionCaptureIds ?? [],
  )
  const limit = normalizeAssistantInputQueryLimit(input.query.limit)
  const selected: AssistantInputCandidate[] = []
  let nextCursor = input.query.afterCursor ?? null

  for (const candidate of [...input.candidates].sort((left, right) =>
    compareAssistantInputCursors(left.event.cursor, right.event.cursor),
  )) {
    if (
      input.query.afterCursor &&
      compareAssistantInputCursors(candidate.event.cursor, input.query.afterCursor) <= 0
    ) {
      continue
    }
    if (!assistantInputEventMatchesDeliveryRoute({
      accountId: input.query.conversation.accountId,
      conversation: candidate.event.conversation,
      deliveryRoute: input.query.deliveryRoute,
      replyTarget: candidate.event.replyTarget,
      source: candidate.event.source,
      threadIsDirect: input.query.conversation.threadIsDirect,
    })) {
      continue
    }
    if (!assistantInputEventMatchesConversationActor({
      candidate: candidate.event.conversation,
      expected: input.query.conversation,
    })) {
      break
    }

    nextCursor = candidate.event.cursor
    if (
      knownInputIds.has(candidate.event.inputId) ||
      (candidate.projection.captureId &&
        knownProjectionCaptureIds.has(candidate.projection.captureId))
    ) {
      continue
    }
    selected.push(candidate)
    if (selected.length >= limit) {
      break
    }
  }

  return { inputs: selected, nextCursor }
}

function assistantInputEventMatchesDeliveryRoute(input: {
  accountId: string | null
  conversation: AssistantInputConversationRef | null
  deliveryRoute: AssistantTurnRouteActorInputQuery['deliveryRoute']
  replyTarget: AssistantInputEventRecord['replyTarget']
  source: string
  threadIsDirect: boolean | null
}): boolean {
  return typeof input.threadIsDirect === 'boolean' &&
    input.conversation?.accountId === input.accountId &&
    input.conversation?.threadIsDirect === input.threadIsDirect &&
    normalizeAssistantInputRouteScalar(input.source) ===
      normalizeAssistantInputRouteScalar(input.deliveryRoute.channel) &&
    normalizeAssistantInputRouteScalar(input.replyTarget?.channel) ===
      normalizeAssistantInputRouteScalar(input.deliveryRoute.channel) &&
    normalizeAssistantInputRouteScalar(input.replyTarget?.threadId) ===
      normalizeAssistantInputRouteScalar(input.deliveryRoute.threadId)
}

function assistantInputEventMatchesConversationActor(input: {
  candidate: AssistantInputConversationRef | null
  expected: AssistantInputConversationRef
}): boolean {
  if (input.expected.threadIsDirect !== false) {
    return true
  }
  return Boolean(
    input.expected.actorId &&
    input.candidate?.actorId &&
    input.candidate.threadIsDirect === false &&
    input.candidate.accountId === input.expected.accountId &&
    input.candidate.actorId === input.expected.actorId &&
    input.candidate.actorIsSelf === input.expected.actorIsSelf &&
    input.candidate.source === input.expected.source,
  )
}

function normalizeAssistantInputRouteScalar(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
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
    nextCursor,
  }
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
