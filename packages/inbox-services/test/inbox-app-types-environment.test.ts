import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const {
  loadQueryRuntimeMock,
  loadRuntimeModuleMock,
  resolveTelegramApiBaseUrlMock,
  resolveTelegramBotTokenMock,
  resolveTelegramFileBaseUrlMock,
} = vi.hoisted(() => ({
  loadQueryRuntimeMock: vi.fn(),
  loadRuntimeModuleMock: vi.fn(),
  resolveTelegramApiBaseUrlMock: vi.fn(),
  resolveTelegramBotTokenMock: vi.fn(),
  resolveTelegramFileBaseUrlMock: vi.fn(),
}))


vi.mock('@murphai/operator-config/telegram-runtime', () => ({
  resolveTelegramApiBaseUrl: resolveTelegramApiBaseUrlMock,
  resolveTelegramBotToken: resolveTelegramBotTokenMock,
  resolveTelegramFileBaseUrl: resolveTelegramFileBaseUrlMock,
}))

vi.mock('@murphai/vault-usecases/runtime', () => ({
  loadQueryRuntime: loadQueryRuntimeMock,
}))

vi.mock('../src/runtime-import.ts', () => ({
  loadRuntimeModule: loadRuntimeModuleMock,
}))

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

beforeEach(() => {
  loadQueryRuntimeMock.mockReset()
  loadRuntimeModuleMock.mockReset()
  resolveTelegramApiBaseUrlMock.mockReset()
  resolveTelegramBotTokenMock.mockReset()
  resolveTelegramFileBaseUrlMock.mockReset()

  loadQueryRuntimeMock.mockResolvedValue({ kind: 'query-runtime' })
  loadRuntimeModuleMock.mockImplementation(async (specifier: string) => ({
    specifier,
  }))
  resolveTelegramApiBaseUrlMock.mockReturnValue(null)
  resolveTelegramBotTokenMock.mockReturnValue(null)
  resolveTelegramFileBaseUrlMock.mockReturnValue(null)
})

test('createInboxAppEnvironment exposes runtime loaders and helper defaults', async () => {
  const env = createInboxAppEnvironment()

  assert.equal(env.journalPromotionEnabled, true)
  assert.deepEqual(await env.loadCore(), { specifier: '@murphai/core' })
  assert.deepEqual(await env.loadImporters(), { specifier: '@murphai/importers' })
  assert.deepEqual(await env.loadInbox(), { specifier: '@murphai/inboxd' })
  assert.deepEqual(await env.loadParsers(), { specifier: '@murphai/parsers' })
  assert.deepEqual(await env.loadQuery(), { kind: 'query-runtime' })
})

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
