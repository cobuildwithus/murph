import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { test } from 'vitest'

type PackageManifest = {
  dependencies?: Record<string, string | undefined>
  exports?: Record<string, { default?: string; types?: string }>
}

type TsConfigShape = {
  compilerOptions?: {
    paths?: Record<string, string[] | undefined>
  }
  references?: Array<{ path?: string }>
}

test('cli headless facades resolve through assistant-core', async () => {
  const cliManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const assistantCoreManifest = JSON.parse(
    await readFile(new URL('../../assistant-core/package.json', import.meta.url), 'utf8'),
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

  assert.equal(cliManifest.dependencies?.['@murph/assistant-core'], 'workspace:*')
  assert.deepEqual(assistantCoreManifest.exports?.['./*'], {
    default: './dist/*.js',
    types: './dist/*.d.ts',
  })
  assert.equal(
    cliTsconfig.references?.some((reference) => reference.path === '../assistant-core'),
    true,
  )
  assert.equal(
    cliTypecheckTsconfig.references?.some((reference) => reference.path === '../assistant-core'),
    true,
  )
  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murph/assistant-core/*'], [
    'packages/assistant-core/src/*.ts',
  ])
})

test('cli keeps daemon-aware wrappers only where transport routing still belongs in the shell', async () => {
  const pureFacadeFiles = [
    '../src/assistant-cli-contracts.ts',
    '../src/assistant-codex.ts',
    '../src/agentmail-runtime.ts',
    '../src/operator-config.ts',
    '../src/vault-services.ts',
  ] as const
  const daemonWrapperFiles = [
    '../src/assistant/service.ts',
    '../src/assistant/status.ts',
    '../src/assistant/store.ts',
    '../src/assistant/outbox.ts',
    '../src/assistant/cron.ts',
    '../src/assistant/automation/run-loop.ts',
  ] as const

  for (const relativePath of pureFacadeFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(source, /@murph\/assistant-core\//u)
    assert.doesNotMatch(source, /assistant-daemon-client/u)
  }

  for (const relativePath of daemonWrapperFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(source, /@murph\/assistant-core\//u)
    assert.match(source, /assistant-daemon-client/u)
  }
})
