import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { afterAll, beforeAll, test as baseTest, vi } from 'vitest'

import {
  maybeFetchGatewayAttachmentsViaDaemon,
  maybeGetGatewayConversationViaDaemon,
  maybeListGatewayConversationsViaDaemon,
  maybeListGatewayOpenPermissionsViaDaemon,
  maybePollGatewayEventsViaDaemon,
  maybeReadGatewayMessagesViaDaemon,
  maybeRespondToGatewayPermissionViaDaemon,
  maybeSendGatewayMessageViaDaemon,
  maybeWaitForGatewayEventsViaDaemon,
  resolveAssistantDaemonClientConfig,
} from '@murphai/assistantd/client'

const test = baseTest.sequential

const TEST_GATEWAY_CONVERSATION = {
  schema: 'murph.gateway-conversation.v1',
  sessionKey: 'gwcs_client_test',
  title: 'Client thread',
  lastMessagePreview: 'Latest update',
  lastActivityAt: '2026-03-28T00:00:00.000Z',
  messageCount: 2,
  canSend: true,
  route: {
    channel: 'email',
    identityId: 'murph@example.com',
    participantId: 'contact:alex',
    threadId: 'thread-client',
    directness: 'group',
    reply: {
      kind: 'thread',
      target: 'thread-client',
    },
  },
} as const

const TEST_GATEWAY_ATTACHMENT = {
  schema: 'murph.gateway-attachment.v1',
  attachmentId: 'gwca_client_test',
  messageId: 'gwcm_client_test',
  kind: 'document',
  mime: 'application/pdf',
  fileName: 'labs.pdf',
  byteSize: 3,
  parseState: 'pending',
  extractedText: null,
  transcriptText: null,
} as const

const TEST_GATEWAY_MESSAGE = {
  schema: 'murph.gateway-message.v1',
  messageId: TEST_GATEWAY_ATTACHMENT.messageId,
  sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
  direction: 'inbound',
  createdAt: '2026-03-28T00:00:00.000Z',
  actorDisplayName: 'Alex',
  text: 'Here is the latest file.',
  attachments: [TEST_GATEWAY_ATTACHMENT],
} as const

const TEST_GATEWAY_PERMISSION = {
  schema: 'murph.gateway-permission-request.v1',
  requestId: 'gwpr_client_test',
  sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
  action: 'messages.send',
  description: 'Needs approval',
  status: 'open',
  requestedAt: '2026-03-28T00:00:00.000Z',
  resolvedAt: null,
  note: null,
} as const

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
  const wait = await maybeWaitForGatewayEventsViaDaemon(
    {
      cursor: 1,
      vault: '/tmp/unused',
    },
    {},
  )
  const permissions = await maybeListGatewayOpenPermissionsViaDaemon(
    {
      sessionKey: 'gwcs_example',
      vault: '/tmp/unused',
    },
    {},
  )
  const permissionResponse = await maybeRespondToGatewayPermissionViaDaemon(
    {
      decision: 'approve',
      requestId: 'perm-example',
      vault: '/tmp/unused',
    },
    {},
  )

  assert.equal(conversations, null)
  assert.equal(conversation, undefined)
  assert.equal(wait, null)
  assert.equal(permissions, null)
  assert.equal(permissionResponse, undefined)
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

test('gateway daemon client covers the remaining gateway endpoints and empty success bodies', async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const payload = init?.body ? JSON.parse(String(init.body)) : null

    if (url.endsWith('/gateway/conversations/get')) {
      return new Response('', { status: 200 })
    }
    if (url.endsWith('/gateway/messages/read')) {
      assert.deepEqual(payload, {
        afterMessageId: null,
        limit: 100,
        oldestFirst: true,
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        vault: '/tmp/test-vault',
      })
      return Response.json({
        messages: [TEST_GATEWAY_MESSAGE],
        nextCursor: null,
      })
    }
    if (url.endsWith('/gateway/attachments/fetch')) {
      assert.deepEqual(payload, {
        attachmentIds: [],
        messageId: TEST_GATEWAY_MESSAGE.messageId,
        sessionKey: null,
        vault: '/tmp/test-vault',
      })
      return Response.json([TEST_GATEWAY_ATTACHMENT])
    }
    if (url.endsWith('/gateway/messages/send')) {
      assert.deepEqual(payload, {
        clientRequestId: null,
        replyToMessageId: null,
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        text: 'follow up',
        vault: '/tmp/test-vault',
      })
      return Response.json({
        delivery: null,
        messageId: 'gwcm_sent_client_test',
        queued: true,
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
      })
    }
    if (url.endsWith('/gateway/events/poll')) {
      assert.deepEqual(payload, {
        cursor: 7,
        kinds: [],
        limit: 50,
        sessionKey: null,
        vault: '/tmp/test-vault',
      })
      return Response.json({
        events: [],
        live: true,
        nextCursor: 7,
      })
    }
    if (url.endsWith('/gateway/events/wait')) {
      assert.deepEqual(payload, {
        cursor: 8,
        kinds: [],
        limit: 50,
        sessionKey: null,
        timeoutMs: 50,
        vault: '/tmp/test-vault',
      })
      return Response.json({
        events: [],
        live: false,
        nextCursor: 9,
      })
    }
    if (url.endsWith('/gateway/permissions/list-open')) {
      assert.deepEqual(payload, {
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        vault: '/tmp/test-vault',
      })
      return Response.json([TEST_GATEWAY_PERMISSION])
    }
    if (url.endsWith('/gateway/permissions/respond')) {
      assert.deepEqual(payload, {
        decision: 'approve',
        note: null,
        requestId: TEST_GATEWAY_PERMISSION.requestId,
        vault: '/tmp/test-vault',
      })
      return new Response('', { status: 200 })
    }

    throw new Error(`Unexpected assistantd route: ${url}`)
  })
  const { env, release } = registerAssistantdFetchHandler(fetchMock)

  try {
    const conversation = await maybeGetGatewayConversationViaDaemon(
      {
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        vault: '/tmp/test-vault',
      },
      env,
    )
    const messages = await maybeReadGatewayMessagesViaDaemon(
      {
        oldestFirst: true,
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        vault: '/tmp/test-vault',
      },
      env,
    )
    const attachments = await maybeFetchGatewayAttachmentsViaDaemon(
      {
        messageId: TEST_GATEWAY_MESSAGE.messageId,
        vault: '/tmp/test-vault',
      },
      env,
    )
    const sendResult = await maybeSendGatewayMessageViaDaemon(
      {
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        text: 'follow up',
        vault: '/tmp/test-vault',
      },
      env,
    )
    const pollResult = await maybePollGatewayEventsViaDaemon(
      {
        cursor: 7,
        vault: '/tmp/test-vault',
      },
      env,
    )
    const waitResult = await maybeWaitForGatewayEventsViaDaemon(
      {
        cursor: 8,
        timeoutMs: 50,
        vault: '/tmp/test-vault',
      },
      env,
    )
    const permissions = await maybeListGatewayOpenPermissionsViaDaemon(
      {
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        vault: '/tmp/test-vault',
      },
      env,
    )
    const permissionResponse = await maybeRespondToGatewayPermissionViaDaemon(
      {
        decision: 'approve',
        requestId: TEST_GATEWAY_PERMISSION.requestId,
        vault: '/tmp/test-vault',
      },
      env,
    )

    assert.equal(conversation, null)
    assert.equal(messages?.messages[0]?.messageId, TEST_GATEWAY_MESSAGE.messageId)
    assert.equal(attachments?.[0]?.attachmentId, TEST_GATEWAY_ATTACHMENT.attachmentId)
    assert.equal(sendResult?.queued, true)
    assert.equal(pollResult?.nextCursor, 7)
    assert.equal(waitResult?.nextCursor, 9)
    assert.equal(permissions?.[0]?.requestId, TEST_GATEWAY_PERMISSION.requestId)
    assert.equal(permissionResponse, null)
    assert.equal(fetchMock.mock.calls.length, 8)
  } finally {
    release()
  }
})

test('gateway daemon client surfaces transport, HTTP, and payload errors cleanly', async () => {
  const network = registerAssistantdFetchHandler(async () => {
    throw new Error('socket hung up')
  })
  const invalidJson = registerAssistantdFetchHandler(
    async () =>
      new Response('not json', {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
  )
  const httpJson = registerAssistantdFetchHandler(
    async () =>
      Response.json(
        {
          code: 'ASSISTANT_GATEWAY_FAILED',
          error: 'Gateway send failed.',
        },
        { status: 502 },
      ),
  )
  const httpText = registerAssistantdFetchHandler(
    async () => new Response('gateway temporarily unavailable', { status: 503 }),
  )
  const invalidArray = registerAssistantdFetchHandler(
    async () => Response.json({ not: 'an-array' }),
  )
  const invalidPermissions = registerAssistantdFetchHandler(
    async () => Response.json({ not: 'an-array' }),
  )

  try {
    await assert.rejects(
      maybeListGatewayConversationsViaDaemon(
        {
          channel: null,
          includeDerivedTitles: true,
          includeLastMessage: true,
          limit: 5,
          search: null,
          vault: '/tmp/test-vault',
        },
        network.env,
      ),
      /failed before receiving a response/u,
    )
    await assert.rejects(
      maybeListGatewayConversationsViaDaemon(
        {
          channel: null,
          includeDerivedTitles: true,
          includeLastMessage: true,
          limit: 5,
          search: null,
          vault: '/tmp/test-vault',
        },
        invalidJson.env,
      ),
      /invalid JSON response/u,
    )
    await assert.rejects(
      maybeSendGatewayMessageViaDaemon(
        {
          sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
          text: 'follow up',
          vault: '/tmp/test-vault',
        },
        httpJson.env,
      ),
      (error: unknown) => {
        assert.equal(error instanceof Error, true)
        assert.equal(
          (error as Error & { code?: string; status?: number }).code,
          'ASSISTANT_GATEWAY_FAILED',
        )
        assert.equal(
          (error as Error & { code?: string; status?: number }).status,
          502,
        )
        assert.match((error as Error).message, /Gateway send failed/u)
        return true
      },
    )
    await assert.rejects(
      maybeSendGatewayMessageViaDaemon(
        {
          sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
          text: 'follow up',
          vault: '/tmp/test-vault',
        },
        httpText.env,
      ),
      /gateway temporarily unavailable/u,
    )
    await assert.rejects(
      maybeFetchGatewayAttachmentsViaDaemon(
        {
          messageId: TEST_GATEWAY_MESSAGE.messageId,
          vault: '/tmp/test-vault',
        },
        invalidArray.env,
      ),
      /invalid gateway attachment payload/u,
    )
    await assert.rejects(
      maybeListGatewayOpenPermissionsViaDaemon(
        {
          sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
          vault: '/tmp/test-vault',
        },
        invalidPermissions.env,
      ),
      /invalid gateway permissions payload/u,
    )
  } finally {
    network.release()
    invalidJson.release()
    httpJson.release()
    httpText.release()
    invalidArray.release()
    invalidPermissions.release()
  }
})
