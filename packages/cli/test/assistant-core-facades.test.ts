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
  './assistant-cli-access',
  './assistant-cli-tools',
  './device-daemon',
  './device-sync-client',
  './health-registry-command-metadata',
  './knowledge',
  './http-json-retry',
  './inbox-app/types',
  './inbox-services/connectors',
  './model-harness',
  './runtime-errors',
  './usecases/experiment-journal-vault',
  './usecases/explicit-health-family-services',
  './usecases/record-mutations',
] as const

const requiredAssistantCliSpecifiers = [
  './assistant-runtime',
  './assistant-chat-ink',
  './assistant-daemon-client',
  './commands/assistant',
  './run-terminal-logging',
  './assistant/automation',
  './assistant/cron',
  './assistant/provider-catalog',
  './assistant/service',
  './assistant/status',
  './assistant/store',
  './assistant/ui/view-model',
] as const

const requiredSetupCliSpecifiers = [
  './setup-cli',
  './setup-services',
  './setup-assistant',
  './setup-assistant-account',
  './setup-agentmail',
  './setup-wizard',
  './setup-services/scheduled-updates',
  './setup-services/shell',
] as const

const removedCliShimFiles = [
  '../src/assistant-chat-ink.ts',
  '../src/assistant-daemon-client.ts',
  '../src/assistant-runtime.ts',
  '../src/assistant/automation.ts',
  '../src/assistant/automation/run-loop.ts',
  '../src/assistant/cron.ts',
  '../src/assistant/doctor-security.ts',
  '../src/assistant/doctor.ts',
  '../src/assistant/outbox.ts',
  '../src/assistant/provider-catalog.ts',
  '../src/assistant/service.ts',
  '../src/assistant/status.ts',
  '../src/assistant/stop.ts',
  '../src/assistant/store.ts',
  '../src/assistant/ui/chat-controller-models.ts',
  '../src/assistant/ui/chat-controller-pause.ts',
  '../src/assistant/ui/chat-controller-runtime.ts',
  '../src/assistant/ui/chat-controller-state.ts',
  '../src/assistant/ui/chat-controller.ts',
  '../src/assistant/ui/composer-editing.ts',
  '../src/assistant/ui/composer-editor.ts',
  '../src/assistant/ui/composer-render.ts',
  '../src/assistant/ui/composer-state.ts',
  '../src/assistant/ui/composer-terminal.ts',
  '../src/assistant/ui/ink-composer-panel.ts',
  '../src/assistant/ui/ink-layout.ts',
  '../src/assistant/ui/ink-message-text.ts',
  '../src/assistant/ui/ink-transcript.ts',
  '../src/assistant/ui/ink.ts',
  '../src/assistant/ui/model-switcher.ts',
  '../src/assistant/ui/theme.ts',
  '../src/assistant/ui/view-model.ts',
  '../src/commands/assistant.ts',
  '../src/run-terminal-logging.ts',
  '../src/setup-agentmail.ts',
  '../src/setup-assistant-account.ts',
  '../src/setup-assistant.ts',
  '../src/setup-cli.ts',
  '../src/setup-services.ts',
  '../src/setup-services/channels.ts',
  '../src/setup-services/process.ts',
  '../src/setup-services/scheduled-updates.ts',
  '../src/setup-services/shell.ts',
  '../src/setup-services/steps.ts',
  '../src/setup-services/toolchain.ts',
  '../src/setup-wizard.ts',
  '../src/usecases/intervention.ts',
  '../src/usecases/text-duration.ts',
  '../src/usecases/workout-artifacts.ts',
  '../src/usecases/workout-format.ts',
  '../src/usecases/workout-import.ts',
  '../src/usecases/workout-measurement.ts',
  '../src/usecases/workout-model.ts',
  '../src/usecases/workout.ts',
] as const

type PackageManifest = {
  dependencies?: Record<string, string | undefined>
  exports?: Record<string, string | { default?: string; types?: string }>
}

type TsConfigShape = {
  compilerOptions?: {
    paths?: Record<string, string[] | undefined>
  }
  references?: Array<{ path?: string }>
}

function resolvePackageExportEntry(
  manifest: PackageManifest,
  specifier: string,
): string | { default?: string; types?: string } | undefined {
  const exportsField = manifest.exports ?? {}
  const exactEntry = exportsField[specifier]
  if (exactEntry !== undefined) {
    return exactEntry
  }

  for (const [exportKey, exportValue] of Object.entries(exportsField)) {
    if (!exportKey.includes('*')) {
      continue
    }

    const exportPattern = new RegExp(
      `^${exportKey.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\\\*/gu, '(.+)')}$`,
      'u',
    )
    if (exportPattern.test(specifier)) {
      return exportValue
    }
  }

  return undefined
}

function assertPublishedSpecifier(
  manifest: PackageManifest,
  specifier: string,
  packageName: string,
) {
  const exportEntry = resolvePackageExportEntry(manifest, specifier)
  assert.notEqual(
    exportEntry,
    undefined,
    `${packageName} should publish ${specifier}`,
  )
}

test('cli depends on the owner packages directly and no longer publishes shim subpaths', async () => {
  const cliManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const assistantCliManifest = JSON.parse(
    await readFile(new URL('../../assistant-cli/package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const assistantCoreManifest = JSON.parse(
    await readFile(new URL('../../assistant-core/package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
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

  assert.equal(cliManifest.dependencies?.['@murphai/assistant-core'], 'workspace:*')
  assert.equal(cliManifest.dependencies?.['@murphai/assistant-cli'], 'workspace:*')
  assert.equal(cliManifest.dependencies?.['@murphai/setup-cli'], 'workspace:*')
  assert.equal(assistantCoreManifest.exports?.['./*'], undefined)
  for (const entrypoint of curatedAssistantCoreExports) {
    assert.notEqual(assistantCoreManifest.exports?.[entrypoint], undefined)
  }
  for (const entrypoint of preservedAssistantCoreLeafExports) {
    assert.notEqual(assistantCoreManifest.exports?.[entrypoint], undefined)
  }
  for (const specifier of requiredAssistantCliSpecifiers) {
    assertPublishedSpecifier(assistantCliManifest, specifier, '@murphai/assistant-cli')
  }
  for (const specifier of requiredSetupCliSpecifiers) {
    assertPublishedSpecifier(setupCliManifest, specifier, '@murphai/setup-cli')
  }

  for (const referencePath of [
    '../assistant-core',
    '../assistant-cli',
    '../setup-cli',
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

  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/assistant-core/*'], [
    'packages/assistant-core/src/*.ts',
  ])
  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/assistant-cli/*'], [
    'packages/assistant-cli/src/*',
  ])
  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/setup-cli/*'], [
    'packages/setup-cli/src/*',
  ])
  for (const removedPathAlias of [
    'murph/assistant/automation',
    'murph/assistant/cron',
    'murph/assistant/service',
    'murph/assistant/outbox',
    'murph/assistant/status',
    'murph/assistant/store',
  ]) {
    assert.equal(repoTsconfigBase.compilerOptions?.paths?.[removedPathAlias], undefined)
  }
  assert.deepEqual(Object.keys(cliManifest.exports ?? {}).sort(), ['.'])

  for (const removedSubpath of [
    './assistant-cli-contracts',
    './assistant/automation',
    './assistant/cron',
    './assistant/outbox',
    './assistant/service',
    './assistant/state-ids',
    './assistant/status',
    './assistant/store',
    './inbox-services',
    './operator-config',
    './vault-cli-services',
    './vault-services',
  ]) {
    assert.equal(cliManifest.exports?.[removedSubpath], undefined)
  }
})

test('cli source no longer keeps passthrough-only facade files to owner packages', async () => {
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
          /from ['"]@murphai\/(?:assistant-core|assistant-cli|setup-cli)\/[^'"]+['"]/u.test(line),
        )
      ) {
        facadeFiles.push(path.relative(packageRoot, fileURLToPath(entryUrl)))
      }
    }
  }

  await walk(srcRoot)
  assert.deepEqual(facadeFiles, [])
})

test('cli no longer keeps duplicated assistant-core or split-package shim source files', async () => {
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
    ...removedCliShimFiles,
  ] as const

  for (const relativePath of removedDuplicateFiles) {
    await assert.rejects(() => access(new URL(relativePath, import.meta.url)))
  }
})

test('cli package root stays CLI-owned and does not re-export owner-package helper surfaces', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /@murphai\/assistant-core\//u)
  assert.doesNotMatch(source, /@murphai\/assistant-cli\//u)
  assert.doesNotMatch(source, /@murphai\/setup-cli\//u)
  assert.doesNotMatch(source, /runAssistantAutomation/u)
  assert.doesNotMatch(source, /dispatchAssistantOutboxIntent/u)
  assert.doesNotMatch(source, /refreshAssistantStatusSnapshot/u)
  assert.doesNotMatch(source, /vault-cli-services/u)
})
