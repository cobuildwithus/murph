import {
  gatewayFetchAttachmentsInputSchema,
  gatewayConversationSchema,
  gatewayEventSchema,
  gatewayGetConversationInputSchema,
  gatewayListConversationsInputSchema,
  gatewayListConversationsResultSchema,
  gatewayPollEventsInputSchema,
  gatewayPollEventsResultSchema,
  gatewayPermissionRequestSchema,
  gatewayProjectionSnapshotSchema,
  gatewayReadMessagesInputSchema,
  gatewayReadMessagesResultSchema,
  type GatewayAttachment,
  type GatewayConversation,
  type GatewayEvent,
  type GatewayFetchAttachmentsInput,
  type GatewayGetConversationInput,
  type GatewayListConversationsInput,
  type GatewayListConversationsResult,
  type GatewayMessage,
  type GatewayPermissionRequest,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayProjectionSnapshot,
  type GatewayReadMessagesInput,
  type GatewayReadMessagesResult,
} from './contracts.ts'
import {
  readGatewayAttachmentId,
  readGatewayConversationSessionToken,
  readGatewayMessageRouteToken,
  sameGatewayConversationSession,
} from './opaque-ids.ts'
import { createGatewayInvalidRuntimeIdError } from './errors.ts'

export interface GatewayEventEmission
  extends Omit<GatewayEvent, 'cursor' | 'schema'> {}

export interface GatewayEventLogState {
  events: GatewayEvent[]
  nextCursor: number
  snapshot: GatewayProjectionSnapshot | null
}

export const DEFAULT_GATEWAY_EVENT_RETENTION = 512

export function listGatewayConversationsFromSnapshot(
  snapshot: GatewayProjectionSnapshot,
  input?: GatewayListConversationsInput,
): GatewayListConversationsResult {
  const parsed = gatewayListConversationsInputSchema.parse(input ?? {})

  let conversations = snapshot.conversations.filter((conversation) => {
    if (parsed.channel && conversation.route.channel !== parsed.channel) {
      return false
    }
    if (!parsed.search) {
      return true
    }
    return conversationMatchesSearch(snapshot, conversation, parsed.search)
  })

  conversations = conversations
    .map((conversation) =>
      conversationPresentationForRequest(snapshot, conversation, parsed),
    )
    .sort(compareGatewayConversationsDescending)

  return gatewayListConversationsResultSchema.parse({
    conversations: conversations.slice(0, parsed.limit),
    nextCursor: null,
  })
}

export function getGatewayConversationFromSnapshot(
  snapshot: GatewayProjectionSnapshot,
  input: GatewayGetConversationInput,
): GatewayConversation | null {
  const parsed = gatewayGetConversationInputSchema.parse(input)
  const sessionToken = readGatewayConversationSessionTokenOrThrow(parsed.sessionKey)
  const conversation = snapshot.conversations.find((entry) =>
    gatewaySessionKeyMatchesRouteToken(entry.sessionKey, sessionToken),
  )

  return conversation
    ? conversationPresentationForRequest(snapshot, conversation, {
        channel: null,
        includeDerivedTitles: true,
        includeLastMessage: true,
        limit: 1,
        search: null,
      })
    : null
}

export function readGatewayMessagesFromSnapshot(
  snapshot: GatewayProjectionSnapshot,
  input: GatewayReadMessagesInput,
): GatewayReadMessagesResult {
  const parsed = gatewayReadMessagesInputSchema.parse(input)
  const sessionToken = readGatewayConversationSessionTokenOrThrow(parsed.sessionKey)
  if (parsed.afterMessageId) {
    assertGatewayMessageBelongsToRoute(parsed.afterMessageId, sessionToken)
  }

  const messages = snapshot.messages
    .filter((message) => gatewaySessionKeyMatchesRouteToken(message.sessionKey, sessionToken))
    .sort(compareGatewayMessagesAscending)
  const ordered = parsed.oldestFirst ? messages : [...messages].reverse()
  const startIndex =
    parsed.afterMessageId === null
      ? 0
      : resolveGatewayReadStartIndex(ordered, parsed.afterMessageId)
  const page = ordered.slice(startIndex, startIndex + parsed.limit)

  return gatewayReadMessagesResultSchema.parse({
    messages: page,
    nextCursor:
      startIndex + parsed.limit < ordered.length
        ? page[page.length - 1]?.messageId ?? null
        : null,
  })
}

export function fetchGatewayAttachmentsFromSnapshot(
  snapshot: GatewayProjectionSnapshot,
  input: GatewayFetchAttachmentsInput,
): GatewayAttachment[] {
  const parsed = gatewayFetchAttachmentsInputSchema.parse(input)
  const requestedRouteToken = parsed.sessionKey
    ? readGatewayConversationSessionTokenOrThrow(parsed.sessionKey)
    : null

  if (parsed.attachmentIds.length > 0) {
    const attachments: GatewayAttachment[] = []
    for (const attachmentId of parsed.attachmentIds) {
      const envelope = readGatewayAttachmentIdOrThrow(attachmentId)
      if (requestedRouteToken && envelope.routeToken !== requestedRouteToken) {
        throw createGatewayInvalidRuntimeIdError(
          'Gateway attachment id did not belong to the requested session key.',
        )
      }
      const attachment = snapshot.messages
        .flatMap((message) => message.attachments)
        .find((entry) => entry.attachmentId === attachmentId)
      if (attachment) {
        attachments.push(attachment)
      }
    }
    return dedupeGatewayAttachments(attachments)
  }

  if (parsed.messageId) {
    const routeToken = readGatewayMessageRouteTokenOrThrow(parsed.messageId)
    if (requestedRouteToken && requestedRouteToken !== routeToken) {
      throw createGatewayInvalidRuntimeIdError(
        'Gateway message id did not belong to the requested session key.',
      )
    }
    const message = snapshot.messages.find((entry) => entry.messageId === parsed.messageId)
    return dedupeGatewayAttachments(message?.attachments ?? [])
  }

  if (requestedRouteToken) {
    return dedupeGatewayAttachments(
      snapshot.messages
        .filter(
          (message) =>
            readGatewayConversationSessionTokenOrThrow(message.sessionKey) ===
            requestedRouteToken,
        )
        .flatMap((message) => message.attachments),
    )
  }

  return []
}

export function listGatewayOpenPermissionsFromSnapshot(
  snapshot: GatewayProjectionSnapshot,
  input?: {
    sessionKey?: string | null
  },
): GatewayPermissionRequest[] {
  const sessionKey = input?.sessionKey ?? null
  const sessionToken = sessionKey
    ? readGatewayConversationSessionTokenOrThrow(sessionKey)
    : null
  return snapshot.permissions
    .filter((permission) => permission.status === 'open')
    .filter(
      (permission) =>
        sessionToken === null ||
        (permission.sessionKey !== null &&
          gatewaySessionKeyMatchesRouteToken(permission.sessionKey, sessionToken)),
    )
    .map((permission) => gatewayPermissionRequestSchema.parse(permission))
    .sort(
      (left, right) =>
        left.requestedAt.localeCompare(right.requestedAt) ||
        left.requestId.localeCompare(right.requestId),
    )
}

export function diffGatewayProjectionSnapshots(
  previous: GatewayProjectionSnapshot | null,
  next: GatewayProjectionSnapshot,
): GatewayEventEmission[] {
  if (!previous) {
    return []
  }

  const emissions: GatewayEventEmission[] = []
  const previousMessages = new Set(previous.messages.map((message) => message.messageId))
  const previousConversations = new Map(
    previous.conversations.map((conversation) => [conversation.sessionKey, conversation]),
  )
  const previousPermissions = new Map(
    previous.permissions.map((permission) => [permission.requestId, permission]),
  )

  for (const message of next.messages) {
    if (previousMessages.has(message.messageId)) {
      continue
    }
    emissions.push({
      createdAt: message.createdAt,
      kind: 'message.created',
      messageId: message.messageId,
      permissionRequestId: null,
      sessionKey: message.sessionKey,
      summary: deriveLastMessagePreview(message),
    })
  }

  for (const conversation of next.conversations) {
    const previousConversation = previousConversations.get(conversation.sessionKey)
    if (
      previousConversation &&
      stableStringify(previousConversation) === stableStringify(conversation)
    ) {
      continue
    }
    emissions.push({
      createdAt: conversation.lastActivityAt ?? next.generatedAt,
      kind: 'conversation.updated',
      messageId: null,
      permissionRequestId: null,
      sessionKey: conversation.sessionKey,
      summary:
        normalizeNullableString(conversation.title) ??
        normalizeNullableString(conversation.lastMessagePreview) ??
        normalizeNullableString(conversation.route.channel),
    })
  }

  for (const permission of next.permissions) {
    const previousPermission = previousPermissions.get(permission.requestId)
    if (!previousPermission && permission.status === 'open') {
      emissions.push({
        createdAt: permission.requestedAt,
        kind: 'permission.requested',
        messageId: null,
        permissionRequestId: permission.requestId,
        sessionKey: permission.sessionKey,
        summary: normalizeNullableString(permission.description) ?? permission.action,
      })
      continue
    }
    if (
      previousPermission?.status === 'open' &&
      permission.status !== 'open'
    ) {
      emissions.push({
        createdAt: permission.resolvedAt ?? next.generatedAt,
        kind: 'permission.resolved',
        messageId: null,
        permissionRequestId: permission.requestId,
        sessionKey: permission.sessionKey,
        summary: normalizeNullableString(permission.note) ?? permission.status,
      })
    }
  }

  return emissions.sort(compareGatewayEventEmissionsAscending)
}

export function applyGatewayProjectionSnapshotToEventLog(
  state: GatewayEventLogState,
  snapshot: GatewayProjectionSnapshot,
  retention: number = DEFAULT_GATEWAY_EVENT_RETENTION,
): GatewayEventLogState {
  const parsedSnapshot = gatewayProjectionSnapshotSchema.parse(snapshot)
  const normalizedRetention =
    Number.isFinite(retention) && retention > 0
      ? Math.floor(retention)
      : DEFAULT_GATEWAY_EVENT_RETENTION

  if (
    state.snapshot &&
    stableGatewayProjectionContentString(state.snapshot) ===
      stableGatewayProjectionContentString(parsedSnapshot)
  ) {
    return state
  }

  const nextEvents = state.events.map((event) => gatewayEventSchema.parse(event))
  let nextCursor =
    Number.isFinite(state.nextCursor) && state.nextCursor >= 0
      ? Math.floor(state.nextCursor)
      : 0

  for (const emission of diffGatewayProjectionSnapshots(state.snapshot, parsedSnapshot)) {
    nextCursor += 1
    nextEvents.push(
      gatewayEventSchema.parse({
        schema: 'murph.gateway-event.v1',
        cursor: nextCursor,
        ...emission,
      }),
    )
  }

  if (nextEvents.length > normalizedRetention) {
    nextEvents.splice(0, nextEvents.length - normalizedRetention)
  }

  return {
    events: nextEvents,
    nextCursor,
    snapshot: parsedSnapshot,
  }
}

export function pollGatewayEventLogState(
  state: GatewayEventLogState,
  input?: GatewayPollEventsInput,
): GatewayPollEventsResult {
  const parsed = gatewayPollEventsInputSchema.parse(input ?? {})
  const events = state.events
    .map((event) => gatewayEventSchema.parse(event))
    .filter((event) => event.cursor > parsed.cursor)
    .filter((event) => parsed.kinds.length === 0 || parsed.kinds.includes(event.kind))
    .filter(
      (event) =>
        parsed.sessionKey === null ||
        (event.sessionKey !== null && sameGatewayConversationSession(event.sessionKey, parsed.sessionKey)),
    )
    .slice(0, parsed.limit)

  return gatewayPollEventsResultSchema.parse({
    events,
    nextCursor:
      events[events.length - 1]?.cursor ?? Math.max(state.nextCursor, parsed.cursor),
    live: true,
  })
}

export function compareGatewayConversationsDescending(
  left: GatewayConversation,
  right: GatewayConversation,
): number {
  return (
    compareNullableTimestampsDescending(left.lastActivityAt, right.lastActivityAt) ||
    left.sessionKey.localeCompare(right.sessionKey)
  )
}

export function compareGatewayMessagesAscending(
  left: GatewayMessage,
  right: GatewayMessage,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.messageId.localeCompare(right.messageId)
  )
}

export function deriveLastMessagePreview(message: GatewayMessage | null): string | null {
  if (!message) {
    return null
  }
  if (normalizeNullableString(message.text)) {
    return message.text
  }
  return message.attachments[0]?.fileName ?? null
}

function conversationPresentationForRequest(
  snapshot: GatewayProjectionSnapshot,
  conversation: GatewayConversation,
  input: GatewayListConversationsInput,
): GatewayConversation {
  const derivedSources = new Set([
    'participant-display-name',
    'participant-id',
    'thread-id',
    'channel',
  ])

  return gatewayConversationSchema.parse({
    ...conversation,
    title:
      input.includeDerivedTitles === false &&
      conversation.titleSource !== null &&
      derivedSources.has(conversation.titleSource)
        ? null
        : deriveGatewayConversationDisplayTitle(
            snapshot,
            conversation,
            input.includeDerivedTitles ?? true,
          ),
    lastMessagePreview:
      input.includeLastMessage === false ? null : conversation.lastMessagePreview,
  })
}

function deriveGatewayConversationDisplayTitle(
  snapshot: GatewayProjectionSnapshot,
  conversation: GatewayConversation,
  includeDerivedTitles: boolean,
): string | null {
  const explicitTitle = normalizeNullableString(conversation.title)
  if (explicitTitle) {
    return explicitTitle
  }
  if (!includeDerivedTitles) {
    return null
  }

  const messages = snapshot.messages.filter(
    (message) => message.sessionKey === conversation.sessionKey,
  )
  const latestInboundActorDisplayName = [...messages]
    .reverse()
    .find(
      (message) =>
        message.direction === 'inbound' && normalizeNullableString(message.actorDisplayName),
    )?.actorDisplayName
  const latestActorDisplayName = [...messages]
    .reverse()
    .find((message) => normalizeNullableString(message.actorDisplayName))?.actorDisplayName

  return (
    normalizeNullableString(latestInboundActorDisplayName) ??
    normalizeNullableString(latestActorDisplayName) ??
    normalizeNullableString(conversation.route.participantId) ??
    normalizeNullableString(conversation.route.threadId) ??
    normalizeNullableString(conversation.route.channel)
  )
}

function conversationMatchesSearch(
  snapshot: GatewayProjectionSnapshot,
  conversation: GatewayConversation,
  search: string,
): boolean {
  const needle = search.trim().toLocaleLowerCase()
  if (needle.length === 0) {
    return true
  }

  const fields = [
    conversation.title,
    conversation.lastMessagePreview,
    conversation.route.channel,
    conversation.route.identityId,
    conversation.route.participantId,
    conversation.route.threadId,
  ]

  if (fields.some((value) => value?.toLocaleLowerCase().includes(needle))) {
    return true
  }

  return snapshot.messages
    .filter((message) => message.sessionKey === conversation.sessionKey)
    .some((message) =>
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

function compareGatewayEventEmissionsAscending(
  left: GatewayEventEmission,
  right: GatewayEventEmission,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.kind.localeCompare(right.kind) ||
    (left.sessionKey ?? '').localeCompare(right.sessionKey ?? '') ||
    (left.messageId ?? '').localeCompare(right.messageId ?? '') ||
    (left.permissionRequestId ?? '').localeCompare(right.permissionRequestId ?? '')
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

function assertGatewayMessageBelongsToRoute(
  messageId: string,
  routeToken: string,
): void {
  const messageRouteToken = readGatewayMessageRouteTokenOrThrow(messageId)
  if (messageRouteToken !== routeToken) {
    throw createGatewayInvalidRuntimeIdError(
      'Gateway message id did not belong to the requested session key.',
    )
  }
}

function gatewaySessionKeyMatchesRouteToken(
  sessionKey: string,
  routeToken: string,
): boolean {
  return readGatewayConversationSessionTokenOrThrow(sessionKey) === routeToken
}

function readGatewayConversationSessionTokenOrThrow(sessionKey: string): string {
  try {
    return readGatewayConversationSessionToken(sessionKey)
  } catch (error) {
    throw createGatewayInvalidRuntimeIdError(
      error instanceof Error ? error.message : 'Gateway session key is invalid.',
    )
  }
}

function readGatewayMessageRouteTokenOrThrow(messageId: string): string {
  try {
    return readGatewayMessageRouteToken(messageId)
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

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

function stableGatewayProjectionContentString(
  snapshot: GatewayProjectionSnapshot,
): string {
  return stableStringify({
    conversations: snapshot.conversations,
    messages: snapshot.messages,
    permissions: snapshot.permissions,
    schema: snapshot.schema,
  })
}
