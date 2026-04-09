import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import {
  resolveDeviceSyncBaseUrl,
  resolveDeviceSyncControlToken,
  createDeviceSyncClient,
} from '../src/device-sync-client.ts'
import { readEnvValue } from '../src/env-values.ts'
import {
  createAbortError,
  createTimeoutAbortController,
  parseRetryAfterHeaderMs,
  waitForRetryDelay,
} from '../src/http-retry.ts'
import {
  fetchJsonResponse,
  readJsonErrorResponse,
  requestJsonWithRetry,
} from '../src/http-json-retry.ts'
import {
  createRuntimeUnavailableError,
  RUNTIME_PACKAGES,
} from '../src/runtime-errors.ts'
import {
  resolveLinqApiBaseUrl,
  resolveLinqApiToken,
  resolveLinqWebhookSecret,
} from '../src/linq-runtime.ts'
import {
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
  resolveTelegramFileBaseUrl,
  startTelegramTypingSession,
} from '../src/telegram-runtime.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function createSingleUseTextResponse(body: string): { text(): Promise<string> } {
  let consumed = false

  return {
    async text() {
      if (consumed) {
        throw new TypeError('Body already consumed.')
      }

      consumed = true
      return body
    },
  }
}

function createTelegramResponse(
  payload: unknown,
  status = 200,
): {
  json(): Promise<unknown>
  ok: boolean
  status: number
} {
  return {
    async json() {
      return payload
    },
    ok: status >= 200 && status < 300,
    status,
  }
}

test('runtime env helpers trim shell values and read the first configured value', () => {
  const env = {
    FIRST: '  ',
    LINQ_API_BASE_URL: '  https://api.linq.example/v3  ',
    LINQ_API_TOKEN: '  linq-token  ',
    LINQ_WEBHOOK_SECRET: '  linq-secret  ',
    SECOND: '  keep-me  ',
    TELEGRAM_API_BASE_URL: '  https://api.telegram.example  ',
    TELEGRAM_BOT_TOKEN: '  telegram-token  ',
    TELEGRAM_FILE_BASE_URL: '  https://files.telegram.example  ',
  } satisfies NodeJS.ProcessEnv

  assert.equal(readEnvValue(env, ['FIRST', 'SECOND']), 'keep-me')
  assert.equal(readEnvValue(env, ['FIRST', 'MISSING']), null)
  assert.equal(resolveTelegramBotToken(env), 'telegram-token')
  assert.equal(resolveTelegramApiBaseUrl(env), 'https://api.telegram.example')
  assert.equal(resolveTelegramFileBaseUrl(env), 'https://files.telegram.example')
  assert.equal(resolveLinqApiToken(env), 'linq-token')
  assert.equal(resolveLinqApiBaseUrl(env), 'https://api.linq.example/v3')
  assert.equal(resolveLinqWebhookSecret(env), 'linq-secret')
})

test('retry helpers parse retry-after headers and surface abort errors', async () => {
  assert.equal(
    parseRetryAfterHeaderMs({
      headers: {
        get(name: string) {
          return name === 'retry-after' ? ' 1.6 ' : null
        },
      },
    }),
    1600,
  )
  assert.equal(
    parseRetryAfterHeaderMs({
      headers: {
        'Retry-After': '9',
      },
      maxDelayMs: 2_500,
    }),
    2_500,
  )
  assert.equal(
    parseRetryAfterHeaderMs({
      headers: {
        'retry-after': '2026-04-08T00:00:04.500Z',
      },
      nowMs: Date.parse('2026-04-08T00:00:00.000Z'),
    }),
    4_500,
  )
  assert.equal(
    parseRetryAfterHeaderMs({
      headers: {
        'retry-after': 'not-a-date',
      },
    }),
    null,
  )
  assert.equal(
    parseRetryAfterHeaderMs({
      headers: {
        'x-retry-after': '5',
        'retry-after': 5,
      },
    }),
    null,
  )
  assert.equal(
    parseRetryAfterHeaderMs({
      headers: {
        'retry-after': 'Wed, 08 Apr 2026 00:00:04 GMT',
      },
      nowMs: Number.NEGATIVE_INFINITY,
    }),
    0,
  )
  assert.equal(createAbortError().name, 'AbortError')

  await waitForRetryDelay({
    attempt: 2,
    headers: {
      'retry-after': '0',
    },
    retryDelaysMs: [10, 20],
  })

  const aborted = new AbortController()
  aborted.abort()

  await assert.rejects(
    () =>
      waitForRetryDelay({
        attempt: 1,
        retryDelaysMs: [10],
        signal: aborted.signal,
      }),
    (error) =>
      error instanceof Error &&
      error.name === 'AbortError' &&
      error.message === 'Operation aborted.',
  )
})

test('createTimeoutAbortController aborts on timeout and can be cleaned up first', async () => {
  vi.useFakeTimers()

  const timedOutController = createTimeoutAbortController(undefined, 25)
  await vi.advanceTimersByTimeAsync(25)
  assert.equal(timedOutController.signal.aborted, true)
  assert.equal(timedOutController.timedOut(), true)
  timedOutController.cleanup()

  const cleanedController = createTimeoutAbortController(undefined, 25)
  cleanedController.cleanup()
  await vi.advanceTimersByTimeAsync(25)
  assert.equal(cleanedController.signal.aborted, false)
  assert.equal(cleanedController.timedOut(), false)
})

test('startTelegramTypingSession stops a pending refresh request cleanly', async () => {
  vi.useFakeTimers()

  const seenSignals: AbortSignal[] = []
  const fetchImplementation = vi.fn(async (_url: string, init: {
    body?: string
    headers?: Record<string, string>
    method: 'POST'
    signal?: AbortSignal
  }) => {
    seenSignals.push(init.signal ?? new AbortController().signal)

    if (seenSignals.length === 1) {
      return {
        async json() {
          return { ok: true }
        },
        ok: true,
        status: 200,
      }
    }

    return await new Promise<{
      json(): Promise<unknown>
      ok: boolean
      status: number
    }>((resolve) => {
      init.signal?.addEventListener('abort', () => {
        resolve({
          async json() {
            return { ok: true }
          },
          ok: true,
          status: 200,
        })
      }, { once: true })
    })
  })

  const handle = await startTelegramTypingSession(
    {
      target: '123',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      fetchImplementation,
    },
  )

  await vi.advanceTimersByTimeAsync(4_000)
  assert.equal(fetchImplementation.mock.calls.length, 2)
  assert.equal(seenSignals[1]?.aborted, false)

  await handle.stop()

  assert.equal(seenSignals[1]?.aborted, true)
})

test('startTelegramTypingSession validates Telegram runtime prerequisites and target format', async () => {
  vi.stubGlobal('fetch', undefined)

  await assert.rejects(
    () =>
      startTelegramTypingSession(
        {
          target: '123',
        },
        {
          env: {},
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TELEGRAM_TOKEN_REQUIRED' &&
      error.message === 'Outbound Telegram delivery requires TELEGRAM_BOT_TOKEN.',
  )

  await assert.rejects(
    () =>
      startTelegramTypingSession(
        {
          target: '123',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TELEGRAM_UNAVAILABLE' &&
      error.message.includes('fetch support'),
  )

  await assert.rejects(
    () =>
      startTelegramTypingSession(
        {
          target: '   ',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: async () => createTelegramResponse({ ok: true }),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TELEGRAM_TARGET_INVALID' &&
      error.message === 'Telegram delivery requires a non-empty chat id, username, or topic target.',
  )

  await assert.rejects(
    () =>
      startTelegramTypingSession(
        {
          target: '123:wat:456',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: async () => createTelegramResponse({ ok: true }),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TELEGRAM_TARGET_INVALID' &&
      error.message.includes('Telegram targets must use') &&
      error.context?.target === '123:wat:456',
  )
})

test('startTelegramTypingSession applies migrated chat ids and preserves optional routing fields', async () => {
  vi.useFakeTimers()

  const requestBodies: Array<Record<string, unknown>> = []
  const fetchImplementation = vi.fn(async (_url: string, init: {
    body?: string
    headers?: Record<string, string>
    method: 'POST'
    signal?: AbortSignal
  }) => {
    requestBodies.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>)

    if (requestBodies.length === 1) {
      return createTelegramResponse(
        {
          description: 'group migrated',
          error_code: 400,
          ok: false,
          parameters: {
            migrate_to_chat_id: 456,
          },
        },
        400,
      )
    }

    return createTelegramResponse({ ok: true })
  })

  const handle = await startTelegramTypingSession(
    {
      target: '123:topic:99:business:biz-123',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      fetchImplementation,
    },
  )

  await vi.advanceTimersByTimeAsync(4_000)
  await handle.stop()

  assert.deepEqual(requestBodies[0], {
    action: 'typing',
    business_connection_id: 'biz-123',
    chat_id: '123',
    message_thread_id: 99,
  })
  assert.deepEqual(requestBodies[1], {
    action: 'typing',
    business_connection_id: 'biz-123',
    chat_id: '456',
    message_thread_id: 99,
  })
})

test('startTelegramTypingSession wraps initial Telegram API transport and response failures', async () => {
  await assert.rejects(
    () =>
      startTelegramTypingSession(
        {
          target: '123',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: async () => {
            throw new TypeError('socket hang up')
          },
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TELEGRAM_ACTIVITY_FAILED' &&
      error.message === 'Telegram typing indicator failed while calling the Bot API.' &&
      (error.context?.error as { message?: string } | undefined)?.message === 'socket hang up',
  )

  await assert.rejects(
    () =>
      startTelegramTypingSession(
        {
          target: '123',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: async () =>
            createTelegramResponse(
              {
                description: 'chat unavailable',
                error_code: 403,
                ok: false,
                parameters: {
                  migrate_to_chat_id: '123',
                },
              },
              403,
            ),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TELEGRAM_ACTIVITY_FAILED' &&
      error.message === 'chat unavailable' &&
      error.context?.status === 403 &&
      error.context?.migrateToChatId === '123',
  )

  await assert.rejects(
    () =>
      startTelegramTypingSession(
        {
          target: '123',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: async () => ({
            async json() {
              throw new Error('invalid json')
            },
            ok: false,
            status: 502,
          }),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TELEGRAM_ACTIVITY_FAILED' &&
      error.message === 'Telegram Bot API sendChatAction failed with HTTP 502.' &&
      error.context?.status === 502,
  )
})

test('startTelegramTypingSession rethrows background refresh failures on stop', async () => {
  vi.useFakeTimers()

  let requestCount = 0
  const fetchImplementation = vi.fn(async () => {
    requestCount += 1
    if (requestCount === 1) {
      return createTelegramResponse({ ok: true })
    }

    return createTelegramResponse(
      {
        description: 'refresh failed',
        error_code: 500,
        ok: false,
      },
      500,
    )
  })

  const handle = await startTelegramTypingSession(
    {
      target: '123',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      fetchImplementation,
    },
  )

  await vi.advanceTimersByTimeAsync(4_000)

  await assert.rejects(
    () => handle.stop(),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TELEGRAM_ACTIVITY_FAILED' &&
      error.message === 'refresh failed',
  )
})

test('startTelegramTypingSession stops cleanly when aborted before the refresh wait settles', async () => {
  vi.useFakeTimers()

  const fetchImplementation = vi.fn(async () => createTelegramResponse({ ok: true }))

  const handle = await startTelegramTypingSession(
    {
      target: '123',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      fetchImplementation,
      refreshMs: 25,
    },
  )

  await handle.stop()
  await vi.advanceTimersByTimeAsync(25)

  assert.equal(fetchImplementation.mock.calls.length, 1)
})

test('startTelegramTypingSession wraps non-error transport failures with stringified details', async () => {
  await assert.rejects(
    () =>
      startTelegramTypingSession(
        {
          target: '123',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: async () => {
            throw 'socket lost'
          },
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TELEGRAM_ACTIVITY_FAILED' &&
      error.message === 'Telegram typing indicator failed while calling the Bot API.' &&
      (error.context?.error as { message?: string; name?: string } | undefined)?.message === 'socket lost' &&
      (error.context?.error as { message?: string; name?: string } | undefined)?.name === 'Error',
  )
})

test('http-json helpers preserve error text and retry retryable response failures', async () => {
  const plainTextResult = await readJsonErrorResponse(
    createSingleUseTextResponse('gateway unavailable'),
  )
  const jsonResult = await readJsonErrorResponse(
    createSingleUseTextResponse('{"message":"temporary outage"}'),
  )

  assert.deepEqual(plainTextResult, {
    payload: null,
    rawText: 'gateway unavailable',
  })
  assert.deepEqual(jsonResult, {
    payload: { message: 'temporary outage' },
    rawText: null,
  })

  let fetchAttempts = 0
  let lastRetryAfter: string | null = null

  const result = await requestJsonWithRetry<{ value: number }, Response>({
    createHttpError: async (response) => {
      assert.equal(response.status, 503)
      return new Error('retryable http failure')
    },
    fetchResponse: async () => {
      fetchAttempts += 1
      if (fetchAttempts === 1) {
        throw new Error('network hiccup')
      }

      if (fetchAttempts === 2) {
        return new Response('{"error":"temporary"}', {
          headers: {
            'Retry-After': '1.25',
          },
          status: 503,
        })
      }

      return new Response(JSON.stringify({ value: 42 }), {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      })
    },
    isRetryableError: (error) =>
      error instanceof Error &&
      (error.message === 'network hiccup' || error.message === 'retryable http failure'),
    maxAttempts: 3,
    parseResponse: async (response) => (await response.json()) as { value: number },
    waitForRetryDelay: async (_attempt, _signal, headers) => {
      lastRetryAfter =
        headers && typeof headers.get === 'function'
          ? headers.get('retry-after')
          : null
    },
  })

  assert.deepEqual(result, { value: 42 })
  assert.equal(fetchAttempts, 3)
  assert.equal(lastRetryAfter, '1.25')
})

test('fetchJsonResponse forwards the timeout signal and wraps transport failures', async () => {
  const seenSignals: AbortSignal[] = []
  const response = new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
  })

  const passedThrough = await fetchJsonResponse({
    body: JSON.stringify({ value: 1 }),
    createTransportError: () => new Error('should not be used'),
    fetchImplementation: async (_url, init) => {
      assert.equal(_url, 'https://example.test/resource')
      assert.equal(init.method, 'POST')
      assert.equal(init.body, '{"value":1}')
      assert.equal(init.headers?.['content-type'], 'application/json')
      if (!init.signal) {
        throw new Error('Expected the timeout signal to be forwarded.')
      }

      seenSignals.push(init.signal)
      return response
    },
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    timeoutMs: 1_000,
    url: 'https://example.test/resource',
  })

  assert.equal(passedThrough, response)
  assert.equal(seenSignals.length, 1)

  const wrapped = new Error('wrapped transport failure')

  await assert.rejects(
    () =>
      fetchJsonResponse({
        createTransportError: ({ error, timedOut }) => {
          assert.equal(timedOut, false)
          assert.equal(error instanceof Error ? error.message : String(error), 'socket hang up')
          return wrapped
        },
        fetchImplementation: async () => {
          throw new Error('socket hang up')
        },
        headers: {},
        method: 'GET',
        timeoutMs: 1_000,
        url: 'https://example.test/resource',
      }),
    (error) => error === wrapped,
  )
})

test('runtime unavailable helpers preserve the public operator-config error contract', () => {
  assert.deepEqual([...RUNTIME_PACKAGES], [
    '@murphai/core',
    '@murphai/importers',
    '@murphai/query',
    'incur',
  ])

  const withCause = createRuntimeUnavailableError(
    'samples import-csv',
    new Error('missing runtime install'),
  )
  assert.ok(withCause instanceof VaultCliError)
  assert.equal(withCause.code, 'runtime_unavailable')
  assert.match(withCause.message, /samples import-csv/u)
  assert.deepEqual(withCause.context, {
    cause: 'missing runtime install',
    packages: [...RUNTIME_PACKAGES],
  })

  const withoutErrorCause = createRuntimeUnavailableError('assistant run', 'boom')
  assert.deepEqual(withoutErrorCause.context, {
    packages: [...RUNTIME_PACKAGES],
  })
})

test('device sync client helpers trim env values, send bearer auth, and map control-plane failures', async () => {
  assert.equal(
    resolveDeviceSyncBaseUrl(
      ' http://127.0.0.1:8788/ ',
      {},
    ),
    'http://127.0.0.1:8788',
  )
  assert.equal(
    resolveDeviceSyncControlToken(null, {
      DEVICE_SYNC_CONTROL_TOKEN: ' env-token ',
    }),
    'env-token',
  )

  const observedAuthHeaders: string[] = []
  const successClient = createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788/',
    controlToken: 'control-token-for-tests',
    fetchImpl: async (_input, init) => {
      observedAuthHeaders.push(new Headers(init?.headers).get('authorization') ?? '')
      return new Response(JSON.stringify({ accounts: [] }), {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      })
    },
  })

  assert.deepEqual(await successClient.listAccounts(), {
    accounts: [],
  })
  assert.deepEqual(observedAuthHeaders, ['Bearer control-token-for-tests'])

  const authClient = createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'CONTROL_PLANE_AUTH_REQUIRED',
            message: 'Device sync control routes require a valid bearer token.',
          },
        }),
        { status: 401 },
      ),
  })

  await assert.rejects(
    () => authClient.listProviders(),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'CONTROL_PLANE_AUTH_REQUIRED' &&
      /DEVICE_SYNC_CONTROL_TOKEN/u.test(error.message),
  )

  const invalidClient = createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    fetchImpl: async () => new Response('[]', { status: 200 }),
  })

  await assert.rejects(
    () => invalidClient.listProviders(),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'device_sync_invalid_response' &&
      /invalid JSON payload/u.test(error.message) &&
      error.context?.baseUrl === 'http://127.0.0.1:8788' &&
      error.context?.path === '/providers',
  )

  assert.throws(
    () =>
      createDeviceSyncClient({
        baseUrl: 'https://device-sync.example.test',
        controlToken: 'control-token-for-tests',
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_REMOTE_BASE_URL_UNSUPPORTED' &&
      /loopback base URLs/u.test(error.message),
  )
})
