import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { test } from 'vitest'

import { resolveAssistantDaemonClientConfig } from '@murphai/assistantd/client'

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

  for (const baseUrl of [
    'https://127.0.0.1:50241',
    'http://127.0.0.1:50241/prefix',
    'http://127.0.0.1:50241?x=1',
    'http://127.0.0.1:50241#fragment',
    'http://user:pass@127.0.0.1:50241',
  ]) {
    assert.throws(
      () =>
        resolveAssistantDaemonClientConfig({
          MURPH_ASSISTANTD_BASE_URL: baseUrl,
          MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
        }),
      /valid loopback-only http:\/\//u,
    )
  }
})
