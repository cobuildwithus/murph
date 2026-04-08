import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

import { test } from 'vitest'

import {
  gatewayConversationSchema,
  gatewayListConversationsInputSchema,
  gatewayPollEventsResultSchema,
  gatewayRespondToPermissionInputSchema,
  gatewaySendMessageResultSchema,
  gatewaySendMessageInputSchema,
  gatewayWaitForEventsInputSchema,
} from '../src/contracts.ts'
import {
  createGatewayInvalidRuntimeIdError,
  createGatewaySessionNotFoundError,
  createGatewayUnsupportedOperationError,
  GATEWAY_SESSION_NOT_FOUND_CODE,
  GATEWAY_UNSUPPORTED_OPERATION_CODE,
  INVALID_GATEWAY_RUNTIME_ID_CODE,
} from '../src/errors.ts'
import {
  assertGatewayAttachmentId,
  assertGatewayConversationSessionKey,
  assertGatewayMessageId,
  createGatewayAttachmentId,
  createGatewayCaptureMessageId,
  createGatewayConversationSessionKey,
  createGatewayOutboxMessageId,
  readGatewayAttachmentId,
  readGatewayConversationSessionToken,
  readGatewayMessageKind,
  readGatewayMessageRouteToken,
  sameGatewayConversationSession,
} from '../src/opaque-ids.ts'
import {
  gatewayBindingDeliveryFromRoute,
  gatewayChannelSupportsReplyToMessage,
  gatewayConversationRouteCanSend,
  gatewayConversationRouteFromBinding,
  gatewayConversationRouteFromCapture,
  gatewayConversationRouteFromOutboxIntent,
  mergeGatewayConversationRoutes,
  normalizeGatewayConversationRoute,
  resolveGatewayConversationRouteKey,
} from '../src/routes.ts'
import { isoTimestampSchema, normalizeNullableString } from '../src/shared.ts'

test('shared helpers normalize nullable strings and ISO timestamps', () => {
  assert.equal(normalizeNullableString('  hello world  '), 'hello world')
  assert.equal(normalizeNullableString('   '), null)
  assert.equal(normalizeNullableString(undefined), null)
  assert.equal(isoTimestampSchema.parse('2026-04-08T12:34:56.000Z'), '2026-04-08T12:34:56.000Z')
  assert.throws(() => isoTimestampSchema.parse('not-an-iso-timestamp'), /Expected an ISO timestamp\./u)
})

test('gateway contract schemas apply their current defaults', () => {
  assert.deepEqual(
    gatewayConversationSchema.parse({
      route: {},
      schema: 'murph.gateway-conversation.v1',
      sessionKey: 'session_123',
    }),
    {
      canSend: false,
      lastActivityAt: null,
      lastMessagePreview: null,
      messageCount: null,
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
      schema: 'murph.gateway-conversation.v1',
      sessionKey: 'session_123',
      title: null,
      titleSource: null,
    },
  )

  assert.deepEqual(gatewayListConversationsInputSchema.parse({}), {
    channel: null,
    includeDerivedTitles: true,
    includeLastMessage: true,
    limit: 50,
    search: null,
  })

  assert.deepEqual(gatewayPollEventsResultSchema.parse({ nextCursor: 0 }), {
    events: [],
    live: true,
    nextCursor: 0,
  })

  assert.deepEqual(gatewaySendMessageResultSchema.parse({ sessionKey: 'session_123' }), {
    delivery: null,
    messageId: null,
    queued: false,
    sessionKey: 'session_123',
  })

  assert.deepEqual(
    gatewayWaitForEventsInputSchema.parse({
      kinds: ['message.created'],
    }),
    {
      cursor: 0,
      kinds: ['message.created'],
      limit: 50,
      sessionKey: null,
      timeoutMs: 30_000,
    },
  )

  assert.deepEqual(
    gatewaySendMessageInputSchema.parse({
      clientRequestId: '  req_1  ',
      replyToMessageId: '  msg_1  ',
      sessionKey: 'session_123',
      text: 'hello',
    }),
    {
      clientRequestId: '  req_1  ',
      replyToMessageId: '  msg_1  ',
      sessionKey: 'session_123',
      text: 'hello',
    },
  )

  assert.deepEqual(
    gatewayRespondToPermissionInputSchema.parse({
      decision: 'approve',
      requestId: 'perm_1',
    }),
    {
      decision: 'approve',
      note: null,
      requestId: 'perm_1',
    },
  )
})

test('route helpers preserve normalized conversation state and reply inference', () => {
  assert.deepEqual(
    normalizeGatewayConversationRoute({
      channel: ' telegram ',
      directness: 'direct',
      identityId: ' acct_1 ',
      participantId: ' actor_1 ',
      reply: {
        kind: 'thread',
        target: ' thread_1 ',
      },
      threadId: ' thread_1 ',
    }),
    {
      channel: 'telegram',
      directness: 'direct',
      identityId: 'acct_1',
      participantId: 'actor_1',
      reply: {
        kind: 'thread',
        target: 'thread_1',
      },
      threadId: 'thread_1',
    },
  )

  const bindingRoute = gatewayConversationRouteFromBinding({
    actorId: 'actor_2',
    channel: 'linq',
    delivery: null,
    threadId: 'thread_2',
    threadIsDirect: false,
  })

  assert.deepEqual(bindingRoute, {
    channel: 'linq',
    directness: 'group',
    identityId: null,
    participantId: 'actor_2',
    reply: {
      kind: null,
      target: null,
    },
    threadId: 'thread_2',
  })
  assert.equal(gatewayConversationRouteCanSend(bindingRoute), true)
  assert.deepEqual(gatewayBindingDeliveryFromRoute(bindingRoute), {
    kind: 'thread',
    target: 'thread_2',
  })
  assert.equal(gatewayChannelSupportsReplyToMessage('linq'), true)
  assert.equal(gatewayChannelSupportsReplyToMessage('telegram'), false)

  const threadRoute = normalizeGatewayConversationRoute({
    channel: 'linq',
    directness: 'group',
    participantId: 'actor_2',
    reply: {
      kind: 'thread',
      target: 'thread_2',
    },
    threadId: 'thread_2',
  })

  const captureRoute = gatewayConversationRouteFromCapture({
    accountId: 'acct_3',
    actor: { id: 'actor_3' },
    source: 'email',
    thread: {
      id: 'thread_3',
      isDirect: true,
    },
  })

  assert.deepEqual(captureRoute, {
    channel: 'email',
    directness: 'direct',
    identityId: 'acct_3',
    participantId: 'actor_3',
    reply: {
      kind: null,
      target: null,
    },
    threadId: 'thread_3',
  })
  assert.equal(resolveGatewayConversationRouteKey(captureRoute), 'channel:email|identity:acct_3|actor:actor_3')

  const outboxRoute = gatewayConversationRouteFromOutboxIntent({
    actorId: 'actor_4',
    bindingDelivery: {
      kind: 'participant',
      target: 'actor_4',
    },
    channel: 'telegram',
    threadId: 'thread_4',
    threadIsDirect: true,
  })

  assert.deepEqual(outboxRoute, {
    channel: 'telegram',
    directness: 'direct',
    identityId: null,
    participantId: 'actor_4',
    reply: {
      kind: 'participant',
      target: 'actor_4',
    },
    threadId: 'thread_4',
  })
  assert.equal(gatewayConversationRouteCanSend(outboxRoute), true)
  assert.deepEqual(gatewayBindingDeliveryFromRoute(outboxRoute), {
    kind: 'participant',
    target: 'actor_4',
  })

  const mergedRoute = mergeGatewayConversationRoutes(
    threadRoute,
    {
      identityId: 'acct_2',
    },
  )

  assert.deepEqual(mergedRoute, {
    channel: 'linq',
    directness: 'group',
    identityId: 'acct_2',
    participantId: 'actor_2',
    reply: {
      kind: 'thread',
      target: 'thread_2',
    },
    threadId: 'thread_2',
  })
  assert.equal(
    gatewayConversationRouteCanSend({
      channel: 'linq',
      participantId: 'actor_5',
      reply: {
        kind: 'participant',
        target: 'actor_5',
      },
      threadId: 'thread_5',
    }),
    false,
  )

  assert.equal(
    resolveGatewayConversationRouteKey({
      channel: 'sms',
      participantId: 'actor direct',
      threadId: 'thread_unused',
    }),
    'channel:sms|actor:actor%20direct',
  )

  assert.deepEqual(
    mergeGatewayConversationRoutes(
      {
        channel: 'telegram',
        participantId: 'actor_6',
        reply: {
          kind: 'thread',
          target: 'thread-old',
        },
        threadId: 'thread-old',
      },
      {
        threadId: 'thread-new',
      },
    ),
    {
      channel: 'telegram',
      directness: null,
      identityId: null,
      participantId: 'actor_6',
      reply: {
        kind: 'thread',
        target: 'thread-new',
      },
      threadId: 'thread-new',
    },
  )

  assert.deepEqual(
    gatewayBindingDeliveryFromRoute({
      channel: 'custom',
      directness: 'group',
      participantId: 'actor_7',
      threadId: 'thread_7',
    }),
    {
      kind: 'thread',
      target: 'thread_7',
    },
  )
})

test('opaque id helpers preserve route tokens and reject malformed envelopes', () => {
  const routeKey = 'channel:telegram|identity:acct_1|actor:actor_1'
  const sessionKey = createGatewayConversationSessionKey(routeKey)
  const normalizedSessionKey = readGatewayConversationSessionToken(sessionKey)

  assert.match(sessionKey, /^gwcs_/u)
  assert.notEqual(normalizedSessionKey, routeKey)
  assert.equal(
    sameGatewayConversationSession(sessionKey, createGatewayConversationSessionKey(normalizedSessionKey)),
    true,
  )
  assert.equal(assertGatewayConversationSessionKey(sessionKey), sessionKey)

  const captureMessageId = createGatewayCaptureMessageId('route-token-1', 'capture-1')
  const outboxMessageId = createGatewayOutboxMessageId('route-token-1', 'intent-1')
  const attachmentId = createGatewayAttachmentId('route-token-1', 'capture-1', 'attachment-1')

  assert.match(captureMessageId, /^gwcm_/u)
  assert.match(outboxMessageId, /^gwcm_/u)
  assert.match(attachmentId, /^gwca_/u)
  assert.equal(readGatewayMessageKind(captureMessageId), 'capture-message')
  assert.equal(readGatewayMessageKind(outboxMessageId), 'outbox-message')
  assert.equal(readGatewayMessageRouteToken(captureMessageId), 'route-token-1')
  assert.equal(readGatewayMessageRouteToken(outboxMessageId), 'route-token-1')
  const attachment = readGatewayAttachmentId(attachmentId)

  assert.deepEqual(attachment, {
    kind: 'attachment',
    routeToken: 'route-token-1',
    sourceToken: attachment.sourceToken,
    version: 2,
  })
  assert.equal(assertGatewayAttachmentId(attachmentId), attachmentId)
  assert.equal(assertGatewayMessageId(outboxMessageId), outboxMessageId)

  const malformedAttachmentEnvelope = `gwca_${Buffer.from(
    JSON.stringify({
      kind: 'conversation',
      routeToken: 'route-token-1',
      sourceToken: 'source-token',
      version: 2,
    }),
    'utf8',
  ).toString('base64url')}`

  assert.throws(
    () => readGatewayAttachmentId(malformedAttachmentEnvelope),
    /Gateway attachment id is invalid\./u,
  )
})

test('gateway errors annotate the expected code values', () => {
  const invalidRuntimeIdError = createGatewayInvalidRuntimeIdError('bad runtime id')
  const unsupportedOperationError = createGatewayUnsupportedOperationError('not supported')
  const sessionNotFoundError = createGatewaySessionNotFoundError('missing session')

  assert.equal(invalidRuntimeIdError.message, 'bad runtime id')
  assert.equal(unsupportedOperationError.message, 'not supported')
  assert.equal(sessionNotFoundError.message, 'missing session')
  assert.equal(invalidRuntimeIdError.code, INVALID_GATEWAY_RUNTIME_ID_CODE)
  assert.equal(unsupportedOperationError.code, GATEWAY_UNSUPPORTED_OPERATION_CODE)
  assert.equal(sessionNotFoundError.code, GATEWAY_SESSION_NOT_FOUND_CODE)
})
