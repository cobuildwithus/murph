import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { resolveRuntimePaths } from '@murphai/runtime-state/node'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import { afterEach, test } from 'vitest'

import { createIntegratedInboxServices } from '../src/index.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((tempRoot) =>
      rm(tempRoot, { force: true, recursive: true }),
    ),
  )
})

test('storage repairs do not require inbox runtime configuration', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'inbox-storage-repair-'))
  tempRoots.push(tempRoot)
  const vaultRoot = path.join(tempRoot, 'vault')
  await createIntegratedVaultServices().core.init({
    requestId: null,
    vault: vaultRoot,
  })

  const paths = resolveRuntimePaths(vaultRoot)
  await assert.rejects(access(paths.inboxConfigPath))

  const services = createIntegratedInboxServices()
  const envelopeResult = await services.repairEnvelopes({
    apply: false,
    requestId: null,
    vault: vaultRoot,
  })
  const parserResult = await services.compactParserAttempts({
    apply: false,
    requestId: null,
    vault: vaultRoot,
  })

  assert.equal(envelopeResult.mode, 'dry-run')
  assert.equal(envelopeResult.scannedEnvelopeCount, 0)
  assert.equal(parserResult.mode, 'dry-run')
  assert.equal(parserResult.scannedAttemptCount, 0)
})
