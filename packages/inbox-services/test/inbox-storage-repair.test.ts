import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { openInboxRuntime, persistCanonicalInboxCapture } from '@murphai/inboxd'
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
  await assert.rejects(access(path.join(vaultRoot, '.runtime/operations/inbox/config.json')))

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

test('hosted inbox initialization opens SQLite and remains idempotent with rebuild enabled', async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'inbox-init-'))
  tempRoots.push(vaultRoot)
  await createIntegratedVaultServices().core.init({ requestId: null, vault: vaultRoot })
  const services = createIntegratedInboxServices()
  const first = await services.init({ requestId: null, vault: vaultRoot })
  assert.equal(first.databasePath, '.runtime/projections/inboxd.sqlite')
  await access(resolveRuntimePaths(vaultRoot).inboxDbPath)
  const second = await services.init({ requestId: null, vault: vaultRoot, rebuild: true })
  assert.deepEqual(second.createdPaths, [])
  assert.equal(second.rebuiltCaptures, 0)
  const listed = await services.list({ requestId: null, vault: vaultRoot })
  assert.deepEqual(listed.items, [])
})

test('rebuild reports all committed captures beyond the SQLite list limit and ignores retired config', async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'inbox-rebuild-count-'))
  tempRoots.push(vaultRoot)
  await createIntegratedVaultServices().core.init({ requestId: null, vault: vaultRoot })
  const paths = resolveRuntimePaths(vaultRoot)
  const services = createIntegratedInboxServices()
  const captureCount = 201
  for (let index = 0; index < captureCount; index += 1) {
    await persistCanonicalInboxCapture({
      vaultRoot,
      captureId: `cap_rebuild_${index}`,
      eventId: `evt_${String(index).padStart(26, '0')}`,
      storedAt: '2026-11-10T12:00:00.000Z',
      input: {
        source: 'telegram',
        accountId: 'bot',
        externalId: `message-${index}`,
        thread: { id: 'thread-rebuild', isDirect: true },
        actor: { isSelf: false },
        occurredAt: '2026-11-10T12:00:00.000Z',
        text: `Rebuild capture ${index}`,
        attachments: [],
        raw: {},
      },
    })
  }

  const rebuilt = await services.init({ requestId: null, vault: vaultRoot, rebuild: true })
  assert.equal(rebuilt.rebuiltCaptures, captureCount)
  await assert.rejects(access(path.join(vaultRoot, '.runtime/operations/inbox/config.json')))
  const runtime = await openInboxRuntime({ vaultRoot })
  try {
    assert.equal(runtime.listCaptures({ limit: captureCount }).length, 200)
    assert.equal(runtime.getCapture('cap_rebuild_200')?.externalId, 'message-200')
  } finally {
    runtime.close()
  }

  const listed = await services.list({ requestId: null, vault: vaultRoot })
  assert.equal(listed.items.length, 50)
  const searched = await services.search({ requestId: null, vault: vaultRoot, text: 'Rebuild' })
  assert.equal(searched.hits.length, 20)
  await mkdir(path.dirname(path.join(vaultRoot, '.runtime/operations/inbox/config.json')), { recursive: true })
  await writeFile(path.join(vaultRoot, '.runtime/operations/inbox/config.json'), 'retired malformed config', 'utf8')
  const replayed = await services.init({ requestId: null, vault: vaultRoot, rebuild: true })
  assert.equal(replayed.rebuiltCaptures, captureCount)
  assert.equal((await services.list({ requestId: null, vault: vaultRoot })).items.length, 50)
  assert.equal((await services.search({ requestId: null, vault: vaultRoot, text: 'Rebuild' })).hits.length, 20)
  assert.equal(await readFile(path.join(vaultRoot, '.runtime/operations/inbox/config.json'), 'utf8'), 'retired malformed config')
})
