import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  resolveRuntimePaths,
  writeVersionedJsonStateFile,
  type RuntimePaths,
} from '@murphai/runtime-state/node'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { afterEach, test } from 'vitest'

import { createInboxPromotionOps } from '../src/inbox-app/promotions.ts'
import { ensureConfigFile } from '../src/inbox-services/state.ts'
import {
  documentCanonicalPromotionSpec,
  mealCanonicalPromotionSpec,
  persistPromotionEntry,
  preserveCanonicalDocumentAttachments,
  promoteCanonicalAttachmentImport,
  readExperimentPromotionEntries,
  readPromotionsByCapture,
  requireExperimentPromotionCore,
  requireExperimentPromotionEntry,
  requireJournalPromotionCore,
  resolveAttachmentSha256,
  resolveExperimentPromotionTarget,
  resolvePromotionAttachmentFilePath,
} from '../src/inbox-services/promotions.ts'
import type {
  CoreRuntimeModule,
  ImportersFactoryRuntimeModule,
  InboxAppEnvironment,
  InboxRuntimeModule,
  ParsersRuntimeModule,
  QueryRuntimeModule,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../src/inbox-app/types.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((tempRoot) =>
      rm(tempRoot, { force: true, recursive: true }),
    ),
  )
})

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function createTempVault(): Promise<RuntimePaths> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-inbox-promotions-'))
  tempRoots.push(vaultRoot)
  const paths = resolveRuntimePaths(vaultRoot)
  await ensureConfigFile(paths, [])
  return paths
}

async function writeTextFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
  return absolutePath
}

async function writeJsonFile(
  vaultRoot: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  await writeTextFile(vaultRoot, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

function createAttachment(
  overrides: Partial<RuntimeAttachmentRecord> & Pick<RuntimeAttachmentRecord, 'kind' | 'ordinal'>,
): RuntimeAttachmentRecord {
  return {
    ordinal: overrides.ordinal,
    kind: overrides.kind,
    attachmentId: overrides.attachmentId ?? `attachment-${overrides.ordinal}`,
    externalId: overrides.externalId ?? null,
    storedPath: overrides.storedPath ?? null,
    fileName: overrides.fileName ?? null,
    mime: overrides.mime ?? null,
    originalPath: overrides.originalPath ?? null,
    byteSize: overrides.byteSize ?? null,
    sha256: overrides.sha256 ?? null,
    extractedText: overrides.extractedText ?? null,
    transcriptText: overrides.transcriptText ?? null,
    derivedPath: overrides.derivedPath ?? null,
    parserProviderId: overrides.parserProviderId ?? null,
    parseState: overrides.parseState ?? null,
  }
}

function createCapture(
  captureId: string,
  overrides: Partial<RuntimeCaptureRecord> = {},
): RuntimeCaptureRecord {
  return {
    captureId,
    eventId: `${captureId}-event`,
    source: 'email',
    externalId: `${captureId}-external`,
    accountId: 'mailbox-1',
    thread: {
      id: `${captureId}-thread`,
      title: 'Inbox thread',
      isDirect: true,
    },
    actor: {
      id: `${captureId}-actor`,
      displayName: 'Inbox actor',
      isSelf: false,
    },
    occurredAt: '2026-04-08T11:22:33.000Z',
    receivedAt: '2026-04-08T11:22:44.000Z',
    text: 'capture note',
    attachments: [],
    raw: {},
    envelopePath: `derived/inbox/${captureId}/envelope.json`,
    createdAt: '2026-04-08T11:22:55.000Z',
    ...overrides,
  }
}

function createRuntimeStore(
  captures: RuntimeCaptureRecord[],
  onClose?: () => void,
): RuntimeStore {
  return {
    close() {
      onClose?.()
    },
    getCapture(captureId: string) {
      return captures.find((capture) => capture.captureId === captureId) ?? null
    },
    getCursor() {
      return null
    },
    listCaptures(filters) {
      const limit = filters?.limit ?? captures.length
      return captures.slice(0, limit)
    },
    searchCaptures() {
      return []
    },
    setCursor() {},
  }
}

function createInboxRuntimeModule(runtime: RuntimeStore): InboxRuntimeModule {
  return {
    async ensureInboxVault() {},
    async openInboxRuntime() {
      return runtime
    },
    async createInboxPipeline() {
      throw new Error('createInboxPipeline not used in promotions tests')
    },
    createTelegramPollConnector() {
      throw new Error('createTelegramPollConnector not used in promotions tests')
    },
    createEmailPollConnector() {
      throw new Error('createEmailPollConnector not used in promotions tests')
    },
    createLinqWebhookConnector() {
      throw new Error('createLinqWebhookConnector not used in promotions tests')
    },
    createTelegramBotApiPollDriver() {
      throw new Error('createTelegramBotApiPollDriver not used in promotions tests')
    },
    createAgentmailApiPollDriver() {
      throw new Error('createAgentmailApiPollDriver not used in promotions tests')
    },
    async rebuildRuntimeFromVault() {
      throw new Error('rebuildRuntimeFromVault not used in promotions tests')
    },
    async runInboxDaemon() {
      throw new Error('runInboxDaemon not used in promotions tests')
    },
    async runInboxDaemonWithParsers() {
      throw new Error('runInboxDaemonWithParsers not used in promotions tests')
    },
  }
}

function createCoreRuntimeModule(
  overrides: Partial<CoreRuntimeModule> = {},
): CoreRuntimeModule {
  return {
    async addMeal() {
      return {
        mealId: 'meal-created',
        event: { id: 'meal-created' },
        manifestPath: 'raw/meals/meal-created/manifest.json',
      }
    },
    async promoteInboxJournal() {
      return {
        lookupId: 'journal:2026-04-08',
        relatedId: 'journal-event',
        journalPath: 'journal/2026/2026-04-08.md',
        created: true,
        appended: true,
        linked: false,
      }
    },
    async promoteInboxExperimentNote() {
      return {
        experimentId: 'experiment-1',
        relatedId: 'experiment-event',
        experimentPath: 'bank/experiments/experiment-1.md',
        experimentSlug: 'experiment-1',
        appended: true,
      }
    },
    ...overrides,
  }
}

function createQueryRuntimeModule(
  entries: Array<{
    path: string
    entityId: string
    attributes: {
      slug?: string
      status?: string | null
    }
    experimentSlug?: string
    status?: string | null
  }>,
): QueryRuntimeModule {
  return {
    async readVault() {
      return {} as Awaited<ReturnType<QueryRuntimeModule['readVault']>>
    },
    listEntities() {
      return entries
    },
  } as QueryRuntimeModule
}

function createInboxAppEnvironment(input: {
  clock?: () => Date
  core?: CoreRuntimeModule
  importers?: ImportersFactoryRuntimeModule
  inbox?: InboxRuntimeModule
  query?: QueryRuntimeModule
}): InboxAppEnvironment {
  const inbox =
    input.inbox ?? createInboxRuntimeModule(createRuntimeStore([]))

  const query =
    input.query ?? createQueryRuntimeModule([])

  const parsers: ParsersRuntimeModule = {
    async createConfiguredParserRegistry() {
      throw new Error('createConfiguredParserRegistry not used in promotions tests')
    },
    createInboxParserService() {
      throw new Error('createInboxParserService not used in promotions tests')
    },
    async discoverParserToolchain() {
      throw new Error('discoverParserToolchain not used in promotions tests')
    },
    async writeParserToolchainConfig() {
      throw new Error('writeParserToolchainConfig not used in promotions tests')
    },
  }

  return {
    clock: input.clock ?? (() => new Date('2026-04-08T12:00:00.000Z')),
    getPid: () => 1,
    getPlatform: () => 'darwin',
    getHomeDirectory: () => '/tmp',
    killProcess() {},
    sleep: async () => undefined,
    getEnvironment: () => ({}),
    usesInjectedEmailDriver: false,
    usesInjectedTelegramDriver: false,
    loadCore: async () => input.core ?? createCoreRuntimeModule(),
    loadImporters: async () =>
      input.importers ?? {
        createImporters() {
          return {
            async importDocument() {
              return {
                documentId: 'document-created',
                event: { id: 'document-created' },
              }
            },
          }
        },
      },
    loadInbox: async () => inbox,
    loadParsers: async () => parsers,
    loadQuery: async () => query,
    requireParsers: async () => parsers,
    async loadConfiguredTelegramDriver() {
      throw new Error('loadConfiguredTelegramDriver not used in promotions tests')
    },
    async loadConfiguredEmailDriver() {
      throw new Error('loadConfiguredEmailDriver not used in promotions tests')
    },
    createConfiguredAgentmailClient() {
      throw new Error('createConfiguredAgentmailClient not used in promotions tests')
    },
    async enableAssistantAutoReplyChannel() {
      return false
    },
    async provisionOrRecoverAgentmailInbox() {
      throw new Error('provisionOrRecoverAgentmailInbox not used in promotions tests')
    },
    async tryResolveAgentmailInboxAddress() {
      return null
    },
    journalPromotionEnabled: true,
  }
}

async function writePromotionStore(
  paths: RuntimePaths,
  entries: Array<{
    captureId: string
    target: 'meal' | 'document' | 'journal' | 'experiment-note'
    status?: 'applied' | 'unsupported'
    promotedAt?: string
    lookupId: string | null
    relatedId: string | null
    note?: string | null
  }>,
): Promise<void> {
  await writeVersionedJsonStateFile({
    filePath: paths.inboxPromotionsPath,
    schema: 'murph.inbox-promotion-store.v1',
    schemaVersion: 1,
    value: {
      entries: entries.map((entry) => ({
        status: 'applied',
        promotedAt: '2026-04-08T12:00:00.000Z',
        note: null,
        ...entry,
      })),
    },
  })
}

test('promotion store helpers group persisted entries and surface invalid state', async () => {
  const paths = await createTempVault()

  await persistPromotionEntry({
    paths,
    promotionStore: { entries: [] },
    captureId: 'capture-1',
    target: 'meal',
    lookupId: 'meal-1',
    promotedAt: '2026-04-08T12:00:00.000Z',
    relatedId: 'meal-1',
    note: 'meal note',
  })
  await persistPromotionEntry({
    paths,
    promotionStore: {
      entries: [
        {
          captureId: 'capture-1',
          target: 'meal',
          status: 'applied',
          promotedAt: '2026-04-08T12:00:00.000Z',
          lookupId: 'meal-1',
          relatedId: 'meal-1',
          note: 'meal note',
        },
      ],
    },
    captureId: 'capture-2',
    target: 'document',
    lookupId: 'document-2',
    promotedAt: '2026-04-08T12:05:00.000Z',
    relatedId: 'document-2',
    note: null,
  })

  const grouped = await readPromotionsByCapture(paths)
  assert.equal(grouped.get('capture-1')?.length, 1)
  assert.equal(grouped.get('capture-2')?.[0]?.lookupId, 'document-2')

  await writeTextFile(paths.absoluteVaultRoot, path.relative(paths.absoluteVaultRoot, paths.inboxPromotionsPath), '{\n')
  await assert.rejects(
    () => readPromotionsByCapture(paths),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTIONS_INVALID',
  )
})

test('attachment path helpers resolve hashes and reject invalid promotion paths', async () => {
  const paths = await createTempVault()
  const capture = createCapture('capture-attachment')
  const storedPath = 'raw/inbox/email/capture-attachment/attachments/file.txt'
  await writeTextFile(paths.absoluteVaultRoot, storedPath, 'attachment body')

  const attachment = createAttachment({
    ordinal: 1,
    kind: 'document',
    storedPath,
  })

  assert.equal(
    await resolvePromotionAttachmentFilePath(
      paths.absoluteVaultRoot,
      capture,
      attachment,
    ),
    path.join(paths.absoluteVaultRoot, storedPath),
  )
  assert.equal(
    await resolveAttachmentSha256(paths.absoluteVaultRoot, capture, attachment),
    sha256('attachment body'),
  )

  await assert.rejects(
    () =>
      resolvePromotionAttachmentFilePath(paths.absoluteVaultRoot, capture, {
        ...attachment,
        storedPath: '   ',
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_ATTACHMENT_PATH_INVALID',
  )
  await assert.rejects(
    () =>
      resolvePromotionAttachmentFilePath(paths.absoluteVaultRoot, capture, {
        ...attachment,
        storedPath: 'raw/inbox/email/other-capture/attachments/file.txt',
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_ATTACHMENT_PATH_INVALID',
  )
})

test('direct promotion helpers cover canonical matching and stale-state reconciliation', async () => {
  const canonicalPaths = await createTempVault()
  const canonicalCapture = createCapture('capture-canonical', {
    attachments: [
      createAttachment({
        ordinal: 1,
        kind: 'document',
        storedPath: 'raw/inbox/email/capture-canonical/attachments/canonical.pdf',
        fileName: 'Canonical.pdf',
      }),
    ],
  })
  await writeTextFile(
    canonicalPaths.absoluteVaultRoot,
    'raw/inbox/email/capture-canonical/attachments/canonical.pdf',
    'canonical document',
  )
  await writeJsonFile(
    canonicalPaths.absoluteVaultRoot,
    'raw/documents/canonical/manifest.json',
    {
      importId: 'document-existing',
      importKind: 'document',
      importedAt: '2026-04-08T10:00:00.000Z',
      source: 'import',
      artifacts: [
        {
          role: 'source_document',
          sha256: sha256('canonical document'),
        },
      ],
      provenance: {
        occurredAt: canonicalCapture.occurredAt,
        note: canonicalCapture.text,
        lookupId: 'document-existing',
        title: 'Canonical.pdf',
      },
    },
  )

  let canonicalClosed = 0
  const canonicalInbox = createInboxRuntimeModule(
    createRuntimeStore([canonicalCapture], () => {
      canonicalClosed += 1
    }),
  )
  let createdCalls = 0
  const canonicalResult = await promoteCanonicalAttachmentImport({
    input: {
      vault: canonicalPaths.absoluteVaultRoot,
      captureId: canonicalCapture.captureId,
      requestId: null,
    },
    target: 'document',
    clock: () => new Date('2026-04-08T12:00:00.000Z'),
    loadInbox: async () => canonicalInbox,
    prepare: async () => ({ prepared: true }),
    findRequiredAttachment: (capture) =>
      capture.attachments.find(
        (attachment) =>
          attachment.kind === 'document' && typeof attachment.storedPath === 'string',
      ) as RuntimeAttachmentRecord & { storedPath: string } | undefined,
    missingAttachmentError: () =>
      new VaultCliError('INBOX_PROMOTION_REQUIRES_DOCUMENT', 'missing document'),
    canonicalPromotionSpec: documentCanonicalPromotionSpec,
    buildCanonicalMatchContext: async ({ paths, capture, attachment }) => ({
      documentSha256: await resolveAttachmentSha256(
        paths.absoluteVaultRoot,
        capture,
        attachment,
      ),
      title: attachment.fileName,
    }),
    createPromotion: async () => {
      createdCalls += 1
      return {
        lookupId: 'document-created',
        relatedId: 'document-created',
      }
    },
  })
  assert.deepEqual(canonicalResult, {
    vault: canonicalPaths.absoluteVaultRoot,
    captureId: canonicalCapture.captureId,
    target: 'document',
    lookupId: 'document-existing',
    relatedId: 'document-existing',
    created: false,
  })
  assert.equal(createdCalls, 0)
  assert.equal(canonicalClosed, 1)
  const canonicalGrouped = await readPromotionsByCapture(canonicalPaths)
  assert.equal(canonicalGrouped.get(canonicalCapture.captureId)?.[0]?.lookupId, 'document-existing')

  const mismatchPaths = await createTempVault()
  await writeTextFile(
    mismatchPaths.absoluteVaultRoot,
    'raw/inbox/email/capture-canonical/attachments/canonical.pdf',
    'canonical document',
  )
  await writeJsonFile(
    mismatchPaths.absoluteVaultRoot,
    'raw/documents/canonical/manifest.json',
    {
      importId: 'document-existing',
      importKind: 'document',
      importedAt: '2026-04-08T10:00:00.000Z',
      source: 'import',
      artifacts: [
        {
          role: 'source_document',
          sha256: sha256('canonical document'),
        },
      ],
      provenance: {
        occurredAt: canonicalCapture.occurredAt,
        note: canonicalCapture.text,
        lookupId: 'document-existing',
        title: 'Canonical.pdf',
      },
    },
  )
  await writePromotionStore(mismatchPaths, [
    {
      captureId: canonicalCapture.captureId,
      target: 'document',
      lookupId: 'document-other',
      relatedId: 'document-other',
    },
  ])
  await assert.rejects(
    () =>
      promoteCanonicalAttachmentImport({
        input: {
          vault: mismatchPaths.absoluteVaultRoot,
          captureId: canonicalCapture.captureId,
          requestId: null,
        },
        target: 'document',
        clock: () => new Date('2026-04-08T12:01:00.000Z'),
        loadInbox: async () =>
          createInboxRuntimeModule(createRuntimeStore([canonicalCapture])),
        prepare: async () => ({ prepared: true }),
        findRequiredAttachment: (capture) =>
          capture.attachments.find(
            (attachment) =>
              attachment.kind === 'document' &&
              typeof attachment.storedPath === 'string',
          ) as RuntimeAttachmentRecord & { storedPath: string } | undefined,
        missingAttachmentError: () =>
          new VaultCliError('INBOX_PROMOTION_REQUIRES_DOCUMENT', 'missing document'),
        canonicalPromotionSpec: documentCanonicalPromotionSpec,
        buildCanonicalMatchContext: async ({ paths, capture, attachment }) => ({
          documentSha256: await resolveAttachmentSha256(
            paths.absoluteVaultRoot,
            capture,
            attachment,
          ),
          title: attachment.fileName,
        }),
        createPromotion: async () => ({
          lookupId: 'document-created',
          relatedId: 'document-created',
        }),
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_STATE_INVALID',
  )

  const createdPaths = await createTempVault()
  const createdCapture = createCapture('capture-created', {
    attachments: [
      createAttachment({
        ordinal: 1,
        kind: 'document',
        storedPath: 'raw/inbox/email/capture-created/attachments/new.pdf',
        fileName: ' New.pdf ',
      }),
    ],
  })
  await writeTextFile(
    createdPaths.absoluteVaultRoot,
    'raw/inbox/email/capture-created/attachments/new.pdf',
    'new document',
  )
  await writeTextFile(
    createdPaths.absoluteVaultRoot,
    'raw/documents/broken/manifest.json',
    '{not-valid-json',
  )
  let createClosed = 0
  const createdResult = await promoteCanonicalAttachmentImport({
    input: {
      vault: createdPaths.absoluteVaultRoot,
      captureId: createdCapture.captureId,
      requestId: null,
    },
    target: 'document',
    clock: () => new Date('2026-04-08T12:10:00.000Z'),
    loadInbox: async () =>
      createInboxRuntimeModule(
        createRuntimeStore([createdCapture], () => {
          createClosed += 1
        }),
      ),
    prepare: async () => ({ prepared: true }),
    findRequiredAttachment: (capture) =>
      capture.attachments.find(
        (attachment) =>
          attachment.kind === 'document' && typeof attachment.storedPath === 'string',
      ) as RuntimeAttachmentRecord & { storedPath: string } | undefined,
    missingAttachmentError: () =>
      new VaultCliError('INBOX_PROMOTION_REQUIRES_DOCUMENT', 'missing document'),
    canonicalPromotionSpec: documentCanonicalPromotionSpec,
    buildCanonicalMatchContext: async ({ paths, capture, attachment }) => ({
      documentSha256: await resolveAttachmentSha256(
        paths.absoluteVaultRoot,
        capture,
        attachment,
      ),
      title: attachment.fileName?.trim() ?? null,
    }),
    createPromotion: async () => ({
      lookupId: 'document-created',
      relatedId: 'document-created',
    }),
  })
  assert.equal(createdResult.created, true)
  assert.equal(createClosed, 1)

  const stalePaths = await createTempVault()
  const staleCapture = createCapture('capture-stale', {
    attachments: [
      createAttachment({
        ordinal: 1,
        kind: 'document',
        storedPath: 'raw/inbox/email/capture-stale/attachments/stale.pdf',
      }),
    ],
  })
  await writeTextFile(
    stalePaths.absoluteVaultRoot,
    'raw/inbox/email/capture-stale/attachments/stale.pdf',
    'stale document',
  )
  await writePromotionStore(stalePaths, [
    {
      captureId: staleCapture.captureId,
      target: 'document',
      lookupId: 'document-stale',
      relatedId: 'document-stale',
    },
  ])
  await assert.rejects(
    () =>
      promoteCanonicalAttachmentImport({
        input: {
          vault: stalePaths.absoluteVaultRoot,
          captureId: staleCapture.captureId,
          requestId: null,
        },
        target: 'document',
        clock: () => new Date('2026-04-08T12:20:00.000Z'),
        loadInbox: async () =>
          createInboxRuntimeModule(createRuntimeStore([staleCapture])),
        prepare: async () => ({ prepared: true }),
        findRequiredAttachment: (capture) =>
          capture.attachments.find(
            (attachment) =>
              attachment.kind === 'document' &&
              typeof attachment.storedPath === 'string',
          ) as RuntimeAttachmentRecord & { storedPath: string } | undefined,
        missingAttachmentError: () =>
          new VaultCliError('INBOX_PROMOTION_REQUIRES_DOCUMENT', 'missing document'),
        canonicalPromotionSpec: documentCanonicalPromotionSpec,
        buildCanonicalMatchContext: async ({ paths, capture, attachment }) => ({
          documentSha256: await resolveAttachmentSha256(
            paths.absoluteVaultRoot,
            capture,
            attachment,
          ),
          title: null,
        }),
        createPromotion: async () => ({
          lookupId: 'document-created',
          relatedId: 'document-created',
        }),
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_CANONICAL_MISSING',
  )

  const invalidPaths = await createTempVault()
  const invalidCapture = createCapture('capture-invalid', {
    attachments: [
      createAttachment({
        ordinal: 1,
        kind: 'document',
        storedPath: 'raw/inbox/email/capture-invalid/attachments/invalid.pdf',
      }),
    ],
  })
  await writeTextFile(
    invalidPaths.absoluteVaultRoot,
    'raw/inbox/email/capture-invalid/attachments/invalid.pdf',
    'invalid document',
  )
  await writePromotionStore(invalidPaths, [
    {
      captureId: invalidCapture.captureId,
      target: 'document',
      lookupId: null,
      relatedId: null,
    },
  ])
  await assert.rejects(
    () =>
      promoteCanonicalAttachmentImport({
        input: {
          vault: invalidPaths.absoluteVaultRoot,
          captureId: invalidCapture.captureId,
          requestId: null,
        },
        target: 'document',
        clock: () => new Date('2026-04-08T12:30:00.000Z'),
        loadInbox: async () =>
          createInboxRuntimeModule(createRuntimeStore([invalidCapture])),
        prepare: async () => ({ prepared: true }),
        findRequiredAttachment: (capture) =>
          capture.attachments.find(
            (attachment) =>
              attachment.kind === 'document' &&
              typeof attachment.storedPath === 'string',
          ) as RuntimeAttachmentRecord & { storedPath: string } | undefined,
        missingAttachmentError: () =>
          new VaultCliError('INBOX_PROMOTION_REQUIRES_DOCUMENT', 'missing document'),
        canonicalPromotionSpec: documentCanonicalPromotionSpec,
        buildCanonicalMatchContext: async ({ paths, capture, attachment }) => ({
          documentSha256: await resolveAttachmentSha256(
            paths.absoluteVaultRoot,
            capture,
            attachment,
          ),
          title: null,
        }),
        createPromotion: async () => ({
          lookupId: 'document-created',
          relatedId: 'document-created',
        }),
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_STATE_INVALID',
  )

  await assert.rejects(
    () =>
      promoteCanonicalAttachmentImport({
        input: {
          vault: invalidPaths.absoluteVaultRoot,
          captureId: 'missing-capture',
          requestId: null,
        },
        target: 'document',
        clock: () => new Date('2026-04-08T12:31:00.000Z'),
        loadInbox: async () =>
          createInboxRuntimeModule(createRuntimeStore([invalidCapture])),
        prepare: async () => ({ prepared: true }),
        findRequiredAttachment: (capture) =>
          capture.attachments.find(
            (attachment) =>
              attachment.kind === 'document' &&
              typeof attachment.storedPath === 'string',
          ) as RuntimeAttachmentRecord & { storedPath: string } | undefined,
        missingAttachmentError: () =>
          new VaultCliError('INBOX_PROMOTION_REQUIRES_DOCUMENT', 'missing document'),
        canonicalPromotionSpec: documentCanonicalPromotionSpec,
        buildCanonicalMatchContext: async ({ paths, capture, attachment }) => ({
          documentSha256: await resolveAttachmentSha256(
            paths.absoluteVaultRoot,
            capture,
            attachment,
          ),
          title: null,
        }),
        createPromotion: async () => ({
          lookupId: 'document-created',
          relatedId: 'document-created',
        }),
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_CAPTURE_NOT_FOUND',
  )
})

test('document preservation and experiment helper branches are deterministic', async () => {
  const paths = await createTempVault()
  const canonicalDocumentPath =
    'raw/inbox/email/capture-preserve/attachments/existing.pdf'
  const newDocumentPath =
    'raw/inbox/email/capture-preserve/attachments/new.pdf'
  await writeTextFile(paths.absoluteVaultRoot, canonicalDocumentPath, 'existing document')
  await writeTextFile(paths.absoluteVaultRoot, newDocumentPath, 'new document')

  const capture = createCapture('capture-preserve', {
    text: ' preserved note ',
    attachments: [
      createAttachment({
        ordinal: 1,
        kind: 'document',
        storedPath: canonicalDocumentPath,
        fileName: 'Existing.pdf',
      }),
      createAttachment({
        ordinal: 2,
        kind: 'document',
        storedPath: newDocumentPath,
        fileName: ' New.pdf ',
      }),
    ],
  })

  await writeJsonFile(
    paths.absoluteVaultRoot,
    'raw/documents/existing/manifest.json',
    {
      importId: 'document-existing',
      importKind: 'document',
      importedAt: '2026-04-08T08:00:00.000Z',
      source: 'import',
      artifacts: [
        {
          role: 'source_document',
          sha256: sha256('existing document'),
        },
      ],
      provenance: {
        occurredAt: capture.occurredAt,
        note: 'preserved note',
        lookupId: 'document-existing',
        title: 'Existing.pdf',
      },
    },
  )

  const importedFiles: string[] = []
  let closed = 0
  const result = await preserveCanonicalDocumentAttachments({
    input: {
      vault: paths.absoluteVaultRoot,
      captureId: capture.captureId,
      requestId: null,
    },
    loadImporters: async () => ({
      createImporters() {
        return {
          async importDocument(input) {
            importedFiles.push(input.filePath)
            return {
              documentId: 'document-created',
              event: { id: 'document-created' },
            }
          },
        }
      },
    }),
    loadInbox: async () =>
      createInboxRuntimeModule(
        createRuntimeStore([capture], () => {
          closed += 1
        }),
      ),
  })

  assert.equal(result.preservedCount, 2)
  assert.equal(result.createdCount, 1)
  assert.equal(result.documents[0]?.created, false)
  assert.equal(result.documents[1]?.lookupId, 'document-created')
  assert.deepEqual(importedFiles, [
    path.join(paths.absoluteVaultRoot, newDocumentPath),
  ])
  assert.equal(closed, 1)

  const query = createQueryRuntimeModule([
    {
      path: 'bank/experiments/current.md',
      entityId: 'experiment-1',
      attributes: {
        slug: 'current',
        status: 'active',
      },
      experimentSlug: 'current',
      status: 'active',
    },
  ])
  const entries = await readExperimentPromotionEntries(paths.absoluteVaultRoot, query)
  assert.deepEqual(entries, [
    {
      relativePath: 'bank/experiments/current.md',
      attributes: {
        experimentId: 'experiment-1',
        slug: 'current',
        status: 'active',
      },
    },
  ])

  assert.equal(
    resolveExperimentPromotionTarget(entries)?.attributes.experimentId,
    'experiment-1',
  )
  assert.throws(
    () =>
      resolveExperimentPromotionTarget([
        {
          relativePath: 'bank/experiments/a.md',
          attributes: {
            experimentId: 'experiment-a',
            slug: 'a',
            status: 'active',
          },
        },
        {
          relativePath: 'bank/experiments/b.md',
          attributes: {
            experimentId: 'experiment-b',
            slug: 'b',
            status: 'paused',
          },
        },
      ]),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_EXPERIMENT_TARGET_AMBIGUOUS',
  )
  assert.throws(
    () => resolveExperimentPromotionTarget([]),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_EXPERIMENT_TARGET_MISSING',
  )

  const experimentCapture = createCapture('capture-experiment-helper')
  assert.equal(
    requireExperimentPromotionEntry(
      entries,
      'experiment-1',
      experimentCapture.eventId,
      experimentCapture,
    ).relativePath,
    'bank/experiments/current.md',
  )
  assert.throws(
    () => requireExperimentPromotionEntry(entries, null, experimentCapture.eventId, experimentCapture),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_STATE_INVALID',
  )
  assert.throws(
    () =>
      requireExperimentPromotionEntry(
        entries,
        'experiment-1',
        'other-event',
        experimentCapture,
      ),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_STATE_INVALID',
  )
  assert.throws(
    () =>
      requireExperimentPromotionEntry(
        entries,
        'missing-experiment',
        experimentCapture.eventId,
        experimentCapture,
      ),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_CANONICAL_MISSING',
  )

  const supportedCore = createCoreRuntimeModule()
  assert.equal(requireJournalPromotionCore(supportedCore).promoteInboxJournal, supportedCore.promoteInboxJournal)
  assert.equal(
    requireExperimentPromotionCore(supportedCore).promoteInboxExperimentNote,
    supportedCore.promoteInboxExperimentNote,
  )
  assert.throws(
    () => requireJournalPromotionCore({ addMeal: supportedCore.addMeal }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_UNSUPPORTED',
  )
  assert.throws(
    () => requireExperimentPromotionCore({ addMeal: supportedCore.addMeal }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_UNSUPPORTED',
  )

  assert.equal(
    mealCanonicalPromotionSpec.matchesManifest(
      {
        importId: 'meal-1',
        importKind: 'meal',
        importedAt: '2026-04-08T08:00:00.000Z',
        source: 'import',
        artifacts: [
          { role: 'photo', sha256: 'photo-hash' },
          { role: 'audio', sha256: 'audio-hash' },
        ],
        provenance: {},
      },
      {
        photoSha256: 'photo-hash',
        audioSha256: 'audio-hash',
      },
    ),
    true,
  )
  assert.equal(
    mealCanonicalPromotionSpec.matchesManifest(
      {
        importId: 'meal-1',
        importKind: 'meal',
        importedAt: '2026-04-08T08:00:00.000Z',
        source: 'import',
        artifacts: [{ role: 'photo', sha256: 'photo-hash' }],
        provenance: {},
      },
      {
        photoSha256: 'photo-hash',
        audioSha256: 'audio-hash',
      },
    ),
    false,
  )
  assert.equal(
    documentCanonicalPromotionSpec.matchesManifest(
      {
        importId: 'document-1',
        importKind: 'document',
        importedAt: '2026-04-08T08:00:00.000Z',
        source: 'import',
        artifacts: [{ role: 'source_document', sha256: 'document-hash' }],
        provenance: { title: 'Title' },
      },
      {
        documentSha256: 'document-hash',
        title: 'Title',
      },
    ),
    true,
  )
  assert.equal(
    documentCanonicalPromotionSpec.matchesManifest(
      {
        importId: 'document-1',
        importKind: 'document',
        importedAt: '2026-04-08T08:00:00.000Z',
        source: 'import',
        artifacts: [{ role: 'source_document', sha256: 'document-hash' }],
        provenance: { title: 'Other' },
      },
      {
        documentSha256: 'document-hash',
        title: 'Title',
      },
    ),
    false,
  )
})

test('app promotion ops exercise meal, document, journal, and experiment flows', async () => {
  const paths = await createTempVault()
  const captures = [
    createCapture('capture-preserve-delegated', {
      text: 'delegated preserve',
      attachments: [
        createAttachment({
          ordinal: 1,
          kind: 'document',
          storedPath: 'raw/inbox/email/capture-preserve-delegated/attachments/delegated.pdf',
          fileName: 'Delegated.pdf',
        }),
      ],
    }),
    createCapture('capture-meal-canonical', {
      text: 'meal existing',
      attachments: [
        createAttachment({
          ordinal: 1,
          kind: 'image',
          storedPath: 'raw/inbox/email/capture-meal-canonical/attachments/photo.jpg',
        }),
      ],
    }),
    createCapture('capture-meal-created', {
      text: 'meal created',
      attachments: [
        createAttachment({
          ordinal: 1,
          kind: 'image',
          storedPath: 'raw/inbox/email/capture-meal-created/attachments/photo.jpg',
        }),
        createAttachment({
          ordinal: 2,
          kind: 'audio',
          storedPath: 'raw/inbox/email/capture-meal-created/attachments/audio.m4a',
        }),
      ],
    }),
    createCapture('capture-document-created', {
      text: ' document note ',
      attachments: [
        createAttachment({
          ordinal: 1,
          kind: 'document',
          storedPath: 'raw/inbox/email/capture-document-created/attachments/report.pdf',
          fileName: ' Report.pdf ',
        }),
      ],
    }),
    createCapture('capture-document-empty', {
      text: '   ',
      attachments: [
        createAttachment({
          ordinal: 1,
          kind: 'document',
          storedPath: 'raw/inbox/email/capture-document-empty/attachments/blank.pdf',
          fileName: '   ',
        }),
      ],
    }),
    createCapture('capture-journal'),
    createCapture('capture-experiment'),
    createCapture('capture-journal-existing', {
      text: null,
    }),
    createCapture('capture-experiment-existing', {
      text: null,
    }),
    createCapture('capture-meal-missing'),
    createCapture('capture-document-missing'),
  ]

  await writeTextFile(
    paths.absoluteVaultRoot,
    'raw/inbox/email/capture-preserve-delegated/attachments/delegated.pdf',
    'delegated document',
  )
  await writeTextFile(
    paths.absoluteVaultRoot,
    'raw/inbox/email/capture-meal-canonical/attachments/photo.jpg',
    'existing meal photo',
  )
  await writeTextFile(
    paths.absoluteVaultRoot,
    'raw/inbox/email/capture-meal-created/attachments/photo.jpg',
    'new meal photo',
  )
  await writeTextFile(
    paths.absoluteVaultRoot,
    'raw/inbox/email/capture-meal-created/attachments/audio.m4a',
    'new meal audio',
  )
  await writeTextFile(
    paths.absoluteVaultRoot,
    'raw/inbox/email/capture-document-created/attachments/report.pdf',
    'report body',
  )
  await writeTextFile(
    paths.absoluteVaultRoot,
    'raw/inbox/email/capture-document-empty/attachments/blank.pdf',
    'blank body',
  )
  await writeJsonFile(
    paths.absoluteVaultRoot,
    'raw/meals/existing/manifest.json',
    {
      importId: 'meal-existing',
      importKind: 'meal',
      importedAt: '2026-04-08T07:00:00.000Z',
      source: 'import',
      artifacts: [{ role: 'photo', sha256: sha256('existing meal photo') }],
      provenance: {
        occurredAt: captures[0]?.occurredAt,
        note: captures[0]?.text,
        lookupId: 'meal-existing',
      },
    },
  )

  const mealCalls: Array<Parameters<NonNullable<CoreRuntimeModule['addMeal']>>[0]> = []
  const journalCalls: Array<Parameters<NonNullable<CoreRuntimeModule['promoteInboxJournal']>>[0]> = []
  const experimentCalls: Array<Parameters<NonNullable<CoreRuntimeModule['promoteInboxExperimentNote']>>[0]> = []
  const importedFiles: Array<Parameters<ReturnType<ImportersFactoryRuntimeModule['createImporters']>['importDocument']>[0]> = []

  const env = createInboxAppEnvironment({
    inbox: createInboxRuntimeModule(createRuntimeStore(captures)),
    core: createCoreRuntimeModule({
      async addMeal(input) {
        mealCalls.push(input)
        return {
          mealId: 'meal-created',
          event: { id: 'meal-created' },
          manifestPath: 'raw/meals/meal-created/manifest.json',
        }
      },
      async promoteInboxJournal(input) {
        journalCalls.push(input)
        return {
          lookupId: 'journal:2026-04-08',
          relatedId: input.capture.eventId,
          journalPath: 'journal/2026/2026-04-08.md',
          created: true,
          appended: false,
          linked: true,
        }
      },
      async promoteInboxExperimentNote(input) {
        experimentCalls.push(input)
        return {
          experimentId: 'experiment-1',
          relatedId: input.capture.eventId,
          experimentPath: input.relativePath,
          experimentSlug: 'current-experiment',
          appended: true,
        }
      },
    }),
    importers: {
      createImporters() {
        return {
          async importDocument(input) {
            importedFiles.push(input)
            return {
              documentId: 'document-created',
              event: { id: 'document-created' },
            }
          },
        }
      },
    },
    query: createQueryRuntimeModule([
      {
        path: 'bank/experiments/current.md',
        entityId: 'experiment-1',
        attributes: {
          slug: 'current-experiment',
          status: 'active',
        },
        experimentSlug: 'current-experiment',
        status: 'active',
      },
    ]),
  })

  const ops = createInboxPromotionOps(env)

  const preserved = await ops.preserveDocumentAttachments({
    vault: paths.absoluteVaultRoot,
    captureId: 'capture-preserve-delegated',
    requestId: null,
  })
  assert.equal(preserved.createdCount, 1)

  const canonicalMeal = await ops.promoteMeal({
    vault: paths.absoluteVaultRoot,
    captureId: 'capture-meal-canonical',
    requestId: null,
  })
  assert.equal(canonicalMeal.target, 'meal')

  const createdMeal = await ops.promoteMeal({
    vault: paths.absoluteVaultRoot,
    captureId: 'capture-meal-created',
    requestId: null,
  })
  assert.equal(createdMeal.created, true)
  const createdMealCall = mealCalls.at(-1)
  assert.equal(createdMealCall?.source, 'import')
  assert.match(createdMealCall?.photoPath ?? '', /capture-meal-created\/attachments\/photo\.jpg$/)
  assert.match(createdMealCall?.audioPath ?? '', /capture-meal-created\/attachments\/audio\.m4a$/)

  const createdDocument = await ops.promoteDocument({
    vault: paths.absoluteVaultRoot,
    captureId: 'capture-document-created',
    requestId: null,
  })
  assert.equal(createdDocument.created, true)
  const createdDocumentImport = importedFiles.at(-1)
  assert.equal(createdDocumentImport?.title, 'Report.pdf')
  assert.equal(createdDocumentImport?.note, 'document note')

  const emptyDocument = await ops.promoteDocument({
    vault: paths.absoluteVaultRoot,
    captureId: 'capture-document-empty',
    requestId: null,
  })
  assert.equal(emptyDocument.created, true)
  const emptyDocumentImport = importedFiles.at(-1)
  assert.equal(emptyDocumentImport?.title, undefined)
  assert.equal(emptyDocumentImport?.note, undefined)

  const journalResult = await ops.promoteJournal({
    vault: paths.absoluteVaultRoot,
    captureId: 'capture-journal',
    requestId: null,
  })
  assert.equal(journalResult.lookupId, 'journal:2026-04-08')
  assert.equal(journalCalls.length, 1)
  assert.equal(journalCalls[0]?.date, '2026-04-08')

  const experimentResult = await ops.promoteExperimentNote({
    vault: paths.absoluteVaultRoot,
    captureId: 'capture-experiment',
    requestId: null,
  })
  assert.equal(experimentResult.lookupId, 'experiment-1')
  assert.equal(experimentCalls[0]?.relativePath, 'bank/experiments/current.md')

  await writePromotionStore(paths, [
    {
      captureId: 'capture-journal-existing',
      target: 'journal',
      lookupId: 'journal:2026-04-08',
      relatedId: 'capture-journal-existing-event',
    },
    {
      captureId: 'capture-experiment-existing',
      target: 'experiment-note',
      lookupId: 'experiment-1',
      relatedId: 'capture-experiment-existing-event',
    },
  ])
  const existingJournal = await ops.promoteJournal({
    vault: paths.absoluteVaultRoot,
    captureId: 'capture-journal-existing',
    requestId: null,
  })
  assert.equal(existingJournal.relatedId, 'capture-journal-existing-event')
  const existingExperiment = await ops.promoteExperimentNote({
    vault: paths.absoluteVaultRoot,
    captureId: 'capture-experiment-existing',
    requestId: null,
  })
  assert.equal(existingExperiment.relatedId, 'capture-experiment-existing-event')

  await assert.rejects(
    () =>
      ops.promoteMeal({
        vault: paths.absoluteVaultRoot,
        captureId: 'capture-meal-missing',
        requestId: null,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_REQUIRES_PHOTO',
  )
  await assert.rejects(
    () =>
      ops.promoteDocument({
        vault: paths.absoluteVaultRoot,
        captureId: 'capture-document-missing',
        requestId: null,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_REQUIRES_DOCUMENT',
  )
})

test('app promotion ops fail closed for unsupported or invalid journal and experiment state', async () => {
  const paths = await createTempVault()
  const journalCapture = createCapture('capture-journal-fail')
  const experimentCapture = createCapture('capture-experiment-fail')
  const inbox = createInboxRuntimeModule(
    createRuntimeStore([journalCapture, experimentCapture]),
  )

  const unsupportedOps = createInboxPromotionOps({
    ...createInboxAppEnvironment({
      inbox,
      core: createCoreRuntimeModule(),
    }),
    journalPromotionEnabled: false,
  })
  await assert.rejects(
    () =>
      unsupportedOps.promoteJournal({
        vault: paths.absoluteVaultRoot,
        captureId: journalCapture.captureId,
        requestId: null,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_UNSUPPORTED',
  )

  const invalidJournalPaths = await createTempVault()
  await writePromotionStore(invalidJournalPaths, [
    {
      captureId: journalCapture.captureId,
      target: 'journal',
      lookupId: 'journal:other-day',
      relatedId: journalCapture.eventId,
    },
  ])
  const invalidJournalOps = createInboxPromotionOps(
    createInboxAppEnvironment({
      inbox,
      core: createCoreRuntimeModule(),
    }),
  )
  await assert.rejects(
    () =>
      invalidJournalOps.promoteJournal({
        vault: invalidJournalPaths.absoluteVaultRoot,
        captureId: journalCapture.captureId,
        requestId: null,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_STATE_INVALID',
  )

  const invalidExperimentPaths = await createTempVault()
  await writePromotionStore(invalidExperimentPaths, [
    {
      captureId: experimentCapture.captureId,
      target: 'experiment-note',
      lookupId: 'missing-experiment',
      relatedId: experimentCapture.eventId,
    },
  ])
  const invalidExperimentOps = createInboxPromotionOps(
    createInboxAppEnvironment({
      inbox,
      core: createCoreRuntimeModule(),
      query: createQueryRuntimeModule([]),
    }),
  )
  await assert.rejects(
    () =>
      invalidExperimentOps.promoteExperimentNote({
        vault: invalidExperimentPaths.absoluteVaultRoot,
        captureId: experimentCapture.captureId,
        requestId: null,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'INBOX_PROMOTION_CANONICAL_MISSING',
  )

  const throwingJournalOps = createInboxPromotionOps(
    createInboxAppEnvironment({
      inbox,
      core: createCoreRuntimeModule({
        async promoteInboxJournal() {
          throw new VaultCliError('journal_failed', 'journal failed')
        },
      }),
    }),
  )
  await assert.rejects(
    () =>
      throwingJournalOps.promoteJournal({
        vault: paths.absoluteVaultRoot,
        captureId: journalCapture.captureId,
        requestId: null,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'journal_failed',
  )

  const throwingExperimentOps = createInboxPromotionOps(
    createInboxAppEnvironment({
      inbox,
      core: createCoreRuntimeModule({
        async promoteInboxExperimentNote() {
          throw new VaultCliError('experiment_failed', 'experiment failed')
        },
      }),
      query: createQueryRuntimeModule([
        {
          path: 'bank/experiments/current.md',
          entityId: 'experiment-1',
          attributes: {
            slug: 'current',
            status: 'active',
          },
          experimentSlug: 'current',
          status: 'active',
        },
      ]),
    }),
  )
  await assert.rejects(
    () =>
      throwingExperimentOps.promoteExperimentNote({
        vault: paths.absoluteVaultRoot,
        captureId: experimentCapture.captureId,
        requestId: null,
      }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'experiment_failed',
  )
})
