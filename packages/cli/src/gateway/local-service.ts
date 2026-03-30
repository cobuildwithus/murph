import {
  openInboxRuntime,
  type InboxCaptureRecord,
  type IndexedAttachment,
} from '@murph/inboxd'

import {
  type AssistantOutboxIntent,
  type AssistantSession,
} from '../assistant-cli-contracts.js'
import { listAssistantOutboxIntentsLocal } from '../assistant/outbox.js'
import { normalizeNullableString } from '../assistant/shared.js'
import { listAssistantSessionsLocal } from '../assistant/store.js'
import {
  gatewayConversationSchema,
  gatewayFetchAttachmentsInputSchema,
  gatewayGetConversationInputSchema,
  gatewayListConversationsInputSchema,
  gatewayListConversationsResultSchema,
  gatewayListOpenPermissionsInputSchema,
  gatewayMessageSchema,
  gatewayPollEventsInputSchema,
  gatewayPollEventsResultSchema,
  gatewayReadMessagesInputSchema,
  gatewayReadMessagesResultSchema,
  gatewaySendMessageInputSchema,
  gatewayWaitForEventsInputSchema,
  type GatewayAttachment,
  type GatewayConversation,
  type GatewayConversationRoute,
  type GatewayFetchAttachmentsInput,
  type GatewayGetConversationInput,
  type GatewayListConversationsInput,
  type GatewayListConversationsResult,
  type GatewayMessage,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayReadMessagesInput,
  type GatewayReadMessagesResult,
  type GatewayService,
  type GatewayWaitForEventsInput,
} from './contracts.js'
import {
  createGatewayAttachmentId,
  createGatewayCaptureMessageId,
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
  readGatewayAttachmentId,
  readGatewayConversationSessionKey,
  readGatewayMessageRouteKey,
} from './opaque-ids.js'
import {
  gatewayConversationRouteCanSend,
  gatewayConversationRouteFromBinding,
  gatewayConversationRouteFromCapture,
  gatewayConversationRouteFromOutboxIntent,
  mergeGatewayConversationRoutes,
  resolveGatewayConversationRouteKey,
} from './routes.js'

const INBOX_CAPTURE_PAGE_SIZE = 500
const INVALID_GATEWAY_RUNTIME_ID_CODE = 'ASSISTANT_INVALID_RUNTIME_ID'

interface GatewayConversationAccumulator {
  alias: string | null
  latestParticipantDisplayName: string | null
  latestParticipantDisplayNameAt: string | null
  latestThreadTitle: string | null
  latestThreadTitleAt: string | null
  messages: GatewayMessage[]
  route: GatewayConversationRoute
  routeKey: string
  sessionUpdatedAt: string | null
}

interface GatewayProjection {
  conversations: Map<string, GatewayConversationAccumulator>
}

export function createLocalGatewayService(vault: string): GatewayService {
  return {
    fetchAttachments: (input) => fetchGatewayAttachmentsLocal(vault, input),
    getConversation: (input) => getGatewayConversationLocal(vault, input),
    listConversations: (input) => listGatewayConversationsLocal(vault, input),
    listOpenPermissions: async (input) => {
      gatewayListOpenPermissionsInputSchema.parse(input ?? {})
      return []
    },
    pollEvents: async (input) => buildEmptyGatewayEventsResult(input),
    readMessages: (input) => readGatewayMessagesLocal(vault, input),
    respondToPermission: async () => null,
    sendMessage: async (input) => {
      const parsed = gatewaySendMessageInputSchema.parse(input)
      throw createGatewayUnsupportedOperationError(
        `Gateway sendMessage is not implemented yet for session ${parsed.sessionKey}.`,
      )
    },
    waitForEvents: async (input) => buildEmptyGatewayWaitResult(input),
  }
}

export async function listGatewayConversationsLocal(
  vault: string,
  input?: GatewayListConversationsInput,
): Promise<GatewayListConversationsResult> {
  const parsed = gatewayListConversationsInputSchema.parse(input ?? {})
  const projection = await buildLocalGatewayProjection(vault)

  let conversations = Array.from(projection.conversations.values())
    .filter((conversation) => {
      if (parsed.channel && conversation.route.channel !== parsed.channel) {
        return false
      }
      if (!parsed.search) {
        return true
      }
      return conversationMatchesSearch(conversation, parsed.search)
    })
    .map((conversation) =>
      materializeGatewayConversation(conversation, {
        includeDerivedTitles: parsed.includeDerivedTitles,
        includeLastMessage: parsed.includeLastMessage,
      }),
    )

  conversations = conversations.sort(compareGatewayConversationsDescending)
  const limited = conversations.slice(0, parsed.limit)

  return gatewayListConversationsResultSchema.parse({
    conversations: limited,
    nextCursor: null,
  })
}

export async function getGatewayConversationLocal(
  vault: string,
  input: GatewayGetConversationInput,
): Promise<GatewayConversation | null> {
  const parsed = gatewayGetConversationInputSchema.parse(input)
  const routeKey = readGatewayConversationSessionKeyOrThrow(parsed.sessionKey)
  const projection = await buildLocalGatewayProjection(vault)
  const conversation = projection.conversations.get(routeKey)

  if (!conversation) {
    return null
  }

  return materializeGatewayConversation(conversation, {
    includeDerivedTitles: true,
    includeLastMessage: true,
  })
}

export async function readGatewayMessagesLocal(
  vault: string,
  input: GatewayReadMessagesInput,
): Promise<GatewayReadMessagesResult> {
  const parsed = gatewayReadMessagesInputSchema.parse(input)
  const routeKey = readGatewayConversationSessionKeyOrThrow(parsed.sessionKey)
  if (parsed.afterMessageId) {
    assertGatewayMessageBelongsToRoute(parsed.afterMessageId, routeKey)
  }

  const projection = await buildLocalGatewayProjection(vault)
  const conversation = projection.conversations.get(routeKey)
  if (!conversation) {
    return gatewayReadMessagesResultSchema.parse({
      messages: [],
      nextCursor: null,
    })
  }

  const ordered = parsed.oldestFirst
    ? conversation.messages
    : [...conversation.messages].reverse()
  const startIndex =
    parsed.afterMessageId === null
      ? 0
      : resolveGatewayReadStartIndex(ordered, parsed.afterMessageId)
  const page = ordered.slice(startIndex, startIndex + parsed.limit)
  const nextCursor =
    startIndex + parsed.limit < ordered.length
      ? page[page.length - 1]?.messageId ?? null
      : null

  return gatewayReadMessagesResultSchema.parse({
    messages: page,
    nextCursor,
  })
}

export async function fetchGatewayAttachmentsLocal(
  vault: string,
  input: GatewayFetchAttachmentsInput,
): Promise<GatewayAttachment[]> {
  const parsed = gatewayFetchAttachmentsInputSchema.parse(input)
  const requestedRouteKey = parsed.sessionKey
    ? readGatewayConversationSessionKeyOrThrow(parsed.sessionKey)
    : null
  const projection = await buildLocalGatewayProjection(vault)

  if (parsed.attachmentIds.length > 0) {
    const attachments: GatewayAttachment[] = []
    for (const attachmentId of parsed.attachmentIds) {
      const envelope = readGatewayAttachmentIdOrThrow(attachmentId)
      if (requestedRouteKey && envelope.routeKey !== requestedRouteKey) {
        throw createGatewayInvalidRuntimeIdError(
          'Gateway attachment id did not belong to the requested session key.',
        )
      }
      const conversation = projection.conversations.get(envelope.routeKey)
      const attachment = conversation?.messages
        .flatMap((message) => message.attachments)
        .find((entry) => entry.attachmentId === attachmentId)
      if (attachment) {
        attachments.push(attachment)
      }
    }
    return dedupeGatewayAttachments(attachments)
  }

  if (parsed.messageId) {
    if (requestedRouteKey) {
      assertGatewayMessageBelongsToRoute(parsed.messageId, requestedRouteKey)
    }
    const conversation = projection.conversations.get(
      readGatewayMessageRouteKeyOrThrow(parsed.messageId),
    )
    const message = conversation?.messages.find(
      (entry) => entry.messageId === parsed.messageId,
    )
    return dedupeGatewayAttachments(message?.attachments ?? [])
  }

  if (!requestedRouteKey) {
    return []
  }

  const conversation = projection.conversations.get(requestedRouteKey)
  return dedupeGatewayAttachments(
    conversation?.messages.flatMap((message) => message.attachments) ?? [],
  )
}

async function buildLocalGatewayProjection(vault: string): Promise<GatewayProjection> {
  const [captures, sessions, outboxIntents] = await Promise.all([
    listAllInboxCaptures(vault),
    listAssistantSessionsLocal(vault),
    listAssistantOutboxIntentsLocal(vault),
  ])

  const projection: GatewayProjection = {
    conversations: new Map(),
  }

  for (const session of sessions) {
    integrateAssistantSession(projection, session)
  }

  for (const intent of outboxIntents) {
    integrateOutboxIntent(projection, intent)
  }

  for (const capture of captures) {
    integrateInboxCapture(projection, capture)
  }

  for (const conversation of projection.conversations.values()) {
    conversation.messages.sort(compareGatewayMessagesAscending)
  }

  return projection
}

async function listAllInboxCaptures(vault: string): Promise<InboxCaptureRecord[]> {
  const runtime = await openInboxRuntime({ vaultRoot: vault })
  try {
    const captures: InboxCaptureRecord[] = []
    let afterCaptureId: string | null = null
    let afterOccurredAt: string | null = null

    while (true) {
      const page = runtime.listCaptures({
        afterCaptureId,
        afterOccurredAt,
        limit: INBOX_CAPTURE_PAGE_SIZE,
        oldestFirst: true,
      })
      if (page.length === 0) {
        break
      }

      captures.push(...page)
      const last = page[page.length - 1]
      afterCaptureId = last?.captureId ?? null
      afterOccurredAt = last?.occurredAt ?? null

      if (page.length < INBOX_CAPTURE_PAGE_SIZE) {
        break
      }
    }

    return captures
  } finally {
    runtime.close()
  }
}

function integrateAssistantSession(
  projection: GatewayProjection,
  session: AssistantSession,
): void {
  const route = gatewayConversationRouteFromBinding(session.binding)
  const routeKey = resolveGatewayConversationRouteKey(route)
  if (!routeKey) {
    return
  }

  const conversation = ensureGatewayConversationAccumulator(projection, routeKey)
  conversation.route = mergeGatewayConversationRoutes(conversation.route, route)

  if (
    conversation.sessionUpdatedAt === null ||
    session.updatedAt >= conversation.sessionUpdatedAt
  ) {
    conversation.sessionUpdatedAt = session.updatedAt
    if (normalizeNullableString(session.alias)) {
      conversation.alias = session.alias
    }
  } else if (conversation.alias === null && normalizeNullableString(session.alias)) {
    conversation.alias = session.alias
  }
}

function integrateOutboxIntent(
  projection: GatewayProjection,
  intent: AssistantOutboxIntent,
): void {
  const route = gatewayConversationRouteFromOutboxIntent(intent)
  const routeKey = resolveGatewayConversationRouteKey(route)
  if (!routeKey) {
    return
  }

  const conversation = ensureGatewayConversationAccumulator(projection, routeKey)
  conversation.route = mergeGatewayConversationRoutes(conversation.route, route)

  if (intent.status !== 'sent') {
    return
  }

  conversation.messages.push(
    gatewayMessageSchema.parse({
      schema: 'murph.gateway-message.v1',
      messageId: createGatewayOutboxMessageId(routeKey, intent.intentId),
      sessionKey: createGatewayConversationSessionKey(routeKey),
      direction: 'outbound',
      createdAt: intent.sentAt ?? intent.updatedAt,
      actorDisplayName: null,
      text: intent.message,
      attachments: [],
    }),
  )
}

function integrateInboxCapture(
  projection: GatewayProjection,
  capture: InboxCaptureRecord,
): void {
  const route = gatewayConversationRouteFromCapture(capture)
  const routeKey = resolveGatewayConversationRouteKey(route)
  if (!routeKey) {
    return
  }

  const conversation = ensureGatewayConversationAccumulator(projection, routeKey)
  conversation.route = mergeGatewayConversationRoutes(conversation.route, route)

  if (
    capture.thread.title &&
    (conversation.latestThreadTitleAt === null ||
      capture.occurredAt >= conversation.latestThreadTitleAt)
  ) {
    conversation.latestThreadTitle = capture.thread.title
    conversation.latestThreadTitleAt = capture.occurredAt
  }

  if (
    capture.actor.displayName &&
    (conversation.latestParticipantDisplayNameAt === null ||
      capture.occurredAt >= conversation.latestParticipantDisplayNameAt)
  ) {
    conversation.latestParticipantDisplayName = capture.actor.displayName
    conversation.latestParticipantDisplayNameAt = capture.occurredAt
  }

  conversation.messages.push(materializeGatewayCaptureMessage(routeKey, capture))
}

function ensureGatewayConversationAccumulator(
  projection: GatewayProjection,
  routeKey: string,
): GatewayConversationAccumulator {
  const existing = projection.conversations.get(routeKey)
  if (existing) {
    return existing
  }

  const created: GatewayConversationAccumulator = {
    alias: null,
    latestParticipantDisplayName: null,
    latestParticipantDisplayNameAt: null,
    latestThreadTitle: null,
    latestThreadTitleAt: null,
    messages: [],
    route: {
      channel: null,
      directness: null,
      identityId: null,
      participantId: null,
      reply: {
        kind: null,
        target: null,
      },
      threadId: null,
    },
    routeKey,
    sessionUpdatedAt: null,
  }
  projection.conversations.set(routeKey, created)
  return created
}

function materializeGatewayCaptureMessage(
  routeKey: string,
  capture: InboxCaptureRecord,
): GatewayMessage {
  const messageId = createGatewayCaptureMessageId(routeKey, capture.captureId)
  const sessionKey = createGatewayConversationSessionKey(routeKey)

  return gatewayMessageSchema.parse({
    schema: 'murph.gateway-message.v1',
    messageId,
    sessionKey,
    direction: capture.actor.isSelf ? 'outbound' : 'inbound',
    createdAt: capture.occurredAt,
    actorDisplayName: normalizeNullableString(capture.actor.displayName),
    text: capture.text,
    attachments: capture.attachments.map((attachment) =>
      materializeGatewayAttachment(routeKey, capture.captureId, messageId, attachment),
    ),
  })
}

function materializeGatewayAttachment(
  routeKey: string,
  captureId: string,
  messageId: string,
  attachment: IndexedAttachment,
): GatewayAttachment {
  return {
    schema: 'murph.gateway-attachment.v1',
    attachmentId: createGatewayAttachmentId(routeKey, captureId, attachment.attachmentId),
    messageId,
    kind: attachment.kind,
    mime: attachment.mime ?? null,
    fileName: attachment.fileName ?? null,
    byteSize: attachment.byteSize ?? null,
    parseState: normalizeNullableString(attachment.parseState),
    extractedText: attachment.extractedText ?? null,
    transcriptText: attachment.transcriptText ?? null,
  }
}

function materializeGatewayConversation(
  conversation: GatewayConversationAccumulator,
  input: {
    includeDerivedTitles: boolean
    includeLastMessage: boolean
  },
): GatewayConversation {
  const lastMessage = conversation.messages[conversation.messages.length - 1] ?? null
  const title = deriveGatewayConversationTitle(
    conversation,
    input.includeDerivedTitles,
  )

  return gatewayConversationSchema.parse({
    schema: 'murph.gateway-conversation.v1',
    sessionKey: createGatewayConversationSessionKey(conversation.routeKey),
    title,
    lastMessagePreview: input.includeLastMessage ? deriveLastMessagePreview(lastMessage) : null,
    lastActivityAt: lastMessage?.createdAt ?? conversation.sessionUpdatedAt ?? null,
    messageCount: conversation.messages.length,
    canSend: gatewayConversationRouteCanSend(conversation.route),
    route: conversation.route,
  })
}

function deriveGatewayConversationTitle(
  conversation: GatewayConversationAccumulator,
  includeDerivedTitles: boolean,
): string | null {
  const explicit =
    normalizeNullableString(conversation.alias) ??
    normalizeNullableString(conversation.latestThreadTitle)
  if (explicit) {
    return explicit
  }
  if (!includeDerivedTitles) {
    return null
  }

  return (
    normalizeNullableString(conversation.latestParticipantDisplayName) ??
    normalizeNullableString(conversation.route.participantId) ??
    normalizeNullableString(conversation.route.threadId) ??
    normalizeNullableString(conversation.route.channel)
  )
}

function deriveLastMessagePreview(message: GatewayMessage | null): string | null {
  if (!message) {
    return null
  }
  if (normalizeNullableString(message.text)) {
    return message.text
  }
  return message.attachments[0]?.fileName ?? null
}

function conversationMatchesSearch(
  conversation: GatewayConversationAccumulator,
  search: string,
): boolean {
  const needle = search.trim().toLocaleLowerCase()
  if (needle.length === 0) {
    return true
  }

  const fields = [
    conversation.alias,
    conversation.latestThreadTitle,
    conversation.latestParticipantDisplayName,
    conversation.route.channel,
    conversation.route.identityId,
    conversation.route.participantId,
    conversation.route.threadId,
  ]

  if (fields.some((value) => value?.toLocaleLowerCase().includes(needle))) {
    return true
  }

  return conversation.messages.some((message) =>
    [
      message.text,
      message.actorDisplayName,
      ...message.attachments.flatMap((attachment) => [
        attachment.fileName,
        attachment.extractedText,
        attachment.transcriptText,
      ]),
    ].some((value) => value?.toLocaleLowerCase().includes(needle)),
  )
}

function compareGatewayConversationsDescending(
  left: GatewayConversation,
  right: GatewayConversation,
): number {
  return (
    compareNullableTimestampsDescending(left.lastActivityAt, right.lastActivityAt) ||
    left.sessionKey.localeCompare(right.sessionKey)
  )
}

function compareGatewayMessagesAscending(
  left: GatewayMessage,
  right: GatewayMessage,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.messageId.localeCompare(right.messageId)
  )
}

function compareNullableTimestampsDescending(
  left: string | null,
  right: string | null,
): number {
  if (left === right) {
    return 0
  }
  if (left === null) {
    return 1
  }
  if (right === null) {
    return -1
  }
  return right.localeCompare(left)
}

function resolveGatewayReadStartIndex(
  messages: GatewayMessage[],
  afterMessageId: string,
): number {
  const index = messages.findIndex((message) => message.messageId === afterMessageId)
  if (index === -1) {
    throw createGatewayInvalidRuntimeIdError(
      'Gateway message cursor did not match any message in the requested session.',
    )
  }
  return index + 1
}

function dedupeGatewayAttachments(
  attachments: GatewayAttachment[],
): GatewayAttachment[] {
  const deduped = new Map<string, GatewayAttachment>()
  for (const attachment of attachments) {
    deduped.set(attachment.attachmentId, attachment)
  }
  return Array.from(deduped.values())
}

async function buildEmptyGatewayEventsResult(
  input?: GatewayPollEventsInput,
): Promise<GatewayPollEventsResult> {
  const parsed = gatewayPollEventsInputSchema.parse(input ?? {})
  return gatewayPollEventsResultSchema.parse({
    events: [],
    nextCursor: parsed.cursor,
    live: true,
  })
}

async function buildEmptyGatewayWaitResult(
  input?: GatewayWaitForEventsInput,
): Promise<GatewayPollEventsResult> {
  const parsed = gatewayWaitForEventsInputSchema.parse(input ?? {})
  return gatewayPollEventsResultSchema.parse({
    events: [],
    nextCursor: parsed.cursor,
    live: true,
  })
}

function assertGatewayMessageBelongsToRoute(
  messageId: string,
  routeKey: string,
): void {
  const messageRouteKey = readGatewayMessageRouteKeyOrThrow(messageId)
  if (messageRouteKey !== routeKey) {
    throw createGatewayInvalidRuntimeIdError(
      'Gateway message id did not belong to the requested session key.',
    )
  }
}

function readGatewayConversationSessionKeyOrThrow(sessionKey: string): string {
  try {
    return readGatewayConversationSessionKey(sessionKey)
  } catch (error) {
    throw createGatewayInvalidRuntimeIdError(
      error instanceof Error ? error.message : 'Gateway session key is invalid.',
    )
  }
}

function readGatewayMessageRouteKeyOrThrow(messageId: string): string {
  try {
    return readGatewayMessageRouteKey(messageId)
  } catch (error) {
    throw createGatewayInvalidRuntimeIdError(
      error instanceof Error ? error.message : 'Gateway message id is invalid.',
    )
  }
}

function readGatewayAttachmentIdOrThrow(
  attachmentId: string,
): ReturnType<typeof readGatewayAttachmentId> {
  try {
    return readGatewayAttachmentId(attachmentId)
  } catch (error) {
    throw createGatewayInvalidRuntimeIdError(
      error instanceof Error ? error.message : 'Gateway attachment id is invalid.',
    )
  }
}

function createGatewayInvalidRuntimeIdError(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = INVALID_GATEWAY_RUNTIME_ID_CODE
  return error
}

function createGatewayUnsupportedOperationError(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = 'ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION'
  return error
}
