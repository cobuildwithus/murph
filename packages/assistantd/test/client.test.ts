import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { afterAll, beforeAll, test as baseTest, vi } from 'vitest'

import {
  maybeGetGatewayConversationViaDaemon,
  maybeListGatewayConversationsViaDaemon,
  resolveAssistantDaemonClientConfig,
} from '@murphai/assistantd/client'

const test = baseTest.sequential

type AssistantdFetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> | Response

const assistantdFetchHandlers = new Map<string, AssistantdFetchHandler>()
const assistantdFetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = new Headers(init?.headers)
      .get('authorization')
      ?.replace(/^Bearer\s+/u, '')
    if (!token) {
      throw new Error('Expected a bearer token on assistantd client fetch calls.')
    }
    const handler = assistantdFetchHandlers.get(token)
    if (!handler) {
      throw new Error(`No assistantd fetch handler was registered for token ${token}.`)
    }
    return await handler(input, init)
  },
)

let nextAssistantdFetchId = 1

beforeAll(() => {
  vi.stubGlobal('fetch', assistantdFetchMock as unknown as typeof fetch)
})

afterAll(() => {
  assistantdFetchHandlers.clear()
  vi.unstubAllGlobals()
})

function registerAssistantdFetchHandler(handler: AssistantdFetchHandler) {
  const id = nextAssistantdFetchId++
  const env = {
    MURPH_ASSISTANTD_BASE_URL: `http://127.0.0.1:${8700 + id}`,
    MURPH_ASSISTANTD_CONTROL_TOKEN: `assistantd-test-token-${id}`,
  } as const

  assistantdFetchHandlers.set(env.MURPH_ASSISTANTD_CONTROL_TOKEN, handler)

  return {
    env,
    release() {
      assistantdFetchHandlers.delete(env.MURPH_ASSISTANTD_CONTROL_TOKEN)
    },
  }
}

test('assistantd publishes a dedicated client subpath without depending on murph', async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    dependencies?: Record<string, string | undefined>
    exports?: Record<string, { default?: string; types?: string } | undefined>
  }

  assert.deepEqual(packageManifest.exports?.['./client'], {
    default: './dist/client.js',
    types: './dist/client.d.ts',
  })
  assert.equal(packageManifest.dependencies?.murph, undefined)
})

test('resolveAssistantDaemonClientConfig trims loopback URLs, honors disable flags, and rejects remote hosts', () => {
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
  assert.equal(
    resolveAssistantDaemonClientConfig({
      ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241/',
      ASSISTANTD_CONTROL_TOKEN: 'secret-token',
    }),
    null,
  )
  assert.throws(
    () =>
      resolveAssistantDaemonClientConfig({
        MURPH_ASSISTANTD_BASE_URL: 'http://example.com:50241/',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      }),
    /loopback-only http:\/\//u,
  )
  assert.throws(
    () =>
      resolveAssistantDaemonClientConfig({
        MURPH_ASSISTANTD_BASE_URL: 'http://127.example.com:50241/',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      }),
    /loopback-only http:\/\//u,
  )
})

test('gateway daemon client is inert when assistantd client config is absent', async () => {
  const conversations = await maybeListGatewayConversationsViaDaemon(
    {
      channel: null,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 5,
      search: null,
      vault: '/tmp/unused',
    },
    {},
  )
  const conversation = await maybeGetGatewayConversationViaDaemon(
    {
      sessionKey: 'gwcs_example',
      vault: '/tmp/unused',
    },
    {},
  )

  assert.equal(conversations, null)
  assert.equal(conversation, undefined)
})

test('gateway daemon client posts parsed gateway requests to assistantd', async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(
        String(input),
        `${env.MURPH_ASSISTANTD_BASE_URL}/gateway/conversations/list`,
      )
      assert.equal(init?.method, 'POST')
      assert.equal(
        (init?.headers as Headers).get('authorization'),
        `Bearer ${env.MURPH_ASSISTANTD_CONTROL_TOKEN}`,
      )
      assert.equal((init?.headers as Headers).get('content-type'), 'application/json')
      assert.deepEqual(JSON.parse(String(init?.body)), {
        channel: 'email',
        includeDerivedTitles: true,
        includeLastMessage: false,
        limit: 10,
        search: 'alex',
        vault: '/tmp/test-vault',
      })

      return new Response(
        JSON.stringify({
          conversations: [],
          nextCursor: null,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        },
      )
    })
  const { env, release } = registerAssistantdFetchHandler(fetchMock)

  try {
    const result = await maybeListGatewayConversationsViaDaemon(
      {
        channel: 'email',
        includeDerivedTitles: true,
        includeLastMessage: false,
        limit: 10,
        search: 'alex',
        vault: '/tmp/test-vault',
      },
      env,
    )

    assert.deepEqual(result, {
      conversations: [],
      nextCursor: null,
    })
    assert.equal(fetchMock.mock.calls.length, 1)
  } finally {
    release()
  }
})
