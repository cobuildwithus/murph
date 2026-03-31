import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

test('cli imports assistant-core directly and removes facade-only package subpaths', async () => {
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
  assert.deepEqual(Object.keys(cliManifest.exports ?? {}).sort(), [
    '.',
    './assistant/automation',
    './assistant/cron',
    './assistant/outbox',
    './assistant/service',
    './assistant/status',
    './assistant/store',
  ])

  for (const removedSubpath of [
    './assistant-cli-contracts',
    './assistant/state-ids',
    './inbox-services',
    './operator-config',
    './vault-cli-services',
    './vault-services',
  ]) {
    assert.equal(cliManifest.exports?.[removedSubpath], undefined)
  }
})

test('cli source no longer keeps export-only assistant-core facade files', async () => {
  const srcRoot = new URL('../src/', import.meta.url)
  const packageRoot = fileURLToPath(new URL('../', import.meta.url))
  const facadeFiles: string[] = []

  async function walk(directory: URL) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
      if (entry.isDirectory()) {
        await walk(entryUrl)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) {
        continue
      }

      const source = await readFile(entryUrl, 'utf8')
      if (/assistant-daemon-client/u.test(source)) {
        continue
      }
      if (/\b(?:const|function|class|let|var)\b/u.test(source)) {
        continue
      }
      const lines = source
        .replace(/^\/\*\*[\s\S]*?\*\/\s*/u, '')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/u, '').trim())
        .filter(Boolean)
      const isPassthroughOnly = lines.every((line) =>
        /^(import|export)(\s+type)?\b[\s\S]*from ['"][^'"]+['"];?$/u.test(line),
      )
      if (!isPassthroughOnly) {
        continue
      }
      if (lines.some((line) => /from ['"]@murph\/assistant-core\/[^'"]+['"]/u.test(line))) {
        facadeFiles.push(path.relative(packageRoot, fileURLToPath(entryUrl)))
      }
    }
  }

  await walk(srcRoot)
  assert.deepEqual(facadeFiles, [])
})

test('cli package root no longer re-exports assistant-core compatibility shims', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /@murph\/assistant-core\//u)
  assert.doesNotMatch(source, /vault-cli-services/u)
})

test('cli keeps daemon-aware wrappers only where transport routing still belongs in the shell', async () => {
  const daemonWrapperFiles = [
    '../src/assistant/service.ts',
    '../src/assistant/status.ts',
    '../src/assistant/store.ts',
    '../src/assistant/outbox.ts',
    '../src/assistant/cron.ts',
    '../src/assistant/automation/run-loop.ts',
  ] as const

  for (const relativePath of daemonWrapperFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(source, /@murph\/assistant-core\//u)
    assert.match(source, /assistant-daemon-client/u)
  }
})
