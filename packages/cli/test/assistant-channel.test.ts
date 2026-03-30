import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test, vi } from 'vitest'
import {
  createHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from '@murph/runtime-state'
import {
  sendEmailMessage,
  sendImessageMessage,
  sendLinqMessage,
  sendTelegramMessage,
} from '../src/assistant/channel-adapters.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

type OutboundChannelModule = Awaited<typeof import('../src/outbound-channel.ts')>
type AssistantStateModule = Awaited<typeof import('../src/assistant-state.ts')>

const cleanupPaths: string[] = []

async function deliverAssistantMessage(
  input: Parameters<OutboundChannelModule['deliverAssistantMessage']>[0],
  dependencies?: Parameters<OutboundChannelModule['deliverAssistantMessage']>[1],
) {
  const module: OutboundChannelModule = await import('../src/outbound-channel.ts')
  return module.deliverAssistantMessage(input, dependencies)
}

async function resolveImessageDeliveryCandidates(
  input: Parameters<
    Awaited<typeof import('../src/outbound-channel.ts')>['resolveImessageDeliveryCandidates']
  >[0],
) {
  return (await import('../src/outbound-channel.ts')).resolveImessageDeliveryCandidates(input)
}

async function getAssistantSession(
  vault: Parameters<AssistantStateModule['getAssistantSession']>[0],
  sessionId: Parameters<AssistantStateModule['getAssistantSession']>[1],
) {
  const module: AssistantStateModule = await import('../src/assistant-state.ts')
  return module.getAssistantSession(vault, sessionId)
}

async function resolveAssistantSession(
  input: Parameters<
    AssistantStateModule['resolveAssistantSession']
  >[0],
) {
  return (await import('../src/assistant-state.ts')).resolveAssistantSession(input)
}

async function resolveAssistantStatePaths(vaultRoot: string) {
  return (await import('../src/assistant-state.ts')).resolveAssistantStatePaths(vaultRoot)
}

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
})

test(
  'resolveImessageDeliveryCandidates prefers explicit targets and otherwise uses the stored binding delivery',
  async () => {
    assert.deepEqual(
      await resolveImessageDeliveryCandidates({
        explicitTarget: 'chat-override',
        bindingDelivery: {
          kind: 'thread',
          target: 'chat-123',
        },
      }),
      [
        {
          kind: 'explicit',
          target: 'chat-override',
        },
      ],
    )

    assert.deepEqual(
      await resolveImessageDeliveryCandidates({
        bindingDelivery: {
          kind: 'participant',
          target: '+15551234567',
        },
      }),
      [
        {
          kind: 'participant',
          target: '+15551234567',
        },
      ],
    )

    assert.deepEqual(
      await resolveImessageDeliveryCandidates({
        bindingDelivery: {
          kind: 'thread',
          target: 'chat45e2b868',
        },
      }),
      [
        {
          kind: 'thread',
          target: 'chat45e2b868',
        },
      ],
    )
  },
)

test('deliverAssistantMessage resolves a session, sends over iMessage, and keeps assistant state metadata-only', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sent: Array<{ message: string; replyToMessageId?: string | null; target: string }> = []
  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'imessage',
      participantId: '+15551234567',
      message: 'Lunch is logged.',
    },
    {
      sendImessage: async (input: { message: string; target: string }) => {
        sent.push(input)
      },
    },
  )

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    target: '+15551234567',
    message: 'Lunch is logged.',
  })
  assert.equal(result.delivery.channel, 'imessage')
  assert.equal(result.delivery.target, '+15551234567')
  assert.equal(result.delivery.targetKind, 'participant')
  assert.equal(result.session.binding.channel, 'imessage')
  assert.equal(result.session.binding.delivery?.target, '+15551234567')
  assert.equal('lastAssistantMessage' in result.session, false)
  assert.equal(result.session.turnCount, 0)
})


test('deliverAssistantMessage writes a manual delivery receipt plus a sent outbox intent', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-receipts-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'imessage',
      participantId: '+15551234567',
      message: 'Lunch is logged.',
    },
    {
      sendImessage: async () => {},
    },
  )

  const statePaths = await resolveAssistantStatePaths(vaultRoot)
  const receiptFiles = await readdir(statePaths.turnsDirectory)
  assert.equal(receiptFiles.length, 1)
  const receipt = JSON.parse(
    await readFile(
      path.join(statePaths.turnsDirectory, receiptFiles[0]!),
      'utf8',
    ),
  ) as {
    deliveryDisposition: string
    deliveryIntentId: string | null
    deliveryRequested: boolean
    status: string
    timeline: Array<{ kind: string }>
  }
  assert.equal(receipt.status, 'completed')
  assert.equal(receipt.deliveryRequested, true)
  assert.equal(receipt.deliveryDisposition, 'sent')
  assert.equal(typeof receipt.deliveryIntentId, 'string')
  assert.deepEqual(
    receipt.timeline.map((event) => event.kind),
    ['turn.started', 'delivery.queued', 'delivery.attempt.started', 'delivery.sent'],
  )

  const outboxFiles = await readdir(statePaths.outboxDirectory)
  assert.equal(outboxFiles.length, 1)
  const intent = JSON.parse(
    await readFile(path.join(statePaths.outboxDirectory, outboxFiles[0]!), 'utf8'),
  ) as {
    delivery: { target: string } | null
    intentId: string
    status: string
  }
  assert.equal(intent.status, 'sent')
  assert.equal(intent.delivery?.target, '+15551234567')
  assert.equal(intent.intentId, receipt.deliveryIntentId)
})

test('deliverAssistantMessage preserves a deferred receipt when outbound delivery fails retryably', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-deferred-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  await assert.rejects(
    () =>
      deliverAssistantMessage(
        {
          vault: vaultRoot,
          channel: 'imessage',
          participantId: '+15551234567',
          message: 'Lunch is logged.',
        },
        {
          sendImessage: async () => {
            throw new VaultCliError(
              'ASSISTANT_DELIVERY_FAILED',
              'Temporary network interruption while delivering the reply.',
              {
                retryable: true,
              },
            )
          },
        },
      ),
    (error: unknown) => {
      assert.equal(
        typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: unknown }).code === 'ASSISTANT_DELIVERY_FAILED',
        true,
      )
      return true
    },
  )

  const statePaths = await resolveAssistantStatePaths(vaultRoot)
  const receiptFiles = await readdir(statePaths.turnsDirectory)
  assert.equal(receiptFiles.length, 1)
  const receipt = JSON.parse(
    await readFile(
      path.join(statePaths.turnsDirectory, receiptFiles[0]!),
      'utf8',
    ),
  ) as {
    deliveryDisposition: string
    status: string
  }
  assert.equal(receipt.status, 'deferred')
  assert.equal(receipt.deliveryDisposition, 'retryable')

  const outboxFiles = await readdir(statePaths.outboxDirectory)
  assert.equal(outboxFiles.length, 1)
  const intent = JSON.parse(
    await readFile(path.join(statePaths.outboxDirectory, outboxFiles[0]!), 'utf8'),
  ) as {
    status: string
  }
  assert.equal(intent.status, 'retryable')
})

test('deliverAssistantMessage uses one-off targets only for the current send and does not rewrite the stored binding', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-override-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'imessage',
      participantId: '+15551234567',
      message: 'Temporary override.',
      target: 'chat-override',
    },
    {
      sendImessage: async () => {},
    },
  )

  assert.equal(result.delivery.target, 'chat-override')
  assert.equal(result.delivery.targetKind, 'explicit')
  assert.equal(result.session.binding.delivery?.kind, 'participant')
  assert.equal(result.session.binding.delivery?.target, '+15551234567')
})


test('deliverAssistantMessage uses stored Telegram thread bindings so one assistant session can reply back into the same chat', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-telegram-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sent: Array<{ message: string; target: string }> = []
  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'telegram',
      participantId: '123456789',
      sourceThreadId: '-1001234567890:topic:42',
      threadIsDirect: false,
      message: 'Telegram thread reply.',
    },
    {
      sendTelegram: async (input: { message: string; target: string }) => {
        sent.push(input)
      },
    },
  )

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    target: '-1001234567890:topic:42',
    message: 'Telegram thread reply.',
  })
  assert.equal(result.delivery.channel, 'telegram')
  assert.equal(result.delivery.target, '-1001234567890:topic:42')
  assert.equal(result.delivery.targetKind, 'thread')
  assert.equal(result.session.binding.channel, 'telegram')
  assert.equal(result.session.binding.threadId, '-1001234567890:topic:42')
  assert.equal(result.session.binding.delivery?.kind, 'thread')
  assert.equal(result.session.binding.delivery?.target, '-1001234567890:topic:42')
  assert.equal('lastAssistantMessage' in result.session, false)
  assert.equal(result.session.turnCount, 0)
})

test('deliverAssistantMessage persists canonical Telegram thread targets returned by the sender', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-telegram-migrate-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sent: Array<{ message: string; target: string }> = []
  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'telegram',
      participantId: '123456789',
      sourceThreadId: '-1001234567890:topic:42',
      threadIsDirect: false,
      message: 'Telegram thread reply.',
    },
    {
      sendTelegram: async (input: { message: string; target: string }) => {
        sent.push(input)
        return {
          target: '-1009876543210:topic:42',
        }
      },
    },
  )

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    target: '-1001234567890:topic:42',
    message: 'Telegram thread reply.',
  })
  assert.equal(result.delivery.target, '-1009876543210:topic:42')
  assert.equal(result.session.binding.threadId, '-1009876543210:topic:42')
  assert.equal(result.session.binding.delivery?.target, '-1009876543210:topic:42')
  assert.equal(
    result.session.binding.conversationKey,
    'channel:telegram|thread:-1009876543210%3Atopic%3A42',
  )
})

test('deliverAssistantMessage rejects rebinding a saved session to a different routed audience', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-routing-conflict-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    conversation: {
      channel: 'telegram',
      identityId: 'assistant:primary',
      participantId: 'contact:base',
      threadId: 'chat-base',
      directness: 'group',
    },
  })

  const sent: Array<{ message: string; target: string }> = []
  await assert.rejects(
    () =>
      deliverAssistantMessage(
        {
          vault: vaultRoot,
          sessionId: created.session.sessionId,
          conversation: {
            channel: 'telegram',
            identityId: 'assistant:primary',
            participantId: 'contact:base',
            threadId: 'chat-base',
            directness: 'group',
          },
          actorId: 'contact:override',
          sourceThreadId: 'chat-override',
          threadIsDirect: true,
          message: 'Telegram thread override.',
        },
        {
          sendTelegram: async (input: { message: string; target: string }) => {
            sent.push(input)
          },
        },
      ),
    (error: unknown) => {
      assert.equal(
        (error as { code?: unknown })?.code,
        'ASSISTANT_SESSION_ROUTING_CONFLICT',
      )
      return true
    },
  )

  assert.equal(sent.length, 0)

  const persisted = await getAssistantSession(vaultRoot, created.session.sessionId)
  assert.equal(persisted.binding.channel, 'telegram')
  assert.equal(persisted.binding.identityId, 'assistant:primary')
  assert.equal(persisted.binding.actorId, 'contact:base')
  assert.equal(persisted.binding.threadId, 'chat-base')
  assert.equal(persisted.binding.threadIsDirect, false)
})

test('deliverAssistantMessage ignores lookup-only nested conversation metadata when resuming a session', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-lookup-conversation-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:seed',
    channel: 'telegram',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-1',
    threadIsDirect: true,
  })

  const sent: Array<{ message: string; target: string }> = []
  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      sessionId: created.session.sessionId,
      conversation: {
        alias: 'chat:lookup',
      },
      message: 'Reuse the stored thread.',
    },
    {
      sendTelegram: async (input: { message: string; target: string }) => {
        sent.push(input)
      },
    },
  )

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    target: 'chat-1',
    message: 'Reuse the stored thread.',
  })
  assert.equal(result.session.binding.channel, 'telegram')
  assert.equal(result.session.binding.identityId, 'assistant:primary')
  assert.equal(result.session.binding.actorId, 'contact:bob')
  assert.equal(result.session.binding.threadId, 'chat-1')
  assert.equal(result.session.binding.threadIsDirect, true)

  const persisted = await getAssistantSession(vaultRoot, created.session.sessionId)
  assert.equal(persisted.binding.channel, 'telegram')
  assert.equal(persisted.binding.identityId, 'assistant:primary')
  assert.equal(persisted.binding.actorId, 'contact:bob')
  assert.equal(persisted.binding.threadId, 'chat-1')
  assert.equal(persisted.binding.threadIsDirect, true)
})

test('deliverAssistantMessage uses stored Linq thread bindings so one assistant session can reply back into the same chat', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-linq-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sent: Array<{ message: string; target: string }> = []
  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'linq',
      identityId: 'default',
      participantId: '+15551234567',
      sourceThreadId: 'chat_123',
      threadIsDirect: true,
      message: 'Linq thread reply.',
    },
    {
      sendLinq: async (input: { message: string; replyToMessageId?: string | null; target: string }) => {
        sent.push(input)
      },
    },
  )

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    target: 'chat_123',
    message: 'Linq thread reply.',
    replyToMessageId: null,
  })
  assert.equal(result.delivery.channel, 'linq')
  assert.equal(result.delivery.target, 'chat_123')
  assert.equal(result.delivery.targetKind, 'thread')
  assert.equal(result.session.binding.channel, 'linq')
  assert.equal(result.session.binding.identityId, 'default')
  assert.equal(result.session.binding.threadId, 'chat_123')
  assert.equal(result.session.binding.delivery?.kind, 'thread')
  assert.equal(result.session.binding.delivery?.target, 'chat_123')
  assert.equal('lastAssistantMessage' in result.session, false)
  assert.equal(result.session.turnCount, 0)
})

test('deliverAssistantMessage forwards Linq reply anchors when one is available', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-linq-reply-to-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sent: Array<{ message: string; replyToMessageId?: string | null; target: string }> = []
  await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'linq',
      identityId: 'default',
      participantId: '+15551234567',
      sourceThreadId: 'chat_123',
      threadIsDirect: true,
      message: 'Anchored Linq reply.',
      replyToMessageId: 'msg_parent_123',
    },
    {
      sendLinq: async (input) => {
        sent.push(input)
      },
    },
  )

  assert.deepEqual(sent, [
    {
      target: 'chat_123',
      message: 'Anchored Linq reply.',
      replyToMessageId: 'msg_parent_123',
    },
  ])
})

test('deliverAssistantMessage uses stored email thread bindings so one assistant session can reply back into the same email thread', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-email-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sent: Array<{
    identityId: string | null
    message: string
    target: string
    targetKind: 'explicit' | 'participant' | 'thread'
  }> = []
  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'email',
      identityId: 'inbox_123',
      participantId: 'user@example.com',
      sourceThreadId: 'thread_123',
      threadIsDirect: true,
      message: 'Email thread reply.',
    },
    {
      sendEmail: async (input) => {
        sent.push(input)
      },
    },
  )

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    identityId: 'inbox_123',
    target: 'thread_123',
    targetKind: 'thread',
    message: 'Email thread reply.',
  })
  assert.equal(result.delivery.channel, 'email')
  assert.equal(result.delivery.target, 'thread_123')
  assert.equal(result.delivery.targetKind, 'thread')
  assert.equal(result.session.binding.channel, 'email')
  assert.equal(result.session.binding.identityId, 'inbox_123')
  assert.equal(result.session.binding.threadId, 'thread_123')
  assert.equal(result.session.binding.delivery?.kind, 'thread')
  assert.equal(result.session.binding.delivery?.target, 'thread_123')
})


test('deliverAssistantMessage persists canonical email thread targets returned by hosted senders', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-email-canonical-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const canonicalTarget = serializeHostedEmailThreadTarget(createHostedEmailThreadTarget({
    cc: ['coach@example.com'],
    lastMessageId: '<msg_9@example.test>',
    references: ['<msg_1@example.test>', '<msg_9@example.test>'],
    replyAliasAddress: 'assistant+reply@example.test',
    replyKey: 'reply_123',
    subject: 'Check-in',
    to: ['user@example.com'],
  }))
  const sent: Array<{
    identityId: string | null
    message: string
    target: string
    targetKind: 'explicit' | 'participant' | 'thread'
  }> = []

  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'email',
      identityId: 'assistant@example.test',
      participantId: 'user@example.com',
      sourceThreadId: 'thread_123',
      threadIsDirect: true,
      message: 'Canonical email thread reply.',
    },
    {
      sendEmail: async (input) => {
        sent.push(input)
        return {
          target: canonicalTarget,
        }
      },
    },
  )

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    identityId: 'assistant@example.test',
    message: 'Canonical email thread reply.',
    target: 'thread_123',
    targetKind: 'thread',
  })
  assert.equal(result.delivery.target, canonicalTarget)
  assert.equal(result.delivery.targetKind, 'thread')
  assert.equal(result.session.binding.threadId, canonicalTarget)
  assert.equal(result.session.binding.delivery?.target, canonicalTarget)
})

test('sendEmailMessage sends new outbound email through the configured AgentMail inbox', async () => {
  const requests: Array<{
    body: Record<string, unknown>
    headers: Record<string, string> | undefined
    method: string
    url: string
  }> = []

  await sendEmailMessage(
    {
      identityId: 'inbox_123',
      message: 'Daily summary',
      target: 'user@example.com',
      targetKind: 'participant',
    },
    {
      env: {
        AGENTMAIL_API_KEY: 'agentmail-key',
        AGENTMAIL_BASE_URL: 'https://mail.example.test/v0',
      },
      fetchImplementation: async (url, init) => {
        requests.push({
          body: JSON.parse(init.body ?? '{}') as Record<string, unknown>,
          headers: init.headers,
          method: init.method,
          url,
        })
        return {
          ok: true,
          status: 200,
          json: async () => ({ message_id: 'msg_1', thread_id: 'thr_1' }),
          text: async () => '',
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
    },
  )

  assert.equal(requests.length, 1)
  assert.equal(
    requests[0]?.url,
    'https://mail.example.test/v0/inboxes/inbox_123/messages/send',
  )
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[0]?.headers?.authorization, 'Bearer agentmail-key')
  assert.equal(requests[0]?.headers?.['content-type'], 'application/json')
  assert.deepEqual(requests[0]?.body, {
    to: 'user@example.com',
    subject: 'Murph update',
    text: 'Daily summary',
  })
})

test('sendEmailMessage retries AgentMail send requests after a 429 response', async () => {
  const requests: Array<{
    method: string
    url: string
  }> = []
  let attempt = 0

  await sendEmailMessage(
    {
      identityId: 'inbox_123',
      message: 'Daily summary',
      target: 'user@example.com',
      targetKind: 'participant',
    },
    {
      env: {
        AGENTMAIL_API_KEY: 'agentmail-key',
        AGENTMAIL_BASE_URL: 'https://mail.example.test/v0',
      },
      fetchImplementation: async (url, init) => {
        attempt += 1
        requests.push({
          method: init.method,
          url,
        })

        if (attempt === 1) {
          return {
            ok: false,
            status: 429,
            json: async () => ({ message: 'Rate limited' }),
            text: async () => '',
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ message_id: 'msg_1', thread_id: 'thr_1' }),
          text: async () => '',
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
    },
  )

  assert.equal(requests.length, 2)
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[1]?.method, 'POST')
  assert.equal(
    requests[0]?.url,
    'https://mail.example.test/v0/inboxes/inbox_123/messages/send',
  )
  assert.equal(requests[0]?.url, requests[1]?.url)
})

test('sendEmailMessage honors AgentMail Retry-After headers on 429 responses', async () => {
  let attempt = 0
  const attemptTimes: number[] = []

  vi.useFakeTimers()

  try {
    const sendPromise = sendEmailMessage(
      {
        identityId: 'inbox_123',
        message: 'Daily summary',
        target: 'user@example.com',
        targetKind: 'participant',
      },
      {
        env: {
          AGENTMAIL_API_KEY: 'agentmail-key',
          AGENTMAIL_BASE_URL: 'https://mail.example.test/v0',
        },
        fetchImplementation: async (_url, _init) => {
          attempt += 1
          attemptTimes.push(Date.now())

          if (attempt === 1) {
            return {
              ok: false,
              status: 429,
              headers: {
                'Retry-After': '0.05',
              },
              json: async () => ({ message: 'Rate limited' }),
              text: async () => '',
              arrayBuffer: async () => new ArrayBuffer(0),
            }
          }

          return {
            ok: true,
            status: 200,
            json: async () => ({ message_id: 'msg_1', thread_id: 'thr_1' }),
            text: async () => '',
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        },
      },
    )

    await vi.advanceTimersByTimeAsync(100)
    await sendPromise

    assert.equal(attempt, 2)
    assert.ok((attemptTimes[1] ?? 0) - (attemptTimes[0] ?? 0) >= 50)
    assert.ok((attemptTimes[1] ?? 0) - (attemptTimes[0] ?? 0) < 1_000)
  } finally {
    vi.useRealTimers()
  }
})

test('sendEmailMessage falls back to raw AgentMail error text when the error body is not JSON', async () => {
  await assert.rejects(
    () =>
      sendEmailMessage(
        {
          identityId: 'inbox_123',
          message: 'Daily summary',
          target: 'user@example.com',
          targetKind: 'participant',
        },
        {
          env: {
            AGENTMAIL_API_KEY: 'agentmail-key',
            AGENTMAIL_BASE_URL: 'https://mail.example.test/v0',
          },
          fetchImplementation: async () => ({
            ok: false,
            status: 500,
            json: async () => {
              throw new Error('invalid json')
            },
            text: async () => 'Plain AgentMail failure',
            arrayBuffer: async () => new ArrayBuffer(0),
          }),
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      assert.equal((error as VaultCliError).code, 'AGENTMAIL_REQUEST_FAILED')
      assert.equal((error as VaultCliError).message, 'Plain AgentMail failure')
      assert.deepEqual((error as VaultCliError).context, {
        method: 'POST',
        path: '/inboxes/inbox_123/messages/send',
        retryable: false,
        status: 500,
      })
      return true
    },
  )
})

test('sendEmailMessage resolves a thread and replies to the latest AgentMail message', async () => {
  const requests: Array<{
    body: Record<string, unknown> | null
    method: string
    url: string
  }> = []

  await sendEmailMessage(
    {
      identityId: 'inbox_123',
      message: 'Following up in-thread.',
      target: 'thread_123',
      targetKind: 'thread',
    },
    {
      env: {
        AGENTMAIL_API_KEY: 'agentmail-key',
        AGENTMAIL_BASE_URL: 'https://mail.example.test/v0',
      },
      fetchImplementation: async (url, init) => {
        requests.push({
          body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
          method: init.method,
          url,
        })

        if (url.endsWith('/threads/thread_123')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              thread_id: 'thread_123',
              last_message_id: 'msg_9',
              messages: [
                { message_id: 'msg_1' },
                { message_id: 'msg_9' },
              ],
            }),
            text: async () => '',
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ message_id: 'msg_10', thread_id: 'thread_123' }),
          text: async () => '',
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
    },
  )

  assert.equal(requests.length, 2)
  assert.equal(requests[0]?.method, 'GET')
  assert.equal(requests[0]?.url, 'https://mail.example.test/v0/threads/thread_123')
  assert.equal(requests[1]?.method, 'POST')
  assert.equal(
    requests[1]?.url,
    'https://mail.example.test/v0/inboxes/inbox_123/messages/msg_9/reply',
  )
  assert.deepEqual(requests[1]?.body, {
    reply_all: true,
    text: 'Following up in-thread.',
  })
})

test('sendLinqMessage posts Linq chat message payloads to the configured API base url', async () => {
  const requests: Array<{
    body: Record<string, unknown>
    headers: Record<string, string> | undefined
    method: string
    url: string
  }> = []

  await sendLinqMessage(
    {
      message: 'Queued the Linq reply.',
      target: 'chat_123',
    },
    {
      env: {
        LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
        LINQ_API_TOKEN: 'linq-token',
      },
      fetchImplementation: async (url, init) => {
        requests.push({
          body: JSON.parse(init.body ?? '{}') as Record<string, unknown>,
          headers: init.headers,
          method: init.method,
          url,
        })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            chat_id: 'chat_123',
            message: {
              id: 'msg_1',
            },
          }),
          text: async () => '',
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
    },
  )

  assert.equal(requests.length, 1)
  assert.equal(
    requests[0]?.url,
    'https://linq.example.test/api/partner/v3/chats/chat_123/messages',
  )
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[0]?.headers?.authorization, 'Bearer linq-token')
  assert.equal(requests[0]?.headers?.['content-type'], 'application/json')
  assert.deepEqual(requests[0]?.body, {
    message: {
      parts: [
        {
          type: 'text',
          value: 'Queued the Linq reply.',
        },
      ],
    },
  })
})

test('sendLinqMessage includes reply_to when a parent Linq message id is provided', async () => {
  const requests: Array<Record<string, unknown>> = []

  await sendLinqMessage(
    {
      message: 'Queued the Linq reply.',
      replyToMessageId: 'msg_parent_123',
      target: 'chat_123',
    },
    {
      env: {
        LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
        LINQ_API_TOKEN: 'linq-token',
      },
      fetchImplementation: async (_url, init) => {
        requests.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            chat_id: 'chat_123',
            message: {
              id: 'msg_1',
            },
          }),
          text: async () => '',
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
    },
  )

  assert.deepEqual(requests, [
    {
      message: {
        parts: [
          {
            type: 'text',
            value: 'Queued the Linq reply.',
          },
        ],
        reply_to: {
          message_id: 'msg_parent_123',
        },
      },
    },
  ])
})

test('sendLinqMessage retries Linq sends after a 429 response', async () => {
  const requests: Array<{
    method: string
    url: string
  }> = []
  let attempt = 0

  await sendLinqMessage(
    {
      message: 'Queued the Linq reply.',
      target: 'chat_123',
    },
    {
      env: {
        LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
        LINQ_API_TOKEN: 'linq-token',
      },
      fetchImplementation: async (url, init) => {
        attempt += 1
        requests.push({
          method: init.method,
          url,
        })

        if (attempt === 1) {
          return {
            ok: false,
            status: 429,
            json: async () => ({ message: 'Rate limited' }),
            text: async () => '',
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            chat_id: 'chat_123',
            message: {
              id: 'msg_1',
            },
          }),
          text: async () => '',
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
    },
  )

  assert.equal(requests.length, 2)
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[1]?.method, 'POST')
  assert.equal(
    requests[0]?.url,
    'https://linq.example.test/api/partner/v3/chats/chat_123/messages',
  )
  assert.equal(requests[0]?.url, requests[1]?.url)
})

test('sendLinqMessage honors Linq Retry-After headers on 429 responses', async () => {
  let attempt = 0
  const attemptTimes: number[] = []

  vi.useFakeTimers()

  try {
    const sendPromise = sendLinqMessage(
      {
        message: 'Queued the Linq reply.',
        target: 'chat_123',
      },
      {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: async (_url, _init) => {
          attempt += 1
          attemptTimes.push(Date.now())

          if (attempt === 1) {
            return {
              ok: false,
              status: 429,
              headers: {
                'retry-after': '0.05',
              },
              json: async () => ({ message: 'Rate limited' }),
              text: async () => '',
              arrayBuffer: async () => new ArrayBuffer(0),
            }
          }

          return {
            ok: true,
            status: 200,
            json: async () => ({
              chat_id: 'chat_123',
              message: {
                id: 'msg_1',
              },
            }),
            text: async () => '',
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        },
      },
    )

    await vi.advanceTimersByTimeAsync(100)
    await sendPromise

    assert.equal(attempt, 2)
    assert.ok((attemptTimes[1] ?? 0) - (attemptTimes[0] ?? 0) >= 50)
    assert.ok((attemptTimes[1] ?? 0) - (attemptTimes[0] ?? 0) < 1_000)
  } finally {
    vi.useRealTimers()
  }
})

test('sendLinqMessage falls back to raw Linq error text when the error body is not JSON', async () => {
  await assert.rejects(
    () =>
      sendLinqMessage(
        {
          message: 'Queued the Linq reply.',
          target: 'chat_123',
        },
        {
          env: {
            LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
            LINQ_API_TOKEN: 'linq-token',
          },
          fetchImplementation: async () => ({
            ok: false,
            status: 400,
            json: async () => {
              throw new Error('invalid json')
            },
            text: async () => 'Plain Linq failure',
            arrayBuffer: async () => new ArrayBuffer(0),
          }),
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      assert.equal((error as VaultCliError).code, 'LINQ_API_REQUEST_FAILED')
      assert.equal((error as VaultCliError).message, 'Plain Linq failure')
      assert.deepEqual((error as VaultCliError).context, {
        method: 'POST',
        path: '/chats/chat_123/messages',
        retryable: false,
        status: 400,
      })
      return true
    },
  )
})

test('sendTelegramMessage posts Telegram Bot API sendMessage payloads, including topic targets', async () => {
  const requests: Array<{
    body: Record<string, unknown>
    headers: Record<string, string> | undefined
    method: string
    url: string
  }> = []

  await sendTelegramMessage(
    {
      message: 'Queued the parser.',
      target: '-1001234567890:topic:42',
    },
    {
      env: {
        TELEGRAM_API_BASE_URL: 'https://bot.example.test/',
        TELEGRAM_BOT_TOKEN: 'token-123',
      },
      fetchImplementation: async (url, init) => {
        requests.push({
          body: JSON.parse(init.body ?? '{}') as Record<string, unknown>,
          headers: init.headers,
          method: init.method,
          url,
        })

        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 1 } }),
        }
      },
    },
  )

  assert.equal(requests.length, 1)
  assert.equal(
    requests[0]?.url,
    'https://bot.example.test/bottoken-123/sendMessage',
  )
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[0]?.headers?.['content-type'], 'application/json')
  assert.deepEqual(requests[0]?.body, {
    chat_id: '-1001234567890',
    message_thread_id: 42,
    text: 'Queued the parser.',
  })
})

test('sendTelegramMessage posts business and direct-message topic routing fields', async () => {
  const requests: Array<Record<string, unknown>> = []

  await sendTelegramMessage(
    {
      message: 'Route this through the business inbox.',
      target: '-1001234567890:business:biz-42:dm-topic:9',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'token-123',
      },
      fetchImplementation: async (_url, init) => {
        requests.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>)
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 2 } }),
        }
      },
    },
  )

  assert.deepEqual(requests, [
    {
      business_connection_id: 'biz-42',
      chat_id: '-1001234567890',
      direct_messages_topic_id: 9,
      text: 'Route this through the business inbox.',
    },
  ])
})

test('sendTelegramMessage splits long replies and retries transient Telegram failures', async () => {
  const longMessage = `${'A'.repeat(4096)}${'B'.repeat(32)}`
  const requests: Array<Record<string, unknown>> = []
  let callCount = 0

  await sendTelegramMessage(
    {
      message: longMessage,
      target: '123456789',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'token-123',
      },
      fetchImplementation: async (_url, init) => {
        callCount += 1
        const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
        requests.push(body)

        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            json: async () => ({
              ok: false,
              error_code: 429,
              description: 'Too Many Requests: retry later',
              parameters: {
                retry_after: 0.001,
              },
            }),
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: callCount } }),
        }
      },
    },
  )

  assert.equal(requests.length, 3)
  assert.equal((requests[0]?.text as string).length, 4096)
  assert.equal(requests[0]?.text, requests[1]?.text)
  assert.equal(
    `${requests[1]?.text as string}${requests[2]?.text as string}`,
    longMessage,
  )
})

test('sendLinqMessage requires an API token before attempting delivery', async () => {
  await assert.rejects(
    () =>
      sendLinqMessage(
        {
          message: 'Smoke test',
          target: 'chat_123',
        },
        {
          env: {},
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      assert.equal((error as VaultCliError).code, 'ASSISTANT_LINQ_API_TOKEN_REQUIRED')
      assert.match(
        (error as VaultCliError).message,
        /LINQ_API_TOKEN/iu,
      )
      return true
    },
  )
})

test('sendTelegramMessage retries migrated chat ids and preserves topic routing across chunks', async () => {
  const longMessage = `${'A'.repeat(4096)}B`
  const requests: Array<Record<string, unknown>> = []
  let callCount = 0

  await sendTelegramMessage(
    {
      message: longMessage,
      target: '-1001234567890:topic:42',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'token-123',
      },
      fetchImplementation: async (_url, init) => {
        callCount += 1
        const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
        requests.push(body)

        if (callCount === 1) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              ok: false,
              error_code: 400,
              description: 'Bad Request: group chat was upgraded to a supergroup chat',
              parameters: {
                migrate_to_chat_id: -1009876543210,
              },
            }),
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: callCount } }),
        }
      },
    },
  )

  assert.equal(requests.length, 3)
  assert.deepEqual(requests, [
    {
      chat_id: '-1001234567890',
      message_thread_id: 42,
      text: 'A'.repeat(4096),
    },
    {
      chat_id: '-1009876543210',
      message_thread_id: 42,
      text: 'A'.repeat(4096),
    },
    {
      chat_id: '-1009876543210',
      message_thread_id: 42,
      text: 'B',
    },
  ])
})

test('sendTelegramMessage keeps retry budget available after Telegram reports a migrated chat id', async () => {
  const requests: Array<Record<string, unknown>> = []
  let callCount = 0

  await sendTelegramMessage(
    {
      message: 'Retry after migration.',
      target: '-1001234567890:topic:42',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'token-123',
      },
      fetchImplementation: async (_url, init) => {
        callCount += 1
        const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
        requests.push(body)

        if (callCount <= 2) {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              ok: false,
              error_code: 500,
              description: 'Internal Server Error',
            }),
          }
        }

        if (callCount === 3) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              ok: false,
              error_code: 400,
              description: 'Bad Request: group chat was upgraded to a supergroup chat',
              parameters: {
                migrate_to_chat_id: -1009876543210,
              },
            }),
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: callCount } }),
        }
      },
    },
  )

  assert.equal(requests.length, 4)
  assert.deepEqual(requests.map((request) => request.chat_id), [
    '-1001234567890',
    '-1001234567890',
    '-1001234567890',
    '-1009876543210',
  ])
})

test('sendTelegramMessage retries transient failures after a migrated chat id without dropping topic routing', async () => {
  const requests: Array<Record<string, unknown>> = []
  let callCount = 0

  await sendTelegramMessage(
    {
      message: 'Retry after migration and keep the topic.',
      target: '-1001234567890:topic:42',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'token-123',
      },
      fetchImplementation: async (_url, init) => {
        callCount += 1
        const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
        requests.push(body)

        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              ok: false,
              error_code: 500,
              description: 'Internal Server Error',
            }),
          }
        }

        if (callCount === 2) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              ok: false,
              error_code: 400,
              description: 'Bad Request: group chat was upgraded to a supergroup chat',
              parameters: {
                migrate_to_chat_id: -1009876543210,
              },
            }),
          }
        }

        if (callCount === 3) {
          return {
            ok: false,
            status: 429,
            json: async () => ({
              ok: false,
              error_code: 429,
              description: 'Too Many Requests: retry later',
              parameters: {
                retry_after: 0.001,
              },
            }),
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: callCount } }),
        }
      },
    },
  )

  assert.equal(requests.length, 4)
  assert.deepEqual(requests, [
    {
      chat_id: '-1001234567890',
      message_thread_id: 42,
      text: 'Retry after migration and keep the topic.',
    },
    {
      chat_id: '-1001234567890',
      message_thread_id: 42,
      text: 'Retry after migration and keep the topic.',
    },
    {
      chat_id: '-1009876543210',
      message_thread_id: 42,
      text: 'Retry after migration and keep the topic.',
    },
    {
      chat_id: '-1009876543210',
      message_thread_id: 42,
      text: 'Retry after migration and keep the topic.',
    },
  ])
})

test('sendTelegramMessage requires a bot token before attempting delivery', async () => {
  await assert.rejects(
    () =>
      sendTelegramMessage(
        {
          message: 'Smoke test',
          target: '123456789',
        },
        {
          env: {},
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      assert.equal((error as VaultCliError).code, 'ASSISTANT_TELEGRAM_TOKEN_REQUIRED')
      assert.match(
        (error as VaultCliError).message,
        /TELEGRAM_BOT_TOKEN|TELEGRAM_BOT_TOKEN/iu,
      )
      return true
    },
  )
})

test('deliverAssistantMessage redacts HOME-based vault paths in its result payload', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-channel-home-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  await mkdir(vaultRoot, {
    recursive: true,
  })
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  try {
    const result = await deliverAssistantMessage(
      {
        vault: vaultRoot,
        channel: 'imessage',
        participantId: '+15551234567',
        message: 'Redact the vault path.',
      },
      {
        sendImessage: async () => {},
      },
    )

    assert.equal(result.vault, path.join('~', 'vault'))
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendImessageMessage fails before constructing the adapter when the Messages database is unreadable', async () => {
  const createSdk = vi.fn(() => ({
    send: async () => {},
  }))

  await assert.rejects(
    () =>
      sendImessageMessage(
        {
          message: 'Smoke test',
          target: '+15551234567',
        },
        {
          platform: 'darwin',
          homeDirectory: '/Users/tester',
          probeMessagesDb: async () => {
            const error = new Error('authorization denied') as Error & {
              code?: string
            }
            error.code = 'EPERM'
            throw error
          },
          createSdk,
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      assert.equal((error as VaultCliError).code, 'ASSISTANT_IMESSAGE_PERMISSION_REQUIRED')
      assert.match(
        (error as VaultCliError).message,
        /Full Disk Access.*restart it, and retry/iu,
      )
      assert.equal(
        (error as VaultCliError).context?.path,
        '~/Library/Messages/chat.db',
      )
      return true
    },
  )

  assert.equal(createSdk.mock.calls.length, 0)
})

test('sendImessageMessage maps adapter database-open failures to permission guidance', async () => {
  await assert.rejects(
    () =>
      sendImessageMessage(
        {
          message: 'Smoke test',
          target: '+15551234567',
        },
        {
          platform: 'darwin',
          homeDirectory: '/Users/tester',
          probeMessagesDb: async () => {},
          createSdk: () => {
            const error = new Error('unable to open database file') as Error & {
              code?: string
            }
            error.code = 'DATABASE'
            throw error
          },
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      assert.equal((error as VaultCliError).code, 'ASSISTANT_IMESSAGE_PERMISSION_REQUIRED')
      assert.match(
        (error as VaultCliError).message,
        /read access to ~\/Library\/Messages\/chat\.db/iu,
      )
      assert.equal(
        (error as VaultCliError).context?.causeCode,
        'DATABASE',
      )
      return true
    },
  )
})

function restoreEnvironmentVariable(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
