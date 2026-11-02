import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { resolveRuntimePaths } from '@murphai/runtime-state/node'
import { afterEach, test, vi } from 'vitest'

import type {
  InboxAppEnvironment,
  InboxConnectorConfig,
  InboxPaths,
  InboxRuntimeConfig,
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

import { createInboxReadOps } from '../src/inbox-app/reads.ts'

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

function createEnv(
  overrides: Partial<InboxAppEnvironment> = {},
): InboxAppEnvironment {
  return {
    clock: () => new Date('2026-04-08T12:00:00.000Z'),
    journalPromotionEnabled: false,
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
    requireParsers: async () => {
      throw new Error('test did not provide requireParsers')
    },
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
