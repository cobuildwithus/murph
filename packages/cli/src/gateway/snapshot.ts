import {
  gatewayFetchAttachmentsInputSchema,
  gatewayGetConversationInputSchema,
  gatewayListConversationsInputSchema,
  gatewayListConversationsResultSchema,
  gatewayPermissionRequestSchema,
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
  type GatewayProjectionSnapshot,
  type GatewayReadMessagesInput,
  type GatewayReadMessagesResult,
} from './contracts.js'
import {
  readGatewayAttachmentId,
  readGatewayConversationSessionKey,
  readGatewayMessageRouteKey,
} from './opaque-ids.js'
import { createGatewayInvalidRuntimeIdError } from './errors.js'

export interface GatewayEventEmission
  extends Omit<GatewayEvent, 'cursor' | 'schema'> {}

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
      conversationPresentationForRequest(conversation, parsed),
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
  const sessionKey = readGatewayConversationSessionKeyOrThrow(parsed.sessionKey)
  const conversation = snapshot.conversations.find(
    (entry) => readGatewayConversationSessionKeyOrThrow(entry.sessionKey) === sessionKey,
  )

  return conversation
    ? conversationPresentationForRequest(conversation, {
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
  const sessionKey = readGatewayConversationSessionKeyOrThrow(parsed.sessionKey)
  if (parsed.afterMessageId) {
    assertGatewayMessageBelongsToRoute(parsed.afterMessageId, sessionKey)
  }

  const messages = snapshot.messages
    .filter((message) => message.sessionKey === parsed.sessionKey)
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
  const requestedRouteKey = parsed.sessionKey
    ? readGatewayConversationSessionKeyOrThrow(parsed.sessionKey)
    : null

  if (parsed.attachmentIds.length > 0) {
    const attachments: GatewayAttachment[] = []
    for (const attachmentId of parsed.attachmentIds) {
      const envelope = readGatewayAttachmentIdOrThrow(attachmentId)
      if (requestedRouteKey && envelope.routeKey !== requestedRouteKey) {
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
    const routeKey = readGatewayMessageRouteKeyOrThrow(parsed.messageId)
    if (requestedRouteKey && requestedRouteKey !== routeKey) {
      throw createGatewayInvalidRuntimeIdError(
        'Gateway message id did not belong to the requested session key.',
      )
    }
    const message = snapshot.messages.find((entry) => entry.messageId === parsed.messageId)
    return dedupeGatewayAttachments(message?.attachments ?? [])
  }

  if (requestedRouteKey) {
    return dedupeGatewayAttachments(
      snapshot.messages
        .filter(
          (message) =>
            readGatewayConversationSessionKeyOrThrow(message.sessionKey) ===
            requestedRouteKey,
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
  return snapshot.permissions
    .filter((permission) => permission.status === 'open')
    .filter((permission) => !sessionKey || permission.sessionKey === sessionKey)
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
  conversation: GatewayConversation,
  input: GatewayListConversationsInput,
): GatewayConversation {
  return {
    ...conversation,
    title:
      input.includeDerivedTitles === false &&
      conversation.title ===
        (normalizeNullableString(conversation.route.participantId) ??
          normalizeNullableString(conversation.route.threadId) ??
          normalizeNullableString(conversation.route.channel))
        ? null
        : conversation.title,
    lastMessagePreview:
      input.includeLastMessage === false ? null : conversation.lastMessagePreview,
  }
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
