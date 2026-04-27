import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'

import { createVaultCli } from '../src/vault-cli.js'

interface CliEnvelope<TData> {
  data: TData
  ok: boolean
}

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { force: true, recursive: true })))
})

test('sync push dry-run output omits the resolved local vault path', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-sync-output-vault-'))
  cleanupPaths.push(vaultRoot)
  await writeFile(path.join(vaultRoot, 'vault.json'), JSON.stringify({
    createdAt: '2026-04-26T00:00:00.000Z',
    formatVersion: 'murph.vault-format.v1',
    timezone: 'UTC',
    title: 'Sensitive local test vault title',
    vaultId: 'vault_test',
  }))

  const output: string[] = []
  await createVaultCli().serve([
    'sync',
    'push',
    '--vault',
    vaultRoot,
    '--session',
    'PAIRING-CODE',
    '--dry-run',
    '--full-output',
    '--format',
    'json',
  ], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  const envelope = JSON.parse(output.join('').trim()) as CliEnvelope<Record<string, unknown>>
  assert.equal(envelope.ok, true)
  assert.equal(envelope.data.dryRun, true)
  assert.equal(envelope.data.status, 'dry_run')
  assert.equal(Object.hasOwn(envelope.data, 'vault'), false)
  assert.equal(Object.hasOwn(envelope.data, 'sourceVaultTitle'), false)
  assert.equal(output.join('').includes(vaultRoot), false)
  assert.equal(output.join('').includes('Sensitive local test vault title'), false)
})
