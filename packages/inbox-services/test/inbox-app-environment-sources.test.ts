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
  InboxConnectorConfig,
  InboxRuntimeModule,
  ParsersRuntimeModule,
  PollConnector,
  RuntimeStore,
  TelegramDriver,
} from '../src/inbox-app/types.js'

function createRuntimeStore(): RuntimeStore {
  return {
    claimNextAttachmentParseJob() {
      return null
    },
    close() {},
    completeAttachmentParseJob() {
      return {
        applied: false,
        job: {
          attachmentId: 'attachment-1',
          attempts: 1,
          captureId: 'capture-1',
          createdAt: '2026-04-08T00:00:00.000Z',
          jobId: 'job-1',
          pipeline: 'attachment_text',
          state: 'succeeded',
        },
      }
    },
    failAttachmentParseJob() {
      return {
        applied: false,
        job: {
          attachmentId: 'attachment-1',
          attempts: 1,
          captureId: 'capture-1',
          createdAt: '2026-04-08T00:00:00.000Z',
          jobId: 'job-1',
          pipeline: 'attachment_text',
          state: 'failed',
        },
      }
    },
    getAttachment() {
      return null
    },
    getCapture() {
      return null
    },
    getCursor() {
      return null
    },
    listAttachmentParseJobs() {
      return []
    },
    listCaptures() {
      return []
    },
    requeueAttachmentParseJobs() {
      return 0
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
): PollConnector {
  return {
    async backfill() {
      return null
    },
    capabilities: {
      attachments: true,
      backfill: true,
      watch: true,
      webhooks: false,
    },
    id,
    kind: 'poll',
    source,
    async watch() {},
  }
}

function createTelegramDriver(): TelegramDriver {
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
  }
}

function createInboxRuntimeModule(): InboxRuntimeModule {
  return {
    async createInboxPipeline() {
      throw new Error('not used in this test')
    },
    async createParsedInboxPipeline() {
      throw new Error('not used in this test')
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
      throw new Error('not used in this test')
    },
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
    async compactLegacyParserAttempts() {
      throw new Error('not used in this test')
    },
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
        configPath: path.join(
          input.vaultRoot,
          'derived',
          'inbox',
          'parser-toolchain.json',
        ),
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

test('integrated services reject local Linq connector adds in a temp vault', async () => {
  await withTempVault(async (vault) => {
    const services = createIntegratedInboxServices({
      getEnvironment: () => ({ TELEGRAM_BOT_TOKEN: 'bot-token' }),
      getPlatform: () => 'linux',
      loadInboxModule: async () => createInboxRuntimeModule(),
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

    await assert.rejects(
      () =>
        services.sourceAdd({
          requestId: null,
          vault,
          id: 'linq:primary',
          source: 'linq',
          linqWebhookHost: '127.0.0.1',
          linqWebhookPath: 'webhook',
          linqWebhookPort: 9001,
        }),
      (error: unknown) => {
        assert.ok(error instanceof VaultCliError)
        assert.equal(error.code, 'INBOX_SOURCE_LOCAL_LINQ_REMOVED')
        return true
      },
    )
  })
})

test('source operations reject identifiers outside the current source contract', async () => {
  await withTempVault(async (vault) => {
    const env = createInboxAppEnvironment({
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
          id: 'unsupported:self',
          source: 'unsupported' as never,
        }),
      (error: unknown) => {
        assert.ok(error instanceof VaultCliError)
        assert.equal(error.code, 'INBOX_SOURCE_UNSUPPORTED')
        return true
      },
    )
  })
})
