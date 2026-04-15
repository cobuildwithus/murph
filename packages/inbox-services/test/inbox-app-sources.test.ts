import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const {
  ensureConnectorNamespaceAvailableMock,
  ensureInitializedMock,
  readConfigMock,
  sortConnectorsMock,
  writeConfigMock,
} = vi.hoisted(() => ({
  ensureConnectorNamespaceAvailableMock: vi.fn(),
  ensureInitializedMock: vi.fn(),
  readConfigMock: vi.fn(),
  sortConnectorsMock: vi.fn(),
  writeConfigMock: vi.fn(),
}))

vi.mock('../src/inbox-services/state.ts', () => ({
  ensureConnectorNamespaceAvailable: ensureConnectorNamespaceAvailableMock,
  ensureInitialized: ensureInitializedMock,
  readConfig: readConfigMock,
  sortConnectors: sortConnectorsMock,
  writeConfig: writeConfigMock,
}))

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { createInboxSourceOps } from '../src/inbox-app/sources.ts'
import type {
  InboxAppEnvironment,
  InboxConnectorConfig,
} from '../src/inbox-app/types.ts'

function createPaths() {
  return {
    absoluteVaultRoot: '/vault',
    inboxConfigPath: '/vault/.inbox/config.json',
  }
}

function createConfig(connectors: InboxConnectorConfig[] = []) {
  return {
    connectors: [...connectors],
  }
}

function createEnv(
  overrides: Partial<InboxAppEnvironment> = {},
): InboxAppEnvironment {
  return {
    clock: () => new Date('2026-04-08T00:00:00.000Z'),
    createConfiguredAgentmailClient() {
      throw new Error('not used in source tests')
    },
    enableAssistantAutoReplyChannel: vi.fn(
      async (_vault: string, _channel: InboxConnectorConfig['source']) => false,
    ),
    getEnvironment: () => ({}),
    getHomeDirectory: () => '/tmp',
    getPid: () => 123,
    getPlatform: () => 'darwin',
    journalPromotionEnabled: true,
    killProcess() {},
    loadCore: async () => {
      throw new Error('not used in source tests')
    },
    loadConfiguredEmailDriver: async () => {
      throw new Error('not used in source tests')
    },
    loadConfiguredTelegramDriver: async () => {
      throw new Error('not used in source tests')
    },
    loadImporters: async () => {
      throw new Error('not used in source tests')
    },
    loadInbox: async () => {
      throw new Error('not used in source tests')
    },
    loadParsers: async () => {
      throw new Error('not used in source tests')
    },
    loadQuery: async () => {
      throw new Error('not used in source tests')
    },
    provisionOrRecoverAgentmailInbox: async () => ({
      accountId: 'mailbox-1',
      emailAddress: 'user@example.com',
      provisionedMailbox: {
        inboxId: 'mailbox-1',
        emailAddress: 'user@example.com',
        displayName: null,
        clientId: null,
        provider: 'agentmail',
      },
      reusedMailbox: null,
    }),
    requireParsers: async () => {
      throw new Error('not used in source tests')
    },
    sleep: async () => undefined,
    tryResolveAgentmailInboxAddress: async ({
      emailAddress,
    }: {
      emailAddress: string | null
    }) => emailAddress ?? 'resolved@example.com',
    usesInjectedEmailDriver: false,
    usesInjectedTelegramDriver: false,
    ...overrides,
  }
}

function commandContext() {
  return {
    requestId: null,
    vault: '/vault',
  }
}

beforeEach(() => {
  ensureConnectorNamespaceAvailableMock.mockReset()
  ensureInitializedMock.mockReset()
  readConfigMock.mockReset()
  sortConnectorsMock.mockReset()
  writeConfigMock.mockReset()

  ensureInitializedMock.mockResolvedValue(createPaths())
  readConfigMock.mockResolvedValue(createConfig())
})

test('sourceAdd rejects duplicate connector ids', async () => {
  readConfigMock.mockResolvedValue(
    createConfig([
      {
        id: 'email:primary',
        source: 'email',
        enabled: true,
        accountId: 'mailbox-1',
        options: {},
      },
    ]),
  )

  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () =>
      ops.sourceAdd({
        ...commandContext(),
        id: 'email:primary',
        source: 'email',
        account: 'mailbox-2',
        address: null,
        backfillLimit: undefined,
        provision: false,
        enableAutoReply: false,
        includeOwn: false,
        linqWebhookHost: null,
        linqWebhookPath: null,
        linqWebhookPort: undefined,
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_SOURCE_EXISTS')
      return true
    },
  )
})

test('sourceAdd rejects unsupported sources outside the current runtime contract', async () => {
  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () =>
      ops.sourceAdd({
        ...commandContext(),
        id: 'unsupported:source',
        source: 'unsupported' as never,
        account: 'custom',
        address: null,
        backfillLimit: undefined,
        provision: false,
        enableAutoReply: false,
        includeOwn: false,
        linqWebhookHost: null,
        linqWebhookPath: null,
        linqWebhookPort: undefined,
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_SOURCE_UNSUPPORTED')
      return true
    },
  )
})

test('sourceAdd requires an email account when provisioning is disabled', async () => {
  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () =>
      ops.sourceAdd({
        ...commandContext(),
        id: 'email:primary',
        source: 'email',
        account: '   ',
        address: null,
        backfillLimit: undefined,
        provision: false,
        enableAutoReply: false,
        includeOwn: false,
        linqWebhookHost: null,
        linqWebhookPath: null,
        linqWebhookPort: undefined,
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_EMAIL_ACCOUNT_REQUIRED')
      return true
    },
  )
})

test('sourceAdd rejects conflicting Linq webhook endpoints', async () => {
  readConfigMock.mockResolvedValue(
    createConfig([
      {
        id: 'linq:primary',
        source: 'linq',
        enabled: true,
        accountId: null,
        options: {
          linqWebhookHost: '0.0.0.0',
          linqWebhookPath: '/linq-webhook',
          linqWebhookPort: 8789,
        },
      },
    ]),
  )

  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () =>
      ops.sourceAdd({
        ...commandContext(),
        id: 'linq:secondary',
        source: 'linq',
        account: null,
        address: null,
        backfillLimit: undefined,
        provision: false,
        enableAutoReply: false,
        includeOwn: false,
        linqWebhookHost: '0.0.0.0',
        linqWebhookPath: 'linq-webhook',
        linqWebhookPort: 8789,
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_LINQ_WEBHOOK_CONFLICT')
      return true
    },
  )
})

test('sourceAdd provisions email connectors and enables auto reply when requested', async () => {
  const enableAssistantAutoReplyChannel = vi.fn(
    async (_vault: string, _channel: InboxConnectorConfig['source']) => true,
  )
  const provisionOrRecoverAgentmailInbox = vi.fn(async () => ({
    accountId: 'mailbox-9',
    emailAddress: 'provisioned@example.com',
    provisionedMailbox: {
      inboxId: 'mailbox-9',
      emailAddress: 'provisioned@example.com',
      displayName: 'Provisioned Inbox',
      clientId: 'client-9',
      provider: 'agentmail' as const,
    },
    reusedMailbox: null,
  }))
  const tryResolveAgentmailInboxAddress = vi.fn(async () => 'resolved@example.com')
  const config = createConfig()
  readConfigMock.mockResolvedValue(config)

  const ops = createInboxSourceOps(
    createEnv({
      provisionOrRecoverAgentmailInbox,
      tryResolveAgentmailInboxAddress,
      enableAssistantAutoReplyChannel,
    }),
  )

  const result = await ops.sourceAdd({
    ...commandContext(),
    id: 'email:primary',
    source: 'email',
    account: null,
    address: null,
    backfillLimit: 25,
    provision: true,
    enableAutoReply: true,
    includeOwn: false,
    emailClientId: 'client-9',
    emailDisplayName: 'Provisioned Inbox',
    emailDomain: 'example.com',
    emailUsername: 'user',
    linqWebhookHost: null,
    linqWebhookPath: null,
    linqWebhookPort: undefined,
  })

  assert.equal(config.connectors.length, 1)
  assert.equal(config.connectors[0]?.id, 'email:primary')
  assert.equal(config.connectors[0]?.accountId, 'mailbox-9')
  assert.equal(config.connectors[0]?.options.emailAddress, 'resolved@example.com')
  assert.equal(result.autoReplyEnabled, true)
  assert.equal(enableAssistantAutoReplyChannel.mock.calls[0]?.[1], 'email')
  assert.equal(sortConnectorsMock.mock.calls.length, 1)
  assert.equal(writeConfigMock.mock.calls.length, 1)
})

test('sourceAdd normalizes Linq webhook settings before writing config', async () => {
  const config = createConfig()
  readConfigMock.mockResolvedValue(config)
  const ops = createInboxSourceOps(createEnv())

  const result = await ops.sourceAdd({
    ...commandContext(),
    id: 'linq:primary',
    source: 'linq',
    account: null,
    address: null,
    backfillLimit: 10,
    provision: false,
    enableAutoReply: false,
    includeOwn: false,
    linqWebhookHost: null,
    linqWebhookPath: 'hook',
    linqWebhookPort: 9000,
  })

  assert.equal(result.connector.options.linqWebhookHost, undefined)
  assert.equal(result.connector.options.linqWebhookPath, '/hook')
  assert.equal(result.connector.options.linqWebhookPort, 9000)
})

test('sourceList returns the current config connectors', async () => {
  readConfigMock.mockResolvedValue(
    createConfig([
      {
        id: 'telegram:bot',
        source: 'telegram',
        enabled: true,
        accountId: 'bot',
        options: {},
      },
    ]),
  )

  const ops = createInboxSourceOps(createEnv())
  const result = await ops.sourceList(commandContext())

  assert.equal(result.connectors.length, 1)
  assert.equal(result.configPath, '.inbox/config.json')
})

test('sourceRemove rejects unknown connector ids', async () => {
  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () => ops.sourceRemove({ ...commandContext(), connectorId: 'missing' }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_SOURCE_NOT_FOUND')
      return true
    },
  )
})

test('sourceRemove deletes the matching connector and writes config', async () => {
  const config = createConfig([
    {
      id: 'telegram:bot',
      source: 'telegram',
      enabled: true,
      accountId: 'bot',
      options: {},
    },
  ])
  readConfigMock.mockResolvedValue(config)

  const ops = createInboxSourceOps(createEnv())
  const result = await ops.sourceRemove({
    ...commandContext(),
    connectorId: 'telegram:bot',
  })

  assert.equal(config.connectors.length, 0)
  assert.equal(result.removed, true)
  assert.equal(writeConfigMock.mock.calls.length, 1)
})

test('sourceSetEnabled rejects unknown connector ids', async () => {
  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () =>
      ops.sourceSetEnabled({
        ...commandContext(),
        connectorId: 'missing',
        enabled: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_SOURCE_NOT_FOUND')
      return true
    },
  )
})

test('sourceSetEnabled updates connector state and persists config', async () => {
  const config = createConfig([
    {
      id: 'telegram:bot',
      source: 'telegram',
      enabled: false,
      accountId: 'bot',
      options: {},
    },
  ])
  readConfigMock.mockResolvedValue(config)

  const ops = createInboxSourceOps(createEnv())
  const result = await ops.sourceSetEnabled({
    ...commandContext(),
    connectorId: 'telegram:bot',
    enabled: true,
  })

  assert.equal(config.connectors[0]?.enabled, true)
  assert.equal(result.connector.enabled, true)
  assert.equal(writeConfigMock.mock.calls.length, 1)
})
