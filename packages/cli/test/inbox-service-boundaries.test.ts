import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createVersionedJsonStateEnvelope,
  parseVersionedJsonStateEnvelope,
  resolveRuntimePaths,
} from '@murphai/runtime-state/node'
import { test } from 'vitest'
import type {
  EmailDriver,
  InboxRuntimeModule,
  PollConnector,
  TelegramDriver,
} from '@murphai/inbox-services'
import {
  instantiateConnector,
  normalizeDaemonState,
  readPromotionsByCapture,
} from '@murphai/inbox-services/testing'

test('instantiateConnector rejects local Linq connectors', async () => {
  await assert.rejects(
    () =>
      instantiateConnector({
        connector: {
          id: 'linq:default',
          source: 'linq',
          enabled: true,
          accountId: 'default',
          options: {
            linqWebhookHost: '127.0.0.1',
            linqWebhookPath: '/hooks/linq',
            linqWebhookPort: 9911,
          },
        },
        async loadInbox() {
          return createStubInboxRuntimeModule()
        },
        async loadTelegramDriver() {
          throw new Error('unreachable')
        },
      }),
    /Unsupported inbox connector source: linq/u,
  )
})

test('instantiateConnector fails closed for unsupported Linq connectors before loading factories', async () => {
  await assert.rejects(
    () =>
      instantiateConnector({
        connector: {
          id: 'linq:default',
          source: 'linq',
          enabled: true,
          accountId: 'default',
          options: {
            linqWebhookHost: '127.0.0.1',
            linqWebhookPath: '/hooks/linq',
            linqWebhookPort: 9911,
          },
        },
        async loadInbox() {
          return createStubInboxRuntimeModule()
        },
        async loadTelegramDriver() {
          throw new Error('unreachable')
        },
      }),
    /Unsupported inbox connector source: linq/u,
  )
})

test('instantiateConnector delegates Telegram polling through the explicit takeover transport mode', async () => {
  type TelegramConnectorOptions = {
    accountId?: string | null
    backfillLimit?: number
    downloadAttachments?: boolean
    id?: string
    transportMode?: 'take-over-webhook' | 'require-no-webhook'
  }
  let received: TelegramConnectorOptions | null = null

  const connector = await instantiateConnector({
    connector: {
      id: 'telegram:bot',
      source: 'telegram',
      enabled: true,
      accountId: null,
      options: {
        backfillLimit: 42,
      },
    },
    inputLimit: 7,
    async loadInbox() {
      return createStubInboxRuntimeModule({
        createTelegramPollConnector: (options: {
          accountId?: string | null
          backfillLimit?: number
          downloadAttachments?: boolean
          id?: string
          transportMode?: 'take-over-webhook' | 'require-no-webhook'
        }) => {
          received = options
          return {
            async backfill() {
              return null
            },
            id: options.id ?? 'telegram:bot',
            source: 'telegram',
            kind: 'poll',
            capabilities: {
              attachments: true,
              backfill: true,
              ownMessages: true,
              watch: true,
              webhooks: false,
            },
            async watch() {},
          }
        },
      })
    },
    async loadTelegramDriver() {
      return createUnreachableTelegramDriver()
    },
  })

  assert.equal(connector.id, 'telegram:bot')
  if (received == null) {
    throw new Error('expected Telegram connector options to be captured')
  }
  const captured: TelegramConnectorOptions = received
  assert.equal(captured.accountId, 'bot')
  assert.equal(captured.backfillLimit, 7)
  assert.equal(captured.downloadAttachments, true)
  assert.equal(captured.id, 'telegram:bot')
  assert.equal(captured.transportMode, 'take-over-webhook')
})

test.sequential('normalizeDaemonState rewrites stale daemon state records', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-daemon-'))

  try {
    const paths = resolveRuntimePaths(vaultRoot)
    await mkdir(path.dirname(paths.inboxStatePath), { recursive: true })
    await writeFile(
      paths.inboxStatePath,
      `${JSON.stringify(
        createVersionedJsonStateEnvelope({
          schema: 'murph.inbox-daemon-state.v1',
          schemaVersion: 1,
          value: {
            running: true,
            stale: false,
            pid: 4242,
            startedAt: '2026-03-18T12:00:00.000Z',
            stoppedAt: null,
            status: 'running',
            connectorIds: ['telegram:bot'],
            message: null,
            statePath: '.runtime/operations/inbox/state.json',
            configPath: '.runtime/operations/inbox/config.json',
            databasePath: '.runtime/projections/inboxd.sqlite',
          },
        }),
        null,
        2,
      )}\n`,
      'utf8',
    )

    const state = await normalizeDaemonState(paths, {
      clock: () => new Date('2026-03-18T12:34:56.000Z'),
      getPid: () => 9999,
      killProcess() {
        const error = Object.assign(new Error('missing'), { code: 'ESRCH' })
        throw error
      },
    })

    assert.equal(state.running, false)
    assert.equal(state.stale, true)
    assert.equal(state.status, 'stale')
    assert.equal(
      state.message,
      'Stale daemon state found; recorded PID is no longer running.',
    )

    const persisted = parseVersionedJsonStateEnvelope(
      JSON.parse(await readFile(paths.inboxStatePath, 'utf8')),
      {
        label: 'Inbox daemon state',
        parseValue(value) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError('Inbox daemon state must be an object.')
          }

          return value as {
            stale: boolean
            status: string
          }
        },
        schema: 'murph.inbox-daemon-state.v1',
        schemaVersion: 1,
      },
    )
    assert.equal(persisted.stale, true)
    assert.equal(persisted.status, 'stale')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

function createStubPollConnector(input: {
  id: string
  source: string
  accountId?: string | null
}): PollConnector {
  return {
    async backfill() {
      return null
    },
    id: input.id,
    source: input.source,
    accountId: input.accountId ?? null,
    kind: 'poll',
    capabilities: {
      attachments: true,
      backfill: true,
      watch: true,
      webhooks: false,
    },
    async watch() {},
  }
}

function createUnreachableTelegramDriver(): TelegramDriver {
  return {
    async getMe() {
      throw new Error('unreachable')
    },
    async getMessages() {
      throw new Error('unreachable')
    },
    async startWatching() {
      throw new Error('unreachable')
    },
    async getFile() {
      throw new Error('unreachable')
    },
    async downloadFile() {
      throw new Error('unreachable')
    },
  }
}

function createUnreachableEmailDriver(): EmailDriver {
  return {
    inboxId: 'unreachable',
    async listUnreadMessages() {
      throw new Error('unreachable')
    },
    async markProcessed() {
      throw new Error('unreachable')
    },
    async downloadAttachment() {
      throw new Error('unreachable')
    },
  }
}

function createStubInboxRuntimeModule(
  overrides: Partial<InboxRuntimeModule> = {},
): InboxRuntimeModule {
  const runtimeModule: InboxRuntimeModule = {
    async ensureInboxVault() {},
    async runInboxEnvelopeMigration() {
      throw new Error('unreachable')
    },
    async openInboxRuntime() {
      throw new Error('unreachable')
    },
    async createInboxPipeline() {
      throw new Error('unreachable')
    },
    async createParsedInboxPipeline() {
      throw new Error('unreachable')
    },
    createTelegramPollConnector(input) {
      return createStubPollConnector({
        id: input.id ?? 'telegram:bot',
        source: 'telegram',
        accountId: input.accountId ?? null,
      })
    },
    createEmailPollConnector(input) {
      return createStubPollConnector({
        id: input.id ?? 'email:default',
        source: 'email',
        accountId: input.accountId ?? null,
      })
    },
    createTelegramBotApiPollDriver() {
      return createUnreachableTelegramDriver()
    },
    createAgentmailApiPollDriver() {
      return createUnreachableEmailDriver()
    },
    async rebuildRuntimeFromVault() {},
    async runInboxDaemon() {},
    async runPollConnectorBackfill() {
      throw new Error('unreachable')
    },
    async runInboxDaemonWithParsers() {},
  }

  return Object.assign(runtimeModule, overrides)
}

test.sequential('readPromotionsByCapture groups promotion entries by capture id', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-promo-'))

  try {
    const paths = resolveRuntimePaths(vaultRoot)
    await mkdir(path.dirname(paths.inboxPromotionsPath), { recursive: true })
    await writeFile(
      paths.inboxPromotionsPath,
      `${JSON.stringify(
        createVersionedJsonStateEnvelope({
          schema: 'murph.inbox-promotion-store.v1',
          schemaVersion: 1,
          value: {
            entries: [
              {
                captureId: 'cap-1',
                target: 'meal',
                status: 'applied',
                promotedAt: '2026-03-18T12:00:00.000Z',
                lookupId: 'evt-1',
                relatedId: 'meal-1',
                note: 'Breakfast',
              },
              {
                captureId: 'cap-1',
                target: 'journal',
                status: 'applied',
                promotedAt: '2026-03-18T12:05:00.000Z',
                lookupId: 'journal:2026-03-18',
                relatedId: 'evt-1',
                note: 'Breakfast',
              },
              {
                captureId: 'cap-2',
                target: 'document',
                status: 'applied',
                promotedAt: '2026-03-18T13:00:00.000Z',
                lookupId: 'evt-2',
                relatedId: 'doc-2',
                note: null,
              },
            ],
          },
        }),
        null,
        2,
      )}\n`,
      'utf8',
    )

    const grouped = await readPromotionsByCapture(paths)

    assert.deepEqual(
      grouped.get('cap-1')?.map((entry) => entry.target),
      ['meal', 'journal'],
    )
    assert.deepEqual(
      grouped.get('cap-2')?.map((entry) => entry.relatedId),
      ['doc-2'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
