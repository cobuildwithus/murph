import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  resolveRuntimePaths,
  tryKillProcess,
  type RuntimePaths,
} from '@murphai/runtime-state/node'
import type {
  InboxConnectorConfig,
  InboxRuntimeConfig,
} from '@murphai/operator-config/inbox-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { afterEach, test, vi } from 'vitest'

import { createIntegratedInboxServices } from '../src/index.ts'
import { describeLinqConnectorEndpoint as describeAppLinqEndpoint } from '../src/inbox-app/linq-endpoint.ts'
import {
  buildDaemonState,
  createProcessSignalBridge,
  idleState,
  normalizeDaemonState,
  writeDaemonState,
} from '../src/inbox-services/daemon.ts'
import { instantiateConnector } from '../src/inbox-services/connectors.ts'
import {
  buildCaptureCursor,
  detailCapture,
  hasStoredPath,
  isStoredAudioAttachment,
  isStoredDocumentAttachment,
  isStoredImageAttachment,
  requireAttachmentRecord,
  requireCapture,
  resolveSourceFilter,
  summarizeCapture,
  toCliAttachment,
} from '../src/inbox-services/query.ts'
import {
  connectorNamespaceKey,
  countRuntimeCaptures,
  failCheck,
  fileExists,
  listAllCaptures,
  normalizeBackfillLimit,
  normalizeConnectorAccountId,
  normalizeLimit,
  normalizeOptionalCommandLimit,
  normalizeVaultPathOutput,
  occurredDayFromCapture,
  passCheck,
  redactSensitivePath,
  relativeToVault,
  resolveAttachmentParseState,
  runtimeNamespaceAccountId,
  warnCheck,
  writeJsonFile,
} from '../src/inbox-services/shared.ts'
import {
  ensureConfigFile,
  ensureConnectorNamespaceAvailable,
  ensureDirectory,
  findConnector,
  readConfig,
  rebuildRuntime,
  requireConnector,
  sortConnectors,
  writeConfig,
} from '../src/inbox-services/state.ts'
import { describeLinqConnectorEndpoint } from '../src/linq-endpoint.ts'
import {
  normalizeAssistantCaptureId,
  resolveAssistantInboxArtifactPath,
  resolveAssistantVaultPath,
} from '@murphai/vault-usecases/assistant-vault-paths'
import type {
  EmailDriver,
  InboxImessageRuntimeModule,
  InboxPaths,
  InboxRuntimeModule,
  PollConnector,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
  TelegramDriver,
} from '../src/index.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await import('node:fs/promises').then(({ rm }) =>
        rm(tempRoot, { force: true, recursive: true }),
      )
    }),
  )
})

async function createTempVault(): Promise<RuntimePaths> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'inbox-services-'))
  tempRoots.push(tempRoot)
  await mkdir(tempRoot, { recursive: true })
  return resolveRuntimePaths(tempRoot)
}

function createConnector(
  overrides: Partial<InboxConnectorConfig> & Pick<InboxConnectorConfig, 'id' | 'source'>,
): InboxConnectorConfig {
  return {
    accountId: null,
    enabled: true,
    options: {},
    ...overrides,
  }
}

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
      webhooks: source === 'linq',
    },
  }
}

function createCapture(
  overrides: Partial<RuntimeCaptureRecord> = {},
): RuntimeCaptureRecord {
  return {
    accountId: 'default',
    actor: {
      displayName: 'Ada',
      id: 'actor-1',
      isSelf: false,
    },
    attachments: [],
    captureId: 'capture-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    envelopePath: 'derived/inbox/capture-1/envelope.json',
    eventId: 'event-1',
    externalId: 'external-1',
    occurredAt: '2025-01-01T00:00:00.000Z',
    receivedAt: '2025-01-01T00:00:01.000Z',
    source: 'telegram',
    text: 'hello',
    thread: {
      id: 'thread-1',
      isDirect: true,
      title: 'Thread',
    },
    ...overrides,
  }
}

function createRuntimeStore(
  captures: RuntimeCaptureRecord[],
): RuntimeStore {
  return {
    close() {},
    getCapture(captureId) {
      return captures.find((capture) => capture.captureId === captureId) ?? null
    },
    getCursor() {
      return null
    },
    listCaptures({ limit }) {
      return captures.slice(0, limit)
    },
    searchCaptures() {
      return captures
    },
    setCursor() {},
  }
}

test('service-layer helpers cover connector, query, state, daemon, and vault path branches', async () => {
  assert.equal(typeof createIntegratedInboxServices, 'function')

  const defaultEndpoint = describeLinqConnectorEndpoint({ options: {} })
  assert.deepEqual(defaultEndpoint, {
    host: '0.0.0.0',
    path: '/linq-webhook',
    port: 8789,
  })
  assert.deepEqual(
    describeAppLinqEndpoint({
      options: {
        linqWebhookHost: '127.0.0.1',
        linqWebhookPath: '/hook',
        linqWebhookPort: 9000,
      },
    }),
    {
      host: '127.0.0.1',
      path: '/hook',
      port: 9000,
    },
  )

  let killed = false
  tryKillProcess(
    () => {
      killed = true
    },
    123,
    'SIGTERM',
  )
  assert.equal(killed, true)
  tryKillProcess(
    () => {
      const error = Object.assign(new Error('missing'), { code: 'ESRCH' })
      throw error
    },
    123,
    'SIGTERM',
  )
  assert.throws(
    () =>
      tryKillProcess(
        () => {
          throw new Error('boom')
        },
        123,
        'SIGTERM',
      ),
    /boom/,
  )

  const paths = await createTempVault()
  const absoluteNested = await resolveAssistantVaultPath(paths.absoluteVaultRoot, 'derived/inbox')
  assert.match(absoluteNested, /derived[\\/]inbox$/)
  await assert.rejects(
    () => resolveAssistantVaultPath(paths.absoluteVaultRoot, '../escape'),
    (error: unknown) => error instanceof VaultCliError && error.code === 'ASSISTANT_PATH_OUTSIDE_VAULT',
  )
  assert.equal(normalizeAssistantCaptureId(' capture-1 '), 'capture-1')
  assert.throws(() => normalizeAssistantCaptureId('../bad'), /outside the vault root/)
  const artifactPath = await resolveAssistantInboxArtifactPath(
    paths.absoluteVaultRoot,
    'capture-1',
    'attachment.txt',
  )
  assert.match(artifactPath.relativePath, /derived\/inbox\/capture-1\/assistant\/attachment\.txt$/)
  const symlinkRoot = await createTempVault()
  await symlink('/tmp', path.join(symlinkRoot.absoluteVaultRoot, 'escape'))
  await assert.rejects(
    () => resolveAssistantVaultPath(symlinkRoot.absoluteVaultRoot, 'escape/child.txt', 'file path'),
    (error: unknown) => error instanceof VaultCliError && error.code === 'ASSISTANT_PATH_OUTSIDE_VAULT',
  )

  const connector = createConnector({
    id: 'telegram:bot',
    source: 'telegram',
    accountId: 'bot',
    options: { backfillLimit: 10 },
  })
  assert.equal(runtimeNamespaceAccountId(connector), 'bot')
  assert.equal(connectorNamespaceKey(connector), 'telegram::bot')
  assert.equal(normalizeConnectorAccountId('imessage', undefined), 'self')
  assert.equal(normalizeConnectorAccountId('telegram', undefined), 'bot')
  assert.equal(normalizeConnectorAccountId('linq', undefined), 'default')
  assert.equal(normalizeConnectorAccountId('email', undefined), null)
  assert.equal(normalizeBackfillLimit(undefined), undefined)
  assert.equal(normalizeBackfillLimit(50), 50)
  assert.throws(() => normalizeBackfillLimit(0), /Backfill limit must be an integer/)
  assert.equal(normalizeLimit(undefined, 20, 50), 20)
  assert.equal(normalizeLimit(25, 20, 50), 25)
  assert.throws(() => normalizeLimit(100, 20, 50), /Limit must be an integer/)
  assert.equal(normalizeOptionalCommandLimit(undefined, 10), undefined)
  assert.equal(normalizeOptionalCommandLimit(5, 10), 5)
  assert.throws(() => normalizeOptionalCommandLimit(11, 10), /Limit must be an integer/)
  assert.equal(relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath), '.runtime/projections/inboxd.sqlite')
  assert.equal(normalizeVaultPathOutput(paths.absoluteVaultRoot, paths.inboxDbPath), '.runtime/projections/inboxd.sqlite')
  assert.equal(normalizeVaultPathOutput(paths.absoluteVaultRoot, 'relative/file.txt'), 'relative/file.txt')
  assert.equal(redactSensitivePath('/Users/tester/private'), '<REDACTED_PATH>')
  assert.equal(redactSensitivePath('/home/tester/private'), '<REDACTED_PATH>')
  assert.equal(redactSensitivePath('C:\\Users\\tester\\private'), '<REDACTED_PATH>')
  assert.equal(redactSensitivePath(' /tmp/file '), '/tmp/file')
  assert.equal(redactSensitivePath('   '), null)
  assert.equal(
    passCheck('ok', 'done').status,
    'pass',
  )
  assert.equal(warnCheck('warn', 'heads up').status, 'warn')
  assert.equal(failCheck('fail', 'broken').status, 'fail')

  const tempJson = path.join(paths.absoluteVaultRoot, 'tmp', 'sample.json')
  await writeJsonFile(tempJson, { ok: true })
  assert.equal(await fileExists(tempJson), true)

  const telegramConnector = await instantiateConnector({
    connector,
    inputLimit: 25,
    linqWebhookSecret: null,
    loadInbox: async () => ({
      createAgentmailApiPollDriver() {
        throw new Error('unused')
      },
      async createInboxPipeline() {
        throw new Error('unused')
      },
      createEmailPollConnector() {
        throw new Error('unused')
      },
      createLinqWebhookConnector() {
        throw new Error('unused')
      },
      createTelegramBotApiPollDriver() {
        throw new Error('unused')
      },
      createTelegramPollConnector(input) {
        assert.equal(input.accountId, 'bot')
        assert.equal(input.backfillLimit, 25)
        assert.equal(input.transportMode, 'take-over-webhook')
        return createPollConnector('telegram', 'telegram:bot')
      },
      async ensureInboxVault() {},
      async openInboxRuntime() {
        return createRuntimeStore([])
      },
      async rebuildRuntimeFromVault() {},
      async runInboxDaemon() {},
      async runInboxDaemonWithParsers() {},
    } satisfies InboxRuntimeModule),
    loadImessageDriver: async () => {
      throw new Error('unused')
    },
    loadTelegramDriver: async () => ({}) as TelegramDriver,
  })
  assert.equal(telegramConnector.id, 'telegram:bot')

  await assert.rejects(
    () =>
      instantiateConnector({
        connector: createConnector({
          id: 'linq:default',
          source: 'linq',
        }),
        linqWebhookSecret: '   ',
        loadInbox: async () => ({}) as InboxRuntimeModule,
        loadImessageDriver: async () => ({}) as never,
        loadTelegramDriver: async () => ({}) as TelegramDriver,
      }),
    /Linq webhook secret is required/,
  )

  const emailConnector = await instantiateConnector({
    connector: createConnector({
      id: 'email:primary',
      source: 'email',
      options: { emailAddress: 'ada@example.com' },
    }),
    linqWebhookSecret: null,
    loadEmailDriver: async () => ({}) as EmailDriver,
    loadInbox: async () => ({
      createAgentmailApiPollDriver() {
        throw new Error('unused')
      },
      async createInboxPipeline() {
        throw new Error('unused')
      },
      createEmailPollConnector(input) {
        assert.equal(input.accountAddress, 'ada@example.com')
        return createPollConnector('email', 'email:primary')
      },
      createLinqWebhookConnector() {
        throw new Error('unused')
      },
      createTelegramBotApiPollDriver() {
        throw new Error('unused')
      },
      createTelegramPollConnector() {
        throw new Error('unused')
      },
      async ensureInboxVault() {},
      async openInboxRuntime() {
        return createRuntimeStore([])
      },
      async rebuildRuntimeFromVault() {},
      async runInboxDaemon() {},
      async runInboxDaemonWithParsers() {},
    } satisfies InboxRuntimeModule),
    loadImessageDriver: async () => ({}) as never,
    loadTelegramDriver: async () => ({}) as TelegramDriver,
  })
  assert.equal(emailConnector.id, 'email:primary')

  const attachment: RuntimeAttachmentRecord = {
    attachmentId: 'attachment-1',
    byteSize: 42,
    derivedPath: 'derived.txt',
    externalId: 'external-attachment-1',
    extractedText: 'hello',
    fileName: 'file.txt',
    kind: 'image',
    mime: 'image/png',
    ordinal: 0,
    originalPath: '/tmp/original',
    parseState: 'parsed',
    parserProviderId: 'provider-1',
    sha256: 'abc',
    storedPath: 'derived/inbox/file.png',
    transcriptText: 'hello',
  }
  assert.equal(hasStoredPath(attachment), true)
  assert.equal(isStoredImageAttachment(attachment), true)
  assert.equal(isStoredAudioAttachment({ ...attachment, kind: 'audio' }), true)
  assert.equal(isStoredDocumentAttachment({ ...attachment, kind: 'document' }), true)
  assert.deepEqual(buildCaptureCursor(createCapture()), {
    occurredAt: '2025-01-01T00:00:00.000Z',
    externalId: 'external-1',
    receivedAt: '2025-01-01T00:00:01.000Z',
  })
  const promotions = [{ id: 'promotion-1' }] as Array<{ id: string }>
  const detailedCapture = createCapture({ attachments: [attachment] })
  assert.equal(summarizeCapture(detailedCapture, promotions as never).attachmentCount, 1)
  assert.equal(detailCapture(detailedCapture, promotions as never).attachments.length, 1)
  assert.equal(toCliAttachment(attachment).storedPath, 'derived/inbox/file.png')
  const runtime = createRuntimeStore([detailedCapture])
  assert.equal(requireCapture(runtime, 'capture-1').captureId, 'capture-1')
  assert.throws(() => requireCapture(runtime, 'missing'), /was not found/)
  assert.equal(requireAttachmentRecord(runtime, 'attachment-1').attachment.attachmentId, 'attachment-1')
  assert.throws(() => requireAttachmentRecord(runtime, 'missing'), /was not found/)
  const config: InboxRuntimeConfig = {
    connectors: [connector],
  }
  assert.equal(resolveSourceFilter(config, null), null)
  assert.deepEqual(resolveSourceFilter(config, 'telegram:bot'), {
    accountId: 'bot',
    source: 'telegram',
  })

  assert.equal(resolveAttachmentParseState(attachment), 'parsed')
  assert.equal(
    occurredDayFromCapture(detailedCapture),
    '2025-01-01',
  )
  assert.equal(countRuntimeCaptures(runtime), 1)
  assert.equal(listAllCaptures(runtime).length, 1)

  const configPaths = await createTempVault()
  await ensureDirectory(path.dirname(configPaths.inboxConfigPath), [], configPaths.absoluteVaultRoot)
  await ensureConfigFile(configPaths as InboxPaths, [])
  assert.deepEqual(await readConfig(configPaths as InboxPaths), { connectors: [] })
  await writeConfig(configPaths as InboxPaths, config)
  const persistedConfig = await readConfig(configPaths as InboxPaths)
  assert.equal(findConnector(persistedConfig, 'telegram:bot')?.id, 'telegram:bot')
  assert.equal(requireConnector(persistedConfig, 'telegram:bot').id, 'telegram:bot')
  assert.throws(() => requireConnector(persistedConfig, 'missing'), /is not configured/)
  const sortableConfig: InboxRuntimeConfig = {
    connectors: [
      createConnector({ id: 'b', source: 'telegram' }),
      createConnector({ id: 'a', source: 'telegram' }),
    ],
  }
  sortConnectors(sortableConfig)
  assert.deepEqual(sortableConfig.connectors.map((entry) => entry.id), ['a', 'b'])
  assert.throws(
    () =>
      ensureConnectorNamespaceAvailable(persistedConfig, createConnector({
        id: 'telegram:duplicate',
        source: 'telegram',
        accountId: 'bot',
      })),
    /aliases the same runtime namespace/,
  )
  ensureConnectorNamespaceAvailable(
    persistedConfig,
    createConnector({ id: 'email:primary', source: 'email', accountId: 'ada@example.com' }),
  )

  const rebuildCount = await rebuildRuntime(
    configPaths as InboxPaths,
    {
      async ensureInboxVault() {},
      async openInboxRuntime() {
        return {
          close() {},
          getCapture() {
            return null
          },
          getCursor() {
            return null
          },
          listCaptures({ limit }) {
            const count = limit < 800 ? limit : 400
            return Array.from({ length: count }, () => createCapture())
          },
          searchCaptures() {
            return []
          },
          setCursor() {},
        }
      },
      async rebuildRuntimeFromVault() {},
    } as InboxRuntimeModule,
  )
  assert.equal(rebuildCount, 400)

  const idleDaemonState = idleState(configPaths as InboxPaths)
  assert.equal(idleDaemonState.status, 'idle')
  const runningState = buildDaemonState(configPaths as InboxPaths, {
    status: 'running',
    running: true,
    pid: 111,
  })
  await writeDaemonState(configPaths as InboxPaths, runningState)
  const staleState = await normalizeDaemonState(configPaths as InboxPaths, {
    clock: () => new Date('2025-02-01T00:00:00.000Z'),
    getPid: () => 222,
    killProcess() {
      const error = Object.assign(new Error('missing'), { code: 'ESRCH' })
      throw error
    },
  })
  assert.equal(staleState.status, 'stale')
  assert.equal(staleState.stale, true)
  const currentState = await normalizeDaemonState(configPaths as InboxPaths, {
    clock: () => new Date('2025-02-01T00:00:00.000Z'),
    getPid: () => staleState.pid ?? 222,
  })
  assert.equal(currentState.status, 'stale')

  const onSpy = vi.spyOn(process, 'on')
  const offSpy = vi.spyOn(process, 'off')
  const bridge = createProcessSignalBridge()
  assert.equal(onSpy.mock.calls.length >= 2, true)
  bridge.cleanup()
  assert.equal(offSpy.mock.calls.length >= 2, true)
  assert.equal(bridge.signal.aborted, false)
})
