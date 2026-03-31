import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murph/core'
import { createInboxPipeline, openInboxRuntime } from '@murph/inboxd'
import { test } from 'vitest'

import { assistantSessionSchema } from '../src/assistant-cli-contracts.js'
import { createAssistantBinding } from '../src/assistant/bindings.js'
import { listAssistantOutboxIntentsLocal, saveAssistantOutboxIntent } from '../src/assistant/outbox.js'
import { saveAssistantSession } from '../src/assistant/store.js'
import {
  createLocalGatewayService,
  fetchGatewayAttachmentsLocal,
  getGatewayConversationLocal,
  listGatewayConversationsLocal,
  pollGatewayEventsLocalWrapper,
  readGatewayMessagesLocal,
  sendGatewayMessageLocal,
} from '../src/gateway-core-local.js'

test('local gateway projection derives route-backed conversations and transcripts from inbox captures plus assistant state', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-local-'))
  const attachmentSourceRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-attachment-'))

  try {
    await initializeVault({ vaultRoot })

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    const attachmentPath = path.join(attachmentSourceRoot, 'labs.pdf')
    await writeFile(attachmentPath, 'pdf', 'utf8')

    await pipeline.processCapture({
      source: 'email',
      externalId: 'email-1',
      accountId: 'murph@example.com',
      thread: {
        id: 'thread-labs',
        title: 'Lab updates',
        isDirect: false,
      },
      actor: {
        id: 'contact:alex',
        displayName: 'Alex',
        isSelf: false,
      },
      occurredAt: '2026-03-30T09:00:00.000Z',
      receivedAt: '2026-03-30T09:00:01.000Z',
      text: 'Here is the latest lab PDF.',
      attachments: [
        {
          externalId: 'att-email-1',
          kind: 'document',
          mime: 'application/pdf',
          originalPath: attachmentPath,
          fileName: 'labs.pdf',
          byteSize: 3,
        },
      ],
      raw: {
        provider: 'agentmail',
      },
    })

    await pipeline.processCapture({
      source: 'telegram',
      externalId: 'telegram-1',
      thread: {
        id: 'chat-77',
        title: 'Check-ins',
        isDirect: true,
      },
      actor: {
        id: 'contact:taylor',
        displayName: 'Taylor',
        isSelf: false,
      },
      occurredAt: '2026-03-30T10:00:00.000Z',
      receivedAt: '2026-03-30T10:00:01.000Z',
      text: 'How are you feeling today?',
      attachments: [],
      raw: {
        message: {
          message_id: 4321,
        },
        provider: 'telegram',
      },
    })

    runtime.close()

    await saveAssistantSession(
      vaultRoot,
      assistantSessionSchema.parse({
        schema: 'murph.assistant-session.v3',
        sessionId: 'asst_gateway_thread_labs',
        provider: 'codex-cli',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
        },
        providerBinding: null,
        alias: 'Lab thread',
        binding: createAssistantBinding({
          actorId: 'contact:alex',
          channel: 'email',
          deliveryKind: 'thread',
          identityId: 'murph@example.com',
          threadId: 'thread-labs',
          threadIsDirect: false,
        }),
        createdAt: '2026-03-30T08:55:00.000Z',
        updatedAt: '2026-03-30T09:05:00.000Z',
        lastTurnAt: null,
        turnCount: 1,
      }),
    )

    await saveAssistantOutboxIntent(vaultRoot, {
      schema: 'murph.assistant-outbox-intent.v1',
      intentId: 'outbox_gateway_thread_labs',
      sessionId: 'asst_gateway_thread_labs',
      turnId: 'turn_gateway_thread_labs',
      createdAt: '2026-03-30T09:06:00.000Z',
      updatedAt: '2026-03-30T09:07:00.000Z',
      lastAttemptAt: '2026-03-30T09:06:30.000Z',
      nextAttemptAt: null,
      sentAt: '2026-03-30T09:07:00.000Z',
      attemptCount: 1,
      status: 'sent',
      message: 'Please send the latest PDF.',
      dedupeKey: 'gateway-dedupe-thread-labs',
      targetFingerprint: 'gateway-fingerprint-thread-labs',
      channel: 'email',
      identityId: 'murph@example.com',
      actorId: 'contact:alex',
      threadId: 'thread-labs',
      threadIsDirect: false,
      replyToMessageId: null,
      bindingDelivery: {
        kind: 'thread',
        target: 'thread-labs',
      },
      explicitTarget: null,
      delivery: {
        channel: 'email',
        idempotencyKey: 'idem-thread-labs',
        providerMessageId: 'provider-out-1',
        providerThreadId: 'thread-labs',
        target: 'thread-labs',
        targetKind: 'thread',
        sentAt: '2026-03-30T09:07:00.000Z',
        messageLength: 27,
      },
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: 'idem-thread-labs',
      deliveryTransportIdempotent: true,
      lastError: null,
    })

    const runtimeAfterSend = await openInboxRuntime({ vaultRoot })
    const pipelineAfterSend = await createInboxPipeline({ vaultRoot, runtime: runtimeAfterSend })
    await pipelineAfterSend.processCapture({
      source: 'email',
      externalId: 'email:provider-out-1',
      accountId: 'murph@example.com',
      thread: {
        id: 'thread-labs',
        title: 'Lab updates',
        isDirect: false,
      },
      actor: {
        id: 'murph@example.com',
        displayName: 'Murph',
        isSelf: true,
      },
      occurredAt: '2026-03-30T09:07:30.000Z',
      receivedAt: '2026-03-30T09:07:31.000Z',
      text: 'Please send the latest PDF.',
      attachments: [],
      raw: {
        provider: 'agentmail',
      },
    })
    runtimeAfterSend.close()

    const listed = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })

    assert.equal(listed.nextCursor, null)
    assert.equal(listed.conversations.length, 2)

    const emailConversation = listed.conversations.find(
      (conversation) => conversation.route.channel === 'email',
    )
    assert.ok(emailConversation)
    assert.equal(emailConversation.title, 'Lab thread')
    assert.equal(emailConversation.titleSource, 'alias')
    assert.equal(emailConversation.canSend, true)
    assert.equal(emailConversation.lastMessagePreview, 'Please send the latest PDF.')
    assert.equal(emailConversation.messageCount, 2)
    assert.match(emailConversation.sessionKey, /^gwcs_/u)
    assert.doesNotMatch(emailConversation.sessionKey, /channel:email/u)
    assertGatewayOpaqueIdDoesNotExposeRawRoute(emailConversation.sessionKey, [
      'channel:email',
      'thread-labs',
      'contact:alex',
      'murph@example.com',
    ])

    const fetched = await getGatewayConversationLocal(vaultRoot, {
      sessionKey: emailConversation.sessionKey,
    })
    assert.deepEqual(fetched, emailConversation)

    const messages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: emailConversation.sessionKey,
    })
    assert.equal(messages.nextCursor, null)
    assert.equal(messages.messages.length, 2)
    assert.equal(messages.messages[0]?.direction, 'inbound')
    assert.equal(messages.messages[0]?.text, 'Here is the latest lab PDF.')
    assert.match(messages.messages[0]?.attachments[0]?.attachmentId ?? '', /^gwca_/u)
    assertGatewayOpaqueIdDoesNotExposeRawRoute(messages.messages[0]?.messageId ?? '', [
      'channel:email',
      'thread-labs',
      'contact:alex',
      'murph@example.com',
    ])
    assertGatewayOpaqueIdDoesNotExposeRawRoute(
      messages.messages[0]?.attachments[0]?.attachmentId ?? '',
      ['channel:email', 'thread-labs', 'contact:alex', 'murph@example.com'],
    )
    assert.equal(messages.messages[1]?.direction, 'outbound')
    assert.equal(messages.messages[1]?.text, 'Please send the latest PDF.')

    const legacySessionKey = createLegacyGatewayConversationSessionKey(
      'channel:email|identity:murph%40example.com|thread:thread-labs',
    )
    const fetchedFromLegacySessionKey = await getGatewayConversationLocal(vaultRoot, {
      sessionKey: legacySessionKey,
    })
    assert.equal(fetchedFromLegacySessionKey?.sessionKey, emailConversation.sessionKey)
    const messagesFromLegacySessionKey = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: legacySessionKey,
    })
    assert.equal(messagesFromLegacySessionKey.messages.length, 2)

    const attachments = await fetchGatewayAttachmentsLocal(vaultRoot, {
      attachmentIds: [],
      messageId: messages.messages[0]?.messageId ?? '',
      sessionKey: null,
    })
    assert.equal(attachments.length, 1)
    assert.equal(attachments[0]?.fileName, 'labs.pdf')
    assert.equal(attachments[0]?.mime, 'application/pdf')
    assert.equal(attachments[0]?.parseState, 'pending')

    const search = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: 'latest pdf',
    })
    assert.equal(search.conversations.length, 1)
    assert.equal(search.conversations[0]?.route.channel, 'email')

    const filtered = await listGatewayConversationsLocal(vaultRoot, {
      channel: 'telegram',
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })
    assert.equal(filtered.conversations.length, 1)
    assert.equal(filtered.conversations[0]?.title, 'Check-ins')
    assert.equal(filtered.conversations[0]?.canSend, true)
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
    await rm(attachmentSourceRoot, { force: true, recursive: true })
  }
})

test('local gateway hides actor-derived titles unless includeDerivedTitles is enabled', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-derived-title-'))

  try {
    await initializeVault({ vaultRoot })

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      source: 'telegram',
      externalId: 'telegram-derived-title-1',
      thread: {
        id: 'chat-derived-title',
        title: null,
        isDirect: true,
      },
      actor: {
        id: 'contact:jordan',
        displayName: 'Jordan',
        isSelf: false,
      },
      occurredAt: '2026-03-30T11:00:00.000Z',
      receivedAt: '2026-03-30T11:00:01.000Z',
      text: 'Checking in.',
      attachments: [],
      raw: {
        provider: 'telegram',
      },
    })
    runtime.close()

    const withoutDerivedTitles = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: false,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })
    assert.equal(withoutDerivedTitles.conversations.length, 1)
    assert.equal(withoutDerivedTitles.conversations[0]?.title, null)

    const withDerivedTitles = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })
    assert.equal(withDerivedTitles.conversations.length, 1)
    assert.equal(withDerivedTitles.conversations[0]?.title, 'Jordan')
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('local gateway send uses route-bound assistant delivery and Linq reply targets diff the derived projection', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-send-'))

  try {
    await initializeVault({ vaultRoot })

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:4321',
      thread: {
        id: 'chat-send-1',
        title: 'Check-ins',
        isDirect: true,
      },
      actor: {
        id: 'contact:taylor',
        displayName: 'Taylor',
        isSelf: false,
      },
      occurredAt: '2026-03-30T10:00:00.000Z',
      receivedAt: '2026-03-30T10:00:01.000Z',
      text: 'Can you check in later today?',
      attachments: [],
      raw: {},
    })
    runtime.close()

    const listed = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })
    const conversation = listed.conversations[0]
    assert.ok(conversation)
    assert.equal(conversation.canSend, true)

    const initialMessages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: conversation.sessionKey,
    })
    const baseline = await pollGatewayEventsLocalWrapper(vaultRoot, {
      cursor: 0,
      kinds: [],
      limit: 20,
      sessionKey: conversation.sessionKey,
    })
    const sent = await sendGatewayMessageLocal({
      dispatchMode: 'queue-only',
      replyToMessageId: initialMessages.messages[0]?.messageId ?? null,
      sessionKey: conversation.sessionKey,
      text: 'I will check in later today.',
      vault: vaultRoot,
    })
    assert.equal(sent.sessionKey, conversation.sessionKey)
    assert.equal(sent.queued, true)
    assert.match(sent.messageId ?? '', /^gwcm_/u)

    const queuedIntents = await listAssistantOutboxIntentsLocal(vaultRoot)
    assert.equal(queuedIntents.length, 1)
    assert.match(queuedIntents[0]?.sessionId ?? '', /^gwds_gwcs_/u)
    assert.equal(queuedIntents[0]?.replyToMessageId, '4321')

    const runtimeAfterBaseline = await openInboxRuntime({ vaultRoot })
    const pipelineAfterBaseline = await createInboxPipeline({
      vaultRoot,
      runtime: runtimeAfterBaseline,
    })
    await pipelineAfterBaseline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:4322',
      thread: {
        id: 'chat-send-1',
        title: 'Check-ins',
        isDirect: true,
      },
      actor: {
        id: 'contact:taylor',
        displayName: 'Taylor',
        isSelf: false,
      },
      occurredAt: '2026-03-30T10:05:00.000Z',
      receivedAt: '2026-03-30T10:05:01.000Z',
      text: 'Sounds good, thank you!',
      attachments: [],
      raw: {},
    })
    runtimeAfterBaseline.close()

    const events = await pollGatewayEventsLocalWrapper(vaultRoot, {
      cursor: baseline.nextCursor,
      kinds: [],
      limit: 20,
      sessionKey: conversation.sessionKey,
    })
    assert.ok(events.events.some((event) => event.kind === 'message.created'))
    assert.ok(events.events.some((event) => event.kind === 'conversation.updated'))

    const messages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: conversation.sessionKey,
    })
    assert.equal(messages.messages.length, 2)
    assert.equal(messages.messages[1]?.text, 'Sounds good, thank you!')
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

function assertGatewayOpaqueIdDoesNotExposeRawRoute(
  opaqueId: string,
  forbiddenFragments: string[],
): void {
  const encoded = opaqueId.slice(opaqueId.indexOf('_') + 1)
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
  for (const fragment of forbiddenFragments) {
    assert.doesNotMatch(decoded, new RegExp(escapeRegExp(fragment), 'u'))
  }
}

function createLegacyGatewayConversationSessionKey(routeKey: string): string {
  return `gwcs_${Buffer.from(
    JSON.stringify({
      kind: 'conversation',
      routeKey,
      version: 1,
    }),
    'utf8',
  ).toString('base64url')}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

test('local gateway send resolves reply-to provider ids from sent outbox messages within the same session', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-send-outbox-reply-'))

  try {
    await initializeVault({ vaultRoot })

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:5001',
      thread: {
        id: 'chat-send-2',
        title: 'Check-ins',
        isDirect: true,
      },
      actor: {
        id: 'contact:taylor',
        displayName: 'Taylor',
        isSelf: false,
      },
      occurredAt: '2026-03-30T10:00:00.000Z',
      receivedAt: '2026-03-30T10:00:01.000Z',
      text: 'Can you check in later today?',
      attachments: [],
      raw: {},
    })
    runtime.close()

    const conversation = (await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })).conversations[0]
    assert.ok(conversation)

    await saveAssistantOutboxIntent(vaultRoot, {
      schema: 'murph.assistant-outbox-intent.v1',
      intentId: 'outbox_gateway_linq_reply_source',
      sessionId: 'gwds_source_session',
      turnId: 'turn_gateway_linq_reply_source',
      createdAt: '2026-03-30T10:01:00.000Z',
      updatedAt: '2026-03-30T10:01:30.000Z',
      lastAttemptAt: '2026-03-30T10:01:15.000Z',
      nextAttemptAt: null,
      sentAt: '2026-03-30T10:01:30.000Z',
      attemptCount: 1,
      status: 'sent',
      message: 'I will check in later today.',
      dedupeKey: 'gateway-linq-reply-source',
      targetFingerprint: 'gateway-linq-reply-source',
      channel: 'linq',
      identityId: 'default',
      actorId: 'contact:taylor',
      threadId: 'chat-send-2',
      threadIsDirect: true,
      replyToMessageId: '5001',
      bindingDelivery: {
        kind: 'thread',
        target: 'chat-send-2',
      },
      explicitTarget: null,
      delivery: {
        channel: 'linq',
        idempotencyKey: 'idem-linq-reply-source',
        providerMessageId: '6001',
        providerThreadId: 'chat-send-2',
        target: 'chat-send-2',
        targetKind: 'thread',
        sentAt: '2026-03-30T10:01:30.000Z',
        messageLength: 28,
      },
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: 'idem-linq-reply-source',
      deliveryTransportIdempotent: true,
      lastError: null,
    })

    const messages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: conversation.sessionKey,
    })
    const outboundMessageId = messages.messages.find((message) => message.direction === 'outbound')?.messageId
    assert.ok(outboundMessageId)

    const sent = await sendGatewayMessageLocal({
      dispatchMode: 'queue-only',
      replyToMessageId: outboundMessageId ?? null,
      sessionKey: conversation.sessionKey,
      text: 'Replying to the outbound thread message.',
      vault: vaultRoot,
    })
    assert.equal(sent.sessionKey, conversation.sessionKey)

    const queuedIntents = await listAssistantOutboxIntentsLocal(vaultRoot)
    const replyIntent = queuedIntents.find((intent) => intent.intentId !== 'outbox_gateway_linq_reply_source')
    assert.equal(replyIntent?.replyToMessageId, '6001')
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('local gateway send rejects reply-to message ids from a different session', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-send-cross-session-'))

  try {
    await initializeVault({ vaultRoot })

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:7001',
      thread: {
        id: 'chat-a',
        title: 'Thread A',
        isDirect: true,
      },
      actor: {
        id: 'contact:alex',
        displayName: 'Alex',
        isSelf: false,
      },
      occurredAt: '2026-03-30T11:00:00.000Z',
      receivedAt: '2026-03-30T11:00:01.000Z',
      text: 'Thread A message',
      attachments: [],
      raw: {},
    })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:8001',
      thread: {
        id: 'chat-b',
        title: 'Thread B',
        isDirect: true,
      },
      actor: {
        id: 'contact:blair',
        displayName: 'Blair',
        isSelf: false,
      },
      occurredAt: '2026-03-30T11:05:00.000Z',
      receivedAt: '2026-03-30T11:05:01.000Z',
      text: 'Thread B message',
      attachments: [],
      raw: {},
    })
    runtime.close()

    const conversations = (await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })).conversations
    assert.equal(conversations.length, 2)

    const firstConversation = conversations.find((conversation) => conversation.route.threadId === 'chat-a')
    const secondConversation = conversations.find((conversation) => conversation.route.threadId === 'chat-b')
    assert.ok(firstConversation)
    assert.ok(secondConversation)

    const secondMessages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: secondConversation!.sessionKey,
    })
    const wrongReplyMessageId = secondMessages.messages[0]?.messageId ?? null
    assert.ok(wrongReplyMessageId)

    await assert.rejects(
      () =>
        sendGatewayMessageLocal({
          dispatchMode: 'queue-only',
          replyToMessageId: wrongReplyMessageId,
          sessionKey: firstConversation!.sessionKey,
          text: 'This should fail.',
          vault: vaultRoot,
        }),
      /did not belong to the requested session key/i,
    )
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})
