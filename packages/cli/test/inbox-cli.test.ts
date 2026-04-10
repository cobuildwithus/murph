import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { resolveRuntimePaths } from '@murphai/runtime-state/node'
import {
  createIntegratedInboxServices,
  type CoreRuntimeModule,
  type EmailDriver,
  type InboxPipeline,
  type InboxRuntimeModule,
  type InboxRunEvent,
  type RuntimeCaptureRecord,
  type RuntimeCaptureRecordInput,
  type RuntimeStore,
  type TelegramDriver,
} from '@murphai/inbox-services'
import { readAssistantAutomationState } from '@murphai/assistant-engine/assistant-state'
import {
  UNSAFE_FOREGROUND_LOG_DETAILS_ENV,
  formatInboxRunEventForTerminal,
  resolveForegroundTerminalLogOptions,
} from '@murphai/assistant-cli/run-terminal-logging'
import type {
  AgentmailApiClient,
  ListAgentmailInboxesInput,
} from '@murphai/operator-config/agentmail-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createVaultCli } from '../src/vault-cli.js'
import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import { requireData, type CliEnvelope } from './cli-test-helpers.js'

const builtCoreRuntimeUrl = new URL('../../core/dist/index.js', import.meta.url).href
const builtInboxRuntimeUrl = new URL('../../inboxd/dist/index.js', import.meta.url).href

test('formatInboxRunEventForTerminal omits connector identifiers by default', () => {
  const event: InboxRunEvent = {
    connectorId: 'email:person@example.test',
    source: 'email',
    type: 'connector.watch.started',
  }

  const message = formatInboxRunEventForTerminal(event)

  assert.equal(message, 'email connector watching for new messages')
  assert.doesNotMatch(message ?? '', /person@example\.test/u)
})

test('formatInboxRunEventForTerminal redacts actor, thread, and text previews by default', () => {
  const event: InboxRunEvent = {
    capture: {
      actor: {
        displayName: 'Person Example',
        id: 'person@example.test',
        isSelf: false,
      },
      externalId: 'message-1',
      attachments: [
        {
          fileName: 'lab-results.pdf',
          kind: 'document',
        },
      ],
      occurredAt: '2026-03-25T08:00:00.000Z',
      source: 'email',
      text: 'Follow up about the lab results tomorrow morning.',
      thread: {
        id: 'thread-person@example.test',
        title: 'Care plan',
      },
    },
    connectorId: 'email:person@example.test',
    phase: 'watch',
    source: 'email',
    type: 'capture.imported',
  }

  const message = formatInboxRunEventForTerminal(event)

  assert.equal(message, 'new email capture imported: text + 1 attachment')
  assert.doesNotMatch(message ?? '', /Person Example/u)
  assert.doesNotMatch(message ?? '', /person@example\.test/u)
  assert.doesNotMatch(message ?? '', /Care plan/u)
  assert.doesNotMatch(message ?? '', /Follow up about the lab results/u)
})

test('formatInboxRunEventForTerminal only includes verbose capture details when unsafe logging is enabled', () => {
  const event: InboxRunEvent = {
    capture: {
      actor: {
        displayName: 'Person Example',
        id: 'person@example.test',
        isSelf: false,
      },
      externalId: 'message-1',
      attachments: [
        {
          kind: 'document',
        },
      ],
      occurredAt: '2026-03-25T08:00:00.000Z',
      source: 'email',
      text: 'Follow up about the lab results tomorrow morning.',
      thread: {
        id: 'thread-person@example.test',
        title: 'Care plan',
      },
    },
    connectorId: 'email:person@example.test',
    phase: 'watch',
    source: 'email',
    type: 'capture.imported',
  }

  assert.deepEqual(resolveForegroundTerminalLogOptions({}), {
    unsafeDetails: false,
  })

  const message = formatInboxRunEventForTerminal(
    event,
    resolveForegroundTerminalLogOptions({
      [UNSAFE_FOREGROUND_LOG_DETAILS_ENV]: 'true',
    }),
  )

  assert.match(message ?? '', /Person Example/u)
  assert.match(message ?? '', /Care plan/u)
  assert.match(message ?? '', /Follow up about the lab results tomorrow morning\./u)
})

async function makeVaultFixture(prefix: string) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), `${prefix}-vault-`))
  const coreRuntime = await loadBuiltCoreRuntime()
  await coreRuntime.initializeVault({
    vaultRoot,
    createdAt: '2026-03-13T12:00:00.000Z',
  })
  return {
    vaultRoot,
  }
}

async function loadBuiltRuntime<T>(runtimeUrl: string): Promise<T> {
  return (await import(runtimeUrl)) as T
}

async function loadBuiltCoreRuntime(): Promise<{
  initializeVault(input: {
    vaultRoot: string
    createdAt: string
  }): Promise<void>
}> {
  return await loadBuiltRuntime<{
    initializeVault(input: {
      vaultRoot: string
      createdAt: string
    }): Promise<void>
  }>(builtCoreRuntimeUrl)
}

async function loadBuiltCoreModule() {
  return loadBuiltRuntime<CoreRuntimeModule>(builtCoreRuntimeUrl)
}

async function loadBuiltInboxRuntime() {
  return loadBuiltRuntime<InboxRuntimeModule>(builtInboxRuntimeUrl)
}

function createFakeEmailDriver(): EmailDriver {
  return {
    inboxId: 'email:agentmail',
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

function createFakeInboxRuntimeModule(input?: {
  rebuiltCaptureCount?: number
}): InboxRuntimeModule {
  const runtime: RuntimeStore = {
    close() {},
    getCursor() {
      return null
    },
    setCursor() {},
    listCaptures(filters?: { limit?: number }) {
      const total = input?.rebuiltCaptureCount ?? 0
      const limit = filters?.limit ?? total
      return Array.from({ length: Math.min(limit, total) }, (_, index) =>
        ({
          captureId: `cap-${index}`,
          eventId: `evt-${index}`,
          source: 'telegram',
          externalId: `external-${index}`,
          accountId: 'bot',
          thread: {
            id: 'chat-1',
            title: 'Test thread',
            isDirect: true,
          },
          actor: {
            id: 'telegram:user',
            displayName: 'Test user',
            isSelf: false,
          },
          occurredAt: '2026-03-13T08:00:00.000Z',
          receivedAt: '2026-03-13T08:00:01.000Z',
          text: null,
          attachments: [],
          raw: {},
          envelopePath: `raw/inbox/telegram/bot/${index}.json`,
          createdAt: '2026-03-13T08:00:02.000Z',
        }) satisfies RuntimeCaptureRecord,
      )
    },
    searchCaptures() {
      return []
    },
    getCapture() {
      return null
    },
  }

  return {
    async ensureInboxVault() {},
    async openInboxRuntime() {
      return runtime
    },
    async createInboxPipeline(): Promise<InboxPipeline> {
      return {
        runtime,
        async processCapture() {
          return { deduped: false }
        },
        close() {},
      }
    },
    createTelegramPollConnector(options: {
      id?: string
      accountId?: string | null
    }) {
      return {
        id: options.id ?? 'telegram:bot',
        source: 'telegram',
        accountId: options.accountId ?? 'bot',
        kind: 'poll' as const,
        capabilities: {
          attachments: true,
          backfill: true,
          watch: true,
          webhooks: false,
        },
        async backfill() {
          return null
        },
        async watch() {},
        async close() {},
      }
    },
    createEmailPollConnector(options: {
      id?: string
      accountId?: string | null
      accountAddress?: string | null
    }) {
      return {
        id: options.id ?? 'email:agentmail',
        source: 'email',
        accountId: options.accountId ?? null,
        kind: 'poll' as const,
        capabilities: {
          attachments: true,
          backfill: true,
          watch: true,
          webhooks: false,
        },
        async backfill() {
          return null
        },
        async watch() {},
        async close() {},
      }
    },
    createLinqWebhookConnector(options: {
      id?: string
      accountId?: string | null
    }) {
      return {
        id: options.id ?? 'linq:default',
        source: 'linq',
        accountId: options.accountId ?? 'default',
        kind: 'poll' as const,
        capabilities: {
          attachments: true,
          backfill: false,
          watch: true,
          webhooks: true,
        },
        async watch() {},
        async close() {},
      }
    },
    createTelegramBotApiPollDriver() {
      return createFakeTelegramDriver()
    },
    createAgentmailApiPollDriver() {
      return createFakeEmailDriver()
    },
    async rebuildRuntimeFromVault() {},
    async runInboxDaemon() {},
    async runInboxDaemonWithParsers() {},
  }
}

function createFakeTelegramDriver(): TelegramDriver {
  return {
    async getMe() {
      return {
        id: 999,
        username: 'murph_bot',
      }
    },
    async getMessages() {
      return []
    },
    async startWatching() {},
    async getFile() {
      return {
        file_path: 'documents/file-1',
      }
    },
    async downloadFile() {
      return new Uint8Array([1, 2, 3])
    },
    async getWebhookInfo() {
      return {
        url: 'https://example.invalid/webhook',
      }
    },
  }
}

function createFakeAgentmailClient(
  overrides: Partial<AgentmailApiClient> & Pick<AgentmailApiClient, 'apiKey' | 'baseUrl'>,
): AgentmailApiClient {
  return {
    apiKey: overrides.apiKey,
    baseUrl: overrides.baseUrl,
    async listInboxes(
      inputOrSignal?: ListAgentmailInboxesInput | AbortSignal,
      signal?: AbortSignal,
    ) {
      if (overrides.listInboxes) {
        if (inputOrSignal instanceof AbortSignal) {
          return await overrides.listInboxes(inputOrSignal)
        }
        return await overrides.listInboxes(inputOrSignal ?? {}, signal)
      }
      return {
        count: 0,
        inboxes: [],
      }
    },
    async getInbox(inboxId: string) {
      if (overrides.getInbox) {
        return overrides.getInbox(inboxId)
      }
      throw new Error(`unexpected getInbox(${inboxId})`)
    },
    async createInbox(input?: never) {
      if (overrides.createInbox) {
        return overrides.createInbox(input)
      }
      throw new Error('unexpected createInbox')
    },
    async sendMessage(input: never) {
      if (overrides.sendMessage) {
        return overrides.sendMessage(input)
      }
      throw new Error('unexpected sendMessage')
    },
    async replyToMessage(input: never) {
      if (overrides.replyToMessage) {
        return overrides.replyToMessage(input)
      }
      throw new Error('unexpected replyToMessage')
    },
    async getThread(threadId: string) {
      if (overrides.getThread) {
        return overrides.getThread(threadId)
      }
      throw new Error(`unexpected getThread(${threadId})`)
    },
    async listMessages(input: never) {
      if (overrides.listMessages) {
        return overrides.listMessages(input)
      }
      throw new Error('unexpected listMessages')
    },
    async getMessage(input: never) {
      if (overrides.getMessage) {
        return overrides.getMessage(input)
      }
      throw new Error('unexpected getMessage')
    },
    async updateMessage(input: never) {
      if (overrides.updateMessage) {
        return overrides.updateMessage(input)
      }
      throw new Error('unexpected updateMessage')
    },
    async getAttachment(input: never) {
      if (overrides.getAttachment) {
        return overrides.getAttachment(input)
      }
      throw new Error('unexpected getAttachment')
    },
    async downloadUrl(downloadUrl: string) {
      if (overrides.downloadUrl) {
        return overrides.downloadUrl(downloadUrl)
      }
      throw new Error(`unexpected downloadUrl(${downloadUrl})`)
    },
  }
}

function createAgentmailHttpError(input: {
  status: number
  method: 'GET' | 'POST'
  path: string
  message?: string
}) {
  return new VaultCliError(
    'AGENTMAIL_REQUEST_FAILED',
    input.message ?? `AgentMail request ${input.method} ${input.path} failed.`,
    {
      method: input.method,
      path: input.path,
      status: input.status,
    },
  )
}

async function seedInboxCapture(input: {
  capture: RuntimeCaptureRecordInput
  vaultRoot: string
}) {
  const inboxRuntime = await loadBuiltInboxRuntime()
  const runtime = await inboxRuntime.openInboxRuntime({
    vaultRoot: input.vaultRoot,
  })
  const pipeline = await inboxRuntime.createInboxPipeline({
    runtime,
    vaultRoot: input.vaultRoot,
  })

  try {
    await pipeline.processCapture(input.capture)
  } finally {
    pipeline.close()
  }
}

async function initializeTelegramSource(input: {
  services: ReturnType<typeof createIntegratedInboxServices>
  vaultRoot: string
}) {
  await input.services.init({
    vault: input.vaultRoot,
    requestId: null,
  })
  await input.services.sourceAdd({
    vault: input.vaultRoot,
    requestId: null,
    source: 'telegram',
    id: 'telegram:bot',
  })
}

async function readJsonFile<T>(absolutePath: string): Promise<T> {
  return JSON.parse(await readFile(absolutePath, 'utf8')) as T
}

async function runInProcessInboxCli<TData>(
  args: string[],
  inboxServices: ReturnType<typeof createIntegratedInboxServices>,
): Promise<CliEnvelope<TData>> {
  const cli = createVaultCli(createUnwiredVaultServices(), inboxServices)
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runInProcessDefaultInboxCli<TData>(
  args: string[],
): Promise<CliEnvelope<TData>> {
  const cli = createVaultCli(createUnwiredVaultServices())
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function expectVaultCliError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error) => {
    if (!error || typeof error !== 'object') {
      return false
    }
    assert.equal('code' in error, true)
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

test.sequential('vault-cli inbox init/source/doctor/remove emit contract-shaped envelopes for Telegram', async () => {
  const fixture = await makeVaultFixture('murph-inbox-envelope')
  const services = createIntegratedInboxServices({
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
    loadTelegramDriver: async () => createFakeTelegramDriver(),
  })

  try {
    const initResult = requireData(
      await runInProcessInboxCli<{
        configPath: string
        databasePath: string
        runtimeDirectory: string
      }>(['inbox', 'init', '--vault', fixture.vaultRoot], services),
    )
    assert.equal(initResult.runtimeDirectory, '.runtime/operations/inbox')
    assert.equal(initResult.databasePath, '.runtime/projections/inboxd.sqlite')
    assert.equal(initResult.configPath, '.runtime/operations/inbox/config.json')

    const added = requireData(
      await runInProcessInboxCli<{
        connector: {
          accountId: string | null
          id: string
          source: string
        }
        connectorCount: number
      }>(
        [
          'inbox',
          'source',
          'add',
          'telegram',
          '--vault',
          fixture.vaultRoot,
          '--id',
          'telegram:bot',
        ],
        services,
      ),
    )
    assert.equal(added.connector.id, 'telegram:bot')
    assert.equal(added.connector.source, 'telegram')
    assert.equal(added.connector.accountId, 'bot')
    assert.equal(added.connectorCount, 1)

    const doctor = requireData(
      await runInProcessInboxCli<{
        checks: Array<{ name: string; status: string }>
        connectors: Array<{ id: string }>
        ok: boolean
      }>(['inbox', 'doctor', '--vault', fixture.vaultRoot], services),
    )
    assert.equal(doctor.ok, true)
    assert.equal(doctor.connectors[0]?.id, 'telegram:bot')
    assert.equal(
      doctor.checks.some((check) => check.name === 'connectors' && check.status === 'pass'),
      true,
    )

    const removed = requireData(
      await runInProcessInboxCli<{
        connectorCount: number
        connectorId: string
        removed: boolean
      }>(['inbox', 'source', 'remove', 'telegram:bot', '--vault', fixture.vaultRoot], services),
    )
    assert.equal(removed.removed, true)
    assert.equal(removed.connectorId, 'telegram:bot')
    assert.equal(removed.connectorCount, 0)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('vault-cli inbox list/show/search emit contract-shaped envelopes from seeded Telegram captures', async () => {
  const fixture = await makeVaultFixture('murph-inbox-runtime-envelope')
  const services = createIntegratedInboxServices({
    loadCoreModule: loadBuiltCoreModule,
    loadInboxModule: loadBuiltInboxRuntime,
  })

  try {
    await initializeTelegramSource({
      services,
      vaultRoot: fixture.vaultRoot,
    })
    await seedInboxCapture({
      vaultRoot: fixture.vaultRoot,
      capture: {
        source: 'telegram',
        accountId: 'bot',
        externalId: 'telegram-envelope-1',
        occurredAt: '2026-03-13T08:00:00.000Z',
        receivedAt: '2026-03-13T08:00:10.000Z',
        thread: {
          id: 'chat-1',
          title: 'Breakfast',
          isDirect: true,
        },
        actor: {
          id: 'telegram:friend',
          displayName: 'Friend',
          isSelf: false,
        },
        text: 'Toast and eggs',
        attachments: [
          {
            kind: 'image',
            fileName: 'toast.jpg',
          },
        ],
        raw: {},
      },
    })

    const listed = requireData(
      await runInProcessInboxCli<{
        items: Array<{
          attachmentCount: number
          captureId: string
          source: string
          text: string | null
        }>
      }>(['inbox', 'list', '--vault', fixture.vaultRoot], services),
    )
    const captureId = listed.items[0]?.captureId
    assert.ok(captureId)
    assert.equal(listed.items[0]?.source, 'telegram')
    assert.equal(listed.items[0]?.text, 'Toast and eggs')
    assert.equal(listed.items[0]?.attachmentCount, 1)

    const shown = requireData(
      await runInProcessInboxCli<{
        capture: {
          captureId: string
          text: string | null
        }
      }>(['inbox', 'show', captureId, '--vault', fixture.vaultRoot], services),
    )
    assert.equal(shown.capture.captureId, captureId)
    assert.equal(shown.capture.text, 'Toast and eggs')

    const searched = requireData(
      await runInProcessInboxCli<{
        hits: Array<{
          captureId: string
          snippet: string
        }>
      }>(['inbox', 'search', '--vault', fixture.vaultRoot, '--text', 'toast'], services),
    )
    assert.equal(searched.hits[0]?.captureId, captureId)
    assert.match(searched.hits[0]?.snippet ?? '', /toast/iu)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('source add defaults the Telegram account identity to bot when omitted', async () => {
  const fixture = await makeVaultFixture('murph-inbox-telegram-default-account')
  const services = createIntegratedInboxServices({
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })

    const added = await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'telegram',
      id: 'telegram:bot',
    })
    assert.equal(added.connector.accountId, 'bot')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('source add --enableAutoReply updates assistant automation state in the default CLI path', async () => {
  const fixture = await makeVaultFixture('murph-inbox-enable-auto-reply')

  try {
    requireData(
      await runInProcessDefaultInboxCli<{
        configPath: string
      }>(['inbox', 'init', '--vault', fixture.vaultRoot]),
    )

    const added = requireData(
      await runInProcessDefaultInboxCli<{
        autoReplyEnabled?: boolean
        connector: {
          accountId: string | null
          id: string
          source: string
        }
      }>([
        'inbox',
        'source',
        'add',
        'telegram',
        '--vault',
        fixture.vaultRoot,
        '--id',
        'telegram:bot',
        '--enableAutoReply',
      ]),
    )

    assert.equal(added.autoReplyEnabled, true)

    const automationState = await readAssistantAutomationState(fixture.vaultRoot)
    assert.deepEqual(automationState.autoReply, [
      {
        channel: 'telegram',
        cursor: null,
      },
    ])
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('source add defaults the Linq account identity to default when omitted', async () => {
  const fixture = await makeVaultFixture('murph-inbox-linq-default-account')
  const services = createIntegratedInboxServices({
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })

    const added = await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'linq',
      id: 'linq:default',
      linqWebhookPath: 'custom-linq',
      linqWebhookPort: 9911,
    })
    assert.equal(added.connector.accountId, 'default')
    assert.equal(added.connector.options.linqWebhookPath, '/custom-linq')
    assert.equal(added.connector.options.linqWebhookPort, 9911)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('sourceSetEnabled updates the persisted enabled flag for an existing connector', async () => {
  const fixture = await makeVaultFixture('murph-inbox-toggle-source')
  const services = createIntegratedInboxServices({
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'telegram',
      id: 'telegram:bot',
    })

    const disabled = await services.sourceSetEnabled({
      vault: fixture.vaultRoot,
      requestId: null,
      connectorId: 'telegram:bot',
      enabled: false,
    })
    assert.equal(disabled.connector.enabled, false)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('source add email --provision reuses the single discovered AgentMail inbox after create is forbidden', async () => {
  const fixture = await makeVaultFixture('murph-inbox-email-reuse-single')
  const services = createIntegratedInboxServices({
    createAgentmailClient() {
      return createFakeAgentmailClient({
        apiKey: 'agentmail-key',
        baseUrl: 'https://api.agentmail.to/v0',
        async createInbox() {
          throw createAgentmailHttpError({
            status: 403,
            method: 'POST',
            path: '/inboxes',
            message: 'Forbidden',
          })
        },
        async listInboxes() {
          return {
            count: 1,
            inboxes: [
              {
                display_name: 'Existing Inbox',
                email: 'existing@example.test',
                inbox_id: 'existing@example.test',
              },
            ],
          }
        },
      })
    },
    getEnvironment: () => ({
      AGENTMAIL_API_KEY: 'agentmail-key',
    }),
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    const added = await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'email',
      id: 'email:agentmail',
      provision: true,
    })
    assert.equal(added.connector.accountId, 'existing@example.test')
    assert.equal(added.reusedMailbox?.emailAddress, 'existing@example.test')
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('source add email --provision requires --account when multiple discovered AgentMail inboxes are available', async () => {
  const fixture = await makeVaultFixture('murph-inbox-email-reuse-multiple')
  const services = createIntegratedInboxServices({
    createAgentmailClient() {
      return createFakeAgentmailClient({
        apiKey: 'agentmail-key',
        baseUrl: 'https://api.agentmail.to/v0',
        async createInbox() {
          throw createAgentmailHttpError({
            status: 403,
            method: 'POST',
            path: '/inboxes',
            message: 'Forbidden',
          })
        },
        async listInboxes(
          inputOrSignal?: { pageToken?: string | null } | AbortSignal,
        ) {
          const input =
            inputOrSignal instanceof AbortSignal ? undefined : inputOrSignal
          if (!input?.pageToken) {
            return {
              count: 1,
              inboxes: [{ email: 'one@example.test', inbox_id: 'one@example.test' }],
              next_page_token: 'page-2',
            }
          }

          return {
            count: 1,
            inboxes: [{ email: 'two@example.test', inbox_id: 'two@example.test' }],
          }
        },
      })
    },
    getEnvironment: () => ({
      AGENTMAIL_API_KEY: 'agentmail-key',
    }),
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    await expectVaultCliError(
      services.sourceAdd({
        vault: fixture.vaultRoot,
        requestId: null,
        source: 'email',
        id: 'email:agentmail',
        provision: true,
      }),
      'INBOX_EMAIL_ACCOUNT_SELECTION_REQUIRED',
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('source add rejects connector ids that alias the same source/account namespace', async () => {
  const fixture = await makeVaultFixture('murph-inbox-namespace-alias')
  const services = createIntegratedInboxServices({
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'telegram',
      id: 'telegram:bot',
      account: 'bot',
    })

    await expectVaultCliError(
      services.sourceAdd({
        vault: fixture.vaultRoot,
        requestId: null,
        source: 'telegram',
        id: 'telegram:alias',
        account: 'bot',
      }),
      'INBOX_SOURCE_NAMESPACE_EXISTS',
    )
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('doctor reports Telegram diagnostics without consuming updates', async () => {
  const fixture = await makeVaultFixture('murph-inbox-telegram-doctor')
  let getMessagesCalls = 0
  let startWatchingCalls = 0
  const services = createIntegratedInboxServices({
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
    loadTelegramDriver: async () => ({
      async getMe() {
        return {
          id: 999,
          username: 'murph_bot',
        }
      },
      async getMessages() {
        getMessagesCalls += 1
        return []
      },
      async startWatching() {
        startWatchingCalls += 1
      },
      async getFile() {
        throw new Error('getFile should not run during doctor')
      },
      async downloadFile() {
        throw new Error('downloadFile should not run during doctor')
      },
      async getWebhookInfo() {
        return {
          url: 'https://example.invalid/webhook',
        }
      },
    }),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'telegram',
      id: 'telegram:bot',
    })

    const doctor = await services.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'telegram:bot',
    })
    assert.equal(doctor.ok, true)
    assert.equal(
      doctor.checks.some((check) => check.name === 'token' && check.status === 'pass'),
      true,
    )
    assert.equal(
      doctor.checks.some((check) => check.name === 'probe' && check.status === 'pass'),
      true,
    )
    assert.equal(
      doctor.checks.some((check) => check.name === 'webhook' && check.status === 'warn'),
      true,
    )
    assert.equal(getMessagesCalls, 0)
    assert.equal(startWatchingCalls, 0)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('doctor fails Linq webhook-secret checks before probing when LINQ_WEBHOOK_SECRET is missing', async () => {
  const fixture = await makeVaultFixture('murph-inbox-linq-doctor')
  const services = createIntegratedInboxServices({
    getEnvironment: () => ({
      LINQ_API_TOKEN: 'linq-token',
    }),
    loadInboxModule: async () => createFakeInboxRuntimeModule(),
  })

  try {
    await services.init({
      vault: fixture.vaultRoot,
      requestId: null,
    })
    await services.sourceAdd({
      vault: fixture.vaultRoot,
      requestId: null,
      source: 'linq',
      id: 'linq:default',
    })

    const doctor = await services.doctor({
      vault: fixture.vaultRoot,
      requestId: null,
      sourceId: 'linq:default',
    })
    assert.equal(doctor.ok, false)
    assert.equal(
      doctor.checks.some((check) => check.name === 'token' && check.status === 'pass'),
      true,
    )
    assert.equal(
      doctor.checks.some((check) => check.name === 'webhook-secret' && check.status === 'fail'),
      true,
    )
    assert.equal(doctor.checks.some((check) => check.name === 'probe'), false)
  } finally {
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})
