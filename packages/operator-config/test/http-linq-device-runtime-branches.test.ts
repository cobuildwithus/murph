import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import {
  createLinqWebhookSubscription,
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
} from '../src/linq-runtime.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
})

test('linq runtime covers no-content unavailable and raw-text error branches', async () => {
  await assert.rejects(
    () =>
      startLinqChatTypingIndicator(
        { chatId: 'chat-123' },
        {
          env: {},
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_TOKEN_REQUIRED',
  )

  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', undefined)

  await assert.rejects(
    () =>
      startLinqChatTypingIndicator(
        { chatId: 'chat-123' },
        {
          env: {
            LINQ_API_TOKEN: 'token',
          },
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_UNAVAILABLE',
  )

  vi.stubGlobal('fetch', originalFetch)

  await assert.rejects(
    () =>
      stopLinqChatTypingIndicator(
        { chatId: 'chat-123' },
        {
          env: {
            LINQ_API_TOKEN: 'token',
          },
          fetchImplementation: async () =>
            new Response('  temporarily down  ', {
              status: 503,
            }),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_API_REQUEST_FAILED' &&
      error.message === 'temporarily down' &&
      error.context?.retryable === false &&
      error.context?.status === 503,
  )

  await assert.rejects(
    () =>
      createLinqWebhookSubscription(
        {
          subscribedEvents: [],
          targetUrl: 'https://murph.example.test/webhook',
        },
        {
          env: {
            LINQ_API_TOKEN: 'token',
          },
          fetchImplementation: async () => new Response(null, { status: 204 }),
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'LINQ_INVALID_INPUT' &&
      error.message ===
        'Linq subscribed event list must contain at least one non-empty value.',
  )
})

test('device sync client covers non-loopback passthrough and browser-open failure paths', async () => {
  const { resolveDeviceSyncBaseUrl, createDeviceSyncClient } = await import(
    '../src/device-sync-client.ts'
  )

  assert.throws(
    () =>
      resolveDeviceSyncBaseUrl('http://[::1', {}, null),
    (error) => error instanceof TypeError,
  )

  vi.resetModules()
  const spawn = vi.fn(() => {
    throw new Error('missing browser launcher')
  })
  vi.doMock('node:child_process', () => ({ spawn }))
  const dynamicModule = await import('../src/device-sync-client.ts')
  const browserClient = dynamicModule.createDeviceSyncClient({
    baseUrl: 'http://127.0.0.1:8788',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          authorizationUrl: 'https://example.test/oauth',
          expiresAt: '2026-04-08T00:00:00.000Z',
          provider: 'oura',
          state: 'state-3',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        },
      ),
  })

  const result = await browserClient.beginConnection({
    open: true,
    provider: 'oura',
  })

  assert.equal(result.openedBrowser, false)
  assert.equal(spawn.mock.calls[0]?.[0], process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open')
  assert.equal(createDeviceSyncClient({ baseUrl: 'http://127.0.0.1:8788' }).baseUrl, 'http://127.0.0.1:8788')

  let remoteBaseUrlError: unknown
  try {
    createDeviceSyncClient({
      baseUrl: '   ',
      controlToken: 'token-123',
      env: {
        DEVICE_SYNC_BASE_URL: 'https://device-sync.example.test',
      },
    })
  } catch (error) {
    remoteBaseUrlError = error
  }
  assert.ok(remoteBaseUrlError && typeof remoteBaseUrlError === 'object')
  assert.equal(
    (remoteBaseUrlError as { code?: string }).code,
    'DEVICE_SYNC_REMOTE_BASE_URL_UNSUPPORTED',
  )
  assert.equal(
    (remoteBaseUrlError as { context?: { baseUrl?: string } }).context?.baseUrl,
    'https://device-sync.example.test',
  )
})
