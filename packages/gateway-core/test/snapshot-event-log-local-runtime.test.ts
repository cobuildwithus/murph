import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyGatewayProjectionSnapshotToEventLog,
  compareGatewayConversationsDescending,
  compareGatewayMessagesAscending,
  createGatewayAttachmentId,
  createGatewayCaptureMessageId,
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
  deriveLastMessagePreview,
  diffGatewayProjectionSnapshots,
  fetchGatewayAttachmentsFromSnapshot,
  getGatewayConversationFromSnapshot,
  listGatewayConversationsFromSnapshot,
  listGatewayOpenPermissionsFromSnapshot,
  gatewayProjectionSnapshotSchema,
  pollGatewayEventLogState,
  readGatewayConversationSessionToken,
  readGatewayMessagesFromSnapshot,
  type GatewayPollEventsInput,
  type GatewayEventLogState,
  type GatewayProjectionSnapshot,
  waitForGatewayEventsByPolling,
} from '../src/index.ts'

const generatedAt = '2026-04-08T12:00:00.000Z'

function buildSession(routeKey: string): {
  routeToken: string
  sessionKey: string
} {
  const sessionKey = createGatewayConversationSessionKey(routeKey)
  return {
    routeToken: readGatewayConversationSessionToken(sessionKey),
    sessionKey,
  }
}

function buildProjectionSnapshots() {
  const primary = buildSession('route-primary')
  const archive = buildSession('route-archive')
  const attachmentId = createGatewayAttachmentId(primary.routeToken, 'capture-1', 'att-1')
  const primaryOlderMessageId = createGatewayCaptureMessageId(primary.routeToken, 'capture-1')
  const primaryNewerMessageId = createGatewayOutboxMessageId(primary.routeToken, 'intent-1')
  const primaryNewestMessageId = createGatewayCaptureMessageId(primary.routeToken, 'capture-2')
  const archiveMessageId = createGatewayOutboxMessageId(archive.routeToken, 'intent-archive')

  const previous: GatewayProjectionSnapshot = {
    conversations: [
      {
        canSend: true,
        lastActivityAt: '2026-04-08T10:00:00.000Z',
        lastMessagePreview: 'Need help',
        messageCount: 2,
        route: {
          channel: 'telegram',
          directness: 'direct',
          identityId: null,
          participantId: 'alice',
          reply: {
            kind: 'thread',
            target: 'thread-primary',
          },
          threadId: 'thread-primary',
        },
        schema: 'murph.gateway-conversation.v1',
        sessionKey: primary.sessionKey,
        title: null,
        titleSource: 'participant-display-name',
      },
      {
        canSend: false,
        lastActivityAt: '2026-04-08T11:00:00.000Z',
        lastMessagePreview: 'Invoice ready',
        messageCount: 1,
        route: {
          channel: 'email',
          directness: 'group',
          identityId: 'identity-email',
          participantId: null,
          reply: {
            kind: 'participant',
            target: 'billing@example.test',
          },
          threadId: 'mail-9',
        },
        schema: 'murph.gateway-conversation.v1',
        sessionKey: archive.sessionKey,
        title: 'Billing',
        titleSource: 'alias',
      },
    ],
    generatedAt,
    messages: [
      {
        actorDisplayName: 'Alice',
        attachments: [
          {
            attachmentId,
            byteSize: 1200,
            extractedText: 'Invoice total $100',
            fileName: 'invoice.pdf',
            kind: 'document',
            messageId: primaryOlderMessageId,
            mime: 'application/pdf',
            parseState: 'parsed',
            schema: 'murph.gateway-attachment.v1',
            transcriptText: null,
          },
        ],
        createdAt: '2026-04-08T09:55:00.000Z',
        direction: 'inbound',
        messageId: primaryOlderMessageId,
        schema: 'murph.gateway-message.v1',
        sessionKey: primary.sessionKey,
        text: 'Need help',
      },
      {
        actorDisplayName: null,
        attachments: [],
        createdAt: '2026-04-08T10:00:00.000Z',
        direction: 'outbound',
        messageId: primaryNewerMessageId,
        schema: 'murph.gateway-message.v1',
        sessionKey: primary.sessionKey,
        text: 'Sure',
      },
      {
        actorDisplayName: 'Billing Bot',
        attachments: [],
        createdAt: '2026-04-08T11:05:00.000Z',
        direction: 'outbound',
        messageId: archiveMessageId,
        schema: 'murph.gateway-message.v1',
        sessionKey: archive.sessionKey,
        text: 'Invoice ready',
      },
    ],
    permissions: [
      {
        action: 'reply',
        description: 'Reply to the customer',
        note: null,
        requestedAt: '2026-04-08T10:05:00.000Z',
        requestId: 'perm-primary',
        resolvedAt: null,
        schema: 'murph.gateway-permission-request.v1',
        sessionKey: primary.sessionKey,
        status: 'open',
      },
      {
        action: 'reply',
        description: 'Reply to billing',
        note: 'Resolved after approval',
        requestedAt: '2026-04-08T11:10:00.000Z',
        requestId: 'perm-archive',
        resolvedAt: '2026-04-08T11:15:00.000Z',
        schema: 'murph.gateway-permission-request.v1',
        sessionKey: archive.sessionKey,
        status: 'approved',
      },
    ],
    schema: 'murph.gateway-projection-snapshot.v1',
  }

  const next: GatewayProjectionSnapshot = {
    ...previous,
    conversations: [
      {
        ...previous.conversations[0],
        lastActivityAt: '2026-04-08T10:20:00.000Z',
        title: 'Alice from Telegram',
        titleSource: 'participant-display-name',
      },
      previous.conversations[1],
    ],
    generatedAt: '2026-04-08T12:05:00.000Z',
    messages: [
      ...previous.messages,
      {
        actorDisplayName: 'Alice',
        attachments: [],
        createdAt: '2026-04-08T10:15:00.000Z',
        direction: 'inbound',
        messageId: primaryNewestMessageId,
        schema: 'murph.gateway-message.v1',
        sessionKey: primary.sessionKey,
        text: 'Any update?',
      },
    ],
    permissions: [
      {
        ...previous.permissions[0],
        note: 'Approved by operator',
        resolvedAt: '2026-04-08T10:25:00.000Z',
        status: 'approved',
      },
      previous.permissions[1],
    ],
  }

  return {
    archive,
    attachmentId,
    next,
    primary,
    primaryNewerMessageId,
    primaryNewestMessageId,
    primaryOlderMessageId,
    previous,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('@murphai/gateway-core snapshot, event-log, and barrel behavior', () => {
  it('lists conversations with derived title controls and search filtering', () => {
    const { next } = buildProjectionSnapshots()

    const allConversations = listGatewayConversationsFromSnapshot(next, {
      includeDerivedTitles: false,
      includeLastMessage: false,
      limit: 10,
    })

    expect(allConversations.conversations).toHaveLength(2)
    expect(allConversations.conversations.map((conversation) => conversation.sessionKey)).toEqual([
      next.conversations[1].sessionKey,
      next.conversations[0].sessionKey,
    ])
    expect(allConversations.conversations[0].title).toBe('Billing')
    expect(allConversations.conversations[0].lastMessagePreview).toBeNull()
    expect(allConversations.conversations[1].title).toBeNull()
    expect(allConversations.conversations[1].lastMessagePreview).toBeNull()

    const telegramSearch = listGatewayConversationsFromSnapshot(next, {
      channel: 'telegram',
      search: 'alice',
      limit: 10,
    })

    expect(telegramSearch.conversations).toHaveLength(1)
    expect(telegramSearch.conversations[0].sessionKey).toBe(next.conversations[0].sessionKey)
    expect(telegramSearch.conversations[0].title).toBe('Alice from Telegram')
    expect(telegramSearch.conversations[0].lastMessagePreview).toBe('Need help')
  })

  it('falls back through actor, participant, thread, and channel titles while searching message content', () => {
    const { previous } = buildProjectionSnapshots()
    const actorOnly = buildSession('route-actor-only')
    const participantOnly = buildSession('route-participant-only')
    const threadOnly = buildSession('route-thread-only')
    const channelOnly = buildSession('route-channel-only')
    const actorMessageId = createGatewayOutboxMessageId(actorOnly.routeToken, 'intent-actor')

    const snapshot: GatewayProjectionSnapshot = {
      ...previous,
      conversations: [
        ...previous.conversations,
        {
          canSend: true,
          lastActivityAt: '2026-04-08T12:20:00.000Z',
          lastMessagePreview: null,
          messageCount: 1,
          route: {
            channel: 'telegram',
            directness: 'direct',
            identityId: null,
            participantId: 'actor-contact',
            reply: {
              kind: 'thread',
              target: 'thread-actor-only',
            },
            threadId: 'thread-actor-only',
          },
          schema: 'murph.gateway-conversation.v1',
          sessionKey: actorOnly.sessionKey,
          title: null,
          titleSource: null,
        },
        {
          canSend: true,
          lastActivityAt: '2026-04-08T12:19:00.000Z',
          lastMessagePreview: null,
          messageCount: 0,
          route: {
            channel: 'email',
            directness: 'direct',
            identityId: null,
            participantId: 'participant-only@example.test',
            reply: {
              kind: 'participant',
              target: 'participant-only@example.test',
            },
            threadId: null,
          },
          schema: 'murph.gateway-conversation.v1',
          sessionKey: participantOnly.sessionKey,
          title: null,
          titleSource: null,
        },
        {
          canSend: false,
          lastActivityAt: '2026-04-08T12:18:00.000Z',
          lastMessagePreview: null,
          messageCount: 0,
          route: {
            channel: 'sms',
            directness: 'group',
            identityId: null,
            participantId: null,
            reply: {
              kind: 'thread',
              target: 'thread-thread-only',
            },
            threadId: 'thread-thread-only',
          },
          schema: 'murph.gateway-conversation.v1',
          sessionKey: threadOnly.sessionKey,
          title: null,
          titleSource: null,
        },
        {
          canSend: false,
          lastActivityAt: '2026-04-08T12:17:00.000Z',
          lastMessagePreview: null,
          messageCount: 0,
          route: {
            channel: 'whatsapp',
            directness: 'group',
            identityId: null,
            participantId: '   ',
            reply: {
              kind: 'thread',
              target: 'channel-only-thread',
            },
            threadId: '   ',
          },
          schema: 'murph.gateway-conversation.v1',
          sessionKey: channelOnly.sessionKey,
          title: null,
          titleSource: null,
        },
      ],
      messages: [
        ...previous.messages,
        {
          actorDisplayName: 'Outbound Alias',
          attachments: [
            {
              attachmentId: createGatewayAttachmentId(actorOnly.routeToken, 'capture-actor', 'att-voice'),
              byteSize: 42,
              extractedText: 'Voice memo transcript',
              fileName: 'voice-note.ogg',
              kind: 'audio',
              messageId: actorMessageId,
              mime: 'audio/ogg',
              parseState: 'parsed',
              schema: 'murph.gateway-attachment.v1',
              transcriptText: 'Follow-up from audio',
            },
          ],
          createdAt: '2026-04-08T12:20:00.000Z',
          direction: 'outbound',
          messageId: actorMessageId,
          schema: 'murph.gateway-message.v1',
          sessionKey: actorOnly.sessionKey,
          text: '   ',
        },
      ],
    }

    const allConversations = listGatewayConversationsFromSnapshot(snapshot, {
      limit: 20,
      search: '   ',
    })

    expect(allConversations.conversations.map((conversation) => conversation.sessionKey)).toEqual([
      actorOnly.sessionKey,
      participantOnly.sessionKey,
      threadOnly.sessionKey,
      channelOnly.sessionKey,
      previous.conversations[1].sessionKey,
      previous.conversations[0].sessionKey,
    ])
    expect(allConversations.conversations.slice(0, 4).map((conversation) => conversation.title)).toEqual([
      'Outbound Alias',
      'participant-only@example.test',
      'thread-thread-only',
      'whatsapp',
    ])

    const transcriptMatch = listGatewayConversationsFromSnapshot(snapshot, {
      limit: 10,
      search: 'audio',
    })

    expect(transcriptMatch.conversations.map((conversation) => conversation.sessionKey)).toEqual([
      actorOnly.sessionKey,
    ])
    expect(
      listGatewayConversationsFromSnapshot(snapshot, {
        includeDerivedTitles: false,
        limit: 10,
        search: 'outbound',
      }).conversations[0]?.title,
    ).toBeNull()
  })

  it('reads messages in the requested order and pages from a cursor', () => {
    const { next, primary, primaryNewerMessageId, primaryNewestMessageId, primaryOlderMessageId } =
      buildProjectionSnapshots()

    const newestFirst = readGatewayMessagesFromSnapshot(next, {
      limit: 2,
      sessionKey: primary.sessionKey,
    })

    expect(newestFirst.messages.map((message) => message.messageId)).toEqual([
      primaryNewestMessageId,
      primaryNewerMessageId,
    ])
    expect(newestFirst.nextCursor).toBe(primaryNewerMessageId)

    const paged = readGatewayMessagesFromSnapshot(next, {
      afterMessageId: primaryNewerMessageId,
      limit: 1,
      sessionKey: primary.sessionKey,
    })

    expect(paged.messages.map((message) => message.messageId)).toEqual([primaryOlderMessageId])
    expect(paged.nextCursor).toBeNull()
  })

  it('reads conversations and permissions by session while rejecting invalid runtime ids', () => {
    const { archive, next, primary, primaryNewestMessageId } = buildProjectionSnapshots()

    const equivalentPrimarySessionKey = createGatewayConversationSessionKey(
      readGatewayConversationSessionToken(primary.sessionKey),
    )

    expect(
      getGatewayConversationFromSnapshot(next, {
        sessionKey: equivalentPrimarySessionKey,
      }),
    ).toMatchObject({
      lastMessagePreview: 'Need help',
      sessionKey: primary.sessionKey,
      title: 'Alice from Telegram',
    })
    expect(
      getGatewayConversationFromSnapshot(next, {
        sessionKey: createGatewayConversationSessionKey('route-missing'),
      }),
    ).toBeNull()

    expect(
      listGatewayOpenPermissionsFromSnapshot(next, {
        sessionKey: equivalentPrimarySessionKey,
      }).map((permission) => permission.requestId),
    ).toEqual([])

    const previousPermissions = listGatewayOpenPermissionsFromSnapshot(buildProjectionSnapshots().previous)
    expect(previousPermissions.map((permission) => permission.requestId)).toEqual(['perm-primary'])

    expect(() =>
      readGatewayMessagesFromSnapshot(next, {
        afterMessageId: primaryNewestMessageId,
        sessionKey: archive.sessionKey,
      }),
    ).toThrow(/Gateway message id did not belong to the requested session key\./u)

    expect(() =>
      getGatewayConversationFromSnapshot(next, {
        sessionKey: 'not-a-session-key',
      }),
    ).toThrow(/Gateway opaque id is invalid\./u)
  })

  it('covers message cursor validation and attachment session list branches', () => {
    const { next, primary, primaryOlderMessageId } = buildProjectionSnapshots()

    expect(
      readGatewayMessagesFromSnapshot(next, {
        limit: 5,
        oldestFirst: true,
        sessionKey: primary.sessionKey,
      }).messages.map((message) => message.messageId),
    ).toEqual([primaryOlderMessageId, next.messages[1].messageId, next.messages[3].messageId])

    expect(() =>
      readGatewayMessagesFromSnapshot(next, {
        afterMessageId: createGatewayOutboxMessageId(primary.routeToken, 'missing-intent'),
        sessionKey: primary.sessionKey,
      }),
    ).toThrow(/Gateway message cursor did not match any message in the requested session\./u)

    expect(
      fetchGatewayAttachmentsFromSnapshot(next, {
        sessionKey: primary.sessionKey,
      }).map((attachment) => attachment.attachmentId),
    ).toEqual([next.messages[0].attachments[0]?.attachmentId])

    expect(fetchGatewayAttachmentsFromSnapshot(next, {})).toEqual([])
  })

  it('deduplicates attachment lookups and rejects cross-session attachment reads', () => {
    const { archive, attachmentId, next, primary } = buildProjectionSnapshots()

    const attachments = fetchGatewayAttachmentsFromSnapshot(next, {
      attachmentIds: [attachmentId, attachmentId],
      sessionKey: primary.sessionKey,
    })

    expect(attachments).toHaveLength(1)
    expect(attachments[0].attachmentId).toBe(attachmentId)
    expect(attachments[0].fileName).toBe('invoice.pdf')

    expect(() =>
      fetchGatewayAttachmentsFromSnapshot(next, {
        attachmentIds: [attachmentId],
        sessionKey: archive.sessionKey,
      }),
    ).toThrow(/Gateway attachment id did not belong to the requested session key\./u)

    expect(
      fetchGatewayAttachmentsFromSnapshot(next, {
        messageId: next.messages[0].messageId,
      }).map((attachment) => attachment.attachmentId),
    ).toEqual([attachmentId])

    expect(() =>
      fetchGatewayAttachmentsFromSnapshot(next, {
        messageId: next.messages[0].messageId,
        sessionKey: archive.sessionKey,
      }),
    ).toThrow(/Gateway message id did not belong to the requested session key\./u)
  })

  it('returns only existing attachments across id and message lookup variants', () => {
    const { attachmentId, next, primary } = buildProjectionSnapshots()

    expect(
      fetchGatewayAttachmentsFromSnapshot(next, {
        attachmentIds: [
          attachmentId,
          createGatewayAttachmentId(primary.routeToken, 'capture-9', 'att-missing'),
        ],
        sessionKey: primary.sessionKey,
      }).map((attachment) => attachment.attachmentId),
    ).toEqual([attachmentId])

    expect(
      fetchGatewayAttachmentsFromSnapshot(next, {
        messageId: createGatewayCaptureMessageId(primary.routeToken, 'capture-missing'),
        sessionKey: primary.sessionKey,
      }),
    ).toEqual([])
  })

  it('wraps invalid message and attachment ids as runtime-id errors', () => {
    const { next } = buildProjectionSnapshots()

    expect(() =>
      fetchGatewayAttachmentsFromSnapshot(next, {
        messageId: 'not-a-message-id',
      }),
    ).toThrow(/Gateway opaque id is invalid\./u)

    expect(() =>
      fetchGatewayAttachmentsFromSnapshot(next, {
        attachmentIds: ['not-an-attachment-id'],
      }),
    ).toThrow(/Gateway opaque id is invalid\./u)
  })

  it('diffs projection changes and applies them to the event log with retention', () => {
    const { next, previous, primary } = buildProjectionSnapshots()
    const diff = diffGatewayProjectionSnapshots(previous, next)

    expect(diff.map((event) => event.kind)).toEqual([
      'message.created',
      'conversation.updated',
      'permission.resolved',
    ])
    expect(diff.map((event) => event.summary)).toEqual([
      'Any update?',
      'Alice from Telegram',
      'Approved by operator',
    ])

    const normalizedPrevious = gatewayProjectionSnapshotSchema.parse(previous)

    const unchangedState: GatewayEventLogState = {
      events: [
        {
          createdAt: '2026-04-08T09:00:00.000Z',
          cursor: 7,
          kind: 'message.created',
          messageId: null,
          permissionRequestId: null,
          schema: 'murph.gateway-event.v1',
          sessionKey: primary.sessionKey,
          summary: 'Need help',
        },
      ],
      nextCursor: 7,
      snapshot: normalizedPrevious,
    }

    expect(
      applyGatewayProjectionSnapshotToEventLog(unchangedState, normalizedPrevious),
    ).toBe(unchangedState)

    const rolledState = applyGatewayProjectionSnapshotToEventLog(unchangedState, next, 2)

    expect(rolledState.nextCursor).toBe(10)
    expect(rolledState.events.map((event) => ({ cursor: event.cursor, kind: event.kind }))).toEqual([
      { cursor: 9, kind: 'conversation.updated' },
      { cursor: 10, kind: 'permission.resolved' },
    ])
  })

  it('covers snapshot diff fallbacks and no-previous apply behavior', () => {
    const { previous, primary } = buildProjectionSnapshots()
    const fallbackAttachmentId = createGatewayAttachmentId(primary.routeToken, 'capture-3', 'att-fallback')
    const fallbackMessageId = createGatewayCaptureMessageId(primary.routeToken, 'capture-3')

    const next: GatewayProjectionSnapshot = {
      ...previous,
      conversations: [
        {
          ...previous.conversations[0],
          lastActivityAt: null,
          lastMessagePreview: null,
          title: null,
        },
        previous.conversations[1],
      ],
      generatedAt: '2026-04-08T12:15:00.000Z',
      messages: [
        ...previous.messages,
        {
          actorDisplayName: null,
          attachments: [
            {
              attachmentId: fallbackAttachmentId,
              byteSize: null,
              extractedText: null,
              fileName: 'fallback.png',
              kind: 'image',
              messageId: fallbackMessageId,
              mime: 'image/png',
              parseState: 'pending',
              schema: 'murph.gateway-attachment.v1',
              transcriptText: null,
            },
          ],
          createdAt: '2026-04-08T10:16:00.000Z',
          direction: 'inbound',
          messageId: fallbackMessageId,
          schema: 'murph.gateway-message.v1',
          sessionKey: primary.sessionKey,
          text: '   ',
        },
      ],
      permissions: [
        {
          ...previous.permissions[0],
          note: '   ',
          resolvedAt: null,
          status: 'denied',
        },
        previous.permissions[1],
        {
          action: 'archive',
          description: null,
          note: null,
          requestedAt: '2026-04-08T12:10:00.000Z',
          requestId: 'perm-fallback',
          resolvedAt: null,
          schema: 'murph.gateway-permission-request.v1',
          sessionKey: null,
          status: 'open',
        },
      ],
    }

    expect(diffGatewayProjectionSnapshots(null, next)).toEqual([])
    expect(diffGatewayProjectionSnapshots(previous, next)).toEqual([
      {
        createdAt: '2026-04-08T10:16:00.000Z',
        kind: 'message.created',
        messageId: fallbackMessageId,
        permissionRequestId: null,
        sessionKey: primary.sessionKey,
        summary: 'fallback.png',
      },
      {
        createdAt: '2026-04-08T12:10:00.000Z',
        kind: 'permission.requested',
        messageId: null,
        permissionRequestId: 'perm-fallback',
        sessionKey: null,
        summary: 'archive',
      },
      {
        createdAt: '2026-04-08T12:15:00.000Z',
        kind: 'conversation.updated',
        messageId: null,
        permissionRequestId: null,
        sessionKey: primary.sessionKey,
        summary: 'telegram',
      },
      {
        createdAt: '2026-04-08T12:15:00.000Z',
        kind: 'permission.resolved',
        messageId: null,
        permissionRequestId: 'perm-primary',
        sessionKey: primary.sessionKey,
        summary: 'denied',
      },
    ])

    expect(
      applyGatewayProjectionSnapshotToEventLog(
        {
          events: [],
          nextCursor: Number.NaN,
          snapshot: null,
        },
        next,
        0,
      ),
    ).toEqual({
      events: [],
      nextCursor: 0,
      snapshot: gatewayProjectionSnapshotSchema.parse(next),
    })
  })

  it('covers nullable-string fallbacks in previews and permission listing', () => {
    const { next, primary } = buildProjectionSnapshots()
    const withUnscopedPermission: GatewayProjectionSnapshot = {
      ...next,
      permissions: [
        {
          action: 'archive',
          description: null,
          note: null,
          requestedAt: '2026-04-08T09:59:00.000Z',
          requestId: 'perm-unscoped',
          resolvedAt: null,
          schema: 'murph.gateway-permission-request.v1',
          sessionKey: null,
          status: 'open',
        },
        ...next.permissions,
      ],
    }

    expect(deriveLastMessagePreview(null)).toBeNull()
    expect(
      deriveLastMessagePreview({
        ...next.messages[0],
        attachments: [],
        text: '   ',
      }),
    ).toBeNull()

    expect(
      listGatewayOpenPermissionsFromSnapshot(withUnscopedPermission).map(
        (permission) => permission.requestId,
      ),
    ).toEqual(['perm-unscoped'])
    expect(
      listGatewayOpenPermissionsFromSnapshot(withUnscopedPermission, {
        sessionKey: primary.sessionKey,
      }),
    ).toEqual([])
  })

  it('derives titles from the latest actor fallback and searches message-only fields', () => {
    const { previous, primary } = buildProjectionSnapshots()
    const actorFallbackSnapshot: GatewayProjectionSnapshot = {
      ...previous,
      conversations: [
        {
          ...previous.conversations[0],
          lastMessagePreview: null,
          title: null,
          titleSource: null,
        },
        previous.conversations[1],
      ],
      messages: previous.messages.map((message, index) =>
        message.sessionKey === primary.sessionKey
          ? {
              ...message,
              actorDisplayName: index === 1 ? 'Operator Echo' : null,
            }
          : message,
      ),
    }

    const extractedTextMatch = listGatewayConversationsFromSnapshot(actorFallbackSnapshot, {
      channel: 'telegram',
      limit: 10,
      search: 'invoice total',
    })

    expect(extractedTextMatch.conversations).toHaveLength(1)
    expect(extractedTextMatch.conversations[0]?.sessionKey).toBe(primary.sessionKey)
    expect(extractedTextMatch.conversations[0]?.title).toBe('Operator Echo')
    expect(
      listGatewayConversationsFromSnapshot(actorFallbackSnapshot, {
        limit: 10,
        search: '   ',
      }).conversations,
    ).toHaveLength(2)
  })

  it('covers timestamp and message comparators across equality and null branches', () => {
    const { next, primary } = buildProjectionSnapshots()

    expect(
      compareGatewayConversationsDescending(
        {
          ...next.conversations[0],
          lastActivityAt: null,
          sessionKey: primary.sessionKey,
        },
        {
          ...next.conversations[1],
          lastActivityAt: null,
          sessionKey: next.conversations[1].sessionKey,
        },
      ),
    ).toBeGreaterThan(0)
    expect(
      compareGatewayConversationsDescending(
        {
          ...next.conversations[0],
          lastActivityAt: null,
        },
        next.conversations[1],
      ),
    ).toBeGreaterThan(0)
    expect(
      compareGatewayConversationsDescending(next.conversations[1], {
        ...next.conversations[0],
        lastActivityAt: null,
      }),
    ).toBeLessThan(0)
    expect(compareGatewayMessagesAscending(next.messages[0], next.messages[1])).toBeLessThan(0)
  })

  it('polls and waits for event-log results without inventing extra state', async () => {
    const { next, primary } = buildProjectionSnapshots()
    const state: GatewayEventLogState = {
      events: [
        {
          createdAt: '2026-04-08T10:00:00.000Z',
          cursor: 1,
          kind: 'conversation.updated',
          messageId: null,
          permissionRequestId: null,
          schema: 'murph.gateway-event.v1',
          sessionKey: primary.sessionKey,
          summary: 'Alice from Telegram',
        },
        {
          createdAt: '2026-04-08T11:15:00.000Z',
          cursor: 2,
          kind: 'permission.resolved',
          messageId: null,
          permissionRequestId: 'perm-archive',
          schema: 'murph.gateway-event.v1',
          sessionKey: next.conversations[1].sessionKey,
          summary: 'Resolved after approval',
        },
      ],
      nextCursor: 2,
      snapshot: next,
    }

    const polled = pollGatewayEventLogState(state, {
      kinds: ['conversation.updated'],
      limit: 5,
      sessionKey: primary.sessionKey,
    })

    expect(polled.events).toHaveLength(1)
    expect(polled.events[0].cursor).toBe(1)
    expect(polled.nextCursor).toBe(1)
    expect(polled.live).toBe(true)

    const pollCalls: GatewayPollEventsInput[] = []
    const sleepCalls: number[] = []

    const waited = await waitForGatewayEventsByPolling(
      async (input) => {
        pollCalls.push(input)
        if (pollCalls.length === 1) {
          return {
            events: [],
            live: true,
            nextCursor: 0,
          }
        }
        return {
          events: [state.events[0]],
          live: true,
          nextCursor: state.events[0].cursor,
        }
      },
      {
        cursor: 0,
        kinds: ['conversation.updated'],
        limit: 1,
        sessionKey: primary.sessionKey,
        timeoutMs: 100,
      },
      {
        intervalMs: 25,
        sleep: async (ms) => {
          sleepCalls.push(ms)
        },
      },
    )

    expect(pollCalls).toEqual([
      {
        cursor: 0,
        kinds: ['conversation.updated'],
        limit: 1,
        sessionKey: primary.sessionKey,
      },
      {
        cursor: 0,
        kinds: ['conversation.updated'],
        limit: 1,
        sessionKey: primary.sessionKey,
      },
    ])
    expect(sleepCalls).toEqual([25])
    expect(waited.events).toHaveLength(1)
    expect(waited.events[0].cursor).toBe(1)
  })

  it('returns immediately when the first poll already has events', async () => {
    const { primary } = buildProjectionSnapshots()
    const immediateResult = {
      events: [
        {
          createdAt: '2026-04-08T10:00:00.000Z',
          cursor: 1,
          kind: 'conversation.updated' as const,
          messageId: null,
          permissionRequestId: null,
          schema: 'murph.gateway-event.v1' as const,
          sessionKey: primary.sessionKey,
          summary: 'Alice from Telegram',
        },
      ],
      live: true as const,
      nextCursor: 1,
    }

    const poll = vi.fn(async () => immediateResult)

    await expect(
      waitForGatewayEventsByPolling(poll, {
        cursor: 0,
        timeoutMs: 100,
      }),
    ).resolves.toEqual(immediateResult)
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('parses default wait input when no polling options are provided', async () => {
    let now = 5_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const poll = vi.fn(async (input?: GatewayPollEventsInput) => ({
      events: [],
      live: true,
      nextCursor: input?.cursor ?? 0,
    }))

    await expect(
      waitForGatewayEventsByPolling(poll, undefined, {
        sleep: async () => {
          now += 30_000
        },
      }),
    ).resolves.toEqual({
      events: [],
      live: true,
      nextCursor: 0,
    })
    expect(poll).toHaveBeenCalledTimes(2)
    expect(poll).toHaveBeenCalledWith({
      cursor: 0,
      kinds: [],
      limit: 50,
      sessionKey: null,
    })
  })

  it('returns the current cursor when polling finds no matching events', () => {
    const { next, primary } = buildProjectionSnapshots()
    const equivalentPrimarySessionKey = createGatewayConversationSessionKey(
      readGatewayConversationSessionToken(primary.sessionKey),
    )

    const state: GatewayEventLogState = {
      events: [
        {
          createdAt: '2026-04-08T10:00:00.000Z',
          cursor: 3,
          kind: 'conversation.updated',
          messageId: null,
          permissionRequestId: null,
          schema: 'murph.gateway-event.v1',
          sessionKey: primary.sessionKey,
          summary: 'Alice from Telegram',
        },
      ],
      nextCursor: 3,
      snapshot: next,
    }

    expect(
      pollGatewayEventLogState(state, {
        cursor: 10,
        kinds: ['permission.requested'],
        sessionKey: equivalentPrimarySessionKey,
      }),
    ).toEqual({
      events: [],
      live: true,
      nextCursor: 10,
    })
  })

  it('uses the default sleeper when none is provided', async () => {
    vi.useFakeTimers()

    const poll = vi
      .fn<Parameters<typeof waitForGatewayEventsByPolling>[0]>()
      .mockResolvedValueOnce({
        events: [],
        live: true,
        nextCursor: 0,
      })
      .mockResolvedValueOnce({
        events: [],
        live: true,
        nextCursor: 0,
      })

    const waiting = waitForGatewayEventsByPolling(
      poll,
      {
        timeoutMs: 1,
      },
      {
        intervalMs: 0,
      },
    )

    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toEqual({
      events: [],
      live: true,
      nextCursor: 0,
    })
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('stops waiting at the timeout boundary and clamps sleep to the remaining deadline', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const pollCalls: GatewayPollEventsInput[] = []
    const sleepCalls: number[] = []

    const waited = await waitForGatewayEventsByPolling(
      async (input) => {
        pollCalls.push(input)
        return {
          events: [],
          live: true,
          nextCursor: 4,
        }
      },
      {
        cursor: 4,
        timeoutMs: 50,
      },
      {
        intervalMs: 500,
        sleep: async (ms) => {
          sleepCalls.push(ms)
          now += ms
        },
      },
    )

    expect(pollCalls).toEqual([
      {
        cursor: 4,
        kinds: [],
        limit: 50,
        sessionKey: null,
      },
      {
        cursor: 4,
        kinds: [],
        limit: 50,
        sessionKey: null,
      },
    ])
    expect(sleepCalls).toEqual([50])
    expect(waited).toEqual({
      events: [],
      live: true,
      nextCursor: 4,
    })
  })

  it('clamps sub-millisecond polling intervals to one millisecond while timing out cleanly', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const sleepCalls: number[] = []
    const poll = vi.fn(async (input?: GatewayPollEventsInput) => ({
      events: [],
      live: true,
      nextCursor: input?.cursor ?? 0,
    }))

    await expect(
      waitForGatewayEventsByPolling(
        poll,
        {
          cursor: 3,
          timeoutMs: 2,
        },
        {
          intervalMs: 0.4,
          sleep: async (ms) => {
            sleepCalls.push(ms)
            now += ms
          },
        },
      ),
    ).resolves.toEqual({
      events: [],
      live: true,
      nextCursor: 3,
    })

    expect(sleepCalls).toEqual([1, 1])
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('sorts open permissions by request id when timestamps tie', () => {
    const { previous } = buildProjectionSnapshots()
    const sameTime = '2026-04-08T10:05:00.000Z'

    const sorted = listGatewayOpenPermissionsFromSnapshot({
      ...previous,
      permissions: [
        {
          ...previous.permissions[0],
          requestId: 'perm-zeta',
          requestedAt: sameTime,
        },
        {
          ...previous.permissions[0],
          requestId: 'perm-alpha',
          requestedAt: sameTime,
        },
      ],
    })

    expect(sorted.map((permission) => permission.requestId)).toEqual([
      'perm-alpha',
      'perm-zeta',
    ])
  })
})
