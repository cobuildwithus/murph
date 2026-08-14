import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { resolveRuntimePaths } from '@murphai/runtime-state/node'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { afterEach, test, vi } from 'vitest'

import type {
  ConfiguredParserRegistryRuntime,
  InboxAppEnvironment,
  InboxParserServiceRuntime,
  InboxConnectorConfig,
  InboxPaths,
  InboxRuntimeConfig,
  InboxRuntimeModule,
  ParserDoctorRuntimeReport,
  ParserRuntimeDrainResult,
  ParsersRuntimeModule,
  PollConnector,
  PersistedCapture,
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeCaptureRecordInput,
  RuntimeStore,
} from '../src/inbox-app/types.ts'

const stateMocks = vi.hoisted(() => ({
  ensureInitialized: vi.fn(),
  readConfig: vi.fn(),
  requireConnector: vi.fn(),
  withInitializedInboxRuntime: vi.fn(),
}))

const promotionMocks = vi.hoisted(() => ({
  readPromotionsByCapture: vi.fn(),
}))

const connectorMocks = vi.hoisted(() => ({
  instantiateConnector: vi.fn(),
}))

const daemonMocks = vi.hoisted(() => ({
  createProcessSignalBridge: vi.fn(),
  normalizeDaemonState: vi.fn(),
  verifyDaemonStateForExpectedOwner: vi.fn(),
  writeDaemonState: vi.fn(),
}))

const processKillMocks = vi.hoisted(() => ({
  captureProcessIdentity: vi.fn(),
  tryKillProcess: vi.fn(),
}))

const linqRuntimeMocks = vi.hoisted(() => ({
  resolveLinqWebhookSecret: vi.fn(),
}))

vi.mock('../src/inbox-services/state.js', async () => {
  const actual = await vi.importActual<typeof import('../src/inbox-services/state.js')>(
    '../src/inbox-services/state.js',
  )
  return {
    ...actual,
    ensureInitialized: stateMocks.ensureInitialized,
    readConfig: stateMocks.readConfig,
    requireConnector: stateMocks.requireConnector,
    withInitializedInboxRuntime: stateMocks.withInitializedInboxRuntime,
  }
})

vi.mock('../src/inbox-services/promotions.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/inbox-services/promotions.js')
  >('../src/inbox-services/promotions.js')
  return {
    ...actual,
    readPromotionsByCapture: promotionMocks.readPromotionsByCapture,
  }
})

vi.mock('../src/inbox-services/connectors.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/inbox-services/connectors.js')
  >('../src/inbox-services/connectors.js')
  return {
    ...actual,
    instantiateConnector: connectorMocks.instantiateConnector,
  }
})

vi.mock('../src/inbox-services/daemon.js', async () => {
  const actual = await vi.importActual<typeof import('../src/inbox-services/daemon.js')>(
    '../src/inbox-services/daemon.js',
  )
  return {
    ...actual,
    createProcessSignalBridge: daemonMocks.createProcessSignalBridge,
    normalizeDaemonState: daemonMocks.normalizeDaemonState,
    verifyDaemonStateForExpectedOwner:
      daemonMocks.verifyDaemonStateForExpectedOwner,
    writeDaemonState: daemonMocks.writeDaemonState,
  }
})

vi.mock('@murphai/runtime-state/node', async () => {
  const actual = await vi.importActual<typeof import('@murphai/runtime-state/node')>(
    '@murphai/runtime-state/node',
  )
  return {
    ...actual,
    captureProcessIdentity: processKillMocks.captureProcessIdentity,
    tryKillProcess: processKillMocks.tryKillProcess,
  }
})

vi.mock('@murphai/operator-config/linq-runtime', () => ({
  resolveLinqWebhookSecret: linqRuntimeMocks.resolveLinqWebhookSecret,
}))

import { createInboxReadOps } from '../src/inbox-app/reads.ts'
import { createInboxRuntimeOps } from '../src/inbox-app/runtime.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) =>
      rm(tempRoot, { force: true, recursive: true }),
    ),
  )
})

async function createTempPaths(): Promise<InboxPaths> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'inbox-app-reads-runtime-'))
  tempRoots.push(tempRoot)
  return resolveRuntimePaths(tempRoot)
}

function createAttachment(
  overrides: Partial<RuntimeAttachmentRecord> & Pick<RuntimeAttachmentRecord, 'kind' | 'ordinal'>,
): RuntimeAttachmentRecord {
  const { kind, ordinal, ...rest } = overrides
  return {
    attachmentId: 'attachment-1',
    kind,
    ordinal,
    parseState: null,
    ...rest,
  }
}

function createCapture(
  overrides: Partial<RuntimeCaptureRecord> = {},
): RuntimeCaptureRecord {
  return {
    accountId: 'bot',
    actor: {
      displayName: 'Inbox user',
      id: 'actor-1',
      isSelf: false,
    },
    attachments: [],
    captureId: 'capture-1',
    createdAt: '2026-04-08T00:00:00.000Z',
    sourceDirectory: 'raw/inbox/telegram/bot/capture-1',
    eventId: 'event-1',
    externalId: 'external-1',
    occurredAt: '2026-04-08T00:00:00.000Z',
    raw: {},
    receivedAt: '2026-04-08T00:00:01.000Z',
    source: 'telegram',
    text: 'hello from inbox',
    thread: {
      id: 'thread-1',
      isDirect: true,
      title: 'Inbox thread',
    },
    ...overrides,
  }
}

function createInboundCapture(
  overrides: Partial<RuntimeCaptureRecordInput> &
    Pick<RuntimeCaptureRecordInput, 'externalId' | 'occurredAt' | 'source' | 'text'>,
): RuntimeCaptureRecordInput {
  return {
    accountId: 'bot',
    actor: {
      displayName: 'Inbox user',
      id: 'actor-1',
      isSelf: false,
    },
    attachments: [],
    raw: {},
    thread: {
      id: 'thread-1',
      isDirect: true,
      title: 'Inbox thread',
    },
    ...overrides,
  }
}

function createPersistedCapture(
  overrides: Partial<PersistedCapture> = {},
): PersistedCapture {
  return {
    captureId: 'capture-1',
    createdAt: '2026-04-08T00:00:00.000Z',
    deduped: false,
    sourceDirectory: 'raw/inbox/telegram/bot/capture-1',
    eventId: 'event-1',
    ...overrides,
  }
}

function createRuntimeStore(input: {
  captures: RuntimeCaptureRecord[]
  jobs?: RuntimeAttachmentParseJobRecord[]
  requeueCount?: number
}) {
  const close = vi.fn()
  const cursorStore = new Map<string, Record<string, unknown> | null>()
  const getKey = (source: string, accountId?: string | null) =>
    `${source}:${accountId ?? 'default'}`
  const runtime = {
    claimNextAttachmentParseJob() {
      return null
    },
    redactCaptureText() {
      return false
    },
    close,
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
    databasePath: '/tmp/inboxd.sqlite',
    enqueueDerivedJobs() {},
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
    findByExternalId() {
      return null
    },
    getCapture(captureId: string) {
      return input.captures.find((capture) => capture.captureId === captureId) ?? null
    },
    getAttachment(attachmentId: string) {
      for (const capture of input.captures) {
        const attachment = capture.attachments.find(
          (candidate) => candidate.attachmentId === attachmentId,
        )
        if (attachment) {
          return { capture, attachment }
        }
      }
      return null
    },
    getCursor(source, accountId) {
      return cursorStore.get(getKey(source, accountId)) ?? null
    },
    listAttachmentParseJobs(filters) {
      const jobs = input.jobs ?? []
      const limit = filters?.limit ?? jobs.length
      return jobs
        .filter((job) =>
          filters?.attachmentId ? job.attachmentId === filters.attachmentId : true,
        )
        .filter((job) =>
          filters?.captureId ? job.captureId === filters.captureId : true,
        )
        .filter((job) => (filters?.state ? job.state === filters.state : true))
        .slice(0, limit)
    },
    listCaptures(filters) {
      const captures = input.captures.filter((capture) =>
        filters?.source ? capture.source === filters.source : true,
      )
      const limit = filters?.limit ?? captures.length
      return captures.slice(0, limit)
    },
    requeueAttachmentParseJobs() {
      return input.jobs ? (input.requeueCount ?? 1) : 0
    },
    searchCaptures(filters) {
      return input.captures
        .filter((capture) =>
          filters.source ? capture.source === filters.source : true,
        )
        .map((capture) => ({
          accountId: capture.accountId ?? null,
          captureId: capture.captureId,
          sourceDirectory: capture.sourceDirectory,
          occurredAt: capture.occurredAt,
          score: 1,
          snippet: capture.text ?? '',
          source: capture.source,
          text: capture.text,
          threadId: capture.thread.id,
          threadTitle: capture.thread.title ?? null,
        }))
        .slice(0, filters.limit ?? input.captures.length)
    },
    setCursor(source, accountId, cursor) {
      cursorStore.set(getKey(source, accountId), cursor ?? null)
    },
    upsertCaptureIndex() {
      return 'capture-index'
    },
  } satisfies RuntimeStore & {
    databasePath: string
    redactCaptureText(): boolean
    enqueueDerivedJobs(input: { captureId: string; stored: unknown }): void
    findByExternalId(
      source: string,
      accountId: string | null | undefined,
      externalId: string,
    ): PersistedCapture | null
    upsertCaptureIndex(input: {
      captureId: string
      eventId: string
      input: RuntimeCaptureRecordInput
      stored: unknown
    }): string
  }

  return {
    close,
    cursorStore,
    runtime,
  }
}

function createParsersModule(
  drain: (
    input?: { attachmentId?: string; captureId?: string; maxJobs?: number },
  ) => Promise<ParserRuntimeDrainResult[]>,
): ParsersRuntimeModule {
  const doctor: ParserDoctorRuntimeReport = {
    configPath: '/tmp/parser-toolchain.json',
    discoveredAt: '2026-04-08T00:00:00.000Z',
    tools: {
      ffmpeg: {
        available: true,
        command: '/usr/bin/ffmpeg',
        reason: 'configured',
        source: 'config',
      },
      whisper: {
        available: true,
        command: '/usr/bin/whisper',
        modelPath: '/tmp/model.bin',
        reason: 'configured',
        source: 'config',
      },
    },
  }
  const registry: ConfiguredParserRegistryRuntime = {
    doctor,
    ffmpeg: {
      commandCandidates: ['/usr/bin/ffmpeg'],
    },
    registry: { id: 'registry' },
  }
  const service: InboxParserServiceRuntime = {
    drain,
  }

  return {
    async compactLegacyParserAttempts() {
      throw new Error('not used in reads/runtime tests')
    },
    createConfiguredParserRegistry: vi.fn(async () => registry),
    createInboxParserService: vi.fn(() => service),
    discoverParserToolchain: vi.fn(async () => doctor),
    writeParserToolchainConfig: vi.fn(async (input: { vaultRoot: string }) => ({
      config: {
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      configPath: path.join(input.vaultRoot, 'derived', 'inbox', 'parser-toolchain.json'),
    })),
  }
}

function createInboxModule(
  overrides: Partial<InboxRuntimeModule> = {},
): InboxRuntimeModule {
  return {
    async createInboxPipeline() {
      throw new Error('not used in reads/runtime tests')
    },
    createAgentmailApiPollDriver() {
      throw new Error('not used in reads/runtime tests')
    },
    createEmailPollConnector() {
      throw new Error('not used in reads/runtime tests')
    },
    createTelegramBotApiPollDriver() {
      throw new Error('not used in reads/runtime tests')
    },
    createTelegramPollConnector() {
      throw new Error('not used in reads/runtime tests')
    },
    async ensureInboxVault() {},
    async openInboxRuntime() {
      throw new Error('not used in reads/runtime tests')
    },
    async createParsedInboxPipeline() {
      throw new Error('not used in reads/runtime tests')
    },
    async rebuildRuntimeFromVault() {},
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
    async runInboxDaemon() {},
    async runPollConnectorBackfill() {
      throw new Error('not used in reads/runtime tests')
    },
    async runInboxDaemonWithParsers() {},
    ...overrides,
  }
}

function createEnv(
  overrides: Partial<InboxAppEnvironment> = {},
): InboxAppEnvironment {
  return {
    clock: () => new Date('2026-04-08T12:00:00.000Z'),
    createConfiguredAgentmailClient() {
      throw new Error('not used in reads/runtime tests')
    },
    enableAssistantAutoReplyChannel: async () => false,
    getEnvironment: () => ({ LINQ_WEBHOOK_SECRET: 'linq-secret' }),
    getHomeDirectory: () => '/tmp/home',
    getPid: () => 321,
    getPlatform: () => 'linux',
    journalPromotionEnabled: false,
    killProcess() {},
    loadConfiguredEmailDriver: async () => {
      throw new Error('not used in reads/runtime tests')
    },
    loadConfiguredTelegramDriver: async () => {
      throw new Error('not used in reads/runtime tests')
    },
    loadCore: async () => {
      throw new Error('not used in reads/runtime tests')
    },
    loadImporters: async () => {
      throw new Error('not used in reads/runtime tests')
    },
    loadInbox: async () => {
      throw new Error('test did not provide loadInbox')
    },
    loadParsers: async () => {
      throw new Error('not used in reads/runtime tests')
    },
    loadQuery: async () => {
      throw new Error('not used in reads/runtime tests')
    },
    provisionOrRecoverAgentmailInbox: async () => ({
      accountId: 'mailbox-1',
      emailAddress: 'mailbox@example.com',
      provisionedMailbox: null,
      reusedMailbox: null,
    }),
    requireParsers: async () => {
      throw new Error('test did not provide requireParsers')
    },
    sleep: async () => {},
    tryResolveAgentmailInboxAddress: async () => null,
    usesInjectedEmailDriver: false,
    usesInjectedTelegramDriver: false,
    ...overrides,
  }
}

function createConnectorConfig(
  overrides: Partial<InboxConnectorConfig> & Pick<InboxConnectorConfig, 'id' | 'source'>,
): InboxConnectorConfig {
  return {
    accountId: null,
    enabled: true,
    options: {},
    ...overrides,
  }
}

function createConfig(
  connectors: InboxConnectorConfig[],
): InboxRuntimeConfig {
  return { connectors }
}

test('read ops cover list, attachment status, show, and search flows', async () => {
  const paths = await createTempPaths()
  const audioAttachment = createAttachment({
    attachmentId: 'attachment-audio',
    fileName: 'voice-note.m4a',
    kind: 'audio',
    ordinal: 1,
    parseState: 'pending',
    storedPath: 'raw/inbox/capture-1/attachments/voice-note.m4a',
  })
  const otherAttachment = createAttachment({
    attachmentId: 'attachment-other',
    kind: 'other',
    ordinal: 2,
    parseState: 'succeeded',
  })
  const capture = createCapture({
    attachments: [audioAttachment, otherAttachment],
    source: 'telegram',
  })
  const promotion = { relatedId: 'doc-1', target: 'document' } as const
  const parseJobs: RuntimeAttachmentParseJobRecord[] = [
    {
      attachmentId: 'attachment-audio',
      attempts: 1,
      captureId: capture.captureId,
      createdAt: '2026-04-08T00:01:00.000Z',
      jobId: 'job-1',
      pipeline: 'attachment_text',
      state: 'running',
    },
    {
      attachmentId: 'attachment-other',
      attempts: 1,
      captureId: capture.captureId,
      createdAt: '2026-04-08T00:02:00.000Z',
      jobId: 'job-legacy-document',
      pipeline: 'attachment_text',
      state: 'succeeded',
    },
  ]
  const { runtime } = createRuntimeStore({
    captures: [capture],
    jobs: parseJobs,
    requeueCount: 2,
  })
  const env = createEnv()

  stateMocks.withInitializedInboxRuntime.mockImplementation(
    async (_loadInbox, _vault, fn) =>
      fn({
        paths,
        runtime,
      }),
  )
  const sourceConnector = createConnectorConfig({
    accountId: 'bot',
    id: 'telegram-main',
    source: 'telegram',
  })
  stateMocks.readConfig.mockResolvedValue(createConfig([sourceConnector]))
  stateMocks.requireConnector.mockReturnValue(sourceConnector)
  promotionMocks.readPromotionsByCapture.mockResolvedValue(
    new Map([[capture.captureId, [promotion]]]),
  )

  const ops = createInboxReadOps(env)

  const listed = await ops.list({
    requestId: null,
    sourceId: 'telegram-main',
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(listed.items.length, 1)
  assert.equal(listed.items[0]?.promotions[0]?.relatedId, 'doc-1')
  assert.equal(listed.filters.sourceId, 'telegram-main')

  const listedAttachments = await ops.listAttachments({
    captureId: capture.captureId,
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(listedAttachments.attachmentCount, 2)
  assert.equal(listedAttachments.attachments[1]?.parseState, null)

  const shownAttachment = await ops.showAttachment({
    attachmentId: 'attachment-audio',
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(shownAttachment.captureId, capture.captureId)
  assert.equal(shownAttachment.attachment.fileName, 'voice-note.m4a')

  const shownStatus = await ops.showAttachmentStatus({
    attachmentId: 'attachment-other',
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(shownStatus.parseable, false)
  assert.equal(shownStatus.currentState, null)
  assert.equal(shownStatus.jobs.length, 0)

  const shownAudioStatus = await ops.showAttachmentStatus({
    attachmentId: 'attachment-audio',
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(shownAudioStatus.parseable, true)
  assert.equal(shownAudioStatus.currentState, 'pending')
  assert.equal(shownAudioStatus.jobs.length, 1)

  const shownCapture = await ops.show({
    captureId: capture.captureId,
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(shownCapture.capture.attachments.length, 2)

  const searched = await ops.search({
    limit: 1,
    requestId: null,
    sourceId: 'telegram-main',
    text: 'hello',
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(searched.hits.length, 1)
  assert.equal(searched.hits[0]?.promotions[0]?.target, 'document')
})

test('read ops resolve attachments by direct runtime lookup instead of capture scanning', async () => {
  const paths = await createTempPaths()
  const captures = Array.from({ length: 201 }, (_, index) =>
    createCapture({
      captureId: `capture-${index + 1}`,
      attachments:
        index === 200
          ? [
              createAttachment({
                attachmentId: 'attachment-after-first-page',
                fileName: 'late.pdf',
                kind: 'document',
                ordinal: 1,
              }),
            ]
          : [],
    }),
  )
  const { runtime } = createRuntimeStore({ captures })
  runtime.listCaptures = vi.fn(() => {
    throw new Error('attachment lookup should not scan captures')
  })
  const env = createEnv()

  stateMocks.withInitializedInboxRuntime.mockImplementation(
    async (_loadInbox, _vault, fn) =>
      fn({
        paths,
        runtime,
      }),
  )

  const ops = createInboxReadOps(env)
  const shownAttachment = await ops.showAttachment({
    attachmentId: 'attachment-after-first-page',
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })

  assert.equal(shownAttachment.captureId, 'capture-201')
  assert.equal(shownAttachment.attachment.fileName, 'late.pdf')
})

test('read ops report empty parse-status state when no parse jobs exist yet', async () => {
  const paths = await createTempPaths()
  const capture = createCapture({
    attachments: [
      createAttachment({
        attachmentId: 'attachment-audio',
        kind: 'audio',
        ordinal: 1,
      }),
    ],
  })
  const { runtime } = createRuntimeStore({
    captures: [capture],
  })
  const env = createEnv()

  stateMocks.withInitializedInboxRuntime.mockImplementation(
    async (_loadInbox, _vault, fn) =>
      fn({
        paths,
        runtime,
      }),
  )
  stateMocks.readConfig.mockResolvedValue(createConfig([]))
  promotionMocks.readPromotionsByCapture.mockResolvedValue(new Map())

  const ops = createInboxReadOps(env)

  assert.deepEqual(
    await ops.showAttachmentStatus({
      attachmentId: 'attachment-audio',
      requestId: null,
      vault: paths.absoluteVaultRoot,
    }),
    {
      attachmentId: 'attachment-audio',
      captureId: capture.captureId,
      currentState: null,
      jobs: [],
      parseable: true,
      vault: paths.absoluteVaultRoot,
    },
  )
})

test('read ops cover missing source filters and empty promotions', async () => {
  const paths = await createTempPaths()
  const parseableAttachment = createAttachment({
    attachmentId: 'attachment-audio',
    kind: 'audio',
    ordinal: 1,
  })
  const capture = createCapture({
    accountId: null,
    attachments: [parseableAttachment],
    captureId: 'capture-no-promotions',
    source: 'email',
    text: null,
    thread: {
      id: 'thread-no-title',
      isDirect: false,
    },
  })
  const { runtime } = createRuntimeStore({
    captures: [capture],
    jobs: [],
  })

  stateMocks.withInitializedInboxRuntime.mockImplementation(
    async (_loadInbox, _vault, fn) =>
      fn({
        paths,
        runtime,
      }),
  )
  stateMocks.readConfig.mockResolvedValue(createConfig([]))
  stateMocks.requireConnector.mockImplementation(() => {
    throw new Error('source lookup should not run when sourceId is absent')
  })
  promotionMocks.readPromotionsByCapture.mockResolvedValue(new Map())

  const ops = createInboxReadOps(createEnv())

  const listed = await ops.list({
    afterCaptureId: '   ',
    afterOccurredAt: '   ',
    oldestFirst: undefined,
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(listed.filters.sourceId, null)
  assert.equal(listed.filters.afterCaptureId, null)
  assert.equal(listed.items[0]?.promotions.length, 0)

  const shown = await ops.show({
    captureId: capture.captureId,
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(shown.capture.promotions.length, 0)

  const searched = await ops.search({
    requestId: null,
    text: 'unused',
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(searched.filters.sourceId, null)
  assert.equal(searched.hits[0]?.accountId, null)
  assert.equal(searched.hits[0]?.threadTitle, null)
  assert.equal(searched.hits[0]?.promotions.length, 0)

})

test('runtime ops parse, requeue, status, and stop stay deterministic', async () => {
  const paths = await createTempPaths()
  const parseJob: RuntimeAttachmentParseJobRecord = {
    attachmentId: 'attachment-audio',
    attempts: 1,
    captureId: 'capture-1',
    createdAt: '2026-04-08T00:01:00.000Z',
    jobId: 'job-parse',
    pipeline: 'attachment_text',
    state: 'failed',
  }
  const { close, runtime } = createRuntimeStore({
    captures: [
      createCapture({
        attachments: [
          createAttachment({
            attachmentId: 'attachment-audio',
            kind: 'audio',
            ordinal: 1,
          }),
        ],
      }),
    ],
    jobs: [parseJob],
  })
  const parserDrain: (
    input?: { attachmentId?: string; captureId?: string; maxJobs?: number },
  ) => Promise<ParserRuntimeDrainResult[]> = vi.fn(async () => [
    {
      errorCode: 'PARSE_FAILED',
      errorMessage: 'bad input',
      job: parseJob,
      resultPath: undefined,
      providerId: undefined,
      status: 'failed' as const,
    },
  ])
  const inboxModule = createInboxModule({
    openInboxRuntime: vi.fn(async () => runtime),
  })
  const env = createEnv({
    loadInbox: async () => inboxModule,
    requireParsers: vi.fn(async () => createParsersModule(parserDrain)),
    sleep: vi.fn(async () => {}),
  })
  const runningState = {
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: ['telegram-main'],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: 444,
    running: true,
    stale: false,
    startedAt: '2026-04-08T11:59:00.000Z',
    statePath: '.runtime/operations/inbox/state.json',
    status: 'running',
    stoppedAt: null,
  }
  const stoppedState = {
    ...runningState,
    message: 'stopped',
    running: false,
    status: 'stopped',
    stoppedAt: '2026-04-08T12:00:01.000Z',
  }

  stateMocks.ensureInitialized.mockResolvedValue(paths)
  daemonMocks.normalizeDaemonState
    .mockResolvedValueOnce(runningState)
    .mockResolvedValueOnce(runningState)
    .mockResolvedValueOnce(stoppedState)
  daemonMocks.verifyDaemonStateForExpectedOwner.mockResolvedValue({
    verified: true,
    state: runningState,
  })

  const ops = createInboxRuntimeOps(env)

  const parsed = await ops.parse({
    captureId: 'capture-1',
    limit: 5,
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(parsed.attempted, 1)
  assert.equal(parsed.failed, 1)

  const requeued = await ops.requeue({
    attachmentId: 'attachment-audio',
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(requeued.count, 1)
  assert.equal(requeued.filters.state, 'failed')

  const status = await ops.status({
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(status.status, 'running')

  const stopped = await ops.stop({
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(stopped.status, 'stopped')
  assert.deepEqual(
    processKillMocks.tryKillProcess.mock.calls.map((call) => call[2]),
    ['SIGCONT', 'SIGTERM'],
  )
  assert.ok(close.mock.calls.length >= 2)
})

test('runtime stop rejects idle state, escalates to SIGKILL, and surfaces timeout paths deterministically', async () => {
  const paths = await createTempPaths()
  stateMocks.ensureInitialized.mockResolvedValue(paths)

  const ops = createInboxRuntimeOps(
    createEnv({
      sleep: vi.fn(async () => {}),
    }),
  )
  daemonMocks.verifyDaemonStateForExpectedOwner.mockReset()

  daemonMocks.normalizeDaemonState.mockResolvedValueOnce({
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: [],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: null,
    running: false,
    stale: false,
    startedAt: null,
    statePath: '.runtime/operations/inbox/state.json',
    status: 'idle',
    stoppedAt: null,
  })
  await assert.rejects(
    () =>
      ops.stop({
        requestId: null,
        vault: paths.absoluteVaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultCliError && error.code === 'INBOX_NOT_RUNNING',
  )
  assert.equal(processKillMocks.tryKillProcess.mock.calls.length, 0)

  daemonMocks.normalizeDaemonState.mockResolvedValueOnce({
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: [],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: 'Stale daemon state found; recorded PID belongs to a different process.',
    pid: 888,
    running: false,
    stale: true,
    startedAt: '2026-04-08T11:50:00.000Z',
    statePath: '.runtime/operations/inbox/state.json',
    status: 'stale',
    stoppedAt: '2026-04-08T12:00:00.000Z',
  })
  await assert.rejects(
    () =>
      ops.stop({
        requestId: null,
        vault: paths.absoluteVaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultCliError && error.code === 'INBOX_NOT_RUNNING',
  )
  assert.equal(processKillMocks.tryKillProcess.mock.calls.length, 0)

  const runningState = {
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: ['telegram-main'],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: 777,
    running: true,
    stale: false,
    startedAt: '2026-04-08T11:50:00.000Z',
    statePath: '.runtime/operations/inbox/state.json',
    status: 'running',
    stoppedAt: null,
  }
  const stoppedState = {
    ...runningState,
    message: 'killed',
    running: false,
    status: 'stopped',
    stoppedAt: '2026-04-08T12:00:02.000Z',
  }
  daemonMocks.normalizeDaemonState.mockResolvedValueOnce(runningState)
  daemonMocks.verifyDaemonStateForExpectedOwner.mockResolvedValueOnce({
    verified: false,
    state: runningState,
    reason: 'identity-unverifiable',
  })
  await assert.rejects(
    () =>
      ops.stop({
        requestId: null,
        vault: paths.absoluteVaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultCliError && error.code === 'INBOX_STOP_UNVERIFIED',
  )
  assert.equal(processKillMocks.tryKillProcess.mock.calls.length, 0)

  let forceStopReads = 0
  daemonMocks.normalizeDaemonState.mockImplementation(async () => {
    forceStopReads += 1
    if (forceStopReads === 1) {
      return runningState
    }
    if (forceStopReads <= 52) {
      return runningState
    }
    return stoppedState
  })
  daemonMocks.verifyDaemonStateForExpectedOwner.mockResolvedValue({
    verified: true,
    state: runningState,
  })

  const forceStopped = await ops.stop({
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(forceStopped.status, 'stopped')
  assert.deepEqual(
    processKillMocks.tryKillProcess.mock.calls.slice(-3).map((call) => call[2]),
    ['SIGCONT', 'SIGTERM', 'SIGKILL'],
  )

  daemonMocks.normalizeDaemonState.mockImplementation(async () => runningState)
  await assert.rejects(
    () =>
      ops.stop({
        requestId: null,
        vault: paths.absoluteVaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultCliError && error.code === 'INBOX_STOP_TIMEOUT',
  )
})

test('runtime stop re-verifies daemon ownership before SIGKILL and stops on stale state', async () => {
  const paths = await createTempPaths()
  stateMocks.ensureInitialized.mockResolvedValue(paths)

  const ops = createInboxRuntimeOps(
    createEnv({
      sleep: vi.fn(async () => {}),
    }),
  )
  daemonMocks.verifyDaemonStateForExpectedOwner.mockReset()

  const runningState = {
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: ['telegram-main'],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: 777,
    running: true,
    stale: false,
    startedAt: '2026-04-08T11:50:00.000Z',
    statePath: '.runtime/operations/inbox/state.json',
    status: 'running',
    stoppedAt: null,
  }
  const staleState = {
    ...runningState,
    message: 'Stale daemon state found; recorded PID belongs to a different process.',
    running: false,
    stale: true,
    status: 'stale',
    stoppedAt: '2026-04-08T12:00:00.000Z',
  }

  daemonMocks.normalizeDaemonState.mockResolvedValue(runningState)
  daemonMocks.verifyDaemonStateForExpectedOwner
    .mockResolvedValueOnce({ verified: true, state: runningState })
    .mockResolvedValueOnce({
      verified: false,
      state: staleState,
      reason: 'pid-not-running',
    })

  const stopped = await ops.stop({
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })

  assert.equal(stopped.status, 'stale')
  assert.equal(stopped.stale, true)
  assert.deepEqual(
    processKillMocks.tryKillProcess.mock.calls.map((call) => call[2]),
    ['SIGCONT', 'SIGTERM'],
  )
})

test('runtime stop refuses SIGKILL when daemon generation changes under the same pid', async () => {
  const paths = await createTempPaths()
  stateMocks.ensureInitialized.mockResolvedValue(paths)

  const ops = createInboxRuntimeOps(
    createEnv({
      sleep: vi.fn(async () => {}),
    }),
  )
  daemonMocks.verifyDaemonStateForExpectedOwner.mockReset()

  const runningState = {
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: ['telegram-main'],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: 777,
    running: true,
    stale: false,
    startedAt: '2026-04-08T11:50:00.000Z',
    statePath: '.runtime/operations/inbox/state.json',
    status: 'running',
    stoppedAt: null,
  }
  const changedState = {
    ...runningState,
    message: 'Stale daemon state found; daemon ownership changed while stopping.',
    running: false,
    stale: true,
    startedAt: '2026-04-08T11:59:59.000Z',
    status: 'stale',
    stoppedAt: '2026-04-08T12:00:00.000Z',
  }

  daemonMocks.normalizeDaemonState.mockResolvedValue(runningState)
  daemonMocks.verifyDaemonStateForExpectedOwner
    .mockResolvedValueOnce({ verified: true, state: runningState })
    .mockResolvedValueOnce({
      verified: false,
      state: changedState,
      reason: 'owner-changed',
    })

  await assert.rejects(
    () =>
      ops.stop({
        requestId: null,
        vault: paths.absoluteVaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultCliError && error.code === 'INBOX_STOP_UNVERIFIED',
  )
  assert.deepEqual(
    processKillMocks.tryKillProcess.mock.calls.map((call) => call[2]),
    ['SIGCONT', 'SIGTERM'],
  )
})

test('runtime backfill imports captures, updates cursors, and drains parsers only for new captures', async () => {
  const paths = await createTempPaths()
  const connector = createConnectorConfig({
    id: 'telegram-main',
    source: 'telegram',
  })
  const emittedCapture = createCapture({
    attachments: [
      createAttachment({
        attachmentId: 'attachment-audio',
        kind: 'audio',
        ordinal: 1,
      }),
    ],
    captureId: 'capture-imported',
    externalId: 'external-imported',
  })
  const parseJob: RuntimeAttachmentParseJobRecord = {
    attachmentId: 'attachment-audio',
    attempts: 1,
    captureId: 'capture-imported',
    createdAt: '2026-04-08T00:02:00.000Z',
    jobId: 'job-backfill',
    pipeline: 'attachment_text',
    state: 'succeeded',
  }
  const { runtime } = createRuntimeStore({
    captures: [emittedCapture],
  })
  const processCapture = vi
    .fn<(capture: RuntimeCaptureRecordInput) => Promise<PersistedCapture>>()
    .mockResolvedValueOnce(
      createPersistedCapture({ captureId: emittedCapture.captureId }),
    )
    .mockResolvedValueOnce(
      createPersistedCapture({
        captureId: 'capture-deduped',
        deduped: true,
      }),
    )
  const pipeline = {
    close: vi.fn(),
    processCapture,
    runtime,
  }
  const parserDrain: (
    input?: { attachmentId?: string; captureId?: string; maxJobs?: number },
  ) => Promise<ParserRuntimeDrainResult[]> = vi.fn(async () => [
    {
      errorCode: undefined,
      errorMessage: undefined,
      job: parseJob,
      resultPath: path.join(paths.absoluteVaultRoot, 'derived/inbox/backfill.json'),
      providerId: 'parser-1',
      status: 'succeeded' as const,
    },
  ])
  const createParsedInboxPipeline = vi.fn(async (input: {
    drainParsersOnDeduped?: boolean
    onParserDrain?: (results: ParserRuntimeDrainResult[]) => Promise<void> | void
  }) => ({
    close: pipeline.close,
    runtime,
    async processCapture(capture: RuntimeCaptureRecordInput) {
      const persisted = await processCapture(capture)
      if (!persisted.deduped) {
        await input.onParserDrain?.(await parserDrain({ captureId: persisted.captureId }))
      }
      return persisted
    },
  }))
  const runPollConnectorBackfill = vi.fn(async (input: {
    connector: PollConnector
    pipeline: { processCapture(capture: RuntimeCaptureRecordInput): Promise<PersistedCapture> }
    accountId?: string | null
  }) => {
    assert.equal(input.accountId, 'bot')
    return {
      cursor: await input.connector.backfill(null, async (capture) =>
        input.pipeline.processCapture(capture),
      ),
    }
  })
  const inboxModule = createInboxModule({
    createParsedInboxPipeline,
    openInboxRuntime: vi.fn(async () => runtime),
    runPollConnectorBackfill,
  })

  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(createConfig([connector]))
  stateMocks.requireConnector.mockReturnValue(connector)
  connectorMocks.instantiateConnector.mockResolvedValue({
    accountId: 'bot',
    backfill: async (_cursor, emit) => {
      await emit(
        createInboundCapture({
          accountId: 'bot',
          externalId: 'external-imported',
          occurredAt: emittedCapture.occurredAt,
          source: 'telegram',
          text: emittedCapture.text,
        }),
      )
      await emit(
        createInboundCapture({
          accountId: 'bot',
          externalId: 'external-deduped',
          occurredAt: emittedCapture.occurredAt,
          source: 'telegram',
          text: 'deduped',
        }),
        { marker: 'checkpoint' },
      )
      return { marker: 'next' }
    },
    capabilities: {
      attachments: true,
      backfill: true,
      watch: true,
      webhooks: false,
    },
    close: vi.fn(),
    id: connector.id,
    kind: 'poll',
    source: 'telegram',
    watch: async () => {},
  } satisfies PollConnector)
  linqRuntimeMocks.resolveLinqWebhookSecret.mockReturnValue('linq-secret')

  const ops = createInboxRuntimeOps(
    createEnv({
      loadInbox: async () => inboxModule,
      requireParsers: vi.fn(async () => createParsersModule(parserDrain)),
    }),
  )

  const backfilled = await ops.backfill({
    limit: 10,
    parse: true,
    requestId: null,
    sourceId: connector.id,
    vault: paths.absoluteVaultRoot,
  })

  assert.equal(backfilled.importedCount, 1)
  assert.equal(backfilled.dedupedCount, 1)
  assert.deepEqual(backfilled.cursor, { marker: 'next' })
  assert.equal(backfilled.parse?.attempted, 1)
  assert.equal(createParsedInboxPipeline.mock.calls.length, 1)
  assert.equal(
    createParsedInboxPipeline.mock.calls[0]?.[0]?.drainParsersOnDeduped,
    false,
  )
  assert.equal(runPollConnectorBackfill.mock.calls.length, 1)
  assert.equal(pipeline.close.mock.calls.length, 1)
})

test('runtime run rejects empty connector sets before daemon startup', async () => {
  const paths = await createTempPaths()
  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(
    createConfig([
      createConnectorConfig({
        enabled: false,
        id: 'telegram-main',
        source: 'telegram',
      }),
    ]),
  )

  const ops = createInboxRuntimeOps(
    createEnv({
      loadInbox: async () =>
        createInboxModule({
          openInboxRuntime: vi.fn(),
          runInboxDaemonWithParsers: vi.fn(),
        }),
      requireParsers: vi.fn(async () => createParsersModule(vi.fn())),
    }),
  )

  await assert.rejects(
    () =>
      ops.run(
        {
          requestId: null,
          vault: paths.absoluteVaultRoot,
        },
        {},
      ),
    (error: unknown) =>
      error instanceof VaultCliError && error.code === 'INBOX_NO_ENABLED_SOURCES',
  )
})

test('runtime run rejects pre-existing daemon state owned by another pid', async () => {
  const paths = await createTempPaths()
  const connector = createConnectorConfig({
    id: 'telegram-main',
    source: 'telegram',
  })
  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(createConfig([connector]))
  daemonMocks.normalizeDaemonState.mockResolvedValue({
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: [connector.id],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: 999,
    running: true,
    stale: false,
    startedAt: '2026-04-08T11:50:00.000Z',
    statePath: '.runtime/operations/inbox/state.json',
    status: 'running',
    stoppedAt: null,
  })

  const ops = createInboxRuntimeOps(
    createEnv({
      loadInbox: async () =>
        createInboxModule({
          openInboxRuntime: vi.fn(),
          runInboxDaemonWithParsers: vi.fn(),
        }),
      requireParsers: vi.fn(async () => createParsersModule(vi.fn())),
    }),
  )

  await assert.rejects(
    () =>
      ops.run(
        {
          requestId: null,
          vault: paths.absoluteVaultRoot,
        },
        {},
      ),
    (error: unknown) =>
      error instanceof VaultCliError && error.code === 'INBOX_ALREADY_RUNNING',
  )
})

test('runtime run rejects enabled connectors outside the supported source list', async () => {
  const paths = await createTempPaths()
  const connector = createConnectorConfig({
    id: 'unsupported-main',
    source: 'unsupported' as never,
  })
  const onEvent = vi.fn()

  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(createConfig([connector]))
  daemonMocks.normalizeDaemonState.mockResolvedValue({
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: [],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: null,
    running: false,
    stale: false,
    startedAt: null,
    statePath: '.runtime/operations/inbox/state.json',
    status: 'idle',
    stoppedAt: null,
  })
  linqRuntimeMocks.resolveLinqWebhookSecret.mockReturnValue('linq-secret')

  const ops = createInboxRuntimeOps(
    createEnv({
      getPlatform: () => 'linux',
      loadInbox: async () =>
        createInboxModule({
          openInboxRuntime: vi.fn(),
          runInboxDaemonWithParsers: vi.fn(),
        }),
      requireParsers: vi.fn(async () => createParsersModule(vi.fn())),
    }),
  )

  await assert.rejects(
    () =>
      ops.run(
        {
          requestId: null,
          vault: paths.absoluteVaultRoot,
        },
        { onEvent },
      ),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_NO_SUPPORTED_SOURCES',
  )
  assert.equal(onEvent.mock.calls.length, 0)
  assert.equal(connectorMocks.instantiateConnector.mock.calls.length, 0)
})

test('runtime run writes failed daemon state when the daemon surface throws', async () => {
  const paths = await createTempPaths()
  const connector = createConnectorConfig({
    id: 'telegram-main',
    source: 'telegram',
  })
  const cleanup = vi.fn()
  const inboxModule = createInboxModule({
    openInboxRuntime: vi.fn(async () => createRuntimeStore({ captures: [] }).runtime),
    runInboxDaemonWithParsers: vi.fn(async () => {
      throw new Error(
        "daemon failed for https://agentmail.example.test/inboxes/user@example.test at '/tmp/inbox/state' while notifying 415 555 0100",
      )
    }),
  })

  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(createConfig([connector]))
  processKillMocks.captureProcessIdentity.mockResolvedValue({
    pid: 321,
    platform: 'linux',
    startToken: 'linux-proc-start:321',
  })
  daemonMocks.createProcessSignalBridge.mockReturnValue({
    cleanup,
    signal: new AbortController().signal,
  })
  daemonMocks.normalizeDaemonState.mockResolvedValue({
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: [],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: null,
    running: false,
    stale: false,
    startedAt: null,
    statePath: '.runtime/operations/inbox/state.json',
    status: 'idle',
    stoppedAt: null,
  })
  connectorMocks.instantiateConnector.mockResolvedValue({
    capabilities: {
      attachments: true,
      backfill: true,
      watch: true,
      webhooks: false,
    },
    async backfill() {
      return null
    },
    id: connector.id,
    kind: 'poll',
    source: connector.source,
    async watch() {},
  } satisfies PollConnector)
  linqRuntimeMocks.resolveLinqWebhookSecret.mockReturnValue('linq-secret')

  const ops = createInboxRuntimeOps(
    createEnv({
      loadInbox: async () => inboxModule,
      requireParsers: vi.fn(async () => createParsersModule(vi.fn(async () => []))),
    }),
  )

  await assert.rejects(
    () =>
      ops.run({
        requestId: null,
        vault: paths.absoluteVaultRoot,
      }),
    /daemon failed/,
  )
  assert.deepEqual(
    daemonMocks.writeDaemonState.mock.calls.map((call) => call[1].status),
    ['running', 'failed'],
  )
  assert.deepEqual(daemonMocks.writeDaemonState.mock.calls[1]?.[1], {
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: ['telegram-main'],
    databasePath: '.runtime/projections/inboxd.sqlite',
    failureCategory: 'unexpected_error',
    failureCode: 'INBOX_DAEMON_RUN_FAILED',
    message: "daemon failed for <redacted-url> at '<redacted-path>' while notifying <redacted-phone>",
    pid: 321,
    running: false,
    stale: false,
    startedAt: '2026-04-08T12:00:00.000Z',
    statePath: '.runtime/operations/inbox/state.json',
    status: 'failed',
    stoppedAt: '2026-04-08T12:00:00.000Z',
  })
  assert.equal(cleanup.mock.calls.length, 1)
})

test('runtime run instruments connector backfill/watch events and records daemon state', async () => {
  const paths = await createTempPaths()
  const connector = createConnectorConfig({
    id: 'telegram-main',
    source: 'telegram',
  })
  const onEvent = vi.fn()
  const cleanup = vi.fn()
  const abortController = new AbortController()
  const inboxModule = createInboxModule({
    openInboxRuntime: vi.fn(async () => createRuntimeStore({ captures: [] }).runtime),
    runInboxDaemonWithParsers: vi.fn(async ({ connectors, signal }) => {
      await connectors[0]?.backfill(null, async (capture: RuntimeCaptureRecordInput) =>
        createPersistedCapture({
          captureId: capture.externalId,
          deduped: capture.externalId === 'capture-deduped',
        }),
      )
      await connectors[0]?.watch?.(
        null,
        async (capture: RuntimeCaptureRecordInput) =>
          createPersistedCapture({
            captureId: capture.externalId,
          }),
        signal,
      )
    }),
  })

  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(createConfig([connector]))
  processKillMocks.captureProcessIdentity.mockResolvedValue({
    pid: 321,
    platform: 'linux',
    startToken: 'linux-proc-start:321',
  })
  daemonMocks.createProcessSignalBridge.mockReturnValue({
    cleanup,
    signal: abortController.signal,
  })
  daemonMocks.normalizeDaemonState.mockResolvedValue({
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: [],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: null,
    running: false,
    stale: false,
    startedAt: null,
    statePath: '.runtime/operations/inbox/state.json',
    status: 'idle',
    stoppedAt: null,
  })
  connectorMocks.instantiateConnector.mockResolvedValue({
    async backfill(_cursor, emit) {
      await emit(
        createInboundCapture({
          accountId: 'bot',
          externalId: 'capture-imported',
          occurredAt: '2026-04-08T00:00:00.000Z',
          source: 'telegram',
          text: 'imported',
        }),
      )
      await emit(
        createInboundCapture({
          accountId: 'bot',
          externalId: 'capture-deduped',
          occurredAt: '2026-04-08T00:01:00.000Z',
          source: 'telegram',
          text: 'deduped',
        }),
      )
      return null
    },
    capabilities: {
      attachments: true,
      backfill: true,
      watch: true,
      webhooks: false,
    },
    close: vi.fn(),
    id: connector.id,
    kind: 'poll',
    source: 'telegram',
    async watch(_cursor, emit) {
      await emit(
        createInboundCapture({
          accountId: 'bot',
          externalId: 'capture-watch',
          occurredAt: '2026-04-08T00:02:00.000Z',
          source: 'telegram',
          text: 'watch import',
        }),
      )
    },
  } satisfies PollConnector)
  linqRuntimeMocks.resolveLinqWebhookSecret.mockReturnValue('linq-secret')

  const ops = createInboxRuntimeOps(
    createEnv({
      loadInbox: async () => inboxModule,
      requireParsers: vi.fn(async () => createParsersModule(vi.fn(async () => []))),
    }),
  )

  const result = await ops.run(
    {
      requestId: null,
      vault: paths.absoluteVaultRoot,
    },
    { onEvent },
  )

  assert.equal(result.reason, 'completed')
  assert.deepEqual(
    daemonMocks.writeDaemonState.mock.calls.map((call) => call[1].status),
    ['running', 'stopped'],
  )
  assert.deepEqual(daemonMocks.writeDaemonState.mock.calls[0]?.[2], {
    processIdentity: {
      pid: 321,
      platform: 'linux',
      startToken: 'linux-proc-start:321',
    },
  })
  assert.deepEqual(
    onEvent.mock.calls.map((call) => call[0].type),
    [
      'connector.backfill.started',
      'capture.imported',
      'connector.backfill.finished',
      'connector.watch.started',
      'capture.imported',
    ],
  )
  assert.deepEqual(
    onEvent.mock.calls
      .map((call) => call[0])
      .filter((event) => event.type === 'capture.imported')
      .map((event) => ({
        captureId: event.capture?.externalId ?? null,
        phase: event.phase ?? null,
      })),
    [
      {
        captureId: 'capture-imported',
        phase: 'backfill',
      },
      {
        captureId: 'capture-watch',
        phase: 'watch',
      },
    ],
  )
  assert.equal(cleanup.mock.calls.length, 1)
})

test('runtime run respects provided abort signals and records signal shutdown messages', async () => {
  const paths = await createTempPaths()
  const connector = createConnectorConfig({
    id: 'telegram-main',
    source: 'telegram',
  })
  const abortController = new AbortController()
  const inboxModule = createInboxModule({
    openInboxRuntime: vi.fn(async () => createRuntimeStore({ captures: [] }).runtime),
    runInboxDaemonWithParsers: vi.fn(async () => {
      abortController.abort()
    }),
  })

  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(createConfig([connector]))
  daemonMocks.normalizeDaemonState.mockResolvedValue({
    configPath: '.runtime/operations/inbox/config.json',
    connectorIds: [],
    databasePath: '.runtime/projections/inboxd.sqlite',
    message: null,
    pid: null,
    running: false,
    stale: false,
    startedAt: null,
    statePath: '.runtime/operations/inbox/state.json',
    status: 'idle',
    stoppedAt: null,
  })
  connectorMocks.instantiateConnector.mockResolvedValue({
    capabilities: {
      attachments: true,
      backfill: true,
      watch: true,
      webhooks: false,
    },
    async backfill() {
      return null
    },
    id: connector.id,
    kind: 'poll',
    source: connector.source,
    async watch() {},
  } satisfies PollConnector)
  linqRuntimeMocks.resolveLinqWebhookSecret.mockReturnValue('linq-secret')

  const ops = createInboxRuntimeOps(
    createEnv({
      loadInbox: async () => inboxModule,
      requireParsers: vi.fn(async () => createParsersModule(vi.fn(async () => []))),
    }),
  )

  const result = await ops.run(
    {
      requestId: null,
      vault: paths.absoluteVaultRoot,
    },
    { signal: abortController.signal },
  )

  assert.equal(result.reason, 'signal')
  assert.equal(
    daemonMocks.writeDaemonState.mock.calls.at(-1)?.[1]?.message,
    'Inbox daemon stopped by signal.',
  )
})
