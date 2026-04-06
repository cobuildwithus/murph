import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { test } from 'vitest'

interface PackageManifest {
  dependencies?: Record<string, string>
}

interface TsConfigShape {
  compilerOptions?: {
    paths?: Record<string, string[]>
  }
  references?: Array<{ path: string }>
}

test('cli and split owner packages publish the expected owner dependencies', async () => {
  const cliManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const assistantCliManifest = JSON.parse(
    await readFile(new URL('../../assistant-cli/package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const assistantEngineManifest = JSON.parse(
    await readFile(new URL('../../assistant-engine/package.json', import.meta.url), 'utf8'),
  ) as PackageManifest & {
    exports?: Record<string, unknown>
  }
  const setupCliManifest = JSON.parse(
    await readFile(new URL('../../setup-cli/package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const cliTsconfig = JSON.parse(
    await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'),
  ) as TsConfigShape
  const cliTypecheckTsconfig = JSON.parse(
    await readFile(new URL('../tsconfig.typecheck.json', import.meta.url), 'utf8'),
  ) as TsConfigShape
  const repoTsconfigBase = JSON.parse(
    await readFile(new URL('../../../tsconfig.base.json', import.meta.url), 'utf8'),
  ) as TsConfigShape

  assert.equal(cliManifest.dependencies?.['@murphai/assistant-cli'], 'workspace:*')
  assert.equal(cliManifest.dependencies?.['@murphai/setup-cli'], 'workspace:*')
  assert.equal(cliManifest.dependencies?.['@murphai/operator-config'], 'workspace:*')
  assert.equal(cliManifest.dependencies?.['@murphai/vault-inbox'], 'workspace:*')

  assert.equal(assistantCliManifest.dependencies?.['@murphai/assistant-engine'], 'workspace:*')
  assert.equal(assistantCliManifest.dependencies?.['@murphai/operator-config'], 'workspace:*')

  assert.equal(setupCliManifest.dependencies?.['@murphai/assistant-engine'], 'workspace:*')
  assert.equal(setupCliManifest.dependencies?.['@murphai/operator-config'], 'workspace:*')
  assert.equal(setupCliManifest.dependencies?.['@murphai/vault-inbox'], 'workspace:*')
  assert.equal(assistantEngineManifest.exports?.['./assistant-backend'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./assistant-cli-contracts'], undefined)

  for (const referencePath of [
    '../assistant-engine',
    '../assistant-cli',
    '../operator-config',
    '../setup-cli',
    '../vault-inbox',
  ]) {
    assert.equal(
      cliTsconfig.references?.some((reference) => reference.path === referencePath),
      true,
    )
    assert.equal(
      cliTypecheckTsconfig.references?.some((reference) => reference.path === referencePath),
      true,
    )
  }

  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/assistant-engine/*'], [
    'packages/assistant-engine/src/*',
  ])
  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/operator-config/*'], [
    'packages/operator-config/src/*',
  ])
  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/vault-inbox/*'], [
    'packages/vault-inbox/src/*',
  ])
  assert.equal(repoTsconfigBase.compilerOptions?.paths?.['@murphai/assistant-core/*'], undefined)
})
