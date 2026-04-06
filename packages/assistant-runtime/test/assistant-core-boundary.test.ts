import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { test } from 'vitest'

interface PackageManifest {
  dependencies?: Record<string, string>
}

test('assistant-runtime depends on the split owner packages directly', async () => {
  const runtimeManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const hostedRuntimeSource = await readFile(
    new URL('../src/hosted-runtime.ts', import.meta.url),
    'utf8',
  )
  const hostedContextSource = await readFile(
    new URL('../src/hosted-runtime/context.ts', import.meta.url),
    'utf8',
  )

  assert.equal(runtimeManifest.dependencies?.['@murphai/assistant-engine'], 'workspace:*')
  assert.equal(runtimeManifest.dependencies?.['@murphai/operator-config'], 'workspace:*')
  assert.equal(runtimeManifest.dependencies?.['@murphai/vault-inbox'], 'workspace:*')
  assert.equal(runtimeManifest.dependencies?.['@murphai/assistant-core'], undefined)
  assert.match(
    hostedRuntimeSource,
    /from "@murphai\/operator-config\/hosted-assistant-config"/,
  )
  assert.match(
    hostedContextSource,
    /from "@murphai\/operator-config\/hosted-assistant-config"/,
  )
  assert.match(
    hostedContextSource,
    /from "@murphai\/operator-config\/operator-config"/,
  )
  assert.match(hostedContextSource, /from "@murphai\/vault-inbox"/)
  assert.doesNotMatch(hostedRuntimeSource, /@murphai\/assistant-core/u)
  assert.doesNotMatch(hostedContextSource, /@murphai\/assistant-core/u)
})
