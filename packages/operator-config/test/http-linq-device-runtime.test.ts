import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { afterEach, expect, test, vi } from 'vitest'

import { buildLinqIMessageAppCardUrl } from '../src/assistant-response-cards.ts'
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
import { resolveExternalUrlBrowserCommands } from '../src/device-sync-browser-opener.ts'
import { createDeviceSyncClient } from '../src/device-sync-client.ts'
import {
  checkLinqIMessageCapability,
  createLinqChat,
  createLinqWebhookSubscription,
  deleteLinqMessage,
  isDefinitiveLinqIMessageAppCardRejection,
  markLinqChatRead,
  probeLinqApi,
  sendLinqChatMessage,
  sendLinqIMessageAppCard,
  sendLinqVoiceMemo,
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
  type LinqFetch,
  uploadLinqAttachment,
} from '../src/linq-runtime.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

const NUTRITION_CARD = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-07-28',
  mealCount: 4,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
    fiberGrams: { total: 26.5, mealCount: 3 },
  },
  goals: {
    calories: null,
    proteinGrams: null,
    carbsGrams: null,
    fatGrams: null,
    fiberGrams: null,
  },
} as const

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function loadDeviceSyncClientWithMockedSpawn(
  spawn: (
    command: string,
    args: string[],
    options: import('node:child_process').SpawnOptions,
  ) => EventEmitter & { unref(): void },
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

function requireStringRequestBody(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') {
    assert.fail('Expected a JSON string request body.')
  }
  return body
}

function parseJsonRequestBody(body: BodyInit | null | undefined): Record<string, unknown> {
  return JSON.parse(requireStringRequestBody(body)) as Record<string, unknown>
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

  const bodyAbort = new AbortController()
  const bodyAbortReason = new Error('caller aborted during body consumption')
  await assert.rejects(
    () =>
      fetchJsonResponse({
        consumeResponse: async () => {
          bodyAbort.abort(bodyAbortReason)
          throw new Error('body read interrupted')
        },
        createTransportError: () => new Error('should not wrap'),
        fetchImplementation: async () => createJsonResponse({ available: true }),
        headers: {},
        method: 'POST',
        signal: bodyAbort.signal,
        timeoutMs: 50,
        url: 'https://example.test',
      }),
    (error) => error === bodyAbortReason,
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
    body?: string | Blob
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
        media: [
          {
            url: ' https://cdn.example.test/dead-bug/setup.png ',
          },
          {
            url: 'https://cdn.example.test/dead-bug/setup.png',
          },
          {
            url: 'https://cdn.example.test/dead-bug/extend.png',
          },
          {
            url: 'https://cdn.example.test/dead-bug/finish.png',
          },
        ],
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
      providerMessageEffects: [{
        message: 'hi',
        providerMessageId: 'message-created',
      }],
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
  assert.deepEqual(parseJsonRequestBody(chatMessageRequest.body), {
    message: {
      idempotency_key: 'idempotency-1',
      parts: [
        { type: 'text', value: 'hello from Murph' },
        {
          type: 'media',
          url: 'https://cdn.example.test/dead-bug/setup.png',
        },
        {
          type: 'media',
          url: 'https://cdn.example.test/dead-bug/extend.png',
        },
        {
          type: 'media',
          url: 'https://cdn.example.test/dead-bug/finish.png',
        },
      ],
    },
  })
})


test('linq runtime checks iMessage capability and sends the exact one-part app card body', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const requests: Array<{
    body: Record<string, unknown>
    method: string
    url: string
  }> = []
  const fetchImplementation: LinqFetch = vi.fn(async (url, init) => {
    requests.push({
      body: parseJsonRequestBody(init.body),
      method: init.method ?? 'GET',
      url,
    })
    if (url.endsWith('/capability/check_imessage')) {
      return createJsonResponse({ available: true })
    }
    return createJsonResponse({
      message: { id: 'native-card-message-1' },
    })
  })

  await expect(checkLinqIMessageCapability({
    address: ' +15550001 ',
    from: ' +15550000 ',
  }, { env, fetchImplementation })).resolves.toBe(true)
  await sendLinqIMessageAppCard({
    card: NUTRITION_CARD,
    chatId: ' chat-123 ',
    idempotencyKey: ' card-delivery-1 ',
  }, { env, fetchImplementation })

  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual({
    body: {
      address: '+15550001',
      from: '+15550000',
    },
    method: 'POST',
    url: 'https://linq.example.test/api/partner/v3/capability/check_imessage',
  })
  expect(requests[1]).toEqual({
    body: {
      message: {
        idempotency_key: 'card-delivery-1',
        parts: [{
          app: {
            bundle_id: 'ai.withmurph.app.messages',
            name: 'Murph',
            team_id: 'G9DJH2XUMK',
          },
          fallback_text:
            'Your daily nutrition. Ask Murph for this card in text',
          interactive: true,
          layout: {
            caption: 'Jul 28 · 4 meals',
            image_url: expect.stringMatching(
              /^https:\/\/www\.withmurph\.ai\/imessage\/card\/v1\/[A-Za-z0-9_-]+\.png$/u,
            ),
            subcaption: 'Some calorie and nutrition estimates were partial.',
          },
          type: 'imessage_app',
          url: buildLinqIMessageAppCardUrl(NUTRITION_CARD),
        }],
        preferred_service: 'iMessage',
      },
    },
    method: 'POST',
    url: 'https://linq.example.test/api/partner/v3/chats/chat-123/messages',
  })
})

test('linq iMessage capability requires a literal available true response', async () => {
  const env = { LINQ_API_TOKEN: 'linq-token' } satisfies NodeJS.ProcessEnv
  for (const payload of [
    { available: false },
    { available: 'true' },
    { supported: true },
    null,
  ]) {
    await expect(checkLinqIMessageCapability({
      address: '+15550001',
    }, {
      env,
      fetchImplementation: async () => createJsonResponse(payload),
    })).resolves.toBe(false)
  }
})

test('linq iMessage capability does not wait or retry after rate limiting', async () => {
  vi.useFakeTimers()
  const env = { LINQ_API_TOKEN: 'linq-token' } satisfies NodeJS.ProcessEnv
  const fetchImplementation = vi.fn(async () =>
    createJsonResponse({ code: 'RATE_LIMITED' }, {
      headers: { 'Retry-After': '30' },
      status: 429,
    }))
  try {
    const rejection = expect(checkLinqIMessageCapability({
      address: '+15550001',
    }, { env, fetchImplementation })).rejects.toMatchObject({
      code: 'LINQ_API_REQUEST_FAILED',
      context: expect.objectContaining({
        operation: 'check_imessage_capability',
        retryable: false,
        status: 429,
      }),
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await rejection
  } finally {
    vi.useRealTimers()
  }
})

test('linq iMessage capability uses its short read deadline without retrying', async () => {
  vi.useFakeTimers()
  const env = { LINQ_API_TOKEN: 'linq-token' } satisfies NodeJS.ProcessEnv
  let abortedAt: number | null = null
  const startedAt = Date.now()
  const fetchImplementation = vi.fn<LinqFetch>(async (_url, init) =>
    await new Promise<Response>((_resolve, reject) => {
      const rejectOnAbort = () => {
        abortedAt = Date.now()
        reject(new DOMException('aborted', 'AbortError'))
      }
      if (init.signal?.aborted) {
        rejectOnAbort()
        return
      }
      init.signal?.addEventListener('abort', rejectOnAbort, { once: true })
    }))
  try {
    const rejection = expect(checkLinqIMessageCapability({
      address: '+15550001',
    }, { env, fetchImplementation })).rejects.toMatchObject({
      code: 'LINQ_API_REQUEST_FAILED',
      context: expect.objectContaining({
        operation: 'check_imessage_capability',
        retryable: false,
        timedOut: true,
        timeoutMs: 2_500,
      }),
      message:
        'Linq request POST /capability/check_imessage timed out after 2500ms.',
    })
    await vi.advanceTimersByTimeAsync(2_499)

    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(abortedAt).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await rejection

    expect(abortedAt).toBe(startedAt + 2_500)
    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

test.each([
  { label: 'success', status: 200 },
  { label: 'rate-limit error', status: 429 },
])('linq iMessage capability keeps its deadline through a stalled $label body', async ({
  status,
}) => {
  vi.useFakeTimers()
  const env = { LINQ_API_TOKEN: 'linq-token' } satisfies NodeJS.ProcessEnv
  let bodyAbortedAt: number | null = null
  const startedAt = Date.now()
  const fetchImplementation = vi.fn<LinqFetch>(async (_url, init) => {
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          status === 200 ? '{"available":' : '{"code":',
        ))
        const abortBody = () => {
          bodyAbortedAt = Date.now()
          controller.error(new DOMException('aborted', 'AbortError'))
        }
        if (init.signal?.aborted) {
          abortBody()
          return
        }
        init.signal?.addEventListener('abort', abortBody, { once: true })
      },
    })
    return new Response(responseBody, {
      headers: {
        'content-type': 'application/json',
        ...(status === 429 ? { 'retry-after': '30' } : {}),
      },
      status,
    })
  })
  try {
    const rejection = expect(checkLinqIMessageCapability({
      address: '+15550001',
    }, { env, fetchImplementation })).rejects.toMatchObject({
      code: 'LINQ_API_REQUEST_FAILED',
      context: expect.objectContaining({
        operation: 'check_imessage_capability',
        retryable: false,
        timedOut: true,
        timeoutMs: 2_500,
      }),
    })
    await vi.advanceTimersByTimeAsync(2_499)

    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(bodyAbortedAt).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await rejection

    expect(bodyAbortedAt).toBe(startedAt + 2_500)
    expect(fetchImplementation).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

test('linq app-card failure diagnostics do not expose nutrition values', async () => {
  await assert.rejects(
    () => sendLinqIMessageAppCard({
      card: NUTRITION_CARD,
      chatId: 'private-chat-route',
      idempotencyKey: 'card-delivery-1',
    }, {
      env: { LINQ_API_TOKEN: '<REDACTED_TOKEN>' },
      fetchImplementation: async () => createJsonResponse({
        message: 'rejected 1490.25 calories for 2026-07-28',
      }, { status: 400 }),
    }),
    (error) => {
      if (!(error instanceof VaultCliError)) {
        return false
      }
      const serialized = JSON.stringify({
        context: error.context,
        message: error.message,
      })
      return isDefinitiveLinqIMessageAppCardRejection(error) &&
        error.code === 'LINQ_API_REQUEST_FAILED' &&
        error.context?.operation === 'send_imessage_app_card' &&
        error.context?.requestMessagePartCount === 1 &&
        !serialized.includes('1490.25') &&
        !serialized.includes('2026-07-28') &&
        !serialized.includes('private-chat-route')
    },
  )
})

test('linq app-card rejection classification permits only definitive pre-acceptance statuses', () => {
  const createError = (
    status: number,
    retryable: boolean,
    linqFailureKind?: 'chat_not_found',
    failureStage: 'http' | 'transport' = 'http',
  ): VaultCliError => new VaultCliError(
    'LINQ_API_REQUEST_FAILED',
    'Linq rejected the iMessage app card.',
    {
      failureStage,
      ...(linqFailureKind ? { linqFailureKind } : {}),
      method: 'POST',
      operation: 'send_imessage_app_card',
      path: '/chats/[chat]/messages',
      provider: 'linq',
      retryable,
      status,
    },
  )

  for (const status of [400, 415, 422]) {
    expect(isDefinitiveLinqIMessageAppCardRejection(
      createError(status, false),
    )).toBe(true)
  }
  expect(isDefinitiveLinqIMessageAppCardRejection(
    createError(404, false, 'chat_not_found'),
  )).toBe(true)
  for (const status of [404, 408, 429, 500]) {
    expect(isDefinitiveLinqIMessageAppCardRejection(
      createError(status, status !== 404),
    )).toBe(false)
  }
  expect(isDefinitiveLinqIMessageAppCardRejection(
    createError(0, true, undefined, 'transport'),
  )).toBe(false)
})

test('linq runtime serializes reply targets only for marked native replies', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const bodies: Record<string, unknown>[] = []
  const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
    if (typeof init.body !== 'string' && !(init.body instanceof Blob)) {
      throw new TypeError('Expected a JSON request body.')
    }
    bodies.push(parseJsonRequestBody(init.body))
    return createJsonResponse({
      chat_id: 'chat-123',
      id: 'message-1',
    })
  })

  const result = await sendLinqChatMessage(
    {
      chatId: 'chat-123',
      message: 'ordinary automatic reply',
      replyToMessageId: 'context-message-1',
    },
    { env, fetchImplementation },
  )
  await sendLinqChatMessage(
    {
      chatId: 'chat-123',
      message: 'selected native reply',
      nativeReplyRequested: true,
      replyToMessageId: 'selected-message-1',
    },
    { env, fetchImplementation },
  )

  assert.deepEqual(bodies, [
    {
      message: {
        parts: [{ type: 'text', value: 'ordinary automatic reply' }],
      },
    },
    {
      message: {
        parts: [{ type: 'text', value: 'selected native reply' }],
        reply_to: {
          message_id: 'selected-message-1',
        },
      },
    },
  ])
  await assert.rejects(
    () => sendLinqChatMessage(
      {
        chatId: 'chat-123',
        message: 'missing target',
        nativeReplyRequested: true,
      },
      { env, fetchImplementation },
    ),
    (error) => error instanceof VaultCliError && error.code === 'LINQ_INVALID_INPUT',
  )
  expect(fetchImplementation).toHaveBeenCalledTimes(2)
})

const incompleteTwoPartMessageIdentityCases = [
  {
    expectedMessageId: 'message-text',
    expectedMessageIds: ['message-text'],
    label: 'only the primary message id',
    linkMessageId: null,
    primaryMessageId: 'message-text',
  },
  {
    expectedMessageId: 'message-duplicate',
    expectedMessageIds: ['message-duplicate'],
    label: 'the same id for both messages',
    linkMessageId: 'message-duplicate',
    primaryMessageId: 'message-duplicate',
  },
] as const

const missingPrimaryMessageIdentityCases = [
  {
    label: 'a later link identity',
    linkMessageId: 'message-link',
  },
  {
    label: 'no later identity',
    linkMessageId: null,
  },
] as const

test('linq runtime sends a terminal payment URL as a separate rich-link message', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const bodies: Record<string, unknown>[] = []
  let requestCount = 0
  const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(parseJsonRequestBody(requireStringRequestBody(init.body)))
    requestCount += 1
    return createJsonResponse({
      chat_id: 'chat-123',
      message: {
        id: requestCount === 1 ? 'message-text' : 'message-link',
      },
    })
  })

  const result = await sendLinqChatMessage(
    {
      chatId: 'chat-123',
      idempotencyKey: 'payment-message-123',
      message: 'Complete payment here:\n[secure checkout](https://pay.example.test/checkout/session_123).',
      nativeReplyRequested: true,
      replyToMessageId: 'incoming-123',
    },
    { env, fetchImplementation },
  )

  assert.equal(result.message.id, 'message-link')
  assert.deepEqual(result.providerMessageIds, ['message-text', 'message-link'])
  assert.deepEqual(result.providerMessageEffects, [
    {
      message: 'Complete payment here:',
      providerMessageId: 'message-text',
    },
    {
      message: null,
      providerMessageId: 'message-link',
    },
  ])
  assert.deepEqual(bodies, [
    {
      message: {
        idempotency_key: 'payment-message-123',
        parts: [{
          type: 'text',
          value: 'Complete payment here:',
        }],
        reply_to: {
          message_id: 'incoming-123',
        },
      },
    },
    {
      message: {
        idempotency_key: 'payment-message-123:link',
        parts: [{
          type: 'link',
          value: 'https://pay.example.test/checkout/session_123',
        }],
      },
    },
  ])
})

test('linq runtime preserves accepted primary media ownership when the rich-link request fails', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  let requestCount = 0
  const fetchImplementation = vi.fn(async () => {
    requestCount += 1
    if (requestCount === 1) {
      return createJsonResponse({
        chat_id: 'chat-123',
        message: { id: 'message-generated-image' },
      })
    }
    return createJsonResponse(
      { error: 'rich-link request failed' },
      { status: 401 },
    )
  })

  await assert.rejects(
    () => sendLinqChatMessage(
      {
        chatId: 'chat-123',
        idempotencyKey: 'generated-image-123',
        media: [{ url: 'https://cdn.example.test/generated-image.png' }],
        message: 'Generated image\nhttps://example.test/source',
      },
      { env, fetchImplementation },
    ),
    (error) => {
      const partial = error as {
        code?: unknown
        context?: { providerMessageEffects?: unknown }
        providerMessageIds?: unknown
      }
      assert.deepEqual(partial.context?.providerMessageEffects, [{
        carriesIntentMedia: true,
        message: 'Generated image',
        providerMessageId: 'message-generated-image',
      }])
      return partial.code === 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY'
        && JSON.stringify(partial.providerMessageIds)
          === JSON.stringify(['message-generated-image'])
    },
  )
  expect(fetchImplementation).toHaveBeenCalledTimes(2)
})

test('linq runtime preserves created-chat media ownership when the rich-link request fails', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  let requestCount = 0
  const fetchImplementation = vi.fn(async () => {
    requestCount += 1
    if (requestCount === 1) {
      return createJsonResponse({
        chat: {
          id: 'chat-created',
          message: { id: 'message-generated-image' },
        },
      })
    }
    return createJsonResponse(
      { error: 'rich-link request failed' },
      { status: 401 },
    )
  })

  await assert.rejects(
    () => createLinqChat(
      {
        from: '+15550000000',
        idempotencyKey: 'created-generated-image-123',
        media: [{ url: 'https://cdn.example.test/generated-image.png' }],
        message: 'Generated image\nhttps://example.test/source',
        to: ['+15550000001'],
      },
      { env, fetchImplementation },
    ),
    (error) => {
      const partial = error as {
        code?: unknown
        context?: { providerMessageEffects?: unknown }
        providerMessageIds?: unknown
      }
      assert.deepEqual(partial.context?.providerMessageEffects, [{
        carriesIntentMedia: true,
        message: 'Generated image',
        providerMessageId: 'message-generated-image',
      }])
      return partial.code === 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY'
        && JSON.stringify(partial.providerMessageIds)
          === JSON.stringify(['message-generated-image'])
    },
  )
  expect(fetchImplementation).toHaveBeenCalledTimes(2)
})

test.each(incompleteTwoPartMessageIdentityCases)(
  'linq runtime keeps an existing-chat rich-link delivery terminal with $label',
  async ({
    expectedMessageId,
    expectedMessageIds,
    linkMessageId,
    primaryMessageId,
  }) => {
    const env = {
      LINQ_API_BASE_URL: 'https://linq.example.test',
      LINQ_API_TOKEN: 'linq-token',
    } satisfies NodeJS.ProcessEnv
    const bodies: Record<string, unknown>[] = []
    let requestCount = 0
    const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(parseJsonRequestBody(requireStringRequestBody(init.body)))
      requestCount += 1
      return createJsonResponse({
        chat_id: 'chat-123',
        message: requestCount === 1
          ? primaryMessageId
            ? { id: primaryMessageId }
            : {}
          : linkMessageId
            ? { id: linkMessageId }
            : {},
      })
    })

    await assert.rejects(
      () => sendLinqChatMessage(
        {
          chatId: 'chat-123',
          idempotencyKey: 'payment-message-123',
          message:
            'Complete payment here:\nhttps://pay.example.test/checkout/session_123',
        },
        { env, fetchImplementation },
      ),
      (error) => {
        const partial = error as {
          code?: unknown
          deliveryMayHaveSucceeded?: unknown
          providerMessageId?: unknown
          providerMessageIds?: unknown
          providerThreadId?: unknown
        }
        return partial.code === 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY'
          && partial.deliveryMayHaveSucceeded === true
          && partial.providerMessageId === expectedMessageId
          && partial.providerThreadId === 'chat-123'
          && JSON.stringify(partial.providerMessageIds)
            === JSON.stringify(expectedMessageIds)
      },
    )
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    assert.deepEqual(bodies[1], {
      message: {
        idempotency_key: 'payment-message-123:link',
        parts: [{
          type: 'link',
          value: 'https://pay.example.test/checkout/session_123',
        }],
      },
    })
  },
)

test.each(missingPrimaryMessageIdentityCases)(
  'linq runtime does not issue an existing-chat rich-link request when the primary response has no identity, even with $label',
  async ({ linkMessageId }) => {
    const env = {
      LINQ_API_BASE_URL: 'https://linq.example.test',
      LINQ_API_TOKEN: 'linq-token',
    } satisfies NodeJS.ProcessEnv
    let requestCount = 0
    const fetchImplementation = vi.fn(async () => {
      requestCount += 1
      return createJsonResponse({
        chat_id: 'chat-123',
        message: requestCount === 1
          ? {}
          : linkMessageId
            ? { id: linkMessageId }
            : {},
      })
    })

    await assert.rejects(
      () => sendLinqChatMessage(
        {
          chatId: 'chat-123',
          idempotencyKey: 'payment-message-123',
          message:
            'Complete payment here:\nhttps://pay.example.test/checkout/session_123',
        },
        { env, fetchImplementation },
      ),
      (error) => error instanceof VaultCliError
        && error.code === 'LINQ_API_REQUEST_FAILED'
        && 'deliveryMayHaveSucceeded' in error
        && error.deliveryMayHaveSucceeded === true,
    )
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  },
)

test('linq runtime retries an identity-less primary with the same key before issuing the link', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const bodies: Record<string, unknown>[] = []
  let primaryAttemptCount = 0
  const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
    const body = parseJsonRequestBody(requireStringRequestBody(init.body))
    bodies.push(body)
    const parts = (body.message as { parts?: Array<{ type?: string }> })?.parts
    if (parts?.[0]?.type === 'link') {
      return createJsonResponse({
        chat_id: 'chat-123',
        message: { id: 'message-link' },
      })
    }
    primaryAttemptCount += 1
    return createJsonResponse({
      chat_id: 'chat-123',
      message: primaryAttemptCount === 1 ? {} : { id: 'message-text' },
    })
  })
  const input = {
    chatId: 'chat-123',
    idempotencyKey: 'payment-message-123',
    message:
      'Complete payment here:\nhttps://pay.example.test/checkout/session_123',
  }

  await assert.rejects(
    () => sendLinqChatMessage(input, { env, fetchImplementation }),
    (error) => error instanceof VaultCliError
      && error.code === 'LINQ_API_REQUEST_FAILED',
  )
  await expect(sendLinqChatMessage(
    input,
    { env, fetchImplementation },
  )).resolves.toMatchObject({
    providerMessageIds: ['message-text', 'message-link'],
  })

  assert.deepEqual(bodies.map((body) => (
    body.message as { idempotency_key?: string }
  )?.idempotency_key), [
    'payment-message-123',
    'payment-message-123',
    'payment-message-123:link',
  ])
})

test('linq runtime keeps a selected link-only payment URL on the text reply anchor', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  let body: Record<string, unknown> | null = null
  const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
    body = parseJsonRequestBody(requireStringRequestBody(init.body))
    return createJsonResponse({
      chat_id: 'chat-123',
      message: {
        id: 'message-link',
      },
    })
  })

  const result = await sendLinqChatMessage(
    {
      chatId: 'chat-123',
      idempotencyKey: 'payment-message-123',
      message: 'https://pay.example.test/checkout/session_123',
      nativeReplyRequested: true,
      replyToMessageId: 'incoming-123',
    },
    { env, fetchImplementation },
  )

  assert.equal(result.message.id, 'message-link')
  assert.deepEqual(body, {
    message: {
      idempotency_key: 'payment-message-123',
      parts: [{
        type: 'text',
        value: 'https://pay.example.test/checkout/session_123',
      }],
      reply_to: {
        message_id: 'incoming-123',
      },
    },
  })
  assert.deepEqual(result.providerMessageEffects, [{
    message: 'https://pay.example.test/checkout/session_123',
    providerMessageId: 'message-link',
  }])
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
})

test('linq runtime sanitizes but still promotes an uppercase terminal HTTPS URL', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  let body: Record<string, unknown> | null = null
  const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
    body = parseJsonRequestBody(requireStringRequestBody(init.body))
    return createJsonResponse({
      chat_id: 'chat-123',
      message: { id: 'message-link' },
    })
  })

  const result = await sendLinqChatMessage(
    {
      chatId: 'chat-123',
      message: 'HTTPS://PAY.EXAMPLE.TEST/checkout/session_123',
    },
    { env, fetchImplementation },
  )

  assert.deepEqual(body, {
    message: {
      parts: [{
        type: 'link',
        value: 'https://pay.example.test/checkout/session_123',
      }],
    },
  })
  assert.deepEqual(result.providerMessageEffects, [{
    message: null,
    providerMessageId: 'message-link',
  }])
})

test('linq runtime keeps created-chat media on the primary message before the rich-link follow-up', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const requests: Array<{ body: Record<string, unknown>; url: string }> = []
  const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({
      body: parseJsonRequestBody(requireStringRequestBody(init.body)),
      url,
    })
    if (url.endsWith('/chats')) {
      return createJsonResponse({
        chat: {
          id: 'chat-created',
          message: { id: 'message-text' },
        },
      })
    }
    return createJsonResponse({
      chat_id: 'chat-created',
      message: { id: 'message-link' },
    })
  })

  const result = await createLinqChat(
    {
      from: '+15550000000',
      idempotencyKey: 'create-123',
      media: [{ url: 'https://cdn.example.test/generated-avatar.png' }],
      message: 'Generated image\nhttps://example.test/source',
      to: ['+15550000001'],
    },
    { env, fetchImplementation },
  )

  assert.equal(result.messageId, 'message-link')
  assert.deepEqual(result.providerMessageIds, ['message-text', 'message-link'])
  assert.deepEqual(result.providerMessageEffects, [
    {
      carriesIntentMedia: true,
      message: 'Generated image',
      providerMessageId: 'message-text',
    },
    {
      message: null,
      providerMessageId: 'message-link',
    },
  ])
  assert.deepEqual(requests, [
    {
      body: {
        from: '+15550000000',
        message: {
          idempotency_key: 'create-123',
          parts: [{
            type: 'text',
            value: 'Generated image',
          }, {
            type: 'media',
            url: 'https://cdn.example.test/generated-avatar.png',
          }],
        },
        to: ['+15550000001'],
      },
      url: 'https://linq.example.test/chats',
    },
    {
      body: {
        message: {
          idempotency_key: 'create-123:link',
          parts: [{
            type: 'link',
            value: 'https://example.test/source',
          }],
        },
      },
      url: 'https://linq.example.test/chats/chat-created/messages',
    },
  ])
})

test.each(incompleteTwoPartMessageIdentityCases)(
  'linq runtime keeps a new-chat rich-link delivery terminal with $label',
  async ({
    expectedMessageId,
    expectedMessageIds,
    linkMessageId,
    primaryMessageId,
  }) => {
    const env = {
      LINQ_API_BASE_URL: 'https://linq.example.test',
      LINQ_API_TOKEN: 'linq-token',
    } satisfies NodeJS.ProcessEnv
    const requests: Array<{ body: Record<string, unknown>; url: string }> = []
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({
        body: parseJsonRequestBody(requireStringRequestBody(init.body)),
        url,
      })
      if (url.endsWith('/chats')) {
        return createJsonResponse({
          chat: {
            id: 'chat-created',
            message: primaryMessageId ? { id: primaryMessageId } : {},
          },
        })
      }
      return createJsonResponse({
        chat_id: 'chat-created',
        message: linkMessageId ? { id: linkMessageId } : {},
      })
    })

    await assert.rejects(
      () => createLinqChat(
        {
          from: '+15550000000',
          idempotencyKey: 'create-123',
          message:
            'Your secure payment link:\nhttps://pay.example.test/checkout/session_123',
          to: ['+15550000001'],
        },
        { env, fetchImplementation },
      ),
      (error) => {
        const partial = error as {
          code?: unknown
          deliveryMayHaveSucceeded?: unknown
          providerMessageId?: unknown
          providerMessageIds?: unknown
          providerThreadId?: unknown
        }
        return partial.code === 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY'
          && partial.deliveryMayHaveSucceeded === true
          && partial.providerMessageId === expectedMessageId
          && partial.providerThreadId === 'chat-created'
          && JSON.stringify(partial.providerMessageIds)
            === JSON.stringify(expectedMessageIds)
      },
    )
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    assert.deepEqual(requests[1], {
      body: {
        message: {
          idempotency_key: 'create-123:link',
          parts: [{
            type: 'link',
            value: 'https://pay.example.test/checkout/session_123',
          }],
        },
      },
      url: 'https://linq.example.test/chats/chat-created/messages',
    })
  },
)

test.each(missingPrimaryMessageIdentityCases)(
  'linq runtime does not issue a new-chat rich-link request when the primary response has no identity, even with $label',
  async ({ linkMessageId }) => {
    const env = {
      LINQ_API_BASE_URL: 'https://linq.example.test',
      LINQ_API_TOKEN: 'linq-token',
    } satisfies NodeJS.ProcessEnv
    let requestCount = 0
    const fetchImplementation = vi.fn(async (url: string) => {
      requestCount += 1
      if (url.endsWith('/chats')) {
        return createJsonResponse({
          chat: {
            id: 'chat-created',
            message: {},
          },
        })
      }
      return createJsonResponse({
        chat_id: 'chat-created',
        message: linkMessageId ? { id: linkMessageId } : {},
      })
    })

    await assert.rejects(
      () => createLinqChat(
        {
          from: '+15550000000',
          idempotencyKey: 'create-123',
          message:
            'Your secure payment link:\nhttps://pay.example.test/checkout/session_123',
          to: ['+15550000001'],
        },
        { env, fetchImplementation },
      ),
      (error) => error instanceof VaultCliError
        && error.code === 'LINQ_API_REQUEST_FAILED'
        && 'deliveryMayHaveSucceeded' in error
        && error.deliveryMayHaveSucceeded === true,
    )
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  },
)

test('linq runtime falls back to URL text after a definitive rich-link rejection', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  let requestCount = 0
  const bodies: Record<string, unknown>[] = []
  const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(parseJsonRequestBody(requireStringRequestBody(init.body)))
    requestCount += 1
    return requestCount === 1
      ? createJsonResponse({
          chat_id: 'chat-123',
          message: { id: 'message-text' },
        })
      : requestCount === 2
        ? createJsonResponse(
          { error: { code: 'LINK_REJECTED' } },
          { status: 400 },
        )
        : createJsonResponse({
          chat_id: 'chat-123',
          message: { id: 'message-fallback' },
        })
  })

  const result = await sendLinqChatMessage(
    {
      chatId: 'chat-123',
      idempotencyKey: 'payment-message-123',
      message:
        'Complete payment here:\nhttps://pay.example.test/checkout/session_123',
    },
    { env, fetchImplementation },
  )
  assert.deepEqual(result.providerMessageIds, [
    'message-text',
    'message-fallback',
  ])
  assert.deepEqual(result.providerMessageEffects, [
    {
      message: 'Complete payment here:',
      providerMessageId: 'message-text',
    },
    {
      message: 'https://pay.example.test/checkout/session_123',
      providerMessageId: 'message-fallback',
    },
  ])
  assert.deepEqual(bodies[2], {
    message: {
      idempotency_key: 'payment-message-123:link:fallback',
      parts: [{
        type: 'text',
        value: 'https://pay.example.test/checkout/session_123',
      }],
    },
  })
  expect(fetchImplementation).toHaveBeenCalledTimes(3)
})

test('linq runtime never fabricates text for a link-only new chat', async () => {
  const fetchImplementation = vi.fn()

  await assert.rejects(
    () => createLinqChat(
      {
        from: '+15550000000',
        message: 'https://pay.example.test/checkout/session_123',
        to: ['+15550000001'],
      },
      { fetchImplementation },
    ),
    (error) =>
      error instanceof VaultCliError
      && error.code === 'LINQ_INVALID_INPUT'
      && error.message.includes('caller-supplied text or media'),
  )
  expect(fetchImplementation).not.toHaveBeenCalled()
})

test('linq runtime refuses multiple new-chat URLs before provider entry', async () => {
  const fetchImplementation = vi.fn()

  await assert.rejects(
    () => createLinqChat(
      {
        from: '+15550000000',
        message:
          'Use https://first.example.test or https://pay.example.test/checkout/session_123',
        to: ['+15550000001'],
      },
      { fetchImplementation },
    ),
    (error) =>
      error instanceof VaultCliError
      && error.code === 'LINQ_INVALID_INPUT'
      && error.message.includes('cannot include URL text'),
  )
  expect(fetchImplementation).not.toHaveBeenCalled()
})

test('linq runtime makes a missing created-chat id retryable without a link send', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const fetchImplementation = vi.fn(async () =>
    createJsonResponse({
      chat: {
        message: { id: 'message-text' },
      },
    }),
  )

  await assert.rejects(
    () => createLinqChat(
      {
        from: '+15550000000',
        message: 'Your secure payment link:\nhttps://pay.example.test/checkout/session_123',
        to: ['+15550000001'],
      },
      { env, fetchImplementation },
    ),
    (error) =>
      error instanceof VaultCliError
      && error.code === 'LINQ_API_REQUEST_FAILED'
      && error.context?.retryable === true
      && error.message.includes('missing a chat id'),
  )
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
})

test('linq runtime omits the text part for media-only messages and rejects empty text-only sends', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  let body: Record<string, unknown> | null = null
  const fetchImplementation = vi.fn(async (_url: string, init: RequestInit) => {
    if (typeof init.body !== 'string' && !(init.body instanceof Blob)) {
      throw new TypeError('Expected a JSON request body.')
    }
    body = parseJsonRequestBody(init.body)
    return createJsonResponse({
      chat_id: 'chat-123',
      id: 'message-media-only',
    })
  })

  await sendLinqChatMessage({
    chatId: 'chat-123',
    media: [{ attachmentId: 'attachment-pdf-1' }],
    message: '',
  }, { env, fetchImplementation })

  assert.deepEqual(body, {
    message: {
      parts: [{
        attachment_id: 'attachment-pdf-1',
        type: 'media',
      }],
    },
  })
  await assert.rejects(
    () => sendLinqChatMessage({
      chatId: 'chat-123',
      message: '   ',
    }, { env, fetchImplementation }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_INVALID_INPUT' &&
      error.message === 'Linq messages must include text or media.',
  )
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
})

test('linq runtime converts supported text styles to iMessage text decorations', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const seenRequests: Array<{
    body?: string | Blob
    method: string
    url: string
  }> = []
  const fetchImplementation = vi.fn(async (url: string, init) => {
    seenRequests.push({
      body: init.body,
      method: init.method,
      url,
    })

    return createJsonResponse({
      message: {
        id: 'message-1',
      },
    })
  })

  const result = await sendLinqChatMessage(
    {
      chatId: 'chat-123',
      message: '  This is **bold**, *italic*, _short aside_, ~~gone~~, and ++underlined++. Keep durable/home/*/rollout-*.jsonl intact.  ',
    },
    { env, fetchImplementation },
  )

  assert.equal(seenRequests.length, 1)
  assert.deepEqual(result.providerMessageEffects, [{
    message: 'This is bold, italic, short aside, gone, and underlined. Keep durable/home/*/rollout-*.jsonl intact.',
    providerMessageId: 'message-1',
  }])
  assert.deepEqual(parseJsonRequestBody(seenRequests[0]?.body), {
    message: {
      parts: [
        {
          text_decorations: [
            {
              range: [8, 12],
              style: 'bold',
            },
            {
              range: [14, 20],
              style: 'italic',
            },
            {
              range: [22, 33],
              style: 'italic',
            },
            {
              range: [35, 39],
              style: 'strikethrough',
            },
            {
              range: [45, 55],
              style: 'underline',
            },
          ],
          type: 'text',
          value: 'This is bold, italic, short aside, gone, and underlined. Keep durable/home/*/rollout-*.jsonl intact.',
        },
      ],
    },
  })
})

test('linq runtime preserves exact underscore-delimited message text', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const seenRequests: Array<{
    body?: string | Blob
    method: string
    url: string
  }> = []
  const fetchImplementation = vi.fn(async (url: string, init) => {
    seenRequests.push({
      body: init.body,
      method: init.method,
      url,
    })

    return createJsonResponse({
      message: {
        id: 'message-1',
      },
    })
  })

  const message = 'Open https://example.test/download?filename=_report_.pdf and keep token _ABC_ plus 变量_名称_值.'

  await sendLinqChatMessage(
    {
      chatId: 'chat-123',
      message,
    },
    { env, fetchImplementation },
  )

  assert.equal(seenRequests.length, 1)
  assert.deepEqual(parseJsonRequestBody(seenRequests[0]?.body), {
    message: {
      parts: [
        {
          type: 'text',
          value: message,
        },
      ],
    },
  })
})

test('linq runtime emits iMessage bold decoration before an em dash', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const seenRequests: Array<{
    body?: string | Blob
    method: string
    url: string
  }> = []
  const fetchImplementation = vi.fn(async (url: string, init) => {
    seenRequests.push({
      body: init.body,
      method: init.method,
      url,
    })

    return createJsonResponse({
      message: {
        id: 'message-1',
      },
    })
  })

  await sendLinqChatMessage(
    {
      chatId: 'chat-123',
      message: 'humor is set to **10/10**—the regulator has been removed entirely.',
    },
    { env, fetchImplementation },
  )

  assert.equal(seenRequests.length, 1)
  assert.deepEqual(parseJsonRequestBody(seenRequests[0]?.body), {
    message: {
      parts: [
        {
          text_decorations: [
            {
              range: [16, 21],
              style: 'bold',
            },
          ],
          type: 'text',
          value: 'humor is set to 10/10—the regulator has been removed entirely.',
        },
      ],
    },
  })
})

test('linq runtime creates, uploads, and sends voice memo attachments without replay keys', async () => {
  const env = {
    LINQ_API_BASE_URL: ' https://linq.example.test/custom/ ',
    LINQ_API_TOKEN: ' linq-token ',
  } satisfies NodeJS.ProcessEnv
  const audioBytes = new Uint8Array([1, 2, 3, 4])
  const seenRequests: Array<{
    body?: string | Blob
    headers: Record<string, string>
    method: string
    url: string
  }> = []
  let voiceMemoAttempts = 0
  const fetchImplementation = vi.fn(async (url: string, init) => {
    seenRequests.push({
      body: init.body,
      headers: init.headers ?? {},
      method: init.method,
      url,
    })

    if (url.endsWith('/attachments')) {
      return createJsonResponse({
        attachment_id: ' attachment_voice_1 ',
        download_url: ' https://cdn.example.test/voice-memo.mp3 ',
        expires_at: ' 2026-04-08T00:05:00.000Z ',
        http_method: 'PUT',
        required_headers: {
          'content-type': 'audio/mpeg',
          'x-upload-token': 'upload-token',
        },
        upload_url: ' https://uploads.example.test/upload/voice-memo ',
      })
    }

    if (url === 'https://uploads.example.test/upload/voice-memo') {
      return new Response(null, { status: 204 })
    }

    if (url.endsWith('/chats/chat-123/voicememo')) {
      voiceMemoAttempts += 1
      if (voiceMemoAttempts === 1) {
        return createJsonResponse({ detail: 'rate limited' }, {
          headers: { 'Retry-After': '0' },
          status: 429,
        })
      }
      return createJsonResponse({
        voice_memo: {
          chat: {
            id: 'chat-123',
          },
          id: 'message-voice-1',
          voice_memo: {
            id: 'attachment_voice_1',
            url: 'https://cdn.example.test/voice-memo.mp3',
          },
        },
      })
    }

    throw new Error(`Unexpected request: ${init.method} ${url}`)
  })

  await expect(
    uploadLinqAttachment(
      {
        bytes: audioBytes,
        contentType: 'audio/mpeg',
        filename: ' voice-memo.mp3 ',
      },
      { env, fetchImplementation },
    ),
  ).resolves.toEqual({
    attachmentId: 'attachment_voice_1',
  })

  await expect(
    sendLinqVoiceMemo(
      {
        attachmentId: ' attachment_voice_1 ',
        chatId: ' chat-123 ',
      },
      { env, fetchImplementation },
    ),
  ).resolves.toEqual({
    providerMessageId: 'message-voice-1',
    providerThreadId: 'chat-123',
    target: 'chat-123',
    voiceMemoAttachmentId: 'attachment_voice_1',
    voiceMemoUrl: 'https://cdn.example.test/voice-memo.mp3',
  })

  const createRequest = seenRequests.find((request) =>
    request.method === 'POST' && request.url.endsWith('/attachments')
  )
  assert.ok(createRequest)
  assert.deepEqual(parseJsonRequestBody(createRequest.body), {
    content_type: 'audio/mpeg',
    filename: 'voice-memo.mp3',
    size_bytes: audioBytes.byteLength,
  })
  assert.equal(createRequest.headers.authorization, 'Bearer linq-token')

  const uploadRequest = seenRequests.find((request) =>
    request.method === 'PUT' && request.url === 'https://uploads.example.test/upload/voice-memo'
  )
  assert.ok(uploadRequest)
  expect(uploadRequest.body).toBeInstanceOf(Blob)
  assert.deepEqual(
    new Uint8Array(await (uploadRequest.body as Blob).arrayBuffer()),
    audioBytes,
  )
  assert.equal(uploadRequest.headers.authorization, undefined)
  assert.deepEqual(uploadRequest.headers, {
    'content-type': 'audio/mpeg',
    'x-upload-token': 'upload-token',
  })

  const voiceMemoRequest = seenRequests.find((request) =>
    request.method === 'POST' && request.url.endsWith('/chats/chat-123/voicememo')
  )
  assert.ok(voiceMemoRequest)
  const voiceMemoRequests = seenRequests.filter((request) =>
    request.method === 'POST' && request.url.endsWith('/chats/chat-123/voicememo')
  )
  assert.equal(voiceMemoRequests.length, 2)
  for (const request of voiceMemoRequests) {
    assert.deepEqual(parseJsonRequestBody(request.body), {
      attachment_id: 'attachment_voice_1',
    })
    assert.equal(
      JSON.stringify(request.body).includes('idempotency'),
      false,
    )
  }
})

test('linq runtime uploads attachment bytes with public fetch for the presigned PUT', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const bytes = new Uint8Array([1, 2, 3, 4])
  const providerFetch = vi.fn(async (url: string, init) => {
    assert.equal(init.method, 'POST')
    assert.ok(url.endsWith('/attachments'))
    assert.deepEqual(parseJsonRequestBody(init.body), {
      content_type: 'application/pdf',
      filename: 'report.pdf',
      size_bytes: bytes.byteLength,
    })
    return createJsonResponse({
      attachment_id: 'attachment_pdf_1',
      download_url: 'https://cdn.example.test/report.pdf',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {
        'content-type': 'application/pdf',
        'x-upload-token': 'upload-token',
      },
      upload_url: 'https://uploads.example.test/upload/report',
    })
  })
  const publicFetch = vi.fn(async (url: string, init) => {
    assert.equal(url, 'https://uploads.example.test/upload/report')
    assert.equal(init.method, 'PUT')
    assert.equal(init.redirect, 'error')
    assert.deepEqual(init.headers, {
      'content-type': 'application/pdf',
      'x-upload-token': 'upload-token',
    })
    return new Response(null, { status: 204 })
  })

  await expect(
    uploadLinqAttachment(
      {
        bytes,
        contentType: 'application/pdf',
        filename: 'report.pdf',
      },
      {
        env,
        fetchImplementation: providerFetch,
        publicFetchImplementation: publicFetch,
      },
    ),
  ).resolves.toEqual({ attachmentId: 'attachment_pdf_1' })

  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).toHaveBeenCalledTimes(1)
})

test('linq runtime retries only the presigned attachment PUT with stable reservation bytes', async () => {
  vi.useFakeTimers()
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const bytes = new Uint8Array([7, 8, 9, 10])
  const providerFetch = vi.fn(async () =>
    createJsonResponse({
      attachment_id: 'attachment_pdf_retry',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {
        'content-type': 'application/pdf',
        'x-upload-token': 'stable-upload-token',
      },
      upload_url: 'https://uploads.example.test/upload/retry-report',
    }))
  const uploadBodies: Blob[] = []
  const uploadHeaders: Array<Record<string, string> | undefined> = []
  const uploadUrls: string[] = []
  let uploadAttempts = 0
  const publicFetch = vi.fn(async (url: string, init) => {
    assert.ok(init.body instanceof Blob)
    uploadBodies.push(init.body)
    uploadHeaders.push(init.headers)
    uploadUrls.push(url)
    uploadAttempts += 1
    if (uploadAttempts === 1) {
      throw new TypeError('socket closed')
    }
    if (uploadAttempts === 2) {
      return createJsonResponse({ error: 'temporarily unavailable' }, {
        headers: { 'Retry-After': '0' },
        status: 503,
      })
    }
    return new Response(null, { status: 204 })
  })

  const upload = uploadLinqAttachment(
    {
      bytes,
      contentType: 'application/pdf',
      filename: 'report.pdf',
    },
    {
      env,
      fetchImplementation: providerFetch,
      publicFetchImplementation: publicFetch,
    },
  )
  await vi.runAllTimersAsync()

  await expect(upload).resolves.toEqual({ attachmentId: 'attachment_pdf_retry' })
  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).toHaveBeenCalledTimes(3)
  expect(uploadBodies).toHaveLength(3)
  expect(uploadBodies[1]).toBe(uploadBodies[0])
  expect(uploadBodies[2]).toBe(uploadBodies[0])
  expect(uploadHeaders[1]).toBe(uploadHeaders[0])
  expect(uploadHeaders[2]).toBe(uploadHeaders[0])
  expect(uploadUrls).toEqual([
    'https://uploads.example.test/upload/retry-report',
    'https://uploads.example.test/upload/retry-report',
    'https://uploads.example.test/upload/retry-report',
  ])
  for (const body of uploadBodies) {
    assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes)
  }
})

test('linq runtime bounds retryable presigned attachment PUT failures', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const providerFetch = vi.fn(async () =>
    createJsonResponse({
      attachment_id: 'attachment_pdf_bounded',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {
        'content-type': 'application/pdf',
      },
      upload_url: 'https://uploads.example.test/upload/bounded-report',
    }))
  const publicFetch = vi.fn(async () =>
    createJsonResponse({ error: 'temporarily unavailable' }, {
      headers: { 'Retry-After': '0' },
      status: 503,
    }))

  await assert.rejects(
    () => uploadLinqAttachment(
      {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: 'application/pdf',
        filename: 'report.pdf',
      },
      {
        env,
        fetchImplementation: providerFetch,
        publicFetchImplementation: publicFetch,
      },
    ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.failureStage === 'http' &&
      error.context?.method === 'PUT' &&
      error.context?.path === '[presigned-upload]' &&
      error.context?.retryable === false &&
      error.context?.status === 503,
  )

  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).toHaveBeenCalledTimes(3)
})

test('linq runtime keeps presigned attachment retries inside one timeout budget', async () => {
  vi.useFakeTimers()
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const providerFetch = vi.fn(async () =>
    createJsonResponse({
      attachment_id: 'attachment_pdf_deadline',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {
        'content-type': 'application/pdf',
      },
      upload_url: 'https://uploads.example.test/upload/deadline-report',
    }))
  const publicFetch = vi.fn(async () =>
    createJsonResponse({ error: 'temporarily unavailable' }, {
      headers: { 'Retry-After': '30' },
      status: 503,
    }))
  const startedAt = Date.now()

  const rejection = assert.rejects(
    uploadLinqAttachment(
      {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: 'application/pdf',
        filename: 'report.pdf',
      },
      {
        env,
        fetchImplementation: providerFetch,
        publicFetchImplementation: publicFetch,
      },
    ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.failureStage === 'http' &&
      error.context?.method === 'PUT' &&
      error.context?.retryable === false &&
      error.context?.status === 503,
  )
  await vi.advanceTimersByTimeAsync(30_000)
  await rejection

  expect(Date.now() - startedAt).toBe(30_000)
  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).toHaveBeenCalledTimes(1)
})

test('linq runtime keeps the upload budget active through retryable response bodies', async () => {
  vi.useFakeTimers()
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const providerFetch = vi.fn(async () =>
    createJsonResponse({
      attachment_id: 'attachment_pdf_body_deadline',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {
        'content-type': 'application/pdf',
      },
      upload_url: 'https://uploads.example.test/upload/body-deadline-report',
    }))
  const publicFetch = vi.fn<LinqFetch>(async (_url, init) => ({
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: { 'Retry-After': '0' },
    json: async () => ({ error: 'temporarily unavailable' }),
    ok: false,
    status: 503,
    text: () => new Promise<string>((_resolve, reject) => {
      const rejectOnAbort = () => reject(new DOMException('aborted', 'AbortError'))
      if (init.signal?.aborted) {
        rejectOnAbort()
        return
      }
      init.signal?.addEventListener('abort', rejectOnAbort, { once: true })
    }),
  }))
  const startedAt = Date.now()

  const rejection = assert.rejects(
    uploadLinqAttachment(
      {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: 'application/pdf',
        filename: 'report.pdf',
      },
      {
        env,
        fetchImplementation: providerFetch,
        publicFetchImplementation: publicFetch,
      },
    ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.failureStage === 'http' &&
      error.context?.method === 'PUT' &&
      error.context?.retryable === false &&
      error.context?.status === 503,
  )
  await vi.advanceTimersByTimeAsync(30_000)
  await rejection

  expect(Date.now() - startedAt).toBe(30_000)
  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).toHaveBeenCalledTimes(1)
})

test('linq runtime aborts a presigned attachment PUT retry without another attempt', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const signalController = new AbortController()
  const providerFetch = vi.fn(async () =>
    createJsonResponse({
      attachment_id: 'attachment_pdf_abort',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {
        'content-type': 'application/pdf',
      },
      upload_url: 'https://uploads.example.test/upload/abort-report',
    }))
  const publicFetch = vi.fn(async () => {
    queueMicrotask(() => signalController.abort())
    return createJsonResponse({ error: 'temporarily unavailable' }, {
      status: 503,
    })
  })

  await assert.rejects(
    () => uploadLinqAttachment(
      {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: 'application/pdf',
        filename: 'report.pdf',
      },
      {
        env,
        fetchImplementation: providerFetch,
        publicFetchImplementation: publicFetch,
        signal: signalController.signal,
      },
    ),
    (error) => error instanceof Error && error.name === 'AbortError',
  )

  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).toHaveBeenCalledTimes(1)
})

test('linq runtime does not retry an ambiguous attachment reservation failure', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const providerFetch = vi.fn(async () => {
    throw new TypeError('connection ended before a response')
  })
  const publicFetch = vi.fn(async () => new Response(null, { status: 204 }))

  await assert.rejects(
    () => uploadLinqAttachment(
      {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: 'application/pdf',
        filename: 'report.pdf',
      },
      {
        env,
        fetchImplementation: providerFetch,
        publicFetchImplementation: publicFetch,
      },
    ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.failureStage === 'transport' &&
      error.context?.method === 'POST' &&
      error.context?.path === '/attachments' &&
      error.context?.retryable === false,
  )

  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).not.toHaveBeenCalled()
})

test('linq runtime preserves pre-provider yield provenance without retrying the reservation locally', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const providerSkippedError = Object.assign(
    new Error('foreground work owns provider entry'),
    {
      assistantDeliveryFailureClass: 'transient' as const,
      assistantDeliveryResumeTrigger: 'fresh_foreground_input' as const,
      deliveryMayHaveSucceeded: false as const,
      retryable: true as const,
    },
  )
  const providerFetch = vi.fn(async () => {
    throw providerSkippedError
  })
  const publicFetch = vi.fn(async () => new Response(null, { status: 204 }))

  await assert.rejects(
    () => uploadLinqAttachment(
      {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: 'application/pdf',
        filename: 'report.pdf',
      },
      {
        env,
        fetchImplementation: providerFetch,
        publicFetchImplementation: publicFetch,
      },
    ),
    (error) => error === providerSkippedError,
  )

  expect(providerSkippedError).toMatchObject({
    assistantDeliveryFailureClass: 'transient',
    assistantDeliveryResumeTrigger: 'fresh_foreground_input',
    deliveryMayHaveSucceeded: false,
    retryable: true,
  })
  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).not.toHaveBeenCalled()
})

test('linq runtime preserves post-reservation provenance without retrying the message locally', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const providerFetch = vi.fn(async () => {
    throw Object.assign(new Error('foreground work owns provider entry'), {
      linqAttachmentReservationMayHaveSucceeded: true as const,
    })
  })

  await assert.rejects(
    () => sendLinqChatMessage(
      {
        chatId: 'chat-post-reservation-yield',
        idempotencyKey: 'post-reservation-yield',
        message: 'Private media',
      },
      {
        env,
        fetchImplementation: providerFetch,
      },
    ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.failureStage === 'transport' &&
      error.context?.method === 'POST' &&
      error.context?.operation === 'send_message' &&
      error.context?.retryable === false &&
      (error as VaultCliError & {
        linqAttachmentReservationMayHaveSucceeded?: unknown
      }).linqAttachmentReservationMayHaveSucceeded === true,
  )

  expect(providerFetch).toHaveBeenCalledTimes(1)
})

test.each([
  {
    label: 'missing required fields',
    payload: {
      attachment_id: 'attachment_missing_upload_url',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {
        'content-type': 'application/pdf',
      },
      detail: 'reservation-secret-value',
    },
  },
  {
    label: 'an unsupported upload method',
    payload: {
      attachment_id: 'attachment_unsupported_method',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'POST',
      required_headers: {
        'content-type': 'application/pdf',
      },
      detail: 'reservation-secret-value',
      upload_url: 'https://uploads.example.test/upload/report',
    },
  },
  {
    label: 'empty required headers',
    payload: {
      attachment_id: 'attachment_empty_headers',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {},
      detail: 'reservation-secret-value',
      upload_url: 'https://uploads.example.test/upload/report',
    },
  },
  {
    label: 'all-blank required headers',
    payload: {
      attachment_id: 'attachment_blank_headers',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {
        '   ': '   ',
        'content-type': '   ',
      },
      detail: 'reservation-secret-value',
      upload_url: 'https://uploads.example.test/upload/report',
    },
  },
])('linq runtime marks a successful reservation with $label as post-reservation ambiguity', async ({ payload }) => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const providerFetch = vi.fn(async () => createJsonResponse(payload))
  const publicFetch = vi.fn(async () => new Response(null, { status: 204 }))
  await assert.rejects(
    () => uploadLinqAttachment(
      {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: 'application/pdf',
        filename: 'report.pdf',
      },
      {
        env,
        fetchImplementation: providerFetch,
        publicFetchImplementation: publicFetch,
      },
    ),
    (error) => {
      if (!(error instanceof VaultCliError)) {
        return false
      }
      expect(JSON.stringify({
        context: error.context,
        message: error.message,
      })).not.toContain('reservation-secret-value')
      return error.code === 'LINQ_API_REQUEST_FAILED' &&
        error.context?.failureStage === 'http' &&
        error.context?.method === 'POST' &&
        error.context?.operation === 'create_attachment_upload' &&
        error.context?.path === '/attachments' &&
        error.context?.retryable === false &&
        error.context?.status === 200 &&
        (error as VaultCliError & {
          deliveryMayHaveSucceeded?: unknown
          retryable?: unknown
        }).deliveryMayHaveSucceeded === true &&
        (error as VaultCliError & { retryable?: unknown }).retryable === false
    },
  )

  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).not.toHaveBeenCalled()
})

test('linq runtime fails closed when a presigned attachment PUT redirects', async () => {
  vi.useFakeTimers()
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const bytes = new Uint8Array([1, 2, 3, 4])
  const providerFetch = vi.fn(async (url: string, init) => {
    assert.equal(init.method, 'POST')
    assert.ok(url.endsWith('/attachments'))
    return createJsonResponse({
      attachment_id: 'attachment_pdf_1',
      download_url: 'https://cdn.example.test/report.pdf',
      expires_at: '2026-04-08T00:05:00.000Z',
      http_method: 'PUT',
      required_headers: {
        'content-type': 'application/pdf',
        'x-upload-token': 'upload-token',
      },
      upload_url: 'https://uploads.example.test/upload/report',
    })
  })
  const publicFetch = vi.fn(async (url: string, init) => {
    assert.equal(url, 'https://uploads.example.test/upload/report')
    assert.equal(init.method, 'PUT')
    assert.equal(init.redirect, 'error')
    throw new TypeError('fetch failed: redirected')
  })

  const upload = uploadLinqAttachment(
    {
      bytes,
      contentType: 'application/pdf',
      filename: 'report.pdf',
    },
    {
      env,
      fetchImplementation: providerFetch,
      publicFetchImplementation: publicFetch,
    },
  )
  const rejection = assert.rejects(
    upload,
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.operation === 'create_attachment_upload' &&
      error.context?.provider === 'linq' &&
      error.context?.failureStage === 'transport' &&
      error.context?.method === 'PUT' &&
      error.context?.path === '[presigned-upload]' &&
      error.context?.requestOrigin === 'https://uploads.example.test' &&
      error.context?.retryable === false &&
      error.context?.timedOut === false,
  )
  await vi.runAllTimersAsync()
  await rejection

  expect(providerFetch).toHaveBeenCalledTimes(1)
  expect(publicFetch).toHaveBeenCalledTimes(3)
})

test('linq runtime falls back to provider fetch for attachment PUT when public fetch is absent', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom/',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const seenRequests: Array<{ method: string; url: string }> = []
  const fetchImplementation = vi.fn(async (url: string, init) => {
    seenRequests.push({ method: init.method, url })
    if (url.endsWith('/attachments')) {
      return createJsonResponse({
        attachment_id: 'attachment_pdf_1',
        download_url: 'https://cdn.example.test/report.pdf',
        expires_at: '2026-04-08T00:05:00.000Z',
        http_method: 'PUT',
        required_headers: {
          'content-type': 'application/pdf',
        },
        upload_url: 'https://uploads.example.test/upload/report',
      })
    }
    if (url === 'https://uploads.example.test/upload/report') {
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected request: ${init.method} ${url}`)
  })

  await expect(
    uploadLinqAttachment(
      {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: 'application/pdf',
        filename: 'report.pdf',
      },
      { env, fetchImplementation },
    ),
  ).resolves.toEqual({ attachmentId: 'attachment_pdf_1' })

  expect(seenRequests).toEqual([
    {
      method: 'POST',
      url: 'https://linq.example.test/custom/attachments',
    },
    {
      method: 'PUT',
      url: 'https://uploads.example.test/upload/report',
    },
  ])
})

test('linq runtime marks unsafe 2xx attachment upload URLs ambiguous before uploading bytes', async () => {
  const env = {
    LINQ_API_BASE_URL: ' https://linq.example.test/custom/ ',
    LINQ_API_TOKEN: ' linq-token ',
  } satisfies NodeJS.ProcessEnv
  const createFetch = vi.fn(async (url: string, init) => {
    if (url.endsWith('/attachments') && init.method === 'POST') {
      return createJsonResponse({
        attachment_id: 'attachment_voice_1',
        download_url: 'https://cdn.example.test/voice-memo.mp3',
        expires_at: '2026-04-08T00:05:00.000Z',
        http_method: 'PUT',
        required_headers: {
          'content-type': 'audio/mpeg',
        },
        upload_url: 'http://127.0.0.1/upload/voice-memo',
      })
    }

    throw new Error(`Unexpected request: ${init.method} ${url}`)
  })

  await assert.rejects(
    () =>
      uploadLinqAttachment(
        {
          bytes: new Uint8Array([1, 2, 3, 4]),
          contentType: 'audio/mpeg',
          filename: 'voice-memo.mp3',
        },
        { env, fetchImplementation: createFetch },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.message.includes('must use HTTPS') &&
      error.context?.failureStage === 'http' &&
      error.context?.method === 'POST' &&
      error.context?.operation === 'create_attachment_upload' &&
      error.context?.status === 200 &&
      (error as VaultCliError & {
        deliveryMayHaveSucceeded?: unknown
      }).deliveryMayHaveSucceeded === true,
  )
  expect(createFetch).toHaveBeenCalledTimes(1)

  const uploadFetch = vi.fn()
  const unsafeUploadFetch = vi.fn(async (url: string, init) => {
    if (url.endsWith('/attachments') && init.method === 'POST') {
      return createJsonResponse({
        attachment_id: 'attachment_voice_1',
        download_url: 'https://cdn.example.test/voice-memo.mp3',
        expires_at: '2026-04-08T00:05:00.000Z',
        http_method: 'PUT',
        required_headers: {
          'content-type': 'audio/mpeg',
        },
        upload_url: 'https://127.0.0.1/upload/voice-memo',
      })
    }

    throw new Error(`Unexpected request: ${init.method} ${url}`)
  })
  await assert.rejects(
    () =>
      uploadLinqAttachment(
        {
          bytes: new Uint8Array([1, 2, 3, 4]),
          contentType: 'audio/mpeg',
          filename: 'voice-memo.mp3',
        },
        {
          env,
          fetchImplementation: unsafeUploadFetch,
          publicFetchImplementation: uploadFetch,
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.message.includes('must use a public host') &&
      error.context?.failureStage === 'http' &&
      error.context?.method === 'POST' &&
      error.context?.operation === 'create_attachment_upload' &&
      error.context?.status === 200 &&
      (error as VaultCliError & {
        deliveryMayHaveSucceeded?: unknown
      }).deliveryMayHaveSucceeded === true,
  )
  expect(uploadFetch).not.toHaveBeenCalled()
})

test('linq runtime rejects non-HTTPS media URLs before sending', async () => {
  let called = false

  await assert.rejects(
    () =>
      sendLinqChatMessage(
        {
          chatId: 'chat-123',
          media: [
            {
              url: 'http://cdn.example.test/dead-bug/setup.png',
            },
          ],
          message: 'hello',
        },
        {
          env: {
            LINQ_API_TOKEN: 'token',
          },
          fetchImplementation: async () => {
            called = true
            return createJsonResponse({})
          },
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_INVALID_INPUT' &&
      error.message === 'Linq media URLs must use HTTPS.',
  )
  assert.equal(called, false)
})

test('linq runtime preserves path-prefixed base urls when building requests', async () => {
  const seenUrls: string[] = []

  await sendLinqChatMessage(
    {
      chatId: 'chat:123',
      message: 'hello',
    },
    {
      env: {
        LINQ_API_BASE_URL:
          'http://host.docker.internal:8902/custom/results.worker',
        LINQ_API_TOKEN: 'token',
      },
      fetchImplementation: async (url) => {
        seenUrls.push(url)
        return createJsonResponse({
          chat_id: 'chat:123',
          id: 'message-1',
        })
      },
    },
  )

  assert.deepEqual(seenUrls, [
    'http://host.docker.internal:8902/custom/results.worker/chats/chat%3A123/messages',
  ])
})

test('markLinqChatRead posts a no-body read acknowledgement with Linq metadata', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const seenRequests: Array<{
    body?: string | Blob
    headers?: Record<string, string>
    method: string
    url: string
  }> = []

  await markLinqChatRead(
    {
      chatId: ' chat:123 ',
    },
    {
      env,
      fetchImplementation: async (url: string, init) => {
        seenRequests.push({
          body: init.body,
          headers: init.headers,
          method: init.method,
          url,
        })
        return new Response(null, { status: 204 })
      },
    },
  )

  assert.deepEqual(seenRequests, [
    {
      body: undefined,
      headers: {
        authorization: `Bearer ${env.LINQ_API_TOKEN}`,
      },
      method: 'POST',
      url: 'https://linq.example.test/custom/chats/chat%3A123/read',
    },
  ])

  await assert.rejects(
    () =>
      markLinqChatRead(
        {
          chatId: 'chat-123',
        },
        {
          env,
          fetchImplementation: async () =>
            createJsonResponse({ detail: 'read unavailable' }, {
              status: 503,
            }),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.operation === 'mark_read' &&
      error.context?.provider === 'linq' &&
      error.context?.failureStage === 'http' &&
      error.context?.method === 'POST' &&
      error.context?.path === '/chats/[chat]/read' &&
      error.context?.retryable === false &&
      error.context?.status === 503,
  )
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
      error.context?.operation === 'send_message' &&
      error.context?.provider === 'linq' &&
      error.context?.failureStage === 'transport' &&
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
      error.context?.operation === 'create_webhook_subscription' &&
      error.context?.provider === 'linq' &&
      error.context?.failureStage === 'http' &&
      error.context?.retryable === true &&
      error.context?.status === 429 &&
      error.message ===
        'Linq request POST /webhook-subscriptions failed with HTTP 429.',
  )
})

test('linq runtime preserves an explicit pre-provider delivery failure', async () => {
  const preProviderError = Object.assign(
    new VaultCliError(
      'HOSTED_BACKGROUND_DELIVERY_YIELDED',
      'Hosted background delivery yielded before provider entry.',
      { retryable: true },
    ),
    { deliveryMayHaveSucceeded: false as const },
  )
  const fetchImplementation: LinqFetch = vi.fn(async () => {
    throw preProviderError
  })

  await expect(sendLinqChatMessage({
    chatId: 'chat-pre-provider-failure',
    idempotencyKey: 'message-pre-provider-failure',
    message: 'hello',
  }, {
    env: { LINQ_API_TOKEN: 'linq-token' },
    fetchImplementation,
  })).rejects.toBe(preProviderError)
  expect(fetchImplementation).toHaveBeenCalledOnce()
})

test('deleteLinqMessage treats missing provider messages as an idempotent success', async () => {
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv
  const fetchImplementation = vi.fn(async (url: string, init) => {
    if (url.endsWith('/messages/message-present')) {
      return new Response(null, { status: 204 })
    }

    if (url.endsWith('/messages/message-missing')) {
      return createJsonResponse({ error: 'missing' }, { status: 404 })
    }

    throw new Error(`Unexpected request: ${init.method} ${url}`)
  })

  await deleteLinqMessage(
    {
      messageId: ' message-present ',
    },
    {
      env,
      fetchImplementation,
    },
  )
  await deleteLinqMessage(
    {
      messageId: ' message-missing ',
    },
    {
      env,
      fetchImplementation,
    },
  )

  expect(fetchImplementation).toHaveBeenCalledTimes(2)
  expect(fetchImplementation.mock.calls[0]?.[0]).toContain('/messages/message-present')
  expect(fetchImplementation.mock.calls[1]?.[0]).toContain('/messages/message-missing')
})

test('linq runtime records safe request and response diagnostics for provider http failures', async () => {
  await assert.rejects(
    () =>
      sendLinqChatMessage(
        {
          chatId: 'sample-chat-route-value',
          idempotencyKey: 'reply-key-safe-diagnostics',
          media: [
            { url: 'https://cdn.example.test/private-diagnostic-image.png' },
            { attachmentId: 'attachment-safe-diagnostics' },
          ],
          message: 'hello reminder',
          replyToMessageId: 'reply-sample-message-id',
        },
        {
          env: {
            LINQ_API_TOKEN: '<REDACTED_TOKEN>',
          },
          fetchImplementation: async () =>
            createJsonResponse(
              {
                'sample-chat-route-value': 'dynamic key should stay private',
                error: {
                  code: 1004,
                  doc_url: 'https://docs.linqapp.com/error/codes/1xxx/1004/',
                  message: 'chat sample-chat-route-value rejected message',
                  status: 400,
                },
                success: false,
                trace_id: 'trace-sample-response-value',
              },
              {
                status: 400,
              },
            ),
        },
      ),
    (error) => {
      if (!(error instanceof VaultCliError)) {
        return false
      }

      const contextJson = JSON.stringify(error.context)
      return (
        error.code === 'LINQ_API_REQUEST_FAILED' &&
        error.message ===
          'Linq request POST /chats/[chat]/messages failed with HTTP 400.' &&
        error.context?.path === '/chats/[chat]/messages' &&
        error.context?.requestBodyShape ===
          'object:message|message:idempotency_key,parts' &&
        error.context?.requestMessageLength === 'hello reminder'.length &&
        error.context?.requestMessagePartCount === 3 &&
        error.context?.requestTextPartCount === 1 &&
        error.context?.requestMediaPartCount === 2 &&
        error.context?.requestPublicUrlMediaPartCount === 1 &&
        error.context?.requestAttachmentMediaPartCount === 1 &&
        error.context?.providerErrorCode === '1004' &&
        error.context?.providerRequestId === 'trace-sample-response-value' &&
        error.context?.responseBodyKind === 'json_object' &&
        error.context?.responseBodyKeyCount === 4 &&
        error.context?.responseBodyKeySummary === 'error,trace_id' &&
        JSON.stringify(error.context?.responseBodyKeys) ===
          JSON.stringify(['error', 'trace_id']) &&
        error.context?.responseBodyStringFieldCount === 2 &&
        error.context?.responseBodyStringFieldSummary === 'trace_id' &&
        JSON.stringify(error.context?.responseBodyStringFields) ===
          JSON.stringify(['trace_id']) &&
        typeof error.context?.responseBodySha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(error.context.responseBodySha256) &&
        !contextJson.includes('hello reminder') &&
        !contextJson.includes('sample-chat-route-value') &&
        !contextJson.includes('private-diagnostic-image.png') &&
        !contextJson.includes('chat sample-chat-route-value rejected message')
      )
    },
  )
})

test('linq runtime rejects oversized rendered text before provider entry', async () => {
  const fetchImplementation = vi.fn(async () => createJsonResponse({}))

  await assert.rejects(
    () => sendLinqChatMessage(
      {
        chatId: 'chat-oversized-text',
        media: [{ url: 'https://cdn.example.test/frame.png' }],
        message: 'x'.repeat(10_001),
      },
      {
        env: { LINQ_API_TOKEN: '<REDACTED_TOKEN>' },
        fetchImplementation,
      },
    ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_INVALID_INPUT' &&
      error.context?.failureStage === 'configuration' &&
      error.context?.operation === 'send_message' &&
      error.context?.requestMessageLength === 10_001 &&
      error.context?.requestMessagePartCount === 2 &&
      error.context?.requestMediaPartCount === 1 &&
      error.context?.retryable === false &&
      'deliveryMayHaveSucceeded' in error &&
      error.deliveryMayHaveSucceeded === false,
  )
  expect(fetchImplementation).not.toHaveBeenCalled()
})

test('linq runtime does not surface top-level provider error text or transport cause text', async () => {
  await assert.rejects(
    () =>
      sendLinqChatMessage(
        {
          chatId: 'sample-chat-route',
          message: 'sample reminder text',
        },
        {
          env: {
            LINQ_API_TOKEN: '<REDACTED_TOKEN>',
          },
          fetchImplementation: async () =>
            createJsonResponse(
              {
                message:
                  'chat sample-chat-route rejected sample reminder text',
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'X-Trace-ID': 'trace-header-only',
                },
                status: 400,
              },
            ),
        },
      ),
    (error) => {
      if (!(error instanceof VaultCliError)) {
        return false
      }

      const serialized = JSON.stringify({
        message: error.message,
        context: error.context,
      })
      return (
        error.code === 'LINQ_API_REQUEST_FAILED' &&
        error.message ===
          'Linq request POST /chats/[chat]/messages failed with HTTP 400.' &&
        error.context?.providerRequestId === 'trace-header-only' &&
        error.context?.responseBodyKind === 'json_object' &&
        JSON.stringify(error.context?.responseBodyKeys) ===
          JSON.stringify(['message']) &&
        JSON.stringify(error.context?.responseBodyStringFields) ===
          JSON.stringify(['message']) &&
        !serialized.includes('sample-chat-route') &&
        !serialized.includes('sample reminder text')
      )
    },
  )

  await assert.rejects(
    () =>
      sendLinqChatMessage(
        {
          chatId: 'transport-sample-chat',
          message: 'transport sample body',
        },
        {
          env: {
            LINQ_API_TOKEN: '<REDACTED_TOKEN>',
          },
          fetchImplementation: async () => {
            throw new Error(
              'POST https://api.linqapp.com/api/partner/v3/chats/transport-sample-chat/messages failed for transport sample body',
            )
          },
        },
      ),
    (error) => {
      if (!(error instanceof VaultCliError)) {
        return false
      }

      const serialized = JSON.stringify({
        message: error.message,
        context: error.context,
      })
      return (
        error.code === 'LINQ_API_REQUEST_FAILED' &&
        error.message ===
          'Linq request POST /chats/[chat]/messages failed before a response was returned.' &&
        error.context?.transportErrorPresent === true &&
        error.context?.transportErrorCauseCount === 1 &&
        error.context?.transportErrorName === 'Error' &&
        typeof error.context?.transportErrorTextLength === 'number' &&
        !serialized.includes('transport-sample-chat') &&
        !serialized.includes('transport sample body') &&
        !('error' in (error.context ?? {}))
      )
    },
  )
})

test('deleteLinqMessage retries transient delete failures because delete is idempotent', async () => {
  vi.useFakeTimers()
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv

  let retryAfterDeleteAttempts = 0
  const retryAfterDelete = deleteLinqMessage(
    {
      messageId: ' message-retry-http ',
    },
    {
      env,
      fetchImplementation: async (url: string) => {
        if (!url.endsWith('/messages/message-retry-http')) {
          throw new Error(`Unexpected request: ${url}`)
        }

        retryAfterDeleteAttempts += 1
        if (retryAfterDeleteAttempts === 1) {
          return createJsonResponse({ error: 'retry later' }, {
            headers: { 'Retry-After': '0' },
            status: 503,
          })
        }

        return new Response(null, { status: 204 })
      },
    },
  )
  await retryAfterDelete

  let transportDeleteAttempts = 0
  const transportRetryDelete = deleteLinqMessage(
    {
      messageId: ' message-retry-transport ',
    },
    {
      env,
      fetchImplementation: async (url: string) => {
        if (!url.endsWith('/messages/message-retry-transport')) {
          throw new Error(`Unexpected request: ${url}`)
        }

        transportDeleteAttempts += 1
        if (transportDeleteAttempts === 1) {
          throw new Error('temporary transport failure')
        }

        return new Response(null, { status: 204 })
      },
    },
  )
  await vi.advanceTimersByTimeAsync(1_000)
  await transportRetryDelete

  assert.equal(retryAfterDeleteAttempts, 2)
  assert.equal(transportDeleteAttempts, 2)
})

test('stopLinqChatTypingIndicator does not inherit delete-message retries', async () => {
  vi.useFakeTimers()
  const env = {
    LINQ_API_BASE_URL: 'https://linq.example.test/custom',
    LINQ_API_TOKEN: 'linq-token',
  } satisfies NodeJS.ProcessEnv

  let throttleAttempts = 0
  await assert.rejects(
    () =>
      stopLinqChatTypingIndicator(
        {
          chatId: 'chat-stop-once',
        },
        {
          env,
          fetchImplementation: async (url: string) => {
            if (!url.endsWith('/chats/chat-stop-once/typing')) {
              throw new Error(`Unexpected request: ${url}`)
            }

            throttleAttempts += 1
            return createJsonResponse({ error: 'retry later' }, {
              headers: { 'Retry-After': '0' },
              status: 429,
            })
          },
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.operation === 'typing_stop' &&
      error.context?.retryable === false &&
      error.context?.status === 429,
  )

  assert.equal(throttleAttempts, 1)

  let transientAttempts = 0
  await assert.rejects(
    () =>
      stopLinqChatTypingIndicator(
        {
          chatId: 'chat-stop-once-503',
        },
        {
          env,
          fetchImplementation: async (url: string) => {
            if (!url.endsWith('/chats/chat-stop-once-503/typing')) {
              throw new Error(`Unexpected request: ${url}`)
            }

            transientAttempts += 1
            return createJsonResponse({ error: 'retry later' }, {
              headers: { 'Retry-After': '0' },
              status: 503,
            })
          },
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.context?.operation === 'typing_stop' &&
      error.context?.retryable === false &&
      error.context?.status === 503,
  )

  assert.equal(transientAttempts, 1)
})

test('linq runtime covers optional payload omissions, fallback http messages, and timeout transport errors', async () => {
  const seenRequests: Array<{
    body?: string | Blob
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
  assert.deepEqual(parseJsonRequestBody(seenRequests[0]?.body), {
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
      error.context?.operation === 'list_phone_numbers' &&
      error.context?.provider === 'linq' &&
      error.context?.failureStage === 'http' &&
      error.context?.retryable === true &&
      error.context?.status === 408,
  )

  vi.useFakeTimers()
  const idempotentSendRequests: string[] = []
  const idempotentSend = sendLinqChatMessage(
    {
      chatId: 'chat-123',
      idempotencyKey: 'reply-key-1',
      message: 'hello',
    },
    {
      env: {
        LINQ_API_TOKEN: 'token',
      },
      fetchImplementation: async (_url, init) => {
        idempotentSendRequests.push(requireStringRequestBody(init.body))
        if (idempotentSendRequests.length === 1) {
          return createJsonResponse(
            { message: 'temporarily unavailable' },
            { status: 500 },
          )
        }

        return createJsonResponse({
          message: {
            id: 'msg-retry-succeeded',
          },
        })
      },
    },
  )
  await vi.advanceTimersByTimeAsync(1_000)
  assert.deepEqual(await idempotentSend, {
    message: {
      id: 'msg-retry-succeeded',
    },
    providerMessageEffects: [{
      message: 'hello',
      providerMessageId: 'msg-retry-succeeded',
    }],
  })
  assert.equal(idempotentSendRequests.length, 2)
  assert.deepEqual(
    idempotentSendRequests.map((body) => JSON.parse(body)),
    [
      {
        message: {
          idempotency_key: 'reply-key-1',
          parts: [
            {
              type: 'text',
              value: 'hello',
            },
          ],
        },
      },
      {
        message: {
          idempotency_key: 'reply-key-1',
          parts: [
            {
              type: 'text',
              value: 'hello',
            },
          ],
        },
      },
    ],
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
        'Linq request POST /chats/[chat]/messages timed out after 30000ms.' &&
      error.context?.operation === 'send_message' &&
      error.context?.provider === 'linq' &&
      error.context?.failureStage === 'transport' &&
      error.context?.hasIdempotencyKey === false &&
      error.context?.hasReplyToMessageId === false &&
      error.context?.requestOrigin === 'https://api.linqapp.com' &&
      error.context?.retryable === false &&
      error.context?.timedOut === true &&
      error.context?.timeoutMs === 30000 &&
      error.context?.transportErrorPresent === true &&
      error.context?.transportErrorCauseCount === 1 &&
      error.context?.transportErrorName === 'Error' &&
      error.context?.transportErrorTextLength === 'timed out downstream'.length,
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

      if (url.endsWith('/accounts/acct-1/disconnect-if-connected-at')) {
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
      sourceProviderSlug: 'fitbit',
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
  assert.deepEqual(await client.disconnectAccount('acct-1', '2026-04-08T00:00:00.000Z'), {
    account: { accountId: 'acct-1', disconnected: true },
  })

  assert.equal(openBrowser.mock.calls.length, 1)
  assert.equal(openBrowser.mock.calls.at(0)?.at(0), 'https://example.test/oauth')
  assert.deepEqual(seenRequests.map(({ method, url }) => ({ method, url })), [
    { method: 'GET', url: 'http://127.0.0.1:8788/providers' },
    { method: 'POST', url: 'http://127.0.0.1:8788/providers/oura/connect' },
    { method: 'GET', url: 'http://127.0.0.1:8788/accounts?provider=oura' },
    { method: 'GET', url: 'http://127.0.0.1:8788/accounts/acct-1' },
    { method: 'POST', url: 'http://127.0.0.1:8788/accounts/acct-1/reconcile' },
    {
      method: 'POST',
      url: 'http://127.0.0.1:8788/accounts/acct-1/disconnect-if-connected-at',
    },
  ])
  assert.deepEqual(JSON.parse(seenRequests[1]?.body ?? '{}'), {
    returnTo: 'https://murph.example.test/return',
    sourceProviderSlug: 'fitbit',
  })
  assert.deepEqual(JSON.parse(seenRequests[5]?.body ?? '{}'), {
    expectedConnectedAt: '2026-04-08T00:00:00.000Z',
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
    resolveExternalUrlBrowserCommands('https://example.test/oauth')[0]?.[0],
  )

  const failingSpawn = vi.fn((_command: string, _args: string[]) => {
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

test('device sync client resolves Windows authorization URLs without cmd shell parsing', () => {
  const authorizationUrl = 'https://example.test/oauth?next=alpha&redirect=one|two<input>%SAFE%'

  assert.deepEqual(resolveExternalUrlBrowserCommands(authorizationUrl, 'win32'), [
    ['C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', authorizationUrl]],
  ])
  assert.deepEqual(
    resolveExternalUrlBrowserCommands(authorizationUrl, 'win32', {
      SystemRoot: 'D:/Windows/',
    }),
    [['D:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', authorizationUrl]]],
  )
  assert.deepEqual(resolveExternalUrlBrowserCommands(authorizationUrl, 'win32', {
    SystemRoot: 'C:\\unsafe-tools',
  }), [
    ['C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', authorizationUrl]],
  ])
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
