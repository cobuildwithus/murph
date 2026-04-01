import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

const curatedAssistantCoreExports = [
  './assistant-automation',
  './assistant-cron',
  './assistant-outbox',
  './assistant-provider',
  './assistant-runtime',
  './assistant-service',
  './assistant-state',
  './assistant-status',
  './assistant-store',
] as const

const preservedAssistantCoreLeafExports = [
  './assistant/channel-adapters',
  './assistant/conversation-policy',
  './assistant/memory',
  './assistant/provider-config',
  './assistant/provider-registry',
  './assistant/state',
  './assistant/state-ids',
  './assistant/transcript-distillation',
  './assistant-cli-access',
  './assistant-cli-tools',
  './device-daemon',
  './device-sync-client',
  './health-registry-command-metadata',
  './http-json-retry',
  './inbox-app/types',
  './inbox-services/connectors',
  './model-harness',
  './runtime-errors',
  './usecases/experiment-journal-vault',
  './usecases/explicit-health-family-services',
  './usecases/record-mutations',
] as const

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

  assert.equal(cliManifest.dependencies?.['@murphai/assistant-core'], 'workspace:*')
  assert.equal(assistantCoreManifest.exports?.['./*'], undefined)
  for (const entrypoint of curatedAssistantCoreExports) {
    assert.notEqual(assistantCoreManifest.exports?.[entrypoint], undefined)
  }
  for (const entrypoint of preservedAssistantCoreLeafExports) {
    assert.notEqual(assistantCoreManifest.exports?.[entrypoint], undefined)
  }
  assert.equal(
    cliTsconfig.references?.some((reference) => reference.path === '../assistant-core'),
    true,
  )
  assert.equal(
    cliTypecheckTsconfig.references?.some((reference) => reference.path === '../assistant-core'),
    true,
  )
  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/assistant-core/*'], [
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
      if (
        lines.some((line) =>
          /from ['"]@murph(?:ai)?\/assistant-core\/[^'"]+['"]/u.test(line),
        )
      ) {
        facadeFiles.push(path.relative(packageRoot, fileURLToPath(entryUrl)))
      }
    }
  }

  await walk(srcRoot)
  assert.deepEqual(facadeFiles, [])
})

test('cli no longer keeps duplicated assistant-core headless source files', async () => {
  const removedDuplicateFiles = [
    '../src/child-process-env.ts',
    '../src/commands/query-record-command-helpers.ts',
    '../src/inbox-app/bootstrap-doctor-strategies.ts',
    '../src/inbox-app/bootstrap-doctor.ts',
    '../src/inbox-app/environment.ts',
    '../src/inbox-app/linq-endpoint.ts',
    '../src/inbox-app/promotions.ts',
    '../src/inbox-app/reads.ts',
    '../src/inbox-app/runtime.ts',
    '../src/inbox-app/service.ts',
    '../src/inbox-app/sources.ts',
    '../src/inbox-app/types.ts',
    '../src/process-kill.ts',
    '../src/setup-cli-contracts.ts',
    '../src/setup-prompt-io.ts',
    '../src/setup-runtime-env.ts',
    '../src/usecases/document-meal-read.ts',
    '../src/usecases/event-record-mutations.ts',
    '../src/usecases/experiment-journal-vault.ts',
    '../src/usecases/explicit-health-family-services.ts',
    '../src/usecases/food-autolog.ts',
    '../src/usecases/food.ts',
    '../src/usecases/integrated-services.ts',
    '../src/usecases/provider-event.ts',
    '../src/usecases/recipe.ts',
    '../src/usecases/record-mutations.ts',
    '../src/usecases/runtime.ts',
    '../src/usecases/shared.ts',
    '../src/usecases/types.ts',
    '../src/usecases/vault-usecase-helpers.ts',
  ] as const

  for (const relativePath of removedDuplicateFiles) {
    await assert.rejects(() => access(new URL(relativePath, import.meta.url)))
  }
})

test('cli package root no longer re-exports assistant-core compatibility shims', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /@murphai\/assistant-core\//u)
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
    assert.match(source, /@murphai\/assistant-core\//u)
    assert.match(source, /assistant-daemon-client/u)
  }
})
