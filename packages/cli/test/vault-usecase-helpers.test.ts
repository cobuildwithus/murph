import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  compactObject,
  generateContractId,
  inferVaultLinkKind,
  isVaultQueryableRecordId,
  normalizeIsoTimestamp,
  normalizeOptionalText,
  normalizeStringArray,
  resolveVaultRelativePath,
  stringArray,
} from '../src/usecases/vault-usecase-helpers.js'

test('link-kind and queryable helpers preserve provider and current semantics', () => {
  assert.equal(inferVaultLinkKind('prov_01JNV422Y2M5ZBV64ZP4N1DRB1'), 'entity')
  assert.equal(
    inferVaultLinkKind('prov_01JNV422Y2M5ZBV64ZP4N1DRB1', { includeProviderIds: true }),
    'provider',
  )
  assert.equal(inferVaultLinkKind('evt_01JNV422Y2M5ZBV64ZP4N1DRB1'), 'event')

  assert.equal(isVaultQueryableRecordId('current'), true)
  assert.equal(isVaultQueryableRecordId('core'), true)
  assert.equal(isVaultQueryableRecordId('doc_01JNV422Y2M5ZBV64ZP4N1DRB1'), false)
  assert.equal(isVaultQueryableRecordId('meal_01JNV422Y2M5ZBV64ZP4N1DRB1'), false)
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

test('path resolution preserves current invalid_path errors', () => {
  const vaultRoot = '/tmp/healthybob-vault'

  assert.equal(
    resolveVaultRelativePath(vaultRoot, 'bank/providers/labcorp.md'),
    '/tmp/healthybob-vault/bank/providers/labcorp.md',
  )

  assert.throws(() => resolveVaultRelativePath(vaultRoot, '/tmp/nope'), {
    name: 'VaultCliError',
    code: 'invalid_path',
    message: 'Vault-relative path "/tmp/nope" is invalid.',
  })

  assert.throws(() => resolveVaultRelativePath(vaultRoot, '../escape.md'), {
    name: 'VaultCliError',
    code: 'invalid_path',
    message: 'Vault-relative path "../escape.md" escapes the selected vault root.',
  })
})

test('contract ids keep the local ULID-style format', () => {
  assert.match(generateContractId('evt'), /^evt_[0-9A-HJKMNP-TV-Z]{26}$/u)
  assert.match(generateContractId('exp'), /^exp_[0-9A-HJKMNP-TV-Z]{26}$/u)
})
