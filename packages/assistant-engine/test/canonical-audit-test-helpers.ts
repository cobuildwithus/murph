import assert from 'node:assert/strict'
import { listAuditShardPaths, listWriteOperationMetadataPaths, readAuditShardRows } from '@murphai/core'

export async function readCanonicalAuditRecords(vaultRoot: string) {
  const rows = (await Promise.all(
    (await listAuditShardPaths(vaultRoot)).map(relativePath => readAuditShardRows({ vaultRoot, relativePath })),
  )).flat()
  return rows.map(row => row.value)
}

// Preserve detection of pending writes and include durable evidence of completed writes.
export async function listCanonicalWriteEvidence(vaultRoot: string): Promise<string[]> {
  const ids = (await readCanonicalAuditRecords(vaultRoot)).map(record => {
    assert.equal(typeof record.id, 'string')
    return String(record.id)
  })
  return [...ids, ...await listWriteOperationMetadataPaths(vaultRoot)].sort()
}
