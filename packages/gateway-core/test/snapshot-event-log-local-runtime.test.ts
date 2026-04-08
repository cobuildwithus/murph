import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyGatewayProjectionSnapshotToEventLog,
  createGatewayAttachmentId,
  createGatewayCaptureMessageId,
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
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
})
