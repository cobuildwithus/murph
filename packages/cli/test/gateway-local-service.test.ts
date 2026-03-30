import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murph/core'
import { createInboxPipeline, openInboxRuntime } from '@murph/inboxd'
import { test } from 'vitest'

import { assistantSessionSchema } from '../src/assistant-cli-contracts.js'
import { createAssistantBinding } from '../src/assistant/bindings.js'
import { saveAssistantOutboxIntent } from '../src/assistant/outbox.js'
import { saveAssistantSession } from '../src/assistant/store.js'
import {
  fetchGatewayAttachmentsLocal,
  getGatewayConversationLocal,
  listGatewayConversationsLocal,
  readGatewayMessagesLocal,
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
    assert.equal(emailConversation.canSend, true)
    assert.equal(emailConversation.lastMessagePreview, 'Please send the latest PDF.')
    assert.equal(emailConversation.messageCount, 2)
    assert.match(emailConversation.sessionKey, /^gwcs_/u)
    assert.doesNotMatch(emailConversation.sessionKey, /channel:email/u)

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
    assert.equal(messages.messages[1]?.direction, 'outbound')
    assert.equal(messages.messages[1]?.text, 'Please send the latest PDF.')

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
