import assert from 'node:assert/strict'
import test from 'node:test'

import type { InboxConnectorConfig } from '@murphai/operator-config/inbox-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  createInboxAppEnvironment,
  instantiateConnector,
} from '../src/testing.ts'
import type {
  EmailDriver,
  ImessageDriver,
  InboxImessageRuntimeModule,
  InboxRuntimeModule,
  InboxPipeline,
  PollConnector,
  RuntimeStore,
  TelegramDriver,
} from '../src/index.ts'

function createPollConnector(
  source: InboxConnectorConfig['source'],
  id: string,
): PollConnector {
  return {
    id,
    source,
    kind: 'poll',
    capabilities: {
      attachments: true,
      backfill: true,
      watch: true,
      webhooks: false,
    },
  }
}

function createRuntimeStore(): RuntimeStore {
  return {
    close() {},
    getCapture() {
      return null
    },
    getCursor() {
      return null
    },
    listCaptures() {
      return []
    },
    searchCaptures() {
      return []
    },
    setCursor() {},
  }
}

function createInboxPipeline(): InboxPipeline {
  return {
    close() {},
    async processCapture() {
      return {
        deduped: false,
      }
    },
    runtime: createRuntimeStore(),
  }
}

function createTelegramDriver(): TelegramDriver {
  return {
    async deleteWebhook() {},
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
    async getWebhookInfo() {
      return null
    },
    async startWatching() {},
  }
}

function createEmailDriver(): EmailDriver {
  return {
    inboxId: 'email:primary',
    async downloadAttachment() {
      return null
    },
    async getMessage() {
      return {}
    },
    async getThread() {
      return {}
    },
    async listUnreadMessages() {
      return []
    },
    async markProcessed() {},
  }
}

function createImessageDriver(): ImessageDriver {
  return {
    async getMessages() {
      return []
    },
    async listChats() {
      return []
    },
  }
}

function createInboxRuntimeModule(
  overrides: Partial<InboxRuntimeModule> = {},
): InboxRuntimeModule {
  return {
    createAgentmailApiPollDriver() {
      return createEmailDriver()
    },
    async createInboxPipeline() {
      return createInboxPipeline()
    },
    createEmailPollConnector() {
      return createPollConnector('email', 'email:primary')
    },
    createLinqWebhookConnector() {
      return createPollConnector('linq', 'linq:primary')
    },
    createTelegramBotApiPollDriver() {
      return createTelegramDriver()
    },
    createTelegramPollConnector() {
      return createPollConnector('telegram', 'telegram:bot')
    },
    async ensureInboxVault() {},
    async openInboxRuntime() {
      return createRuntimeStore()
    },
    async rebuildRuntimeFromVault() {},
    async runInboxDaemon() {},
    async runInboxDaemonWithParsers() {},
    ...overrides,
  }
}

function createInboxImessageRuntimeModule(
  overrides: Partial<InboxImessageRuntimeModule> = {},
): InboxImessageRuntimeModule {
  return {
    createImessageConnector() {
      return createPollConnector('imessage', 'imessage:self')
    },
    async loadImessageKitDriver() {
      return createImessageDriver()
    },
    ...overrides,
  }
}

const imessageConnector = {
  accountId: 'self',
  enabled: true,
  id: 'imessage:self',
  options: {
    backfillLimit: 50,
    includeOwnMessages: false,
  },
  source: 'imessage',
} satisfies InboxConnectorConfig

const telegramConnector = {
  accountId: 'bot',
  enabled: true,
  id: 'telegram:bot',
  options: {
    backfillLimit: 10,
  },
  source: 'telegram',
} satisfies InboxConnectorConfig

test('createInboxAppEnvironment prefers an injected iMessage module', async () => {
  let inboxLoads = 0
  let imessageDriverLoads = 0
  const expectedDriver = createImessageDriver()
  const inboxImessageModule = createInboxImessageRuntimeModule({
    async loadImessageKitDriver() {
      imessageDriverLoads += 1
      return expectedDriver
    },
  })

  const env = createInboxAppEnvironment({
    inboxImessageModule,
    loadInboxModule: async () => {
      inboxLoads += 1
      return createInboxRuntimeModule()
    },
  })

  assert.equal(await env.loadInboxImessage(), inboxImessageModule)
  assert.equal(
    await env.loadConfiguredImessageDriver(imessageConnector),
    expectedDriver,
  )
  assert.equal(inboxLoads, 0)
  assert.equal(imessageDriverLoads, 1)
})

test('createInboxAppEnvironment adapts an injected legacy inbox runtime as the iMessage module', async () => {
  const expectedDriver = createImessageDriver()
  const legacyInboxModule = {
    ...createInboxRuntimeModule(),
    ...createInboxImessageRuntimeModule({
      async loadImessageKitDriver() {
        return expectedDriver
      },
    }),
  }

  const env = createInboxAppEnvironment({
    loadInboxModule: async () => legacyInboxModule,
  })

  assert.equal(await env.loadInboxImessage(), legacyInboxModule)
  assert.equal(
    await env.loadConfiguredImessageDriver(imessageConnector),
    expectedDriver,
  )
})

test('createInboxAppEnvironment reports a missing optional iMessage runtime cleanly', async () => {
  const env = createInboxAppEnvironment({
    loadInboxImessageModule: async () => {
      throw new Error('module not found')
    },
  })

  await assert.rejects(
    () => env.loadConfiguredImessageDriver(imessageConnector),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'runtime_unavailable')
      assert.match(error.message, /@murphai\/inboxd-imessage/)
      assert.deepEqual(error.context, {
        cause: 'module not found',
        packages: ['@murphai/inboxd-imessage'],
      })
      return true
    },
  )
})

test('instantiateConnector uses the iMessage module seam without loading inbox core', async () => {
  const expectedDriver = createImessageDriver()
  const expectedConnector = createPollConnector('imessage', 'imessage:self')
  let inboxLoads = 0
  let imessageLoads = 0
  let readyChecks = 0
  let receivedCreateInput:
    | Parameters<InboxImessageRuntimeModule['createImessageConnector']>[0]
    | undefined

  const connector = await instantiateConnector({
    connector: imessageConnector,
    ensureImessageReady: async () => {
      readyChecks += 1
    },
    inputLimit: 12,
    linqWebhookSecret: null,
    loadEmailDriver: async () => createEmailDriver(),
    loadImessageDriver: async () => expectedDriver,
    loadInbox: async () => {
      inboxLoads += 1
      return createInboxRuntimeModule()
    },
    loadInboxImessage: async () => {
      imessageLoads += 1
      return createInboxImessageRuntimeModule({
        createImessageConnector(input) {
          receivedCreateInput = input
          return expectedConnector
        },
      })
    },
    loadTelegramDriver: async () => createTelegramDriver(),
  })

  assert.equal(connector, expectedConnector)
  assert.equal(inboxLoads, 0)
  assert.equal(imessageLoads, 1)
  assert.equal(readyChecks, 1)
  assert.deepEqual(receivedCreateInput, {
    accountId: 'self',
    backfillLimit: 12,
    driver: expectedDriver,
    id: 'imessage:self',
    includeOwnMessages: false,
  })
})

test('instantiateConnector keeps telegram on the inbox core runtime', async () => {
  const expectedDriver = createTelegramDriver()
  const expectedConnector = createPollConnector('telegram', 'telegram:bot')
  let inboxLoads = 0
  let imessageLoads = 0
  let receivedCreateInput:
    | Parameters<InboxRuntimeModule['createTelegramPollConnector']>[0]
    | undefined

  const connector = await instantiateConnector({
    connector: telegramConnector,
    inputLimit: 7,
    linqWebhookSecret: null,
    loadEmailDriver: async () => createEmailDriver(),
    loadImessageDriver: async () => createImessageDriver(),
    loadInbox: async () => {
      inboxLoads += 1
      return createInboxRuntimeModule({
        createTelegramPollConnector(input) {
          receivedCreateInput = input
          return expectedConnector
        },
      })
    },
    loadInboxImessage: async () => {
      imessageLoads += 1
      return createInboxImessageRuntimeModule()
    },
    loadTelegramDriver: async () => expectedDriver,
  })

  assert.equal(connector, expectedConnector)
  assert.equal(inboxLoads, 1)
  assert.equal(imessageLoads, 0)
  assert.deepEqual(receivedCreateInput, {
    accountId: 'bot',
    backfillLimit: 7,
    downloadAttachments: true,
    driver: expectedDriver,
    id: 'telegram:bot',
    transportMode: 'take-over-webhook',
  })
})
