import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const {
  createAgentmailApiClientMock,
  listAllAgentmailInboxesMock,
  matchesAgentmailHttpErrorMock,
  resolveAgentmailApiKeyMock,
  resolveAgentmailBaseUrlMock,
  resolveTelegramApiBaseUrlMock,
  resolveTelegramBotTokenMock,
  resolveTelegramFileBaseUrlMock,
  loadQueryRuntimeMock,
  loadRuntimeModuleMock,
} = vi.hoisted(() => ({
  createAgentmailApiClientMock: vi.fn(),
  listAllAgentmailInboxesMock: vi.fn(),
  matchesAgentmailHttpErrorMock: vi.fn(),
  resolveAgentmailApiKeyMock: vi.fn(),
  resolveAgentmailBaseUrlMock: vi.fn(),
  resolveTelegramApiBaseUrlMock: vi.fn(),
  resolveTelegramBotTokenMock: vi.fn(),
  resolveTelegramFileBaseUrlMock: vi.fn(),
  loadQueryRuntimeMock: vi.fn(),
  loadRuntimeModuleMock: vi.fn(),
}))

vi.mock('@murphai/operator-config/agentmail-runtime', () => ({
  createAgentmailApiClient: createAgentmailApiClientMock,
  listAllAgentmailInboxes: listAllAgentmailInboxesMock,
  matchesAgentmailHttpError: matchesAgentmailHttpErrorMock,
  resolveAgentmailApiKey: resolveAgentmailApiKeyMock,
  resolveAgentmailBaseUrl: resolveAgentmailBaseUrlMock,
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

import {
  createInboxAppEnvironment,
} from '../src/inbox-app/environment.ts'
import type {
  CoreRuntimeModule,
  EmailDriver,
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

function createEmailDriver(
  overrides: Partial<EmailDriver> = {},
): EmailDriver {
  return {
    async downloadAttachment() {
      return null
    },
    inboxId: 'mailbox-1',
    async listUnreadMessages() {
      return []
    },
    async markProcessed() {},
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
    createAgentmailApiPollDriver() {
      return createEmailDriver()
    },
    createEmailPollConnector() {
      throw new Error('unused')
    },
    createLinqWebhookConnector() {
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
  createAgentmailApiClientMock.mockReset()
  listAllAgentmailInboxesMock.mockReset()
  matchesAgentmailHttpErrorMock.mockReset()
  resolveAgentmailApiKeyMock.mockReset()
  resolveAgentmailBaseUrlMock.mockReset()
  resolveTelegramApiBaseUrlMock.mockReset()
  resolveTelegramBotTokenMock.mockReset()
  resolveTelegramFileBaseUrlMock.mockReset()
  loadQueryRuntimeMock.mockReset()
  loadRuntimeModuleMock.mockReset()

  resolveAgentmailApiKeyMock.mockReturnValue(null)
  resolveAgentmailBaseUrlMock.mockReturnValue(null)
  resolveTelegramApiBaseUrlMock.mockReturnValue(null)
  resolveTelegramBotTokenMock.mockReturnValue(null)
  resolveTelegramFileBaseUrlMock.mockReturnValue(null)
  matchesAgentmailHttpErrorMock.mockReturnValue(false)
  loadQueryRuntimeMock.mockResolvedValue({ kind: 'query-runtime' })
  loadRuntimeModuleMock.mockImplementation(async (specifier: string) => ({
    specifier,
  }))
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
  const createTelegramBotApiPollDriver = vi.fn(
    (input: { token: string; apiBaseUrl?: string; fileBaseUrl?: string }) =>
      createTelegramDriver(),
  )
  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ TELEGRAM_BOT_TOKEN: '' }),
    loadInboxModule: async () => createInboxModule({
      createTelegramBotApiPollDriver,
    }),
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
  const createTelegramBotApiPollDriver = vi.fn(
    (input: { token: string; apiBaseUrl?: string; fileBaseUrl?: string }) => expectedDriver,
  )
  resolveTelegramBotTokenMock.mockReturnValue('telegram-token')
  resolveTelegramApiBaseUrlMock.mockReturnValue('https://telegram.example/api')
  resolveTelegramFileBaseUrlMock.mockReturnValue('https://telegram.example/file')

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ TELEGRAM_BOT_TOKEN: 'telegram-token' }),
    loadInboxModule: async () => createInboxModule({
      createTelegramBotApiPollDriver,
    }),
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
    token: 'telegram-token',
    apiBaseUrl: 'https://telegram.example/api',
    fileBaseUrl: 'https://telegram.example/file',
  })
})

test('createConfiguredAgentmailClient prefers explicit api keys over env resolution', () => {
  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'explicit-key',
    baseUrl: 'https://agentmail.example',
  })
  resolveAgentmailApiKeyMock.mockReturnValue('env-key')
  resolveAgentmailBaseUrlMock.mockReturnValue('https://agentmail.example')

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  assert.deepEqual(env.createConfiguredAgentmailClient('explicit-key'), {
    apiKey: 'explicit-key',
    baseUrl: 'https://agentmail.example',
  })
  assert.deepEqual(createAgentmailApiClientMock.mock.calls[0], [
    'explicit-key',
    { baseUrl: 'https://agentmail.example' },
  ])
})

test('createConfiguredAgentmailClient throws when no api key is available', () => {
  const env = createInboxAppEnvironment({
    getEnvironment: () => ({}),
  })

  assert.throws(
    () => env.createConfiguredAgentmailClient(),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_EMAIL_API_KEY_MISSING')
      return true
    },
  )
})

test('loadConfiguredEmailDriver requires an account id when not injected', async () => {
  const env = createInboxAppEnvironment()

  await assert.rejects(
    () =>
      env.loadConfiguredEmailDriver({
        accountId: '   ',
        enabled: true,
        id: 'email:primary',
        options: {},
        source: 'email',
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_EMAIL_ACCOUNT_REQUIRED')
      return true
    },
  )
})

test('loadConfiguredEmailDriver resolves the inbox address and creates the driver', async () => {
  const getInbox = vi.fn(async () => ({
    email: 'user@example.com',
  }))
  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: 'https://agentmail.example',
    getInbox,
  })
  resolveAgentmailApiKeyMock.mockReturnValue('env-key')
  resolveAgentmailBaseUrlMock.mockReturnValue('https://agentmail.example')

  const expectedDriver = createEmailDriver()
  const createAgentmailApiPollDriver = vi.fn(
    (input: { apiKey: string; inboxId: string; baseUrl?: string }) => expectedDriver,
  )
  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
    loadInboxModule: async () => createInboxModule({
      createAgentmailApiPollDriver,
    }),
  })

  assert.equal(
    await env.loadConfiguredEmailDriver({
      accountId: 'mailbox-1',
      enabled: true,
      id: 'email:primary',
      options: {},
      source: 'email',
    }),
    expectedDriver,
  )
  assert.deepEqual(createAgentmailApiPollDriver.mock.calls[0]?.[0], {
    apiKey: 'env-key',
    inboxId: 'mailbox-1',
    baseUrl: 'https://agentmail.example',
  })
})

test('tryResolveAgentmailInboxAddress falls back to the input email on inbox lookup errors', async () => {
  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: null,
    getInbox: vi.fn(async () => {
      throw new Error('lookup failed')
    }),
  })
  resolveAgentmailApiKeyMock.mockReturnValue('env-key')

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  assert.equal(
    await env.tryResolveAgentmailInboxAddress({
      accountId: 'mailbox-1',
      emailAddress: null,
    }),
    null,
  )
  assert.equal(
    await env.tryResolveAgentmailInboxAddress({
      accountId: 'mailbox-1',
      emailAddress: 'known@example.com',
    }),
    'known@example.com',
  )
})

test('provisionOrRecoverAgentmailInbox returns a newly created mailbox when create succeeds', async () => {
  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: 'https://agentmail.example',
    createInbox: vi.fn(async () => ({
      inbox_id: 'mailbox-1',
      email: 'user@example.com',
      display_name: 'Inbox User',
      client_id: 'client-1',
    })),
  })
  resolveAgentmailApiKeyMock.mockReturnValue('env-key')

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  assert.deepEqual(
    await env.provisionOrRecoverAgentmailInbox({
      displayName: 'Inbox User',
      username: 'user',
      domain: 'example.com',
      clientId: 'client-1',
    }),
    {
      accountId: 'mailbox-1',
      emailAddress: 'user@example.com',
      provisionedMailbox: {
        inboxId: 'mailbox-1',
        clientId: 'client-1',
        displayName: 'Inbox User',
        emailAddress: 'user@example.com',
        provider: 'agentmail',
      },
      reusedMailbox: null,
    },
  )
})

test('provisionOrRecoverAgentmailInbox recovers a preferred mailbox after a forbidden create', async () => {
  const createInboxError = new Error('forbidden')
  const getInbox = vi.fn(async () => ({
    inbox_id: 'mailbox-2',
    email: 'existing@example.com',
    display_name: 'Existing Inbox',
    client_id: 'client-2',
  }))

  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: 'https://agentmail.example',
    createInbox: vi.fn(async () => {
      throw createInboxError
    }),
    getInbox,
  })
  resolveAgentmailApiKeyMock.mockReturnValue('env-key')
  matchesAgentmailHttpErrorMock.mockImplementation((error, match) =>
    error === createInboxError &&
    match.status === 403 &&
    match.method === 'POST' &&
    match.path === '/inboxes',
  )

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  assert.deepEqual(
    await env.provisionOrRecoverAgentmailInbox({
      preferredAccountId: 'mailbox-2',
      preferredEmailAddress: 'preferred@example.com',
    }),
    {
      accountId: 'mailbox-2',
      emailAddress: 'existing@example.com',
      provisionedMailbox: null,
      reusedMailbox: {
        inboxId: 'mailbox-2',
        clientId: 'client-2',
        displayName: 'Existing Inbox',
        emailAddress: 'existing@example.com',
        provider: 'agentmail',
      },
    },
  )
})

test('provisionOrRecoverAgentmailInbox requires explicit selection when discovery returns many inboxes', async () => {
  const createInboxError = new Error('forbidden')
  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: 'https://agentmail.example',
    createInbox: vi.fn(async () => {
      throw createInboxError
    }),
  })
  resolveAgentmailApiKeyMock.mockReturnValue('env-key')
  matchesAgentmailHttpErrorMock.mockImplementation((error, match) =>
    error === createInboxError &&
    match.status === 403 &&
    match.method === 'POST' &&
    match.path === '/inboxes',
  )
  listAllAgentmailInboxesMock.mockResolvedValue([
    { inbox_id: 'mailbox-1', email: 'one@example.com' },
    { inbox_id: 'mailbox-2', email: 'two@example.com' },
  ])

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  await assert.rejects(
    () => env.provisionOrRecoverAgentmailInbox({}),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_EMAIL_ACCOUNT_SELECTION_REQUIRED')
      return true
    },
  )
})

test('provisionOrRecoverAgentmailInbox surfaces a scoped-key error when discovery is also forbidden', async () => {
  const createInboxError = new Error('forbidden-create')
  const listInboxesError = new Error('forbidden-list')

  createAgentmailApiClientMock.mockReturnValue({
    apiKey: 'env-key',
    baseUrl: 'https://agentmail.example',
    createInbox: vi.fn(async () => {
      throw createInboxError
    }),
  })
  resolveAgentmailApiKeyMock.mockReturnValue('env-key')
  matchesAgentmailHttpErrorMock.mockImplementation((error, match) =>
    (error === createInboxError &&
      match.status === 403 &&
      match.method === 'POST' &&
      match.path === '/inboxes') ||
    (error === listInboxesError &&
      match.status === 403 &&
      match.method === 'GET' &&
      match.path === '/inboxes'),
  )
  listAllAgentmailInboxesMock.mockRejectedValue(listInboxesError)

  const env = createInboxAppEnvironment({
    getEnvironment: () => ({ AGENTMAIL_API_KEY: 'env-key' }),
  })

  await assert.rejects(
    () => env.provisionOrRecoverAgentmailInbox({}),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_EMAIL_SCOPED_KEY_ACCOUNT_REQUIRED')
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
