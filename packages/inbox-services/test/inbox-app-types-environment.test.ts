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

vi.mock('@murphai/operator-config/setup-runtime-env', () => ({
  SETUP_RUNTIME_ENV_NOTICE: 'setup runtime env notice',
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
  InboxRuntimeModule,
  TelegramDriver,
} from '../src/inbox-app/types.ts'

function createTelegramDriver(
  overrides: Partial<TelegramDriver> = {},
): TelegramDriver {
  return {
    async downloadFile() {
      return new Uint8Array()
    },
    async getFile() {
      return {}
    },
    async getMe() {
      return {}
    },
    async getMessages() {
      return []
    },
    async startWatching() {},
    ...overrides,
  }
}

function createInboxModule(
  overrides: Partial<InboxRuntimeModule> = {},
): InboxRuntimeModule {
  return {
    async createInboxPipeline() {
      throw new Error('unused')
    },
    async createParsedInboxPipeline() {
      throw new Error('unused')
    },
    createTelegramBotApiPollDriver() {
      return createTelegramDriver()
    },
    createTelegramPollConnector() {
      throw new Error('unused')
    },
    async ensureInboxVault() {},
    async openInboxRuntime() {
      throw new Error('unused')
    },
    async rebuildRuntimeFromVault() {},
    async runInboxDaemon() {},
    async runInboxDaemonWithParsers() {},
    async runInboxEnvelopeMigration() {
      return {
        activeOperationCount: 0,
        blockerCount: 0,
        candidateBytes: 0,
        candidateCount: 0,
        deletedBytes: 0,
        deletedCount: 0,
        hasMore: false,
        hasWork: false,
        mismatchCount: 0,
        missingLedgerCount: 0,
        mode: 'dry-run' as const,
        mutated: false,
        scannedEnvelopeCount: 0,
      }
    },
    async runPollConnectorBackfill() {
      throw new Error('unused')
    },
    ...overrides,
  }
}

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

test('loadConfiguredTelegramDriver prefers an injected driver', async () => {
  const expectedDriver = createTelegramDriver()
  const env = createInboxAppEnvironment({
    loadTelegramDriver: async () => expectedDriver,
  })

  assert.equal(
    await env.loadConfiguredTelegramDriver({
      accountId: 'bot',
      enabled: true,
      id: 'telegram:bot',
      options: {},
      source: 'telegram',
    }),
    expectedDriver,
  )
  assert.equal(env.usesInjectedTelegramDriver, true)
})

test('loadConfiguredTelegramDriver requires a bot token when not injected', async () => {
  const createTelegramBotApiPollDriver = vi.fn(() => createTelegramDriver())
  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ TELEGRAM_BOT_TOKEN: '' }),
    loadInboxModule: async () =>
      createInboxModule({ createTelegramBotApiPollDriver }),
  })

  await assert.rejects(
    () =>
      env.loadConfiguredTelegramDriver({
        accountId: 'bot',
        enabled: true,
        id: 'telegram:bot',
        options: {},
        source: 'telegram',
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_TELEGRAM_TOKEN_MISSING')
      return true
    },
  )
  assert.equal(createTelegramBotApiPollDriver.mock.calls.length, 0)
})

test('loadConfiguredTelegramDriver builds the inboxd driver with shared runtime env values', async () => {
  const expectedDriver = createTelegramDriver()
  const createTelegramBotApiPollDriver = vi.fn((_input: unknown) => expectedDriver)
  resolveTelegramBotTokenMock.mockReturnValue('telegram-token')
  resolveTelegramApiBaseUrlMock.mockReturnValue('https://telegram.example.test/api')
  resolveTelegramFileBaseUrlMock.mockReturnValue('https://telegram.example.test/file')

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ TELEGRAM_BOT_TOKEN: 'telegram-token' }),
    loadInboxModule: async () =>
      createInboxModule({ createTelegramBotApiPollDriver }),
  })

  assert.equal(
    await env.loadConfiguredTelegramDriver({
      accountId: 'bot',
      enabled: true,
      id: 'telegram:bot',
      options: {},
      source: 'telegram',
    }),
    expectedDriver,
  )
  assert.deepEqual(createTelegramBotApiPollDriver.mock.calls[0]?.[0], {
    apiBaseUrl: 'https://telegram.example.test/api',
    fileBaseUrl: 'https://telegram.example.test/file',
    token: 'telegram-token',
  })
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
