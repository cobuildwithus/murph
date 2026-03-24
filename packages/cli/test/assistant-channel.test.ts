import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test, vi } from 'vitest'
import {
  deliverAssistantMessage,
  resolveImessageDeliveryCandidates,
  sendEmailMessage,
  sendImessageMessage,
  sendTelegramMessage,
} from '../src/outbound-channel.js'
import { VaultCliError } from '../src/vault-cli-errors.js'

const cleanupPaths: string[] = []

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

test('resolveImessageDeliveryCandidates prefers explicit targets and otherwise uses the stored binding delivery', () => {
  assert.deepEqual(
    resolveImessageDeliveryCandidates({
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
    resolveImessageDeliveryCandidates({
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
    resolveImessageDeliveryCandidates({
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
})

test('deliverAssistantMessage resolves a session, sends over iMessage, and keeps assistant state metadata-only', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-channel-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sent: Array<{ message: string; target: string }> = []
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

test('deliverAssistantMessage uses one-off targets only for the current send and does not rewrite the stored binding', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-channel-override-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-channel-telegram-'))
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

test('deliverAssistantMessage uses stored email thread bindings so one assistant session can reply back into the same email thread', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-channel-email-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sent: Array<{
    identityId: string
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
    subject: 'Healthy Bob update',
    text: 'Daily summary',
  })
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-channel-home-'))
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
