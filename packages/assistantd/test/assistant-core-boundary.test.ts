import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { test } from 'vitest'

interface PackageManifest {
  dependencies?: Record<string, string>
}

test('assistantd depends on the canonical assistant-engine owner directly', async () => {
  const assistantdManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const serviceSource = await readFile(
    new URL('../src/service.ts', import.meta.url),
    'utf8',
  )
  const httpSource = await readFile(
    new URL('../src/http.ts', import.meta.url),
    'utf8',
  )
  const httpProtocolSource = await readFile(
    new URL('../src/http-protocol.ts', import.meta.url),
    'utf8',
  )

  assert.equal(assistantdManifest.dependencies?.['@murphai/assistant-engine'], 'workspace:*')
  assert.equal(assistantdManifest.dependencies?.['@murphai/vault-inbox'], undefined)
  assert.equal(assistantdManifest.dependencies?.['@murphai/assistant-core'], undefined)
  assert.match(serviceSource, /from '@murphai\/assistant-engine'/)
  assert.match(serviceSource, /from '@murphai\/vault-usecases\/vault-services'/)
  assert.match(httpProtocolSource, /from '@murphai\/assistant-engine'/)
  assert.doesNotMatch(serviceSource, /@murphai\/assistant-core/u)
  assert.doesNotMatch(httpSource, /@murphai\/assistant-core/u)
  assert.doesNotMatch(httpProtocolSource, /@murphai\/assistant-core/u)
  assert.doesNotMatch(serviceSource, /from '@murphai\/vault-usecases'(?=['"])/u)
})
