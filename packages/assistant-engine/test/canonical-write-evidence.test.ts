import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { addMeal, initializeVault, listAuditShardPaths, listWriteOperationMetadataPaths } from '@murphai/core'
import { listCanonicalWriteEvidence, readCanonicalAuditRecords } from './canonical-audit-test-helpers.js'

it('counts completed writes after journal deletion, including another write in the same audit shard', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-write-evidence-'))
  try {
    await initializeVault({ vaultRoot, timezone: 'UTC', createdAt: '2026-08-29T12:00:00.000Z' })
    const before = new Set(await listCanonicalWriteEvidence(vaultRoot))
    for (let index = 0; index < 2; index += 1) {
      await addMeal({ vaultRoot, occurredAt: '2026-08-29T12:15:00.000Z', ingredients: ['lentils'] })
      expect(await listWriteOperationMetadataPaths(vaultRoot)).toEqual([])
      expect((await listCanonicalWriteEvidence(vaultRoot)).filter(id => !before.has(id))).toHaveLength(index + 1)
    }
    expect(await listAuditShardPaths(vaultRoot)).toHaveLength(1)
    expect((await readCanonicalAuditRecords(vaultRoot)).filter(record => record.action === 'meal_add')).toHaveLength(2)
    const pending = '.runtime/operations/op_pending.json'
    await mkdir(path.join(vaultRoot, '.runtime/operations'), { recursive: true })
    await writeFile(path.join(vaultRoot, pending), '{}')
    expect(await listCanonicalWriteEvidence(vaultRoot)).toContain(pending)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
