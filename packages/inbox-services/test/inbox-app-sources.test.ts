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

function createPaths() {
  return {
    absoluteVaultRoot: '/vault',
    inboxConfigPath: '/vault/.inbox/config.json',
  }
}

function createConfig(connectors: Array<Record<string, unknown>> = []) {
  return {
    connectors: [...connectors],
  }
}

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    getPlatform: () => 'darwin',
    loadInbox: async () => ({ kind: 'inboxd' }),
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
    tryResolveAgentmailInboxAddress: async ({
      emailAddress,
    }: {
      emailAddress: string | null
    }) => emailAddress ?? 'resolved@example.com',
    enableAssistantAutoReplyChannel: vi.fn(async () => undefined),
    ...overrides,
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
        vault: '/vault',
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

test('sourceAdd blocks iMessage on non-macOS hosts', async () => {
  const ops = createInboxSourceOps(
    createEnv({
      getPlatform: () => 'linux',
    }),
  )

  await assert.rejects(
    () =>
      ops.sourceAdd({
        vault: '/vault',
        id: 'imessage:self',
        source: 'imessage',
        account: 'self',
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
      assert.equal(error.code, 'INBOX_IMESSAGE_UNAVAILABLE')
      return true
    },
  )
})

test('sourceAdd requires an email account when provisioning is disabled', async () => {
  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () =>
      ops.sourceAdd({
        vault: '/vault',
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
        vault: '/vault',
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
  const enableAssistantAutoReplyChannel = vi.fn(async () => undefined)
  const provisionOrRecoverAgentmailInbox = vi.fn(async () => ({
    accountId: 'mailbox-9',
    emailAddress: 'provisioned@example.com',
    provisionedMailbox: {
      inboxId: 'mailbox-9',
      emailAddress: 'provisioned@example.com',
      displayName: 'Provisioned Inbox',
      clientId: 'client-9',
      provider: 'agentmail',
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
    vault: '/vault',
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
    vault: '/vault',
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
  const result = await ops.sourceList({ vault: '/vault' })

  assert.equal(result.connectors.length, 1)
  assert.equal(result.configPath, '.inbox/config.json')
})

test('sourceRemove rejects unknown connector ids', async () => {
  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () => ops.sourceRemove({ vault: '/vault', connectorId: 'missing' }),
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
    vault: '/vault',
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
        vault: '/vault',
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

test('sourceSetEnabled blocks enabling iMessage on unsupported hosts', async () => {
  readConfigMock.mockResolvedValue(
    createConfig([
      {
        id: 'imessage:self',
        source: 'imessage',
        enabled: false,
        accountId: 'self',
        options: {},
      },
    ]),
  )
  const ops = createInboxSourceOps(
    createEnv({
      getPlatform: () => 'linux',
    }),
  )

  await assert.rejects(
    () =>
      ops.sourceSetEnabled({
        vault: '/vault',
        connectorId: 'imessage:self',
        enabled: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_IMESSAGE_UNAVAILABLE')
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
    vault: '/vault',
    connectorId: 'telegram:bot',
    enabled: true,
  })

  assert.equal(config.connectors[0]?.enabled, true)
  assert.equal(result.connector.enabled, true)
  assert.equal(writeConfigMock.mock.calls.length, 1)
})
