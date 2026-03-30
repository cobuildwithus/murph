import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { test } from 'vitest'

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

test('assistantd depends on murph/assistant-core instead of the root murph export', async () => {
  const serviceSource = await readFile(new URL('../src/service.ts', import.meta.url), 'utf8')
  const httpSource = await readFile(new URL('../src/http.ts', import.meta.url), 'utf8')

  assert.match(serviceSource, /from 'murph\/assistant-core'/)
  assert.match(httpSource, /from 'murph\/assistant-core'/)
  assert.doesNotMatch(serviceSource, /from 'murph'/)
  assert.doesNotMatch(httpSource, /from 'murph'/)
})
