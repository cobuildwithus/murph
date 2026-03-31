import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import {
  maybeGetGatewayConversationViaDaemon,
  maybeListGatewayConversationsViaDaemon,
} from '../src/gateway-daemon-client.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
    assert.equal(String(input), 'http://127.0.0.1:8787/gateway/conversations/list')
    assert.equal(init?.method, 'POST')
    assert.equal((init?.headers as Headers).get('authorization'), 'Bearer test-token')
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
  vi.stubGlobal('fetch', fetchMock)

  const result = await maybeListGatewayConversationsViaDaemon(
    {
      channel: 'email',
      includeDerivedTitles: true,
      includeLastMessage: false,
      limit: 10,
      search: 'alex',
      vault: '/tmp/test-vault',
    },
    {
      MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:8787',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'test-token',
    },
  )

  assert.deepEqual(result, {
    conversations: [],
    nextCursor: null,
  })
  assert.equal(fetchMock.mock.calls.length, 1)
})
