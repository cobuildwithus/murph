import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { afterEach, test, vi } from 'vitest'

import {
  fetchJsonResponse,
  readJsonErrorResponse,
  requestJsonWithRetry,
} from '../src/http-json-retry.ts'
import {
  createAbortError,
  createTimeoutAbortController,
  parseRetryAfterHeaderMs,
  waitForRetryDelay,
} from '../src/http-retry.ts'
import { createDeviceSyncClient } from '../src/device-sync-client.ts'
import {
  createLinqChat,
  createLinqWebhookSubscription,
  probeLinqApi,
  sendLinqChatMessage,
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
} from '../src/linq-runtime.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function loadDeviceSyncClientWithMockedSpawn(
  spawn: typeof import('node:child_process').spawn,
): Promise<typeof import('../src/device-sync-client.ts')> {
  vi.resetModules()
  vi.doMock('node:child_process', () => ({ spawn }))
  return await import('../src/device-sync-client.ts')
}

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  })
}

test('http retry helpers cover blank headers, clamping, caller abort, and timeout inheritance', async () => {
  assert.equal(parseRetryAfterHeaderMs({}), null)
  assert.equal(parseRetryAfterHeaderMs({ headers: { 'retry-after': '   ' } }), null)
  assert.equal(
    parseRetryAfterHeaderMs({
      headers: { 'retry-after': '-2' },
      maxDelayMs: 5_000,
    }),
    0,
  )
  assert.equal(
    parseRetryAfterHeaderMs({
      headers: { 'retry-after': 'Wed, 08 Apr 2026 00:00:30 GMT' },
      nowMs: Date.parse('2026-04-08T00:00:00.000Z'),
      maxDelayMs: 1_500,
    }),
    1_500,
  )

  vi.useFakeTimers()
  const signalController = new AbortController()
  const waitPromise = waitForRetryDelay({
    attempt: 2,
    retryDelaysMs: [5, 25],
    signal: signalController.signal,
  })
  signalController.abort()
  await assert.rejects(waitPromise, (error) => error instanceof Error && error.name === 'AbortError')

  const parentController = new AbortController()
  const timeoutController = createTimeoutAbortController(parentController.signal, 25)
  parentController.abort()
  assert.equal(timeoutController.signal.aborted, true)
  assert.equal(timeoutController.timedOut(), false)
  timeoutController.cleanup()

  assert.equal(createAbortError().message, 'Operation aborted.')
})

test('http json helpers cover swallowed body read failures, caller abort passthrough, and non-retry branches', async () => {
  assert.deepEqual(
    await readJsonErrorResponse({
      async text() {
        throw new Error('stream lost')
      },
    }),
    {
      payload: null,
      rawText: null,
    },
  )

  const callerAbort = new AbortController()
  callerAbort.abort()
  const passthrough = new Error('caller aborted first')
  await assert.rejects(
    () =>
      fetchJsonResponse({
        createTransportError: () => new Error('should not wrap'),
        fetchImplementation: async () => {
          throw passthrough
        },
        headers: {},
        method: 'GET',
        signal: callerAbort.signal,
        timeoutMs: 50,
        url: 'https://example.test',
      }),
    (error) => error === passthrough,
  )

  const terminalHttpError = new Error('stop retrying')
  let attempts = 0
  await assert.rejects(
    () =>
      requestJsonWithRetry({
        createHttpError: () => terminalHttpError,
        fetchResponse: async () => {
          attempts += 1
          if (attempts === 1) {
            throw new Error('retry once')
          }

          return createJsonResponse({ error: 'still broken' }, { status: 500 })
        },
        isRetryableError: (error) =>
          error instanceof Error &&
          (error.message === 'retry once' || error === terminalHttpError),
        maxAttempts: 2,
        parseResponse: async () => ({ ok: true }),
        waitForRetryDelay: async () => undefined,
      }),
    (error) => error === terminalHttpError,
  )
  assert.equal(attempts, 2)
})

test('linq runtime normalizes happy-path payloads and retries retryable GET failures', async () => {
  const env = {
    LINQ_API_BASE_URL: ' https://linq.example.test/custom/ ',
    LINQ_API_TOKEN: ' linq-token ',
  } satisfies NodeJS.ProcessEnv
  const seenRequests: Array<{
    body?: string
    headers: Record<string, string>
    method: string
    url: string
  }> = []

  let probeAttempts = 0
  const fetchImplementation = vi.fn(async (url: string, init) => {
    seenRequests.push({
      body: init.body,
      headers: init.headers ?? {},
      method: init.method,
      url,
    })

    if (url.endsWith('/phone_numbers')) {
      probeAttempts += 1
      if (probeAttempts === 1) {
        return createJsonResponse({ error: 'retry later' }, {
          headers: { 'Retry-After': '0' },
          status: 503,
        })
      }

      return createJsonResponse({
        phone_numbers: [
          { phone_number: ' +15550001 ' },
          { phone_number: null },
          { phone_number: '   ' },
        ],
      })
    }

    if (url.endsWith('/chats/chat-123/messages')) {
      return createJsonResponse({
        id: 'message-1',
        chat_id: 'chat-123',
      })
    }

    if (url.endsWith('/typing') && init.method === 'POST') {
      return new Response(null, { status: 204 })
    }

    if (url.endsWith('/typing') && init.method === 'DELETE') {
      return new Response(null, { status: 204 })
    }

    if (url.endsWith('/webhook-subscriptions')) {
      return createJsonResponse({
        created_at: '2026-04-08T00:00:00.000Z',
        id: 'subscription-1',
        is_active: true,
        phone_numbers: [' +15550001 ', null, '   '],
        signing_secret: ' webhook-secret ',
        subscribed_events: [' message.received ', null, '   '],
        target_url: ' https://murph.example.test/webhook ',
        updated_at: '2026-04-08T00:00:01.000Z',
      })
    }

    if (url.endsWith('/chats')) {
      return createJsonResponse({
        chat: {
          id: 'chat-created',
          message: {
            id: 'message-created',
          },
        },
      })
    }

    throw new Error(`Unexpected request: ${init.method} ${url}`)
  })

  assert.deepEqual(await probeLinqApi({ env, fetchImplementation }), {
    ok: true,
    phoneNumbers: ['+15550001'],
  })

  assert.deepEqual(
    await sendLinqChatMessage(
      {
        chatId: ' chat-123 ',
        idempotencyKey: ' idempotency-1 ',
        message: ' hello from Murph ',
        replyToMessageId: ' reply-1 ',
      },
      { env, fetchImplementation },
    ),
    {
      chat_id: 'chat-123',
      id: 'message-1',
    },
  )

  await startLinqChatTypingIndicator({ chatId: 'chat-123' }, { env, fetchImplementation })
  await stopLinqChatTypingIndicator({ chatId: 'chat-123' }, { env, fetchImplementation })

  assert.deepEqual(
    await createLinqWebhookSubscription(
      {
        phoneNumbers: [' +15550001 ', ' +15550001 '],
        subscribedEvents: [' message.received ', ' message.received '],
        targetUrl: ' https://murph.example.test/webhook ',
      },
      { env, fetchImplementation },
    ),
    {
      createdAt: '2026-04-08T00:00:00.000Z',
      id: 'subscription-1',
      isActive: true,
      phoneNumbers: ['+15550001'],
      signingSecret: 'webhook-secret',
      subscribedEvents: ['message.received'],
      targetUrl: 'https://murph.example.test/webhook',
      updatedAt: '2026-04-08T00:00:01.000Z',
    },
  )

  assert.deepEqual(
    await createLinqChat(
      {
        from: ' +15550000 ',
        idempotencyKey: ' idem-2 ',
        message: ' hi ',
        to: [' +15550001 ', ' +15550001 '],
      },
      { env, fetchImplementation },
    ),
    {
      chatId: 'chat-created',
      messageId: 'message-created',
    },
  )

  assert.equal(probeAttempts, 2)
  assert.equal(seenRequests[0]?.headers.authorization, 'Bearer linq-token')
  const chatMessageRequest = seenRequests.find(
    (request) =>
      request.method === 'POST' &&
      /custom\/chats\/chat-123\/messages$/u.test(request.url),
  )
  assert.ok(chatMessageRequest)
  assert.deepEqual(JSON.parse(chatMessageRequest.body ?? '{}'), {
    message: {
      idempotency_key: 'idempotency-1',
      parts: [{ type: 'text', value: 'hello from Murph' }],
      reply_to: { message_id: 'reply-1' },
    },
  })
})

test('linq runtime surfaces non-retryable transport, http, and configuration failures', async () => {
  await assert.rejects(
    () =>
      sendLinqChatMessage(
        {
          chatId: 'chat-123',
          message: 'hello',
        },
        { env: {} },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_TOKEN_REQUIRED',
  )

  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', undefined)
  await assert.rejects(
    () =>
      probeLinqApi({
        env: {
          LINQ_API_TOKEN: 'token',
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_UNAVAILABLE',
  )
  vi.stubGlobal('fetch', originalFetch)

  let attempts = 0
  await assert.rejects(
    () =>
      sendLinqChatMessage(
        {
          chatId: 'chat-123',
          message: 'hello',
        },
        {
          env: {
            LINQ_API_TOKEN: 'token',
          },
          fetchImplementation: async () => {
            attempts += 1
            throw new Error('socket closed')
          },
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.retryable === false &&
      error.context?.timedOut === false,
  )
  assert.equal(attempts, 1)

  await assert.rejects(
    () =>
      createLinqChat(
        {
          from: ' ',
          message: 'hello',
          to: ['   '],
        },
        {
          env: {
            LINQ_API_TOKEN: 'token',
          },
          fetchImplementation: async () => createJsonResponse({}),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_INVALID_INPUT',
  )

  await assert.rejects(
    () =>
      createLinqWebhookSubscription(
        {
          subscribedEvents: [' message.sent '],
          targetUrl: 'https://murph.example.test/webhook',
        },
        {
          env: {
            LINQ_API_TOKEN: 'token',
          },
          fetchImplementation: async () =>
            createJsonResponse({ detail: 'rate limited' }, {
              status: 429,
            }),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.retryable === true &&
      error.context?.status === 429 &&
      error.message === 'rate limited',
  )
})

test('linq runtime covers optional payload omissions, fallback http messages, and timeout transport errors', async () => {
  const seenRequests: Array<{
    body?: string
    headers: Record<string, string>
    method: string
    url: string
  }> = []

  const defaultBaseResult = await createLinqChat(
    {
      from: ' +15550000 ',
      message: ' hello ',
      to: [' +15550001 '],
    },
    {
      env: {
        LINQ_API_TOKEN: 'token',
      },
      fetchImplementation: async (url, init) => {
        seenRequests.push({
          body: init.body,
          headers: init.headers ?? {},
          method: init.method,
          url,
        })
        return createJsonResponse({
          chat: {
            id: '   ',
            message: {
              id: null,
            },
          },
        })
      },
    },
  )

  assert.deepEqual(defaultBaseResult, {
    chatId: null,
    messageId: null,
  })
  assert.equal(
    seenRequests[0]?.url,
    'https://api.linqapp.com/api/partner/v3/chats',
  )
  assert.deepEqual(JSON.parse(seenRequests[0]?.body ?? '{}'), {
    from: '+15550000',
    message: {
      parts: [{ type: 'text', value: 'hello' }],
    },
    to: ['+15550001'],
  })
  assert.equal(seenRequests[0]?.headers.authorization, 'Bearer token')
  assert.equal(seenRequests[0]?.headers['content-type'], 'application/json')

  const webhookResult = await createLinqWebhookSubscription(
    {
      phoneNumbers: null,
      subscribedEvents: [' message.received '],
      targetUrl: ' https://murph.example.test/webhook ',
    },
    {
      env: {
        LINQ_API_TOKEN: 'token',
      },
      fetchImplementation: async () =>
        createJsonResponse({
          created_at: '   ',
          id: null,
          is_active: 'yes',
          phone_numbers: null,
          signing_secret: '   ',
          subscribed_events: null,
          target_url: null,
          updated_at: undefined,
        }),
    },
  )

  assert.deepEqual(webhookResult, {
    createdAt: null,
    id: null,
    isActive: null,
    phoneNumbers: [],
    signingSecret: null,
    subscribedEvents: [],
    targetUrl: null,
    updatedAt: null,
  })

  await assert.rejects(
    () =>
      probeLinqApi({
        env: {
          LINQ_API_TOKEN: 'token',
        },
        fetchImplementation: async () =>
          new Response('{"ignored":true}', {
            status: 408,
          }),
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.message === 'Linq request GET /phone_numbers failed with HTTP 408.' &&
      error.context?.retryable === true &&
      error.context?.status === 408,
  )

  vi.useFakeTimers()
  const timeoutAssertion = assert.rejects(
    sendLinqChatMessage(
      {
        chatId: 'chat-123',
        message: 'hello',
      },
      {
        env: {
          LINQ_API_TOKEN: 'token',
        },
        fetchImplementation: async (_url, init) =>
          await new Promise((_, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => reject(new Error('timed out downstream')),
              { once: true },
            )
          }),
      },
    ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.message ===
        'Linq request POST /chats/chat-123/messages timed out after 30000ms.' &&
      error.context?.retryable === false &&
      error.context?.timedOut === true &&
      error.context?.timeoutMs === 30000 &&
      error.context?.error === 'timed out downstream',
  )
  await vi.advanceTimersByTimeAsync(30_000)
  await timeoutAssertion
})

test('device sync client covers list, begin, and browser open paths', async () => {
  const seenRequests: Array<{ method: string; url: string; body: string | null }> = []
  const openBrowser = vi.fn(async () => true)
  const client = createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    controlToken: 'token-123',
    fetchImpl: async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      seenRequests.push({
        body: init?.body ? String(init.body) : null,
        method: init?.method ?? 'GET',
        url,
      })

      if (url.endsWith('/providers')) {
        return createJsonResponse({ providers: [{ id: 'oura', label: 'Oura' }] })
      }

      if (url.endsWith('/providers/oura/connect')) {
        return createJsonResponse({
          authorizationUrl: 'https://example.test/oauth',
          expiresAt: '2026-04-08T00:00:00.000Z',
          provider: 'oura',
          state: 'state-1',
        })
      }

      if (url.endsWith('/accounts?provider=oura')) {
        return createJsonResponse({ accounts: [{ accountId: 'acct-1' }] })
      }

      if (url.endsWith('/accounts/acct-1')) {
        return createJsonResponse({ account: { accountId: 'acct-1' } })
      }

      if (url.endsWith('/accounts/acct-1/reconcile')) {
        return createJsonResponse({
          account: { accountId: 'acct-1' },
          job: { id: 'job-1' },
        })
      }

      if (url.endsWith('/accounts/acct-1/disconnect')) {
        return createJsonResponse({
          account: { accountId: 'acct-1', disconnected: true },
        })
      }

      throw new Error(`Unexpected request: ${url}`)
    },
    openBrowser,
  })

  assert.deepEqual(await client.listProviders(), {
    providers: [{ id: 'oura', label: 'Oura' }],
  })
  assert.deepEqual(
    await client.beginConnection({
      open: true,
      provider: 'oura',
      returnTo: 'https://murph.example.test/return',
    }),
    {
      authorizationUrl: 'https://example.test/oauth',
      expiresAt: '2026-04-08T00:00:00.000Z',
      openedBrowser: true,
      provider: 'oura',
      state: 'state-1',
    },
  )
  assert.deepEqual(await client.listAccounts({ provider: 'oura' }), {
    accounts: [{ accountId: 'acct-1' }],
  })
  assert.deepEqual(await client.showAccount('acct-1'), {
    account: { accountId: 'acct-1' },
  })
  assert.deepEqual(await client.reconcileAccount('acct-1'), {
    account: { accountId: 'acct-1' },
    job: { id: 'job-1' },
  })
  assert.deepEqual(await client.disconnectAccount('acct-1'), {
    account: { accountId: 'acct-1', disconnected: true },
  })

  assert.equal(openBrowser.mock.calls.length, 1)
  assert.equal(openBrowser.mock.calls[0]?.[0], 'https://example.test/oauth')
  assert.deepEqual(seenRequests.map(({ method, url }) => ({ method, url })), [
    { method: 'GET', url: 'http://127.0.0.1:8788/providers' },
    { method: 'POST', url: 'http://127.0.0.1:8788/providers/oura/connect' },
    { method: 'GET', url: 'http://127.0.0.1:8788/accounts?provider=oura' },
    { method: 'GET', url: 'http://127.0.0.1:8788/accounts/acct-1' },
    { method: 'POST', url: 'http://127.0.0.1:8788/accounts/acct-1/reconcile' },
    { method: 'POST', url: 'http://127.0.0.1:8788/accounts/acct-1/disconnect' },
  ])
  assert.deepEqual(JSON.parse(seenRequests[1]?.body ?? '{}'), {
    returnTo: 'https://murph.example.test/return',
  })

  const successfulSpawn = vi.fn((_command: string, _args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      unref(): void
    }
    child.unref = vi.fn()
    queueMicrotask(() => {
      child.emit('spawn')
    })
    return child
  })
  const dynamicModule = await loadDeviceSyncClientWithMockedSpawn(successfulSpawn)
  const browserClient = dynamicModule.createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    fetchImpl: async () =>
      createJsonResponse({
        authorizationUrl: 'https://example.test/oauth',
        expiresAt: '2026-04-08T00:00:00.000Z',
        provider: 'oura',
        state: 'state-2',
      }),
  })
  const browserResult = await browserClient.beginConnection({
    open: true,
    provider: 'oura',
  })
  assert.equal(browserResult.openedBrowser, true)
  assert.equal(
    successfulSpawn.mock.calls[0]?.[0],
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open',
  )

  const failingSpawn = vi.fn(() => {
    throw new Error('missing browser launcher')
  })
  const failureModule = await loadDeviceSyncClientWithMockedSpawn(failingSpawn)
  const failingBrowserClient = failureModule.createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    fetchImpl: async () =>
      createJsonResponse({
        authorizationUrl: 'https://example.test/oauth',
        expiresAt: '2026-04-08T00:00:00.000Z',
        provider: 'oura',
        state: 'state-3',
      }),
  })
  const failedBrowserResult = await failingBrowserClient.beginConnection({
    open: true,
    provider: 'oura',
  })
  assert.equal(failedBrowserResult.openedBrowser, false)
})

test('device sync client wraps transport and http failures with control-plane context', async () => {
  const unavailableClient = createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED')
    },
  })
  await assert.rejects(
    () => unavailableClient.listProviders(),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'device_sync_unavailable' &&
      'context' in error &&
      typeof error.context === 'object' &&
      error.context !== null &&
      (error.context as { baseUrl?: string }).baseUrl ===
        'http://127.0.0.1:8788' &&
      (error.context as { cause?: string }).cause === 'connect ECONNREFUSED',
  )

  const httpClient = createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    controlToken: 'token-123',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            details: { provider: 'oura' },
            retryable: true,
          },
        }),
        { status: 503 },
      ),
  })
  await assert.rejects(
    () => httpClient.listProviders(),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'device_sync_request_failed' &&
      error.message === 'Device sync request failed with HTTP 503.' &&
      'context' in error &&
      typeof error.context === 'object' &&
      error.context !== null &&
      (error.context as { retryable?: boolean }).retryable === true &&
      ((error.context as { details?: { provider?: string } }).details?.provider ===
        'oura'),
  )

  const missingTokenClient = createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: null,
            message: '   ',
          },
        }),
        { status: 401 },
      ),
  })
  await assert.rejects(
    () => missingTokenClient.listProviders(),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'device_sync_request_failed' &&
      error.message ===
        'Device sync control plane requires DEVICE_SYNC_CONTROL_TOKEN when you target an explicit daemon.' &&
      'context' in error &&
      typeof error.context === 'object' &&
      error.context !== null &&
      (error.context as { status?: number }).status === 401,
  )

  const invalidResponseClient = createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    fetchImpl: async () =>
      new Response('not-json', {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      }),
  })
  await assert.rejects(
    () => invalidResponseClient.listProviders(),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'device_sync_invalid_response' &&
      'context' in error &&
      typeof error.context === 'object' &&
      error.context !== null &&
      (error.context as { path?: string }).path === '/providers',
  )
})
