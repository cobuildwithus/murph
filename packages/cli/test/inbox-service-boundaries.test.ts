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
  ImessageDriver,
  InboxImessageRuntimeModule,
  InboxRuntimeModule,
  PollConnector,
  TelegramDriver,
} from '@murphai/inbox-services'
import {
  instantiateConnector,
  normalizeDaemonState,
  readPromotionsByCapture,
} from '@murphai/inbox-services/testing'

test('instantiateConnector delegates iMessage defaults through the connector factory', async () => {
  let received: {
    accountId?: string | null
    backfillLimit?: number
    id?: string
    includeOwnMessages?: boolean
  } | null = null
  const inboxCoreModule = createStubInboxRuntimeModule()
  const imessageModule = createStubInboxImessageRuntimeModule({
    createImessageConnector(options) {
      received = options
      return createStubPollConnector({
        id: options.id ?? 'imessage:self',
        source: 'imessage',
      })
    },
  })

  const connector = await instantiateConnector({
    connector: {
      id: 'imessage:self',
      source: 'imessage',
      enabled: true,
      accountId: null,
      options: {
        includeOwnMessages: false,
        backfillLimit: 42,
      },
    },
    inputLimit: 7,
    async loadInbox() {
      return inboxCoreModule
    },
    async loadInboxImessage() {
      return imessageModule
    },
    async loadImessageDriver() {
      return createUnreachableImessageDriver()
    },
    async loadTelegramDriver() {
      throw new Error('unreachable')
    },
    linqWebhookSecret: null,
  })

  assert.equal(connector.id, 'imessage:self')
  assert.equal('createImessageConnector' in inboxCoreModule, false)
  if (!received) {
    throw new Error('expected connector options to be captured')
  }
  const captured: {
    accountId?: string | null
    backfillLimit?: number
    includeOwnMessages?: boolean
  } = received
  assert.equal(captured.accountId, 'self')
  assert.equal(captured.includeOwnMessages, false)
  assert.equal(captured.backfillLimit, 7)
})

test('instantiateConnector delegates Linq webhook options through the connector factory', async () => {
  let received: {
    accountId?: string | null
    downloadAttachments?: boolean
    host?: string
    id?: string
    path?: string
    port?: number
    webhookSecret?: string
  } | null = null

  const connector = await instantiateConnector({
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
    linqWebhookSecret: 'secret-123',
    async loadInbox() {
      return createStubInboxRuntimeModule({
        createLinqWebhookConnector: (options: {
          accountId?: string | null
          downloadAttachments?: boolean
          host?: string
          id?: string
          path?: string
          port?: number
          webhookSecret: string
        }) => {
          received = options
          return {
            id: options.id ?? 'linq:default',
            source: 'linq',
            accountId: options.accountId ?? null,
            kind: 'poll',
            capabilities: {
              attachments: true,
              backfill: false,
              ownMessages: true,
              watch: true,
              webhooks: true,
            },
            async backfill() {
              return null
            },
            async watch() {},
          }
        },
      })
    },
    async loadInboxImessage() {
      throw new Error('unreachable')
    },
    async loadImessageDriver() {
      throw new Error('unreachable')
    },
    async loadTelegramDriver() {
      throw new Error('unreachable')
    },
  })

  assert.equal(connector.id, 'linq:default')
  if (!received) {
    throw new Error('expected Linq connector options to be captured')
  }
  assert.deepEqual(received, {
    accountId: 'default',
    downloadAttachments: true,
    host: '127.0.0.1',
    id: 'linq:default',
    path: '/hooks/linq',
    port: 9911,
    webhookSecret: 'secret-123',
  })
})

test('instantiateConnector fails closed for Linq when the local webhook secret is missing', async () => {
  let created = false

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
        linqWebhookSecret: null,
        async loadInbox() {
          return createStubInboxRuntimeModule({
            createLinqWebhookConnector: () => {
              created = true
              throw new Error('unreachable')
            },
          })
        },
        async loadInboxImessage() {
          throw new Error('unreachable')
        },
        async loadImessageDriver() {
          throw new Error('unreachable')
        },
        async loadTelegramDriver() {
          throw new Error('unreachable')
        },
      }),
    /local Linq listener can start/u,
  )

  assert.equal(created, false)
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
          }
        },
      })
    },
    async loadInboxImessage() {
      throw new Error('unreachable')
    },
    async loadImessageDriver() {
      throw new Error('unreachable')
    },
    async loadTelegramDriver() {
      return createUnreachableTelegramDriver()
    },
    linqWebhookSecret: null,
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
            connectorIds: ['imessage:self'],
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
  }
}

function createUnreachableImessageDriver(): ImessageDriver {
  return {
    async getMessages() {
      throw new Error('unreachable')
    },
    async listChats() {
      throw new Error('unreachable')
    },
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

function createStubInboxImessageRuntimeModule(
  overrides: Partial<InboxImessageRuntimeModule> = {},
): InboxImessageRuntimeModule {
  return {
    createImessageConnector(input) {
      return createStubPollConnector({
        id: input.id ?? 'imessage:self',
        source: 'imessage',
        accountId: input.accountId ?? null,
      })
    },
    async loadImessageKitDriver() {
      return createUnreachableImessageDriver()
    },
    ...overrides,
  }
}

function createStubInboxRuntimeModule(
  overrides: Partial<InboxRuntimeModule> = {},
): InboxRuntimeModule {
  return {
    async ensureInboxVault() {},
    async openInboxRuntime() {
      throw new Error('unreachable')
    },
    async createInboxPipeline() {
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
    createLinqWebhookConnector(input) {
      return createStubPollConnector({
        id: input.id ?? 'linq:default',
        source: 'linq',
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
    async runInboxDaemonWithParsers() {},
    ...overrides,
  }
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
