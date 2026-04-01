import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { VaultCliError } from '@murphai/assistant-core/vault-cli-errors'
import { applyRecordPatch } from '@murphai/assistant-core/usecases/record-mutations'

test('applyRecordPatch requires at least one mutation source', async () => {
  await assert.rejects(
    () =>
      applyRecordPatch({
        record: {},
        patchLabel: 'payload',
      }),
    (error: unknown) =>
      error instanceof VaultCliError && error.code === 'invalid_payload',
  )
})

test('applyRecordPatch parses values, deep-merges file patches, and does not over-report cleared top-level fields', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-record-patch-'))
  const patchPath = path.join(vaultRoot, 'patch.json')

  try {
    await writeFile(
      patchPath,
      JSON.stringify({
        meta: { b: 2 },
        added: { deep: { x: 1 } },
      }),
      'utf8',
    )

    const original = {
      autoLogDaily: { time: '08:00', tz: 'UTC' },
      meta: { a: 1 },
    }

    const result = await applyRecordPatch({
      record: original,
      inputFile: patchPath,
      set: [
        'flag=true',
        'count=12',
        'name="Alice"',
        'tags=["breakfast","protein"]',
        'added.deep.y=null',
      ],
      clear: ['autoLogDaily.tz', 'meta.a'],
      patchLabel: 'payload',
    })

    assert.deepEqual(result.record.meta, { b: 2 })
    assert.deepEqual(result.record.autoLogDaily, { time: '08:00' })
    assert.equal(result.record.flag, true)
    assert.equal(result.record.count, 12)
    assert.equal(result.record.name, 'Alice')
    assert.deepEqual(result.record.tags, ['breakfast', 'protein'])
    assert.deepEqual(result.record.added, { deep: { x: 1, y: null } })

    assert.deepEqual([...result.clearedFields].sort(), [])
    assert.deepEqual(
      [...result.touchedTopLevelFields].sort(),
      ['added', 'autoLogDaily', 'count', 'flag', 'meta', 'name', 'tags'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('applyRecordPatch reports a top-level field as cleared only when pruning removes it entirely', async () => {
  const original = {
    autoLogDaily: { time: '08:00' },
    tags: ['a', 'b'],
  }

  const result = await applyRecordPatch({
    record: original,
    clear: ['autoLogDaily.time'],
    patchLabel: 'payload',
  })

  assert.equal('autoLogDaily' in result.record, false)
  assert.deepEqual([...result.clearedFields].sort(), ['autoLogDaily'])
  assert.deepEqual([...result.touchedTopLevelFields].sort(), ['autoLogDaily'])
})

test('applyRecordPatch rejects malformed dotted.path=value assignments', async () => {
  await assert.rejects(
    () =>
      applyRecordPatch({
        record: {},
        set: ['missing-separator'],
        patchLabel: 'payload',
      }),
    (error: unknown) =>
      error instanceof VaultCliError && error.code === 'invalid_payload',
  )
})
