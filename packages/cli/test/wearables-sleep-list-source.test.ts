import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { initializeVault, withCanonicalWriteLock } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerWearablesCommands } from '../src/commands/wearables.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { runInProcessJsonCli } from './cli-test-helpers.js'

test('sleep list preserves the public strict-source error envelope without private parser detail', async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'sleep-list-source-error-'))
  try {
    await initializeVault({ vaultRoot: vault, timezone: 'UTC' })
    await withCanonicalWriteLock(vault, async () => {
      await mkdir(path.join(vault, 'ledger/events/2026'), { recursive: true })
      await writeFile(path.join(vault, 'ledger/events/2026/2026-01.jsonl'), '{SYNTHETIC_INVALID_SOURCE\n')
    })
    const cli = Cli.create('vault-cli', { description: 'Sleep error proof', version: '0.0.0-test' })
    cli.use(incurErrorBridge)
    registerWearablesCommands(cli, createIntegratedVaultServices())
    const result = await runInProcessJsonCli(cli, [
      'wearables', 'sleep', 'list', '--vault', vault, '--provider', 'missing', '--limit', '1',
    ])
    assert.equal(result.envelope.ok, false)
    if (result.envelope.ok) throw new Error('Invalid canonical evidence must not become empty success')
    assert.deepEqual(result.envelope.error, {
      code: 'VAULT_INVALID_JSONL',
      message: 'Invalid JSON on line 1.',
      retryable: false, stage: 'command',
    })
    assert.equal(result.envelope.meta.command, 'wearables sleep list')
    assert.equal(typeof result.envelope.meta.duration, 'string')
    assert.ok(!JSON.stringify(result.envelope).includes('SYNTHETIC_INVALID_SOURCE'))
    assert.ok(!JSON.stringify(result.envelope).includes(vault))
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})
