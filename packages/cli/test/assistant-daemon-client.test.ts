import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import {
  canUseAssistantDaemonForMessage,
  maybeOpenAssistantConversationViaDaemon,
  maybeSendAssistantMessageViaDaemon,
  maybeUpdateAssistantSessionOptionsViaDaemon,
  resolveAssistantDaemonClientConfig,
} from '../src/assistant-daemon-client.js'

const TEST_SESSION = {
  schema: 'murph.assistant-session.v3',
  sessionId: 'session_daemon_test',
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
  alias: 'chat:test',
  binding: {
    conversationKey: 'chat:test',
    channel: 'local',
    identityId: null,
    actorId: null,
    threadId: null,
    threadIsDirect: true,
    delivery: null,
  },
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
  lastTurnAt: null,
  turnCount: 0,
} as const

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('resolveAssistantDaemonClientConfig trims the base URL and honors the disable flag', () => {
  assert.deepEqual(
    resolveAssistantDaemonClientConfig({
      MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241/',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
    }),
    {
      baseUrl: 'http://127.0.0.1:50241',
      token: 'secret-token',
    },
  )

  assert.equal(
    resolveAssistantDaemonClientConfig({
      MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241/',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      MURPH_ASSISTANTD_DISABLE_CLIENT: '1',
    }),
    null,
  )

  assert.deepEqual(
    resolveAssistantDaemonClientConfig({
      MURPH_ASSISTANTD_BASE_URL: ' http://localhost:50241/ ',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
    }),
    {
      baseUrl: 'http://localhost:50241',
      token: 'secret-token',
    },
  )
})

test('resolveAssistantDaemonClientConfig rejects non-loopback base URLs', () => {
  assert.throws(
    () =>
      resolveAssistantDaemonClientConfig({
        MURPH_ASSISTANTD_BASE_URL: 'http://example.com:50241/',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      }),
    /loopback base URLs/u,
  )
})

test('canUseAssistantDaemonForMessage declines turns that rely on local progress or snapshots', () => {
  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        vault: '/tmp/vault',
        prompt: 'hello',
      },
      {
        MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      },
    ),
    true,
  )

  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        vault: '/tmp/vault',
        prompt: 'hello',
        onProviderEvent: () => undefined,
      },
      {
        MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      },
    ),
    false,
  )
})

test('assistant daemon client posts requests with a bearer token and parses assistant results', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.endsWith('/message')) {
      assert.equal(init?.method, 'POST')
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer secret-token')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      assert.equal(body.prompt, 'hello from daemon')
      assert.equal('abortSignal' in body, false)
      return new Response(
        JSON.stringify({
          vault: '/tmp/vault',
          status: 'completed',
          prompt: 'hello from daemon',
          response: 'daemon response',
          session: TEST_SESSION,
          delivery: null,
          deliveryDeferred: false,
          deliveryIntentId: null,
          deliveryError: null,
          blocked: null,
        }),
        { status: 200 },
      )
    }

    if (url.endsWith('/open-conversation')) {
      return new Response(
        JSON.stringify({
          created: true,
          paths: {
            assistantStateRoot: '/tmp/assistant-state',
          },
          session: TEST_SESSION,
        }),
        { status: 200 },
      )
    }

    if (url.endsWith('/session-options')) {
      return new Response(JSON.stringify(TEST_SESSION), { status: 200 })
    }

    throw new Error(`unexpected assistant daemon route: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const env = {
    MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241/',
    MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
  }

  const messageResult = await maybeSendAssistantMessageViaDaemon(
    {
      vault: '/tmp/vault',
      prompt: 'hello from daemon',
    },
    env,
  )
  assert.ok(messageResult)
  assert.equal(messageResult?.response, 'daemon response')
  assert.equal(messageResult?.session.sessionId, TEST_SESSION.sessionId)

  const conversation = await maybeOpenAssistantConversationViaDaemon(
    {
      vault: '/tmp/vault',
      alias: 'chat:test',
    },
    env,
  )
  assert.ok(conversation)
  assert.equal(conversation?.created, true)
  assert.equal(conversation?.session.sessionId, TEST_SESSION.sessionId)

  const updated = await maybeUpdateAssistantSessionOptionsViaDaemon(
    {
      vault: '/tmp/vault',
      sessionId: TEST_SESSION.sessionId,
      providerOptions: {
        model: 'gpt-5.4-mini',
      },
    },
    env,
  )
  assert.ok(updated)
  assert.equal(updated?.sessionId, TEST_SESSION.sessionId)
  assert.equal(fetchMock.mock.calls.length, 3)
})
