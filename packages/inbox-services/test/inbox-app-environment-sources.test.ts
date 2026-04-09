import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { createInboxBootstrapDoctorOps } from '../src/inbox-app/bootstrap-doctor.js'
import { createInboxAppEnvironment } from '../src/inbox-app/environment.js'
import { createIntegratedInboxServices } from '../src/inbox-app/service.js'
import { createInboxSourceOps } from '../src/inbox-app/sources.js'
import type {
  AgentmailApiClient,
  EmailDriver,
  InboxRuntimeModule,
  InboxConnectorConfig,
  ParsersRuntimeModule,
  PollConnector,
  RuntimeStore,
  TelegramDriver,
} from '../src/inbox-app/types.js'

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

function createPollConnector(
  source: InboxConnectorConfig['source'],
  id: string,
  webhooks: boolean,
): PollConnector {
  return {
    capabilities: {
      attachments: true,
      backfill: true,
      watch: true,
      webhooks,
    },
    id,
    kind: 'poll',
    source,
  }
}

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

function createAgentmailClient(
  overrides: Partial<AgentmailApiClient> = {},
): AgentmailApiClient {
  return {
    apiKey: 'agentmail-key',
    baseUrl: 'https://agentmail.test',
    async createInbox() {
      throw new Error('not used in this test')
    },
    async downloadUrl() {
      return new Uint8Array()
    },
    async getAttachment() {
      throw new Error('not used in this test')
    },
    async getInbox(inboxId: string) {
      return {
        email: 'agentmail@example.com',
        inbox_id: inboxId,
      }
    },
    async getMessage() {
      throw new Error('not used in this test')
    },
    async getThread() {
      throw new Error('not used in this test')
    },
    async listInboxes() {
      return {
        count: 0,
        inboxes: [],
      }
    },
    async listMessages() {
      return {
        count: 0,
        messages: [],
      }
    },
    async replyToMessage() {
      throw new Error('not used in this test')
    },
    async sendMessage() {
      throw new Error('not used in this test')
    },
    async updateMessage() {
      throw new Error('not used in this test')
    },
    ...overrides,
  }
}

function createInboxRuntimeModule(): InboxRuntimeModule {
  return {
    createAgentmailApiPollDriver(input) {
      return createEmailDriver({
        inboxId: input.inboxId,
      })
    },
    async createInboxPipeline() {
      throw new Error('not used in this test')
    },
    createEmailPollConnector() {
      return createPollConnector('email', 'email:primary', false)
    },
    createLinqWebhookConnector() {
      return createPollConnector('linq', 'linq:primary', true)
    },
    createTelegramBotApiPollDriver() {
      return createTelegramDriver()
    },
    createTelegramPollConnector() {
      return createPollConnector('telegram', 'telegram:bot', false)
    },
    async ensureInboxVault() {},
    async openInboxRuntime() {
      return createRuntimeStore()
    },
    async rebuildRuntimeFromVault() {},
    async runInboxDaemon() {},
    async runInboxDaemonWithParsers() {},
  }
}

function createParserDoctor() {
  return {
    configPath: '/tmp/parser-toolchain.json',
    discoveredAt: '2026-04-08T00:00:00.000Z',
    tools: {
      ffmpeg: {
        available: true,
        command: '/usr/bin/ffmpeg',
        reason: 'configured',
        source: 'config' as const,
      },
      pdftotext: {
        available: true,
        command: '/usr/bin/pdftotext',
        reason: 'configured',
        source: 'config' as const,
      },
      whisper: {
        available: true,
        command: '/usr/bin/whisper',
        modelPath: '/tmp/model.bin',
        reason: 'configured',
        source: 'config' as const,
      },
    },
  }
}

function createParserModule(): ParsersRuntimeModule {
  return {
    async createConfiguredParserRegistry() {
      return {
        doctor: createParserDoctor(),
        ffmpeg: undefined,
        registry: {},
      }
    },
    createInboxParserService() {
      return {
        async drain() {
          return []
        },
      }
    },
    async discoverParserToolchain() {
      return createParserDoctor()
    },
    async writeParserToolchainConfig(input: { vaultRoot: string }) {
      return {
        config: {
          updatedAt: '2026-04-08T00:00:00.000Z',
        },
        configPath: path.join(input.vaultRoot, 'derived', 'inbox', 'parser-toolchain.json'),
      }
    },
  }
}

async function withTempVault<T>(fn: (vault: string) => Promise<T>): Promise<T> {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'murph-inbox-services-'))
  try {
    return await fn(vault)
  } finally {
    await rm(vault, { force: true, recursive: true })
  }
}

test('createInboxAppEnvironment builds an AgentMail client from injected settings', () => {
  const seen: Array<{ apiKey: string; baseUrl?: string; env: NodeJS.ProcessEnv }> = []
  const client = { apiKey: 'client-key', baseUrl: 'https://agentmail.test' } satisfies Partial<AgentmailApiClient>

  const env = createInboxAppEnvironment({
    createAgentmailClient(input) {
      seen.push(input)
      return createAgentmailClient(client)
    },
    getEnvironment: () => ({
      AGENTMAIL_API_KEY: 'env-key',
      AGENTMAIL_BASE_URL: 'https://env-agentmail.test',
    }),
  })

  const configuredClient = env.createConfiguredAgentmailClient('explicit-key')
  assert.equal(configuredClient.apiKey, 'client-key')
  assert.equal(configuredClient.baseUrl, 'https://agentmail.test')
  assert.deepEqual(seen, [
    {
      apiKey: 'explicit-key',
      baseUrl: 'https://env-agentmail.test',
      env: {
        AGENTMAIL_API_KEY: 'env-key',
        AGENTMAIL_BASE_URL: 'https://env-agentmail.test',
      },
    },
  ])
})

test('createInboxAppEnvironment recovers an existing AgentMail inbox after create is forbidden', async () => {
  const env = createInboxAppEnvironment({
    createAgentmailClient() {
      return createAgentmailClient({
        async createInbox() {
          throw new VaultCliError(
            'AGENTMAIL_REQUEST_FAILED',
            'forbidden',
            {
              status: 403,
              method: 'POST',
              path: '/inboxes',
            },
          )
        },
        async getInbox(inboxId: string) {
          return {
            client_id: 'client-1',
            display_name: 'Inbox',
            email: 'agentmail@example.com',
            inbox_id: inboxId,
          }
        },
      })
    },
    getEnvironment: () => ({
      AGENTMAIL_API_KEY: 'agentmail-key',
    }),
  })

  const result = await env.provisionOrRecoverAgentmailInbox({
    preferredAccountId: 'existing-inbox',
    preferredEmailAddress: 'existing@example.com',
  })

  assert.deepEqual(result, {
    accountId: 'existing-inbox',
    emailAddress: 'agentmail@example.com',
    provisionedMailbox: null,
    reusedMailbox: {
      clientId: 'client-1',
      displayName: 'Inbox',
      emailAddress: 'agentmail@example.com',
      inboxId: 'existing-inbox',
      provider: 'agentmail',
    },
  })
})

test('createInboxAppEnvironment throws when Telegram bot token is missing', async () => {
  const env = createInboxAppEnvironment({
    getEnvironment: () => ({}),
    loadInboxModule: async () => createInboxRuntimeModule(),
  })

  await assert.rejects(
    () =>
      env.loadConfiguredTelegramDriver({
        accountId: 'bot',
        enabled: true,
        id: 'telegram:bot',
        options: {},
        source: 'telegram',
      } satisfies InboxConnectorConfig),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'INBOX_TELEGRAM_TOKEN_MISSING')
      return true
    },
  )
})

test('integrated services can init, setup, and manage Linq connectors in a temp vault', async () => {
  await withTempVault(async (vault) => {
    const inboxd = createInboxRuntimeModule()
    const services = createIntegratedInboxServices({
      createAgentmailClient() {
        throw new Error('not used in this test')
      },
      getPlatform: () => 'linux',
      getEnvironment: () => ({
        AGENTMAIL_API_KEY: 'agentmail-key',
        TELEGRAM_BOT_TOKEN: 'bot-token',
      }),
      loadInboxModule: async () => inboxd,
      loadParsersModule: async () => createParserModule(),
    })

    const initResult = await services.init({
      requestId: null,
      vault,
    })
    assert.equal(initResult.vault, vault)
    assert.ok(initResult.createdPaths.includes(initResult.runtimeDirectory))
    assert.ok(initResult.createdPaths.includes(initResult.configPath))
    assert.ok(initResult.createdPaths.includes(initResult.databasePath))

    const setupResult = await services.setup({
      requestId: null,
      vault,
      ffmpegCommand: '/usr/bin/ffmpeg',
    })
    assert.equal(setupResult.vault, vault)
    assert.equal(setupResult.tools.ffmpeg.available, true)
    assert.equal(setupResult.tools.whisper.modelPath, '/tmp/model.bin')

    const added = await services.sourceAdd({
      requestId: null,
      vault,
      id: 'linq:primary',
      source: 'linq',
      linqWebhookHost: '127.0.0.1',
      linqWebhookPath: 'webhook',
      linqWebhookPort: 9001,
    })

    assert.equal(added.connector.options.linqWebhookPath, '/webhook')
    assert.equal(added.connectorCount, 1)

    const listed = await services.sourceList({
      requestId: null,
      vault,
    })
    assert.equal(listed.connectors.length, 1)
    assert.equal(listed.connectors[0]?.id, 'linq:primary')

    await assert.rejects(
      () =>
        services.sourceAdd({
          requestId: null,
          vault,
          id: 'linq:secondary',
          source: 'linq',
          linqWebhookHost: '127.0.0.1',
          linqWebhookPath: '/webhook',
          linqWebhookPort: 9001,
        }),
      (error: unknown) => {
        assert.ok(error instanceof VaultCliError)
        assert.equal(error.code, 'INBOX_LINQ_WEBHOOK_CONFLICT')
        return true
      },
    )

    const disabled = await services.sourceSetEnabled({
      requestId: null,
      vault,
      connectorId: 'linq:primary',
      enabled: false,
    })
    assert.equal(disabled.connector.enabled, false)

    const removed = await services.sourceRemove({
      requestId: null,
      vault,
      connectorId: 'linq:primary',
    })
    assert.equal(removed.removed, true)
    assert.equal(removed.connectorCount, 0)
  })
})

test('source operations reject unsupported iMessage enabling on non-macOS hosts', async () => {
  await withTempVault(async (vault) => {
    const env = createInboxAppEnvironment({
      getPlatform: () => 'linux',
      loadInboxModule: async () => createInboxRuntimeModule(),
    })
    const bootstrap = createInboxBootstrapDoctorOps(env)
    const sources = createInboxSourceOps(env)

    await bootstrap.init({
      requestId: null,
      vault,
    })

    await assert.rejects(
      () =>
        sources.sourceAdd({
          requestId: null,
          vault,
          id: 'imessage:self',
          source: 'imessage',
        }),
      (error: unknown) => {
        assert.ok(error instanceof VaultCliError)
        assert.equal(error.code, 'INBOX_IMESSAGE_UNAVAILABLE')
        return true
      },
    )
  })
})
