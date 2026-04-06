import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import {
  loadJsonInputFile,
  preparePatchedUpsertPayload,
} from '@murphai/assistant-engine/usecases/shared'
import {
  compactObject,
  inferVaultLinkKind,
  isVaultQueryableRecordId,
  normalizeIsoTimestamp,
  normalizeOptionalText,
  normalizeStringArray,
  resolveVaultRelativePath,
  stringArray,
} from '@murphai/assistant-engine/usecases/vault-usecase-helpers'

test('link-kind and queryable helpers preserve provider and current semantics', () => {
  assert.equal(inferVaultLinkKind('prov_01JNV422Y2M5ZBV64ZP4N1DRB1'), 'entity')
  assert.equal(
    inferVaultLinkKind('prov_01JNV422Y2M5ZBV64ZP4N1DRB1', { includeProviderIds: true }),
    'provider',
  )
  assert.equal(inferVaultLinkKind('current'), 'entity')
  assert.equal(inferVaultLinkKind('evt_01JNV422Y2M5ZBV64ZP4N1DRB1'), 'event')
  assert.equal(inferVaultLinkKind('xfm_01JNV422Y2M5ZBV64ZP4N1DRB1'), 'transform')
  assert.equal(inferVaultLinkKind('pack_focus'), 'export_pack')

  assert.equal(isVaultQueryableRecordId('current'), true)
  assert.equal(isVaultQueryableRecordId('core'), true)
  assert.equal(isVaultQueryableRecordId('doc_01JNV422Y2M5ZBV64ZP4N1DRB1'), true)
  assert.equal(isVaultQueryableRecordId('meal_01JNV422Y2M5ZBV64ZP4N1DRB1'), true)
  assert.equal(isVaultQueryableRecordId('xfm_01JNV422Y2M5ZBV64ZP4N1DRB1'), false)
  assert.equal(isVaultQueryableRecordId('pack_focus'), false)
})

test('normalization helpers keep their distinct trim and dedupe behavior', () => {
  assert.equal(normalizeOptionalText('  hello  '), 'hello')
  assert.equal(normalizeOptionalText('   '), null)
  assert.equal(normalizeIsoTimestamp('2026-03-12T08:15:00.000Z'), '2026-03-12T08:15:00.000Z')
  assert.equal(normalizeIsoTimestamp('2026-03-12'), null)
  assert.deepEqual(normalizeStringArray([' a ', 'b', 'a', '', 1]), ['a', 'b'])
  assert.deepEqual(stringArray([' a ', '', 'b', 1]), [' a ', 'b'])
  assert.deepEqual(compactObject({ a: 1, b: undefined, c: null }), { a: 1, c: null })
})

test('path resolution preserves current invalid_path errors and rejects symlink escapes', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-vault-helper-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-vault-helper-outside-'))

  try {
    await mkdir(path.join(vaultRoot, 'journal'), { recursive: true })
    await mkdir(path.join(vaultRoot, 'bank'), { recursive: true })
    await symlink(outsideRoot, path.join(vaultRoot, 'bank', 'providers'))

    assert.equal(
      await resolveVaultRelativePath(vaultRoot, 'journal/2026-03-17.md'),
      path.join(vaultRoot, 'journal', '2026-03-17.md'),
    )

    await assert.rejects(() => resolveVaultRelativePath(vaultRoot, '/tmp/nope'), {
      name: 'VaultCliError',
      code: 'invalid_path',
      message: 'Vault-relative path "/tmp/nope" is invalid.',
    })

    await assert.rejects(() => resolveVaultRelativePath(vaultRoot, '../escape.md'), {
      name: 'VaultCliError',
      code: 'invalid_path',
      message: 'Vault-relative path "../escape.md" escapes the selected vault root.',
    })

    await assert.rejects(() => resolveVaultRelativePath(vaultRoot, ''), {
      name: 'VaultCliError',
      code: 'invalid_path',
      message: 'Vault-relative path "" is invalid.',
    })

    await assert.rejects(() => resolveVaultRelativePath(vaultRoot, 'C:/outside.txt'), {
      name: 'VaultCliError',
      code: 'invalid_path',
      message: 'Vault-relative path "C:/outside.txt" is invalid.',
    })

    await assert.rejects(() => resolveVaultRelativePath(vaultRoot, 'bank/providers/labcorp.md'), {
      name: 'VaultCliError',
      code: 'invalid_path',
      message:
        'Vault-relative path "bank/providers/labcorp.md" may not traverse symbolic links inside the selected vault root.',
    })
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('path resolution fails fast when the selected vault root does not exist', async () => {
  const missingVaultRoot = path.join(tmpdir(), `murph-vault-helper-missing-${Date.now()}`)

  await assert.rejects(
    () => resolveVaultRelativePath(missingVaultRoot, 'journal/2026-03-17.md'),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === 'object' &&
          error instanceof Error &&
          'code' in error &&
          (error as { code?: unknown }).code === 'VAULT_INVALID_ROOT' &&
          error.message === 'Vault root does not exist on disk.',
      ),
  )
})

test('shared JSON payload reader loads object input for record scaffolding usecases', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-shared-json-'))
  const payloadPath = path.join(tempDir, 'payload.json')

  try {
    await writeFile(payloadPath, JSON.stringify({
      title: 'Sheet Pan Salmon Bowls',
      status: 'saved',
    }))

    const payload = await loadJsonInputFile(`@${payloadPath}`, 'recipe payload')

    assert.deepEqual(payload, {
      title: 'Sheet Pan Salmon Bowls',
      status: 'saved',
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('shared patched-upsert helper preserves canonical ids while surfacing cleared fields and slug edits', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-shared-edit-'))
  const patchPath = path.join(tempDir, 'patch.json')

  try {
    await writeFile(patchPath, JSON.stringify({
      foodId: 'food_patch_attempt',
      title: 'Protein Acai Bowl',
      slug: 'protein-acai-bowl',
    }))
    const originalRecord = {
      foodId: 'food_123',
      title: 'Regular Acai Bowl',
      slug: 'regular-acai-bowl',
      note: 'Usual order.',
    }

    const result = await preparePatchedUpsertPayload({
      record: originalRecord,
      entityIdField: 'foodId',
      entityId: 'food_123',
      inputFile: `@${patchPath}`,
      clear: ['note'],
      patchLabel: 'food payload',
      parsePayload(value) {
        return value as {
          foodId: string
          title: string
          slug: string
          note?: string
        }
      },
    })

    assert.deepEqual(result.payload, {
      foodId: 'food_123',
      title: 'Protein Acai Bowl',
      slug: 'protein-acai-bowl',
    })
    assert.equal(result.allowSlugRename, true)
    assert.deepEqual([...result.clearedFields], ['note'])
    assert.deepEqual(originalRecord, {
      foodId: 'food_123',
      title: 'Regular Acai Bowl',
      slug: 'regular-acai-bowl',
      note: 'Usual order.',
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('shared patched-upsert helper ignores set and clear attempts against the canonical entity id', async () => {
  const originalRecord = {
    foodId: 'food_123',
    title: 'Regular Acai Bowl',
    slug: 'regular-acai-bowl',
    note: 'Usual order.',
  }

  const result = await preparePatchedUpsertPayload({
    record: originalRecord,
    entityIdField: 'foodId',
    entityId: 'food_123',
    set: ['foodId=food_PATCHATTEMPT1', 'title=Protein Acai Bowl'],
    clear: ['foodId', 'note'],
    patchLabel: 'food payload',
    parsePayload(value) {
      return value as {
        foodId: string
        title: string
        slug: string
        note?: string
      }
    },
  })

  assert.deepEqual(result.payload, {
    foodId: 'food_123',
    title: 'Protein Acai Bowl',
    slug: 'regular-acai-bowl',
  })
  assert.equal(result.allowSlugRename, false)
  assert.deepEqual([...result.clearedFields].sort(), ['foodId', 'note'])
  assert.deepEqual(originalRecord, {
    foodId: 'food_123',
    title: 'Regular Acai Bowl',
    slug: 'regular-acai-bowl',
    note: 'Usual order.',
  })
})
