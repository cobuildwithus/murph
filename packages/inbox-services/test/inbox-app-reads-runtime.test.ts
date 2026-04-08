import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { resolveRuntimePaths } from '@murphai/runtime-state/node'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { afterEach, test, vi } from 'vitest'

import type {
  InboxAppEnvironment,
  InboxConnectorConfig,
  InboxPaths,
  InboxRuntimeConfig,
  ParsersRuntimeModule,
  PollConnector,
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
  writeDaemonState: vi.fn(),
}))

const processKillMocks = vi.hoisted(() => ({
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
    writeDaemonState: daemonMocks.writeDaemonState,
  }
})

vi.mock('../src/process-kill.js', () => ({
  tryKillProcess: processKillMocks.tryKillProcess,
}))

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
  return {
    attachmentId: 'attachment-1',
    ordinal: overrides.ordinal,
    kind: overrides.kind,
    parseState: null,
    ...overrides,
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
    envelopePath: 'derived/inbox/capture-1/envelope.json',
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

function createRuntimeStore(input: {
  captures: RuntimeCaptureRecord[]
  jobs?: RuntimeAttachmentParseJobRecord[]
  requeueCount?: number
}) {
  const close = vi.fn()
  const cursorStore = new Map<string, Record<string, unknown> | null>()
  const getKey = (source: string, accountId?: string | null) =>
    `${source}:${accountId ?? 'default'}`
  const runtime: RuntimeStore = {
    close,
    getCapture(captureId) {
      return input.captures.find((capture) => capture.captureId === captureId) ?? null
    },
    getCursor(source, accountId) {
      return cursorStore.get(getKey(source, accountId)) ?? null
    },
    listAttachmentParseJobs: input.jobs
      ? (filters) => {
          const limit = filters?.limit ?? input.jobs?.length ?? 0
          return (input.jobs ?? [])
            .filter((job) =>
              filters?.attachmentId ? job.attachmentId === filters.attachmentId : true,
            )
            .filter((job) =>
              filters?.captureId ? job.captureId === filters.captureId : true,
            )
            .filter((job) => (filters?.state ? job.state === filters.state : true))
            .slice(0, limit)
        }
      : undefined,
    listCaptures(filters) {
      const captures = input.captures.filter((capture) =>
        filters?.source ? capture.source === filters.source : true,
      )
      const limit = filters?.limit ?? captures.length
      return captures.slice(0, limit)
    },
    requeueAttachmentParseJobs: input.jobs
      ? () => input.requeueCount ?? 1
      : undefined,
    searchCaptures(filters) {
      return input.captures
        .filter((capture) =>
          filters.source ? capture.source === filters.source : true,
        )
        .map((capture) => ({
          accountId: capture.accountId ?? null,
          captureId: capture.captureId,
          envelopePath: capture.envelopePath,
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
  }

  return {
    close,
    cursorStore,
    runtime,
  }
}

function createParsersModule(
  drain: ReturnType<typeof vi.fn>,
): ParsersRuntimeModule {
  return {
    createConfiguredParserRegistry: vi.fn(async () => ({
      ffmpeg: '/usr/bin/ffmpeg',
      registry: { id: 'registry' },
    })),
    createInboxParserService: vi.fn(() => ({
      drain,
    })),
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
    ensureConfiguredImessageReady: async () => {},
    getEnvironment: () => ({ LINQ_WEBHOOK_SECRET: 'linq-secret' }),
    getHomeDirectory: () => '/tmp/home',
    getPid: () => 321,
    getPlatform: () => 'linux',
    journalPromotionEnabled: false,
    killProcess() {},
    loadConfiguredEmailDriver: async () => {
      throw new Error('not used in reads/runtime tests')
    },
    loadConfiguredImessageDriver: async () => {
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
    loadInboxImessage: async () => {
      throw new Error('not used in reads/runtime tests')
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

test('read ops cover list, attachment, parse, reparse, show, and search flows', async () => {
  const paths = await createTempPaths()
  const documentAttachment = createAttachment({
    attachmentId: 'attachment-doc',
    fileName: 'invoice.pdf',
    kind: 'document',
    ordinal: 1,
    parseState: 'pending',
    storedPath: 'derived/inbox/capture-1/invoice.pdf',
  })
  const otherAttachment = createAttachment({
    attachmentId: 'attachment-other',
    kind: 'other',
    ordinal: 2,
  })
  const capture = createCapture({
    attachments: [documentAttachment, otherAttachment],
    source: 'telegram',
  })
  const promotion = { relatedId: 'doc-1', target: 'document' } as const
  const parseJobs: RuntimeAttachmentParseJobRecord[] = [
    {
      attachmentId: 'attachment-doc',
      attempts: 1,
      captureId: capture.captureId,
      createdAt: '2026-04-08T00:01:00.000Z',
      jobId: 'job-1',
      pipeline: 'attachment_text',
      state: 'running',
    },
  ]
  const { runtime } = createRuntimeStore({
    captures: [capture],
    jobs: parseJobs,
    requeueCount: 2,
  })
  const parserDrain = vi.fn(async () => [
    {
      errorCode: null,
      errorMessage: null,
      job: parseJobs[0],
      manifestPath: path.join(paths.absoluteVaultRoot, 'derived/inbox/job-1.json'),
      providerId: 'parser-1',
      status: 'succeeded',
    },
  ])
  const env = createEnv({
    requireParsers: vi.fn(async () => createParsersModule(parserDrain)),
  })

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
    text: undefined,
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

  const shownAttachment = await ops.showAttachment({
    attachmentId: 'attachment-doc',
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(shownAttachment.captureId, capture.captureId)
  assert.equal(shownAttachment.attachment.fileName, 'invoice.pdf')

  const shownStatus = await ops.showAttachmentStatus({
    attachmentId: 'attachment-other',
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(shownStatus.parseable, false)
  assert.equal(shownStatus.jobs.length, 0)

  const parsed = await ops.parseAttachment({
    attachmentId: 'attachment-doc',
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(parsed.parseable, true)
  assert.equal(parsed.attempted, 1)
  assert.equal(parsed.results[0]?.manifestPath, 'derived/inbox/job-1.json')

  const reparsed = await ops.reparseAttachment({
    attachmentId: 'attachment-doc',
    requestId: null,
    vault: paths.absoluteVaultRoot,
  })
  assert.equal(reparsed.requeuedJobs, 2)
  assert.equal(reparsed.currentState, 'pending')

  await assert.rejects(
    () =>
      ops.reparseAttachment({
        attachmentId: 'attachment-other',
        requestId: null,
        vault: paths.absoluteVaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
  )

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

test('read ops report unsupported parse-status boundaries when the runtime omits parse jobs', async () => {
  const paths = await createTempPaths()
  const capture = createCapture({
    attachments: [
      createAttachment({
        attachmentId: 'attachment-doc',
        kind: 'document',
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

  await assert.rejects(
    () =>
      ops.showAttachmentStatus({
        attachmentId: 'attachment-doc',
        requestId: null,
        vault: paths.absoluteVaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_ATTACHMENT_PARSE_UNSUPPORTED',
  )
})

test('read ops cover missing source filters, empty promotions, and missing reparse jobs', async () => {
  const paths = await createTempPaths()
  const parseableAttachment = createAttachment({
    attachmentId: 'attachment-doc',
    kind: 'document',
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

  await assert.rejects(
    () =>
      ops.reparseAttachment({
        attachmentId: 'attachment-doc',
        requestId: null,
        vault: paths.absoluteVaultRoot,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_ATTACHMENT_PARSE_MISSING',
  )
})

test('runtime ops parse, requeue, status, and stop stay deterministic', async () => {
  const paths = await createTempPaths()
  const parseJob: RuntimeAttachmentParseJobRecord = {
    attachmentId: 'attachment-doc',
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
            attachmentId: 'attachment-doc',
            kind: 'document',
            ordinal: 1,
          }),
        ],
      }),
    ],
    jobs: [parseJob],
  })
  const parserDrain = vi.fn(async () => [
    {
      errorCode: 'PARSE_FAILED',
      errorMessage: 'bad input',
      job: parseJob,
      manifestPath: null,
      providerId: null,
      status: 'failed',
    },
  ])
  const inboxModule = {
    openInboxRuntime: vi.fn(async () => runtime),
  }
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
    attachmentId: 'attachment-doc',
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
  let forceStopReads = 0
  daemonMocks.normalizeDaemonState.mockImplementation(async () => {
    forceStopReads += 1
    if (forceStopReads === 1) {
      return runningState
    }
    if (forceStopReads <= 51) {
      return runningState
    }
    return stoppedState
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

test('runtime backfill imports captures, updates cursors, and drains parsers only for new captures', async () => {
  const paths = await createTempPaths()
  const connector = createConnectorConfig({
    id: 'telegram-main',
    source: 'telegram',
  })
  const emittedCapture = createCapture({
    attachments: [
      createAttachment({
        attachmentId: 'attachment-doc',
        kind: 'document',
        ordinal: 1,
      }),
    ],
    captureId: 'capture-imported',
    externalId: 'external-imported',
  })
  const parseJob: RuntimeAttachmentParseJobRecord = {
    attachmentId: 'attachment-doc',
    attempts: 1,
    captureId: 'capture-imported',
    createdAt: '2026-04-08T00:02:00.000Z',
    jobId: 'job-backfill',
    pipeline: 'attachment_text',
    state: 'succeeded',
  }
  const { cursorStore, runtime } = createRuntimeStore({
    captures: [emittedCapture],
  })
  const processCapture = vi
    .fn<
      (capture: RuntimeCaptureRecordInput) => Promise<{ captureId?: string; deduped: boolean }>
    >()
    .mockResolvedValueOnce({ captureId: emittedCapture.captureId, deduped: false })
    .mockResolvedValueOnce({ captureId: undefined, deduped: true })
  const pipeline = {
    close: vi.fn(),
    processCapture,
  }
  const parserDrain = vi.fn(async () => [
    {
      errorCode: null,
      errorMessage: null,
      job: parseJob,
      manifestPath: path.join(paths.absoluteVaultRoot, 'derived/inbox/backfill.json'),
      providerId: 'parser-1',
      status: 'succeeded',
    },
  ])
  const inboxModule = {
    createInboxPipeline: vi.fn(async () => pipeline),
    openInboxRuntime: vi.fn(async () => runtime),
  }

  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(createConfig([connector]))
  stateMocks.requireConnector.mockReturnValue(connector)
  connectorMocks.instantiateConnector.mockResolvedValue({
    accountId: 'bot',
    backfill: async (_cursor, emit) => {
      await emit({
        accountId: 'bot',
        attachments: [],
        externalId: 'external-imported',
        occurredAt: emittedCapture.occurredAt,
        source: 'telegram',
        text: emittedCapture.text,
      })
      await emit(
        {
          accountId: 'bot',
          attachments: [],
          externalId: 'external-deduped',
          occurredAt: emittedCapture.occurredAt,
          source: 'telegram',
          text: 'deduped',
        },
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
  assert.equal(
    cursorStore.get('telegram:default')?.['marker'],
    'next',
  )
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
      loadInbox: async () => ({
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
      loadInbox: async () => ({
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

test('runtime run skips unsupported imessage connectors and surfaces no-supported-sources', async () => {
  const paths = await createTempPaths()
  const connector = createConnectorConfig({
    id: 'imessage-main',
    source: 'imessage',
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
  connectorMocks.instantiateConnector.mockRejectedValue(
    new VaultCliError(
      'INBOX_IMESSAGE_UNAVAILABLE',
      'iMessage is unavailable on this host.',
    ),
  )
  linqRuntimeMocks.resolveLinqWebhookSecret.mockReturnValue('linq-secret')

  const ops = createInboxRuntimeOps(
    createEnv({
      getPlatform: () => 'linux',
      loadInbox: async () => ({
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
  assert.equal(onEvent.mock.calls[0]?.[0]?.type, 'connector.skipped')
})

test('runtime run writes failed daemon state when the daemon surface throws', async () => {
  const paths = await createTempPaths()
  const connector = createConnectorConfig({
    id: 'telegram-main',
    source: 'telegram',
  })
  const cleanup = vi.fn()
  const inboxModule = {
    openInboxRuntime: vi.fn(async () => createRuntimeStore({ captures: [] }).runtime),
    runInboxDaemonWithParsers: vi.fn(async () => {
      throw new Error('daemon failed')
    }),
  }

  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(createConfig([connector]))
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
    id: connector.id,
    kind: 'poll',
    source: connector.source,
  } satisfies PollConnector)
  linqRuntimeMocks.resolveLinqWebhookSecret.mockReturnValue('linq-secret')

  const ops = createInboxRuntimeOps(
    createEnv({
      loadInbox: async () => inboxModule,
      requireParsers: vi.fn(async () => ({
        createConfiguredParserRegistry: vi.fn(async () => ({
          ffmpeg: '/usr/bin/ffmpeg',
          registry: { id: 'registry' },
        })),
      })),
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
  const inboxModule = {
    openInboxRuntime: vi.fn(async () => createRuntimeStore({ captures: [] }).runtime),
    runInboxDaemonWithParsers: vi.fn(async ({ connectors, signal }) => {
      await connectors[0]?.backfill?.(null, async (capture) => ({
        captureId: capture.externalId,
        deduped: capture.externalId === 'capture-deduped',
      }))
      await connectors[0]?.watch?.(
        null,
        async (capture) => ({
          captureId: capture.externalId,
          deduped: false,
        }),
        signal,
      )
    }),
  }

  stateMocks.ensureInitialized.mockResolvedValue(paths)
  stateMocks.readConfig.mockResolvedValue(createConfig([connector]))
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
      await emit({
        accountId: 'bot',
        externalId: 'capture-imported',
        occurredAt: '2026-04-08T00:00:00.000Z',
        source: 'telegram',
        text: 'imported',
      })
      await emit({
        accountId: 'bot',
        externalId: 'capture-deduped',
        occurredAt: '2026-04-08T00:01:00.000Z',
        source: 'telegram',
        text: 'deduped',
      })
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
      await emit({
        accountId: 'bot',
        externalId: 'capture-watch',
        occurredAt: '2026-04-08T00:02:00.000Z',
        source: 'telegram',
        text: 'watch import',
      })
    },
  } satisfies PollConnector)
  linqRuntimeMocks.resolveLinqWebhookSecret.mockReturnValue('linq-secret')

  const ops = createInboxRuntimeOps(
    createEnv({
      loadInbox: async () => inboxModule,
      requireParsers: vi.fn(async () => ({
        createConfiguredParserRegistry: vi.fn(async () => ({
          ffmpeg: '/usr/bin/ffmpeg',
          registry: { id: 'registry' },
        })),
      })),
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
  assert.deepEqual(
    onEvent.mock.calls.map((call) => call[0].type),
    [
      'connector.backfill.started',
      'connector.backfill.finished',
      'connector.watch.started',
      'capture.imported',
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
  const inboxModule = {
    openInboxRuntime: vi.fn(async () => createRuntimeStore({ captures: [] }).runtime),
    runInboxDaemonWithParsers: vi.fn(async () => {
      abortController.abort()
    }),
  }

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
    id: connector.id,
    kind: 'poll',
    source: connector.source,
  } satisfies PollConnector)
  linqRuntimeMocks.resolveLinqWebhookSecret.mockReturnValue('linq-secret')

  const ops = createInboxRuntimeOps(
    createEnv({
      loadInbox: async () => inboxModule,
      requireParsers: vi.fn(async () => ({
        createConfiguredParserRegistry: vi.fn(async () => ({
          ffmpeg: '/usr/bin/ffmpeg',
          registry: { id: 'registry' },
        })),
      })),
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
