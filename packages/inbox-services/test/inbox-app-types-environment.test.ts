import assert from 'node:assert/strict'

import { test } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { createInboxAppEnvironment } from '../src/inbox-app/environment.ts'
import type {
  CoreRuntimeModule,
} from '../src/inbox-app/types.ts'

function createCoreModule(
  overrides: Partial<CoreRuntimeModule> = {},
): CoreRuntimeModule {
  return {
    async addMeal() {
      return {
        event: { id: 'event-1' },
        manifestPath: 'derived/meals/meal-1.json',
        mealId: 'meal-1',
      }
    },
    ...overrides,
  }
}

test('requireParsers wraps missing local runtime packages', async () => {
  const env = createInboxAppEnvironment({
    loadParsersModule: async () => {
      throw new Error('module unavailable')
    },
  })

  await assert.rejects(
    () => env.requireParsers('attachment parsing'),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'runtime_unavailable')
      assert.match(error.message, /attachment parsing/u)
      return true
    },
  )
})

test('journalPromotionEnabled honours explicit dependency overrides', () => {
  assert.equal(createInboxAppEnvironment().journalPromotionEnabled, true)
  assert.equal(
    createInboxAppEnvironment({ loadCoreModule: async () => createCoreModule() })
      .journalPromotionEnabled,
    false,
  )
  assert.equal(
    createInboxAppEnvironment({
      enableJournalPromotion: false,
    }).journalPromotionEnabled,
    false,
  )
  assert.equal(
    createInboxAppEnvironment({
      enableJournalPromotion: true,
      loadCoreModule: async () => createCoreModule(),
    }).journalPromotionEnabled,
    true,
  )
})
