import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murph/core'
import { createInboxPipeline, openInboxRuntime } from '@murph/inboxd'
import {
  openSqliteRuntimeDatabase,
  resolveGatewayRuntimePaths,
  resolveInboxRuntimePaths,
} from '@murph/runtime-state'
import { test } from 'vitest'

import { assistantSessionSchema } from '@murph/assistant-core/assistant-cli-contracts'
import { createAssistantBinding } from '@murph/assistant-core/assistant/bindings'
import { listAssistantOutboxIntentsLocal, saveAssistantOutboxIntent } from '../src/assistant/outbox.js'
import { saveAssistantSession } from '../src/assistant/store.js'
import {
  exportGatewayProjectionSnapshotLocal,
  fetchGatewayAttachmentsLocal,
  getGatewayConversationLocal,
  listGatewayConversationsLocal,
  listGatewayOpenPermissionsLocalWrapper,
  pollGatewayEventsLocalWrapper,
  readGatewayMessagesLocal,
  respondToGatewayPermissionLocalWrapper,
  sendGatewayMessageLocal,
} from '@murph/gateway-local'

async function rewriteInboxCaptureRuntimeRecord(input: {
  accountId?: string | null
  externalId: string
  source: string
  textContent: string
  threadTitle?: string | null
  vaultRoot: string
}): Promise<void> {
  const database = openSqliteRuntimeDatabase(resolveInboxRuntimePaths(input.vaultRoot).inboxDbPath)
  try {
    const result = database
      .prepare(
        `
          update capture
             set text_content = ?,
                 thread_title = coalesce(?, thread_title)
           where source = ?
             and account_id = ?
             and external_id = ?
        `,
      )
      .run(
        input.textContent,
        input.threadTitle ?? null,
        input.source,
        input.accountId ?? '',
        input.externalId,
      )
    assert.equal(result.changes, 1)
  } finally {
    database.close()
  }
}

test('local gateway projection derives route-backed conversations and transcripts from inbox captures plus assistant state', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-local-'))
  const attachmentSourceRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-attachment-'))

  try {
    await initializeVault({ vaultRoot })
    let firstCaptureCursorCreatedAt: string | null = null

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

    const legacySessionKey = `gwcs_${Buffer.from(
      JSON.stringify({
        kind: 'conversation',
        routeKey: 'channel:email|identity:murph%40example.com|thread:thread-labs',
        version: 1,
      }),
      'utf8',
    ).toString('base64url')}`
    await assert.rejects(
      getGatewayConversationLocal(vaultRoot, {
        sessionKey: legacySessionKey,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'ASSISTANT_INVALID_RUNTIME_ID')
        assert.match(
          error instanceof Error ? error.message : String(error),
          /version is unsupported/u,
        )
        return true
      },
    )
    await assert.rejects(
      readGatewayMessagesLocal(vaultRoot, {
        afterMessageId: null,
        limit: 100,
        oldestFirst: true,
        sessionKey: legacySessionKey,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'ASSISTANT_INVALID_RUNTIME_ID')
        assert.match(
          error instanceof Error ? error.message : String(error),
          /version is unsupported/u,
        )
        return true
      },
    )

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

test('local gateway persists serving tables and advances the inbox-backed capture cursor', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-serving-store-'))

  try {
    await initializeVault({ vaultRoot })
    let firstCaptureCursor: string | null = null

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:8101',
      thread: {
        id: 'chat-serving-store',
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
      text: 'First capture',
      attachments: [],
      raw: {},
    })
    runtime.close()

    const initial = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })
    assert.equal(initial.conversations.length, 1)

    const gatewayDb = openSqliteRuntimeDatabase(resolveGatewayRuntimePaths(vaultRoot).gatewayDbPath)
    try {
      const conversationCount = gatewayDb
        .prepare('SELECT COUNT(*) AS count FROM gateway_conversations')
        .get() as { count: number }
      const messageCount = gatewayDb
        .prepare('SELECT COUNT(*) AS count FROM gateway_messages')
        .get() as { count: number }
      const snapshotJson = gatewayDb
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('snapshot.json') as { value?: string } | undefined
      const captureSignature = gatewayDb
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('captures.cursor') as { value?: string } | undefined

      assert.equal(conversationCount.count, 1)
      assert.equal(messageCount.count, 1)
      assert.equal(snapshotJson, undefined)
      assert.ok(captureSignature?.value)
      firstCaptureCursor = captureSignature?.value ?? null
    } finally {
      gatewayDb.close()
    }

    const runtimeAfterInitial = await openInboxRuntime({ vaultRoot })
    const pipelineAfterInitial = await createInboxPipeline({
      vaultRoot,
      runtime: runtimeAfterInitial,
    })
    await pipelineAfterInitial.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:8102',
      thread: {
        id: 'chat-serving-store',
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
      text: 'Second capture',
      attachments: [],
      raw: {},
    })
    runtimeAfterInitial.close()

    const messages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: initial.conversations[0]!.sessionKey,
    })
    assert.equal(messages.messages.length, 2)
    assert.equal(messages.messages[1]?.text, 'Second capture')

    const gatewayDbAfterIncrement = openSqliteRuntimeDatabase(
      resolveGatewayRuntimePaths(vaultRoot).gatewayDbPath,
    )
    try {
      const captureSourceCount = gatewayDbAfterIncrement
        .prepare('SELECT COUNT(*) AS count FROM gateway_capture_sources')
        .get() as { count: number }
      const messageCount = gatewayDbAfterIncrement
        .prepare('SELECT COUNT(*) AS count FROM gateway_messages')
        .get() as { count: number }
      const captureSignature = gatewayDbAfterIncrement
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('captures.cursor') as { value?: string } | undefined

      assert.equal(captureSourceCount.count, 2)
      assert.equal(messageCount.count, 2)
      assert.ok(captureSignature?.value)
      assert.ok(firstCaptureCursor)
      assert.notEqual(captureSignature?.value, firstCaptureCursor)
    } finally {
      gatewayDbAfterIncrement.close()
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('local gateway bootstraps empty serving snapshots once and keeps the stored snapshot metadata stable', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-empty-serving-store-'))

  try {
    await initializeVault({ vaultRoot })

    const firstSnapshot = await exportGatewayProjectionSnapshotLocal(vaultRoot)
    const first = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })
    assert.equal(firstSnapshot.generatedAt.length > 0, true)
    assert.equal(first.conversations.length, 0)

    const gatewayDb = openSqliteRuntimeDatabase(resolveGatewayRuntimePaths(vaultRoot).gatewayDbPath)
    let firstGeneratedAt: string | null = null
    try {
      const cursor = gatewayDb
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('captures.cursor') as { value?: string } | undefined
      const snapshotInitialized = gatewayDb
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('snapshot.initialized') as { value?: string } | undefined
      const snapshotGeneratedAt = gatewayDb
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('snapshot.generatedAt') as { value?: string } | undefined
      const snapshotEmpty = gatewayDb
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('snapshot.empty') as { value?: string } | undefined
      const conversationCount = gatewayDb
        .prepare('SELECT COUNT(*) AS count FROM gateway_conversations')
        .get() as { count: number }
      const messageCount = gatewayDb
        .prepare('SELECT COUNT(*) AS count FROM gateway_messages')
        .get() as { count: number }

      assert.equal(cursor?.value, '0')
      assert.equal(snapshotInitialized?.value, '1')
      assert.equal(snapshotEmpty?.value, '1')
      assert.ok(snapshotGeneratedAt?.value)
      assert.equal(conversationCount.count, 0)
      assert.equal(messageCount.count, 0)
      firstGeneratedAt = snapshotGeneratedAt?.value ?? null
    } finally {
      gatewayDb.close()
    }

    const secondSnapshot = await exportGatewayProjectionSnapshotLocal(vaultRoot)
    const second = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })
    assert.equal(secondSnapshot.generatedAt, firstSnapshot.generatedAt)
    assert.equal(second.conversations.length, 0)

    const gatewayDbAfterSecondRead = openSqliteRuntimeDatabase(
      resolveGatewayRuntimePaths(vaultRoot).gatewayDbPath,
    )
    try {
      const snapshotGeneratedAt = gatewayDbAfterSecondRead
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('snapshot.generatedAt') as { value?: string } | undefined
      const snapshotInitialized = gatewayDbAfterSecondRead
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('snapshot.initialized') as { value?: string } | undefined
      const snapshotEmpty = gatewayDbAfterSecondRead
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('snapshot.empty') as { value?: string } | undefined

      assert.equal(snapshotInitialized?.value, '1')
      assert.equal(snapshotEmpty?.value, '1')
      assert.ok(firstGeneratedAt)
      assert.equal(snapshotGeneratedAt?.value, firstGeneratedAt)
    } finally {
      gatewayDbAfterSecondRead.close()
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('local gateway rebuilds capture-serving rows when they are lost but the stored cursor is still current', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-capture-recovery-'))

  try {
    await initializeVault({ vaultRoot })

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:8291',
      thread: {
        id: 'chat-capture-recovery',
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
      text: 'Initial capture text',
      attachments: [],
      raw: {},
    })
    runtime.close()

    const initial = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })
    assert.equal(initial.conversations.length, 1)

    const gatewayDb = openSqliteRuntimeDatabase(resolveGatewayRuntimePaths(vaultRoot).gatewayDbPath)
    try {
      const cursor = gatewayDb
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('captures.cursor') as { value?: string } | undefined
      const captureEmpty = gatewayDb
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('captures.empty') as { value?: string } | undefined
      const captureInitialized = gatewayDb
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('captures.initialized') as { value?: string } | undefined

      assert.equal(captureInitialized?.value, '1')
      assert.equal(captureEmpty?.value, '0')
      assert.ok(cursor?.value)

      gatewayDb.prepare('DELETE FROM gateway_capture_attachments').run()
      gatewayDb.prepare('DELETE FROM gateway_capture_sources').run()
      gatewayDb.prepare('DELETE FROM gateway_conversations').run()
      gatewayDb.prepare('DELETE FROM gateway_messages').run()
    } finally {
      gatewayDb.close()
    }

    const rebuilt = await listGatewayConversationsLocal(vaultRoot, {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })
    assert.equal(rebuilt.conversations.length, 1)
    assert.equal(rebuilt.conversations[0]?.lastMessagePreview, 'Initial capture text')

    const gatewayDbAfterRebuild = openSqliteRuntimeDatabase(
      resolveGatewayRuntimePaths(vaultRoot).gatewayDbPath,
    )
    try {
      const captureSourceCount = gatewayDbAfterRebuild
        .prepare('SELECT COUNT(*) AS count FROM gateway_capture_sources')
        .get() as { count: number }
      const captureEmpty = gatewayDbAfterRebuild
        .prepare('SELECT value FROM gateway_meta WHERE key = ?')
        .get('captures.empty') as { value?: string } | undefined

      assert.equal(captureSourceCount.count, 1)
      assert.equal(captureEmpty?.value, '0')
    } finally {
      gatewayDbAfterRebuild.close()
    }
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('local gateway refreshes attachment parse metadata when only capture_attachment changes', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-attachment-refresh-'))
  const attachmentSourceRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-gateway-attachment-refresh-source-'),
  )

  try {
    await initializeVault({ vaultRoot })

    const attachmentPath = path.join(attachmentSourceRoot, 'labs.pdf')
    await writeFile(attachmentPath, 'pdf', 'utf8')

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:8201',
      thread: {
        id: 'chat-attachment-refresh',
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
      text: 'See attachment',
      attachments: [
        {
          externalId: 'att-linq-8201',
          kind: 'document',
          mime: 'application/pdf',
          originalPath: attachmentPath,
          fileName: 'labs.pdf',
          byteSize: 3,
        },
      ],
      raw: {},
    })

    const conversation = (
      await listGatewayConversationsLocal(vaultRoot, {
        channel: null,
        includeDerivedTitles: true,
        includeLastMessage: true,
        limit: 10,
        search: null,
      })
    ).conversations[0]
    assert.ok(conversation)

    const messages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: conversation!.sessionKey,
    })
    const initialAttachment = await fetchGatewayAttachmentsLocal(vaultRoot, {
      attachmentIds: [],
      messageId: messages.messages[0]?.messageId ?? null,
      sessionKey: conversation!.sessionKey,
    })
    assert.equal(initialAttachment[0]?.parseState, 'pending')
    assert.equal(initialAttachment[0]?.extractedText, null)

    const job = runtime.claimNextAttachmentParseJob()
    assert.ok(job)
    const completed = runtime.completeAttachmentParseJob({
      attempt: job!.attempts,
      extractedText: 'parsed labs',
      jobId: job!.jobId,
      providerId: 'test-parser',
      resultPath: 'derived/inbox/test-parser.json',
      transcriptText: null,
    })
    assert.equal(completed.applied, true)
    runtime.close()

    const refreshedAttachment = await fetchGatewayAttachmentsLocal(vaultRoot, {
      attachmentIds: [],
      messageId: messages.messages[0]?.messageId ?? null,
      sessionKey: conversation!.sessionKey,
    })
    assert.equal(refreshedAttachment[0]?.parseState, 'succeeded')
    assert.equal(refreshedAttachment[0]?.extractedText, 'parsed labs')
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
    await rm(attachmentSourceRoot, { force: true, recursive: true })
  }
})

test('local gateway refreshes message projection when an existing capture is rewritten', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-capture-rewrite-'))

  try {
    await initializeVault({ vaultRoot })

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:8251',
      thread: {
        id: 'chat-capture-rewrite',
        title: 'Old title',
        isDirect: true,
      },
      actor: {
        id: 'contact:taylor',
        displayName: 'Taylor',
        isSelf: false,
      },
      occurredAt: '2026-03-30T10:00:00.000Z',
      receivedAt: '2026-03-30T10:00:01.000Z',
      text: 'Original capture text',
      attachments: [],
      raw: {},
    })
    runtime.close()

    const initialConversation = (
      await listGatewayConversationsLocal(vaultRoot, {
        channel: null,
        includeDerivedTitles: true,
        includeLastMessage: true,
        limit: 10,
        search: null,
      })
    ).conversations[0]
    assert.ok(initialConversation)
    assert.equal(initialConversation?.title, 'Old title')

    const initialMessages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: initialConversation!.sessionKey,
    })
    assert.equal(initialMessages.messages[0]?.text, 'Original capture text')

    await rewriteInboxCaptureRuntimeRecord({
      accountId: 'default',
      externalId: 'linq:8251',
      source: 'linq',
      textContent: 'Rewritten capture text',
      threadTitle: 'Rewritten title',
      vaultRoot,
    })

    const refreshedConversation = (
      await listGatewayConversationsLocal(vaultRoot, {
        channel: null,
        includeDerivedTitles: true,
        includeLastMessage: true,
        limit: 10,
        search: null,
      })
    ).conversations[0]
    assert.ok(refreshedConversation)
    assert.equal(refreshedConversation?.title, 'Rewritten title')
    assert.equal(refreshedConversation?.lastMessagePreview, 'Rewritten capture text')

    const refreshedMessages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: refreshedConversation!.sessionKey,
    })
    assert.equal(refreshedMessages.messages[0]?.text, 'Rewritten capture text')
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('local gateway rebuilds when a legacy serving store is missing the capture cursor meta', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-legacy-cursor-rebuild-'))

  try {
    await initializeVault({ vaultRoot })

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:8271',
      thread: {
        id: 'chat-legacy-cursor-rebuild',
        title: 'Legacy title',
        isDirect: true,
      },
      actor: {
        id: 'contact:taylor',
        displayName: 'Taylor',
        isSelf: false,
      },
      occurredAt: '2026-03-30T10:00:00.000Z',
      receivedAt: '2026-03-30T10:00:01.000Z',
      text: 'Legacy capture text',
      attachments: [],
      raw: {},
    })
    runtime.close()

    const initialConversation = (
      await listGatewayConversationsLocal(vaultRoot, {
        channel: null,
        includeDerivedTitles: true,
        includeLastMessage: true,
        limit: 10,
        search: null,
      })
    ).conversations[0]
    assert.ok(initialConversation)

    const gatewayDb = openSqliteRuntimeDatabase(resolveGatewayRuntimePaths(vaultRoot).gatewayDbPath)
    try {
      gatewayDb.prepare('DELETE FROM gateway_meta WHERE key = ?').run('captures.cursor')
    } finally {
      gatewayDb.close()
    }

    await rewriteInboxCaptureRuntimeRecord({
      accountId: 'default',
      externalId: 'linq:8271',
      source: 'linq',
      textContent: 'Rebuilt capture text',
      threadTitle: 'Rebuilt title',
      vaultRoot,
    })

    const refreshedConversation = (
      await listGatewayConversationsLocal(vaultRoot, {
        channel: null,
        includeDerivedTitles: true,
        includeLastMessage: true,
        limit: 10,
        search: null,
      })
    ).conversations[0]
    assert.ok(refreshedConversation)
    assert.equal(refreshedConversation?.title, 'Rebuilt title')
    assert.equal(refreshedConversation?.lastMessagePreview, 'Rebuilt capture text')

    const refreshedMessages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: initialConversation!.sessionKey,
    })
    assert.equal(refreshedMessages.messages[0]?.text, 'Rebuilt capture text')
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('local gateway refreshes older attachment parses when new captures arrive in the same sync window', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-attachment-mixed-refresh-'))
  const attachmentSourceRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-gateway-attachment-mixed-refresh-source-'),
  )

  try {
    await initializeVault({ vaultRoot })

    const attachmentPath = path.join(attachmentSourceRoot, 'labs.pdf')
    await writeFile(attachmentPath, 'pdf', 'utf8')

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:8301',
      thread: {
        id: 'chat-attachment-mixed-refresh',
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
      text: 'First attachment',
      attachments: [
        {
          externalId: 'att-linq-8301',
          kind: 'document',
          mime: 'application/pdf',
          originalPath: attachmentPath,
          fileName: 'labs.pdf',
          byteSize: 3,
        },
      ],
      raw: {},
    })

    const conversation = (
      await listGatewayConversationsLocal(vaultRoot, {
        channel: null,
        includeDerivedTitles: true,
        includeLastMessage: true,
        limit: 10,
        search: null,
      })
    ).conversations[0]
    assert.ok(conversation)

    const initialMessages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: conversation!.sessionKey,
    })
    const firstMessageId = initialMessages.messages[0]?.messageId ?? null
    assert.ok(firstMessageId)

    const initialAttachment = await fetchGatewayAttachmentsLocal(vaultRoot, {
      attachmentIds: [],
      messageId: firstMessageId,
      sessionKey: conversation!.sessionKey,
    })
    assert.equal(initialAttachment[0]?.parseState, 'pending')

    const job = runtime.claimNextAttachmentParseJob()
    assert.ok(job)
    const completed = runtime.completeAttachmentParseJob({
      attempt: job!.attempts,
      extractedText: 'parsed labs',
      jobId: job!.jobId,
      providerId: 'test-parser',
      resultPath: 'derived/inbox/test-parser.json',
      transcriptText: null,
    })
    assert.equal(completed.applied, true)

    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:8302',
      thread: {
        id: 'chat-attachment-mixed-refresh',
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
      text: 'Second capture',
      attachments: [],
      raw: {},
    })
    runtime.close()

    const refreshedAttachment = await fetchGatewayAttachmentsLocal(vaultRoot, {
      attachmentIds: [],
      messageId: firstMessageId,
      sessionKey: conversation!.sessionKey,
    })
    assert.equal(refreshedAttachment[0]?.parseState, 'succeeded')
    assert.equal(refreshedAttachment[0]?.extractedText, 'parsed labs')

    const refreshedMessages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: conversation!.sessionKey,
    })
    assert.equal(refreshedMessages.messages.length, 2)
    assert.equal(refreshedMessages.messages[1]?.text, 'Second capture')
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
    await rm(attachmentSourceRoot, { force: true, recursive: true })
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

test('local gateway permission responses rebuild the projection and emit permission.resolved', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-permission-'))

  try {
    await initializeVault({ vaultRoot })
    await listGatewayOpenPermissionsLocalWrapper(vaultRoot)

    const database = openSqliteRuntimeDatabase(resolveGatewayRuntimePaths(vaultRoot).gatewayDbPath)
    try {
      database.prepare(`
        INSERT INTO gateway_permissions (
          request_id,
          session_key,
          action,
          description,
          status,
          requested_at,
          resolved_at,
          note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'perm_local_123',
        'gwcs_channel%3Aemail%7Cidentity%3Amurph%2540example.com%7Cthread%3Athread-labs',
        'send-message',
        'Need operator approval',
        'open',
        '2026-03-30T21:00:00.000Z',
        null,
        null,
      )
    } finally {
      database.close()
    }

    const openPermissions = await listGatewayOpenPermissionsLocalWrapper(vaultRoot)
    assert.equal(openPermissions.length, 1)
    assert.equal(openPermissions[0]?.requestId, 'perm_local_123')

    const resolved = await respondToGatewayPermissionLocalWrapper(vaultRoot, {
      decision: 'approve',
      note: 'Approved by operator',
      requestId: 'perm_local_123',
    })
    assert.ok(resolved)
    assert.equal(resolved.status, 'approved')
    assert.equal(resolved.note, 'Approved by operator')

    const remainingPermissions = await listGatewayOpenPermissionsLocalWrapper(vaultRoot)
    assert.equal(remainingPermissions.length, 0)

    const events = await pollGatewayEventsLocalWrapper(vaultRoot, {
      cursor: 0,
      kinds: ['permission.resolved'],
      limit: 20,
      sessionKey: null,
    })
    assert.equal(events.events.length, 1)
    assert.equal(events.events[0]?.kind, 'permission.resolved')
    assert.equal(events.events[0]?.permissionRequestId, 'perm_local_123')
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})

test('local gateway send reuses an existing intent when clientRequestId is retried', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-gateway-send-client-request-id-'))

  try {
    await initializeVault({ vaultRoot })

    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })
    await pipeline.processCapture({
      accountId: 'default',
      source: 'linq',
      externalId: 'linq:client-request-id',
      thread: {
        id: 'chat-client-request-id',
        title: 'Lab thread',
        isDirect: true,
      },
      actor: {
        id: 'contact:alex',
        displayName: 'Alex',
        isSelf: false,
      },
      occurredAt: '2026-03-31T09:00:00.000Z',
      receivedAt: '2026-03-31T09:00:01.000Z',
      text: 'Please send the latest results.',
      attachments: [],
      raw: {},
    })
    runtime.close()

    const conversation = (await listGatewayConversationsLocal(vaultRoot, {
      channel: 'linq',
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 10,
      search: null,
    })).conversations[0]
    assert.ok(conversation)
    const initialMessages = await readGatewayMessagesLocal(vaultRoot, {
      afterMessageId: null,
      limit: 100,
      oldestFirst: true,
      sessionKey: conversation.sessionKey,
    })

    const first = await sendGatewayMessageLocal({
      clientRequestId: 'req-123',
      dispatchMode: 'queue-only',
      sessionKey: conversation.sessionKey,
      text: 'Queued retry-safe follow-up.',
      vault: vaultRoot,
    })
    const second = await sendGatewayMessageLocal({
      clientRequestId: 'req-123',
      dispatchMode: 'queue-only',
      replyToMessageId: initialMessages.messages[0]?.messageId ?? null,
      sessionKey: conversation.sessionKey,
      text: 'Queued retry-safe follow-up with drift.',
      vault: vaultRoot,
    })

    assert.equal(first.messageId, second.messageId)
    const intents = await listAssistantOutboxIntentsLocal(vaultRoot)
    assert.equal(intents.length, 1)
    assert.equal(intents[0]?.message, 'Queued retry-safe follow-up.')
    assert.equal(intents[0]?.replyToMessageId, null)
    assert.equal(intents[0]?.deliveryIdempotencyKey?.startsWith('gateway-send:'), true)
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
