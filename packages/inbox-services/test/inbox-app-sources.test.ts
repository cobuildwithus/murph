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
import type { InboxConnectorConfig } from '../src/inbox-app/types.ts'

function createPaths() {
  return {
    absoluteVaultRoot: '/vault',
    inboxConfigPath: '/vault/.inbox/config.json',
  }
}

function createConfig(connectors: InboxConnectorConfig[] = []) {
  return { connectors: [...connectors] }
}

function createEnv(
  enableAssistantAutoReplyChannel = vi.fn(async () => false),
): Parameters<typeof createInboxSourceOps>[0] {
  return {
    enableAssistantAutoReplyChannel,
    loadInbox: async () => {
      throw new Error('not used in source tests')
    },
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
        id: 'telegram:bot',
        source: 'telegram',
        enabled: true,
        accountId: 'bot',
        options: {},
      },
    ]),
  )

  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () =>
      ops.sourceAdd({
        ...commandContext(),
        id: 'telegram:bot',
        source: 'telegram',
        account: 'bot',
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_SOURCE_EXISTS')
      return true
    },
  )
})

test('sourceAdd rejects unsupported sources outside the current contract', async () => {
  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () =>
      ops.sourceAdd({
        ...commandContext(),
        id: 'unsupported:source',
        source: 'unsupported' as never,
        account: 'custom',
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_SOURCE_UNSUPPORTED')
      return true
    },
  )
})

test('sourceAdd rejects local Linq connector creation', async () => {
  const ops = createInboxSourceOps(createEnv())

  await assert.rejects(
    () =>
      ops.sourceAdd({
        ...commandContext(),
        id: 'linq:primary',
        source: 'linq',
        account: null,
      }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_SOURCE_LOCAL_LINQ_REMOVED')
      return true
    },
  )
})

test('sourceAdd persists normalized Telegram composition and optional auto reply', async () => {
  const enableAssistantAutoReplyChannel = vi.fn(async () => true)
  const config = createConfig()
  readConfigMock.mockResolvedValue(config)

  const ops = createInboxSourceOps(createEnv(enableAssistantAutoReplyChannel))
  const result = await ops.sourceAdd({
    ...commandContext(),
    id: 'telegram:bot',
    source: 'telegram',
    account: null,
    backfillLimit: 25,
    enableAutoReply: true,
  })

  assert.equal(config.connectors.length, 0)
  const writtenConfig = writeConfigMock.mock.calls[0]?.[1]
  assert.deepEqual(writtenConfig?.connectors, [
    {
      id: 'telegram:bot',
      source: 'telegram',
      enabled: true,
      accountId: 'bot',
      options: { backfillLimit: 25 },
    },
  ])
  assert.equal(result.autoReplyEnabled, true)
  assert.deepEqual(enableAssistantAutoReplyChannel.mock.calls[0], [
    '/vault',
    'telegram',
  ])
  assert.equal(sortConnectorsMock.mock.calls.length, 1)
})

test('sourceAdd does not persist when auto reply enablement throws', async () => {
  const config = createConfig()
  readConfigMock.mockResolvedValue(config)
  const ops = createInboxSourceOps(
    createEnv(
      vi.fn(async () => {
        throw new Error('auto reply failed')
      }),
    ),
  )

  await assert.rejects(
    () =>
      ops.sourceAdd({
        ...commandContext(),
        id: 'telegram:bot',
        source: 'telegram',
        enableAutoReply: true,
      }),
    /auto reply failed/,
  )

  assert.equal(config.connectors.length, 0)
  assert.equal(writeConfigMock.mock.calls.length, 0)
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

  const result = await createInboxSourceOps(createEnv()).sourceList(commandContext())

  assert.equal(result.connectors.length, 1)
  assert.equal(result.configPath, '.inbox/config.json')
})

test('sourceRemove deletes the matching connector and rejects unknown ids', async () => {
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

  await assert.rejects(
    () => ops.sourceRemove({ ...commandContext(), connectorId: 'missing' }),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_SOURCE_NOT_FOUND')
      return true
    },
  )

  const result = await ops.sourceRemove({
    ...commandContext(),
    connectorId: 'telegram:bot',
  })
  assert.equal(result.removed, true)
  assert.equal(config.connectors.length, 0)
  assert.equal(writeConfigMock.mock.calls.length, 1)
})

test('sourceSetEnabled updates connector state and rejects unknown ids', async () => {
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

  const result = await ops.sourceSetEnabled({
    ...commandContext(),
    connectorId: 'telegram:bot',
    enabled: true,
  })
  assert.equal(result.connector.enabled, true)
  assert.equal(writeConfigMock.mock.calls.length, 1)
})
