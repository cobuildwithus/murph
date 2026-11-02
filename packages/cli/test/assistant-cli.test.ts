import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import { resolveDefaultVault, resolveOperatorConfigPath } from '@murphai/operator-config/operator-config'
import { formatStructuredErrorMessage } from '@murphai/operator-config/text/shared'
import { collectVaultCliDescriptorRootCommandNames, collectVaultRequiredCliDescriptorRootCommandNames } from '../src/vault-cli-command-manifest.js'
const cleanupPaths: string[] = []
const ASSISTANT_CLI_TIMEOUT_MS = 60_000
afterEach(async () => { await Promise.all(cleanupPaths.splice(0).map(target => rm(target, { recursive: true, force: true }))) })

test('formatStructuredErrorMessage expands structured validation details and redacts home paths', () => {
  const error = Object.assign(
    new Error('Vault metadata failed contract validation.'),
    {
      code: 'VAULT_INVALID_METADATA',
      details: {
        errors: [
          '$.paths.protocolsRoot: Invalid input: expected "bank/protocols"',
          'Invalid JSON in "/Users/example/vault/vault.json".',
        ],
      },
    },
  )

  assert.equal(
    formatStructuredErrorMessage(error),
    [
      'Vault metadata failed contract validation.',
      'details:',
      '- $.paths.protocolsRoot: Invalid input: expected "bank/protocols"',
      '- Invalid JSON in "<HOME_DIR>/vault/vault.json".',
    ].join('\n'),
  )
})

test.sequential(
  'resolveDefaultVault falls back to the current working directory vault when saved config is stale',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-stale-default-vault-'))
    const homeRoot = path.join(parent, 'home')
    const cwdRoot = path.join(parent, 'workspace')
    const staleVaultRoot = path.join(homeRoot, 'stale-vault')
    const cwdVaultRoot = path.join(cwdRoot, 'vault')
    cleanupPaths.push(parent)

    await mkdir(cwdVaultRoot, { recursive: true })

    const originalHome = process.env.HOME
    const originalCwd = process.cwd()
    process.env.HOME = homeRoot
    process.chdir(cwdRoot)

    try {
      const configPath = resolveOperatorConfigPath(homeRoot)
      await mkdir(path.dirname(configPath), { recursive: true })
      await writeFile(configPath, JSON.stringify({ schema: 'murph.operator-config.v1', defaultVault: staleVaultRoot, updatedAt: '2026-11-02T12:00:00.000Z' }))

      assert.equal(await resolveDefaultVault(homeRoot), path.resolve('vault'))
    } finally {
      process.chdir(originalCwd)
      restoreEnvironmentVariable('HOME', originalHome)
    }
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test('manifest marks query as vault-backed while route is exempt', () => {
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('query'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('commons'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('route'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('research'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('deepthink'), false)
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('commons'), false)
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('research'), false)
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('route'), false)
})

function restoreEnvironmentVariable(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
