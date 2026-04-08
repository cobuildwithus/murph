import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { test } from 'vitest'

interface PackageManifest {
  dependencies?: Record<string, string>
  exports?: Record<string, unknown>
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
  ) as PackageManifest
  const vaultUsecasesManifest = JSON.parse(
    await readFile(new URL('../../vault-usecases/package.json', import.meta.url), 'utf8'),
  ) as PackageManifest
  const operatorConfigManifest = JSON.parse(
    await readFile(new URL('../../operator-config/package.json', import.meta.url), 'utf8'),
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

  assert.equal(cliManifest.dependencies?.['@murphai/assistant-cli'], 'workspace:*')
  assert.equal(cliManifest.dependencies?.['@murphai/setup-cli'], 'workspace:*')
  assert.equal(cliManifest.dependencies?.['@murphai/operator-config'], 'workspace:*')
  assert.equal(cliManifest.dependencies?.['@murphai/assistant-engine'], 'workspace:*')
  assert.equal(cliManifest.dependencies?.['@murphai/vault-usecases'], 'workspace:*')

  assert.equal(assistantCliManifest.dependencies?.['@murphai/assistant-engine'], 'workspace:*')
  assert.equal(assistantCliManifest.dependencies?.['@murphai/operator-config'], 'workspace:*')
  assert.equal(assistantCliManifest.dependencies?.['@murphai/vault-usecases'], 'workspace:*')
  assert.equal(assistantCliManifest.exports?.['./assistant-runtime'], undefined)
  assert.equal(assistantCliManifest.exports?.['./assistant-chat-ink'], undefined)
  assert.equal(assistantCliManifest.exports?.['./assistant-daemon-client'], undefined)
  assert.equal(assistantCliManifest.exports?.['./assistant/automation'], undefined)
  assert.equal(assistantCliManifest.exports?.['./assistant/doctor-security'], undefined)
  assert.equal(assistantCliManifest.exports?.['./assistant/stop'], undefined)
  assert.equal(assistantCliManifest.exports?.['./assistant/*'], undefined)
  assert.equal(assistantCliManifest.exports?.['./commands/assistant'] !== undefined, true)
  assert.equal(assistantCliManifest.exports?.['./run-terminal-logging'] !== undefined, true)

  assert.equal(setupCliManifest.dependencies?.['@murphai/assistant-engine'], 'workspace:*')
  assert.equal(setupCliManifest.dependencies?.['@murphai/operator-config'], 'workspace:*')
  assert.equal(setupCliManifest.dependencies?.['@murphai/vault-usecases'], 'workspace:*')
  assert.equal(setupCliManifest.dependencies?.['@murphai/vault-inbox'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./assistant-backend'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./assistant-cli-contracts'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./assistant-cli-access'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./assistant-cli-tools'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./assistant/*'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./commands/*'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./commands/query-record-command-helpers'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./health-registry-command-metadata'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./inbox-app/reads'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./inbox-app/sources'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./inbox-services/connectors'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./inbox-services/daemon'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./inbox-services/promotions'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./inbox-services/*'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./knowledge/*'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./model-harness'] !== undefined, true)
  assert.equal(assistantEngineManifest.exports?.['./usecases/*'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./usecases/document-meal-read'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./usecases/event-record-mutations'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./usecases/experiment-journal-vault'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./usecases/explicit-health-family-services'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./usecases/record-mutations'], undefined)
  assert.equal(assistantEngineManifest.exports?.['./usecases/workout-artifacts'], undefined)
  assert.equal(vaultUsecasesManifest.exports?.['./vault-services'], undefined)
  assert.equal(vaultUsecasesManifest.exports?.['./usecases/runtime'], undefined)
  assert.equal(vaultUsecasesManifest.exports?.['./usecases/shared'], undefined)
  assert.equal(vaultUsecasesManifest.exports?.['./health-cli-descriptors'], undefined)
  assert.equal(vaultUsecasesManifest.exports?.['./helpers'] !== undefined, true)
  assert.equal(vaultUsecasesManifest.exports?.['./records'] !== undefined, true)
  assert.equal(vaultUsecasesManifest.exports?.['./runtime'] !== undefined, true)
  assert.equal(vaultUsecasesManifest.exports?.['./testing'] !== undefined, true)
  assert.equal(vaultUsecasesManifest.exports?.['./workouts'] !== undefined, true)
  assert.equal(operatorConfigManifest.exports?.['./text/*'], undefined)
  assert.equal(operatorConfigManifest.exports?.['./text/shared'] !== undefined, true)

  for (const referencePath of [
    '../assistant-engine',
    '../vault-usecases',
    '../assistant-cli',
    '../operator-config',
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

  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/assistant-engine/*'], [
    'packages/assistant-engine/src/*',
  ])
  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/vault-usecases/*'], [
    'packages/vault-usecases/src/*',
  ])
  assert.deepEqual(repoTsconfigBase.compilerOptions?.paths?.['@murphai/operator-config/*'], [
    'packages/operator-config/src/*',
  ])
  assert.equal(repoTsconfigBase.compilerOptions?.paths?.['@murphai/vault-inbox/*'], undefined)
  assert.equal(repoTsconfigBase.compilerOptions?.paths?.['@murphai/assistant-core/*'], undefined)
})
