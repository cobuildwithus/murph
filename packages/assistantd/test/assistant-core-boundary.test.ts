import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { createAssistantLocalService } from '../src/service.js'

test('murph publishes assistant-core for headless assistant consumers', async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL('../../cli/package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, { default?: string; types?: string }>
  }

  assert.deepEqual(packageManifest.exports['./assistant-core'], {
    default: './dist/assistant-core.js',
    types: './dist/assistant-core.d.ts',
  })
})

test('assistantd depends on headless murph subpaths instead of the root murph export', async () => {
  const serviceSource = await readFile(new URL('../src/service.ts', import.meta.url), 'utf8')
  const httpSource = await readFile(new URL('../src/http.ts', import.meta.url), 'utf8')

  assert.match(serviceSource, /from 'murph\/assistant-core'/)
  assert.match(serviceSource, /from 'murph\/gateway-core-local'/)
  assert.match(serviceSource, /from 'murph\/gateway-core'/)
  assert.match(httpSource, /from 'murph\/assistant-core'/)
  assert.match(httpSource, /from 'murph\/gateway-core'/)
  assert.doesNotMatch(serviceSource, /from 'murph'/)
  assert.doesNotMatch(httpSource, /from 'murph'/)
})

test('assistant-core local services stay local even when assistantd client env vars are present', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'assistant-core-local-'))
  const originalBaseUrl = process.env.MURPH_ASSISTANTD_BASE_URL
  const originalToken = process.env.MURPH_ASSISTANTD_CONTROL_TOKEN
  const originalDisable = process.env.MURPH_ASSISTANTD_DISABLE_CLIENT
  process.env.MURPH_ASSISTANTD_BASE_URL = 'http://127.0.0.1:9'
  process.env.MURPH_ASSISTANTD_CONTROL_TOKEN = 'secret-token'
  delete process.env.MURPH_ASSISTANTD_DISABLE_CLIENT

  try {
    const service = createAssistantLocalService(vaultRoot)
    const sessions = await service.listSessions({ vault: vaultRoot })
    assert.deepEqual(sessions, [])
  } finally {
    if (originalBaseUrl === undefined) {
      delete process.env.MURPH_ASSISTANTD_BASE_URL
    } else {
      process.env.MURPH_ASSISTANTD_BASE_URL = originalBaseUrl
    }
    if (originalToken === undefined) {
      delete process.env.MURPH_ASSISTANTD_CONTROL_TOKEN
    } else {
      process.env.MURPH_ASSISTANTD_CONTROL_TOKEN = originalToken
    }
    if (originalDisable === undefined) {
      delete process.env.MURPH_ASSISTANTD_DISABLE_CLIENT
    } else {
      process.env.MURPH_ASSISTANTD_DISABLE_CLIENT = originalDisable
    }
    await rm(vaultRoot, { force: true, recursive: true })
  }
})
