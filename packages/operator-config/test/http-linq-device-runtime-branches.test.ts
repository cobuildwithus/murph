import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import {
  createLinqWebhookSubscription,
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
} from '../src/linq-runtime.ts'
import { createDeviceSyncClient, resolveDeviceSyncBaseUrl } from '../src/device-sync-client.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

afterEach(() => {
  vi.restoreAllMocks()
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
      error.code === 'LINQ_API_TOKEN_REQUIRED' &&
      error.context?.operation === 'typing_start' &&
      error.context?.provider === 'linq' &&
      error.context?.failureStage === 'configuration',
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
      error.code === 'LINQ_UNAVAILABLE' &&
      error.context?.operation === 'typing_start' &&
      error.context?.provider === 'linq' &&
      error.context?.failureStage === 'configuration',
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
      error.message ===
        'Linq request DELETE /chats/[chat]/typing failed with HTTP 503.' &&
      error.context?.operation === 'typing_stop' &&
      error.context?.provider === 'linq' &&
      error.context?.failureStage === 'http' &&
      error.context?.path === '/chats/[chat]/typing' &&
      error.context?.responseBodyKind === 'text' &&
      error.context?.responseBodyTextLength === '  temporarily down  '.length &&
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

test('device sync client covers non-loopback passthrough paths', async () => {
  assert.throws(
    () =>
      resolveDeviceSyncBaseUrl('http://[::1', {}, null),
    (error) => error instanceof TypeError,
  )

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
