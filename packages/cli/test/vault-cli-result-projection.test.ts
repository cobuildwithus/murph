import assert from 'node:assert/strict'

import { z } from 'incur'
import { test } from 'vitest'

import {
  projectVaultCliOutputSchema,
  projectVaultCliRunResult,
} from '../src/vault-cli-result-projection.js'

const incurSentinel = Symbol.for('incur.sentinel')

test('vault cli results drop echoed vault roots, storage paths, duplicate ids, and unset filters', () => {
  assert.deepEqual(
    projectVaultCliRunResult({
      vault: '/vaults/member',
      eventId: 'evt_1',
      lookupId: 'evt_1',
      ledgerFile: 'ledger/events/2026/2026-11.jsonl',
      manifestFile: null,
      created: true,
      filters: { kind: null, from: null, tag: [], text: '', limit: 20, windowDays: 28 },
    }),
    {
      eventId: 'evt_1',
      created: true,
      filters: { limit: 20, windowDays: 28 },
    },
  )

  assert.deepEqual(
    projectVaultCliRunResult({
      vault: '/vaults/member',
      regimenId: 'reg_1',
      lookupId: 'reg_1',
      path: 'bank/regimens/supplement/vitamin-d3.md',
      entity: { id: 'reg_1', path: 'bank/regimens/supplement/vitamin-d3.md' },
    }),
    {
      regimenId: 'reg_1',
      entity: { id: 'reg_1', path: 'bank/regimens/supplement/vitamin-d3.md' },
    },
  )
})

test('vault cli results keep distinct lookups, real paths, and set filters', () => {
  const automation = {
    automationId: 'automation_1',
    lookupId: 'weekly-review',
    path: 'bank/automations/weekly-review.md',
    created: true,
  }
  assert.deepEqual(projectVaultCliRunResult({ vault: '/vaults/member', ...automation }), automation)

  const meal = {
    mealId: 'meal_1',
    manifestFile: 'raw/meals/2026/11/meal_1/manifest.json',
    filters: { status: ['active'], limit: 0, includeDetails: false },
  }
  assert.deepEqual(projectVaultCliRunResult(meal), meal)

  const emptyFilters = projectVaultCliRunResult({ filters: { from: null, providers: [] }, items: [] })
  assert.deepEqual(emptyFilters, { items: [] })
})

test('vault cli result projection reaches ok envelopes and leaves other values untouched', () => {
  const ok = projectVaultCliRunResult({
    [incurSentinel]: 'ok',
    data: { vault: '/vaults/member', noun: 'goal' },
    cta: { commands: [] },
  })
  assert.ok(typeof ok === 'object' && ok !== null)
  assert.deepEqual(Reflect.get(ok, 'data'), { noun: 'goal' })
  assert.deepEqual(Reflect.get(ok, 'cta'), { commands: [] })
  assert.equal(Reflect.get(ok, incurSentinel), 'ok')

  const error = { [incurSentinel]: 'error', code: 'x', message: 'y', vault: '/vaults/member' }
  assert.equal(projectVaultCliRunResult(error), error)

  async function* stream() {
    yield { vault: '/vaults/member' }
  }
  const generator = stream()
  assert.equal(projectVaultCliRunResult(generator), generator)

  const items = [{ vault: '/vaults/member' }]
  assert.equal(projectVaultCliRunResult(items), items)
})

test('vault cli output schemas describe the projected result', () => {
  const projected = projectVaultCliOutputSchema(z.object({
    vault: z.string(),
    eventId: z.string(),
    lookupId: z.string(),
    ledgerFile: z.string(),
    manifestFile: z.string().nullable(),
    filters: z.object({ kind: z.string().nullable(), limit: z.number() }),
  }))
  assert.ok(projected instanceof z.ZodObject)
  assert.deepEqual(Object.keys(projected.shape).sort(), [
    'eventId',
    'filters',
    'lookupId',
    'manifestFile',
  ])
  assert.equal(projected.safeParse({ eventId: 'evt_1', filters: { limit: 5 } }).success, true)
  assert.equal(projected.safeParse({ eventId: 'evt_1', lookupId: 'evt_1' }).success, true)

  const union = projectVaultCliOutputSchema(z.union([
    z.object({ vault: z.string(), created: z.boolean() }),
    z.object({ count: z.number() }),
  ]).meta({ type: 'object' }))
  assert.ok(union instanceof z.ZodUnion)
  assert.equal(union.safeParse({ created: true }).success, true)
  // MCP needs the declared root object type to return structured content.
  assert.deepEqual(union.meta(), { type: 'object' })

  const described = projectVaultCliOutputSchema(
    z.object({ vault: z.string(), count: z.number() }).describe('Counted records.'),
  )
  assert.ok(described instanceof z.ZodObject)
  assert.equal(described.description, 'Counted records.')

  const refined = z.object({ vault: z.string() }).refine(() => true)
  assert.equal(projectVaultCliOutputSchema(refined), refined)

  const withoutVault = z.object({ count: z.number() })
  assert.equal(projectVaultCliOutputSchema(withoutVault), withoutVault)
})
