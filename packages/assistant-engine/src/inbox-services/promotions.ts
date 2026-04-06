import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { normalizeOpaquePathSegment, normalizeRelativeVaultPath } from '@murphai/core'
import {
  hasLocalStatePath,
  readVersionedJsonStateFile,
  writeVersionedJsonStateFile,
} from '@murphai/runtime-state/node'
import { resolveAssistantVaultPath } from '../assistant-vault-paths.js'
import {
  inboxPromotionStoreSchema,
  inboxPreserveDocumentAttachmentsResultSchema,
  type InboxPromotionEntry,
  type InboxPreserveDocumentAttachmentsResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import type { QueryRuntimeModule } from '../query-runtime.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  CanonicalAttachmentPromotionResult,
  CanonicalPromotionLookupSpec,
  CanonicalPromotionManifest,
  CanonicalPromotionLookupTarget,
  CanonicalPromotionMatch,
  CoreRuntimeModule,
  InboxPaths,
  InboxRuntimeModule,
  PromotionStore,
  PromotionTarget,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeStore,
} from '../inbox-app/types.js'
import { isStoredDocumentAttachment } from './query.js'
import { ensureInitialized } from './state.js'
import {
  fileExists,
  normalizeNullableString,
  relativeToVault,
} from './shared.js'

const INBOX_PROMOTION_STORE_SCHEMA = 'murph.inbox-promotion-store.v1'
const INBOX_PROMOTION_STORE_SCHEMA_VERSION = 1
const RAW_MEALS_DIRECTORY = path.posix.join('raw', 'meals')
const RAW_DOCUMENTS_DIRECTORY = path.posix.join('raw', 'documents')

interface PromoteInput {
  captureId: string
  requestId: string | null
  vault: string
}

interface PromotionScope<TPrepared, TDerived> {
  input: PromoteInput
  paths: InboxPaths
  capture: RuntimeCaptureRecord
  prepared: TPrepared
  derived: TDerived
  promotionStore: PromotionStore
  existing: InboxPromotionEntry | undefined
}

export async function readPromotionsByCapture(
  paths: InboxPaths,
): Promise<Map<string, InboxPromotionEntry[]>> {
  const store = await readPromotionStore(paths)
  const byCapture = new Map<string, InboxPromotionEntry[]>()

  for (const entry of store.entries) {
    const entries = byCapture.get(entry.captureId) ?? []
    entries.push(entry)
    byCapture.set(entry.captureId, entries)
  }

  return byCapture
}

export async function persistPromotionEntry(input: {
  paths: InboxPaths
  promotionStore: PromotionStore
  captureId: string
  target: PromotionTarget
  lookupId: string
  promotedAt: string
  relatedId: string
  note: string | null
}): Promise<void> {
  upsertPromotionEntry(input.promotionStore, {
    captureId: input.captureId,
    target: input.target,
    lookupId: input.lookupId,
    note: input.note,
    promotedAt: input.promotedAt,
    relatedId: input.relatedId,
  })
  await writePromotionStore(input.paths, input.promotionStore)
}

export async function promoteCanonicalAttachmentImport<
  TPrepared,
  TAttachment extends RuntimeAttachmentRecord & { storedPath: string },
  TManifest extends CanonicalPromotionManifest,
  TContext,
  TTarget extends CanonicalPromotionLookupTarget,
>(input: {
  input: PromoteInput
  target: TTarget
  clock: () => Date
  loadInbox: () => Promise<InboxRuntimeModule>
  prepare(paths: InboxPaths): Promise<TPrepared>
  findRequiredAttachment(
    capture: RuntimeCaptureRecord,
  ): TAttachment | undefined
  missingAttachmentError(): VaultCliError
  canonicalPromotionSpec: CanonicalPromotionLookupSpec<TManifest, TContext>
  buildCanonicalMatchContext(input: {
    paths: InboxPaths
    capture: RuntimeCaptureRecord
    prepared: TPrepared
    attachment: TAttachment
  }): Promise<TContext> | TContext
  createPromotion(input: {
    paths: InboxPaths
    capture: RuntimeCaptureRecord
    prepared: TPrepared
    attachment: TAttachment
  }): Promise<{
    lookupId: string
    relatedId: string
  }>
}): Promise<CanonicalAttachmentPromotionResult<TTarget>> {
  return withPromotionScope<TPrepared, undefined, CanonicalAttachmentPromotionResult<TTarget>>(
    {
      input: input.input,
      target: input.target,
      loadInbox: input.loadInbox,
      prepare: input.prepare,
      deriveBeforePromotionStore: () => undefined,
      run: async ({
        paths,
        capture,
        prepared,
        promotionStore,
        existing,
      }) => {
        const attachment = input.findRequiredAttachment(capture)
        if (!attachment) {
          throw input.missingAttachmentError()
        }

        const canonicalPromotion = await findCanonicalPromotionMatch({
          capture,
          absoluteVaultRoot: paths.absoluteVaultRoot,
          spec: input.canonicalPromotionSpec,
          context: await input.buildCanonicalMatchContext({
            paths,
            capture,
            prepared,
            attachment,
          }),
        })
        const promotion = await reconcileCanonicalImportPromotion({
          paths,
          promotionStore,
          existing,
          capture,
          clock: input.clock,
          target: input.target,
          canonicalPromotion,
          createPromotion: () =>
            input.createPromotion({
              paths,
              capture,
              prepared,
              attachment,
            }),
        })

        return {
          vault: paths.absoluteVaultRoot,
          captureId: input.input.captureId,
          target: input.target,
          lookupId: promotion.lookupId,
          relatedId: promotion.relatedId,
          created: promotion.created,
        } as CanonicalAttachmentPromotionResult<TTarget>
      },
    },
  )
}

export async function preserveCanonicalDocumentAttachments(input: {
  input: PromoteInput
  loadImporters: () => Promise<{
    createImporters(): {
      importDocument(input: {
        filePath: string
        vaultRoot: string
        occurredAt?: string
        title?: string
        note?: string
        source?: string
      }): Promise<{
        documentId: string
        event: {
          id: string
        }
      }>
    }
  }>
  loadInbox: () => Promise<InboxRuntimeModule>
}): Promise<InboxPreserveDocumentAttachmentsResult> {
  const paths = await ensureInitialized(input.loadInbox, input.input.vault)
  const inboxd = await input.loadInbox()
  const importers = (await input.loadImporters()).createImporters()
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot: paths.absoluteVaultRoot,
  })

  try {
    const capture = requirePromotionCapture(runtime, input.input.captureId)
    const documents: InboxPreserveDocumentAttachmentsResult['documents'] = []

    for (const attachment of capture.attachments.filter(isStoredDocumentAttachment)) {
      const title = resolveDocumentAttachmentTitle(attachment)
      const canonicalPromotion = await findCanonicalPromotionMatch({
        capture,
        absoluteVaultRoot: paths.absoluteVaultRoot,
        spec: documentCanonicalPromotionSpec,
        context: {
          documentSha256: await resolveAttachmentSha256(
            paths.absoluteVaultRoot,
            capture,
            attachment,
          ),
          title,
        },
      })

      if (canonicalPromotion) {
        documents.push({
          attachmentId: attachment.attachmentId ?? null,
          ordinal: attachment.ordinal,
          lookupId: canonicalPromotion.lookupId,
          relatedId: canonicalPromotion.relatedId,
          created: false,
        })
        continue
      }

      const result = await importers.importDocument({
        filePath: await resolvePromotionAttachmentFilePath(
          paths.absoluteVaultRoot,
          capture,
          attachment,
        ),
        vaultRoot: paths.absoluteVaultRoot,
        occurredAt: capture.occurredAt,
        title: title ?? undefined,
        note: resolveCapturePromotionNote(capture) ?? undefined,
        source: 'import',
      })

      documents.push({
        attachmentId: attachment.attachmentId ?? null,
        ordinal: attachment.ordinal,
        lookupId: result.documentId,
        relatedId: result.documentId,
        created: true,
      })
    }

    return inboxPreserveDocumentAttachmentsResultSchema.parse({
      vault: paths.absoluteVaultRoot,
      captureId: capture.captureId,
      preservedCount: documents.length,
      createdCount: documents.filter((document) => document.created).length,
      documents,
    })
  } finally {
    runtime.close()
  }
}

export function requireJournalPromotionCore(core: CoreRuntimeModule) {
  if (!core.promoteInboxJournal) {
    throw unsupportedPromotion('journal')
  }

  return {
    promoteInboxJournal: core.promoteInboxJournal,
  }
}

export function requireExperimentPromotionCore(core: CoreRuntimeModule) {
  if (!core.promoteInboxExperimentNote) {
    throw unsupportedPromotion('experiment-note')
  }

  return {
    promoteInboxExperimentNote: core.promoteInboxExperimentNote,
  }
}

export async function readExperimentPromotionEntries(
  vaultRoot: string,
  query: QueryRuntimeModule,
): Promise<
  Array<{
    relativePath: string
    attributes: {
      experimentId: string
      slug: string
      status: string | null
    }
  }>
> {
  const readModel = await query.readVault(vaultRoot)

  return query
    .listEntities(readModel, {
      families: ['experiment'],
    })
    .map((entity) => ({
      relativePath: entity.path,
      attributes: {
        experimentId: entity.entityId,
        slug:
          typeof entity.attributes.slug === 'string'
            ? entity.attributes.slug
            : entity.experimentSlug ?? entity.entityId,
        status:
          typeof entity.attributes.status === 'string'
            ? entity.attributes.status
            : entity.status,
      },
    }))
}

export function resolveExperimentPromotionTarget(
  entries: Array<{
    relativePath: string
    attributes: {
      experimentId: string
      slug: string
      status: string | null
    }
  }>,
) {
  const openEntries = entries.filter(
    (entry) =>
      entry.attributes.status !== 'completed' &&
      entry.attributes.status !== 'abandoned',
  )

  if (openEntries.length === 1) {
    return openEntries[0]
  }

  if (entries.length === 1) {
    return entries[0]
  }

  const candidates = openEntries.length > 0 ? openEntries : entries
  if (candidates.length === 0) {
    throw new VaultCliError(
      'INBOX_EXPERIMENT_TARGET_MISSING',
      'Experiment-note promotion requires at least one experiment document in bank/experiments.',
    )
  }

  throw new VaultCliError(
    'INBOX_EXPERIMENT_TARGET_AMBIGUOUS',
    'Experiment-note promotion needs exactly one unambiguous experiment target.',
    {
      candidates: candidates.map((entry) => ({
        experimentId: entry.attributes.experimentId,
        slug: entry.attributes.slug,
        status: entry.attributes.status,
      })),
    },
  )
}

export function requireExperimentPromotionEntry(
  entries: Array<{
    relativePath: string
    attributes: {
      experimentId: string
      slug: string
      status: string | null
    }
  }>,
  lookupId: string | null,
  relatedId: string | null,
  capture: RuntimeCaptureRecord,
) {
  if (!lookupId || !relatedId) {
    throw new VaultCliError(
      'INBOX_PROMOTION_STATE_INVALID',
      'Stored experiment-note promotion state is missing canonical ids.',
    )
  }

  if (relatedId !== capture.eventId) {
    throw new VaultCliError(
      'INBOX_PROMOTION_STATE_INVALID',
      'Stored experiment-note promotion state does not match the capture event.',
    )
  }

  const existing = entries.find(
    (entry) =>
      entry.attributes.experimentId === lookupId ||
      entry.attributes.slug === lookupId,
  )
  if (!existing) {
    throw new VaultCliError(
      'INBOX_PROMOTION_CANONICAL_MISSING',
      'Local experiment-note promotion state exists, but the target experiment could not be verified.',
      {
        captureId: capture.captureId,
        lookupId,
      },
    )
  }

  return existing
}

export async function resolveAttachmentSha256(
  absoluteVaultRoot: string,
  capture: Pick<RuntimeCaptureRecord, 'captureId' | 'envelopePath'>,
  attachment: RuntimeAttachmentRecord & { storedPath?: string | null },
): Promise<string> {
  const content = await readFile(
    await resolvePromotionAttachmentFilePath(
      absoluteVaultRoot,
      capture,
      attachment,
    ),
  )
  return createHash('sha256').update(content).digest('hex')
}

export async function resolvePromotionAttachmentFilePath(
  absoluteVaultRoot: string,
  capture: Pick<RuntimeCaptureRecord, 'captureId' | 'envelopePath'>,
  attachment: RuntimeAttachmentRecord & { storedPath?: string | null },
): Promise<string> {
  const storedPath = normalizeNullableString(attachment.storedPath)
  if (!storedPath) {
    throw new VaultCliError(
      'INBOX_ATTACHMENT_PATH_INVALID',
      'Stored attachment path is missing or empty.',
    )
  }

  const normalizedStoredPath = normalizeAnchoredPromotionAttachmentPath(
    capture,
    attachment,
    storedPath,
  )
  if (!normalizedStoredPath) {
    throw new VaultCliError(
      'INBOX_ATTACHMENT_PATH_INVALID',
      'Stored attachment path is outside the capture attachment subtree.',
      {
        attachmentId: attachment.attachmentId ?? null,
        captureId: capture.captureId,
        storedPath,
      },
    )
  }

  return resolveAssistantVaultPath(
    absoluteVaultRoot,
    normalizedStoredPath,
    'file path',
  )
}

function normalizeAnchoredPromotionAttachmentPath(
  capture: Pick<RuntimeCaptureRecord, 'captureId' | 'envelopePath'>,
  _attachment: RuntimeAttachmentRecord,
  storedPath: string,
): string | null {
  try {
    const normalizedStoredPath = normalizeRelativeVaultPath(storedPath)
    return isCaptureAttachmentSubtreePath(normalizedStoredPath, capture.captureId)
      ? normalizedStoredPath
      : null
  } catch {
    return null
  }
}

function isCaptureAttachmentSubtreePath(
  normalizedStoredPath: string,
  captureId: string,
): boolean {
  const normalizedCaptureId = normalizeOpaquePathSegment(captureId, 'Capture id')
  const segments = normalizedStoredPath.split('/')
  const attachmentsIndex = segments.indexOf('attachments')
  return (
    segments[0] === 'raw' &&
    segments[1] === 'inbox' &&
    attachmentsIndex >= 3 &&
    attachmentsIndex < segments.length - 1 &&
    segments[attachmentsIndex - 1] === normalizedCaptureId
  )
}

const canonicalMealManifestSchema = z.object({
  importId: z.string().min(1),
  importKind: z.literal('meal'),
  importedAt: z.string().min(1),
  source: z.string().nullable(),
  artifacts: z.array(
    z.object({
      role: z.string().min(1),
      sha256: z.string().min(1),
    }),
  ),
  provenance: z.record(z.string(), z.unknown()),
})

const canonicalDocumentManifestSchema = z.object({
  importId: z.string().min(1),
  importKind: z.literal('document'),
  importedAt: z.string().min(1),
  source: z.string().nullable(),
  artifacts: z.array(
    z.object({
      role: z.string().min(1),
      sha256: z.string().min(1),
    }),
  ),
  provenance: z.record(z.string(), z.unknown()),
})

type CanonicalMealManifest = z.infer<typeof canonicalMealManifestSchema>
type CanonicalDocumentManifest = z.infer<typeof canonicalDocumentManifestSchema>

export const mealCanonicalPromotionSpec = {
  target: 'meal',
  manifestDirectory: RAW_MEALS_DIRECTORY,
  manifestSchema: canonicalMealManifestSchema,
  matchesManifest(
    manifest: CanonicalMealManifest,
    context: {
      photoSha256: string
      audioSha256: string | null
    },
  ): boolean {
    const manifestPhoto = manifest.artifacts.find(
      (artifact) => artifact.role === 'photo',
    )
    const manifestAudio = manifest.artifacts.find(
      (artifact) => artifact.role === 'audio',
    )
    if (!manifestPhoto || manifestPhoto.sha256 !== context.photoSha256) {
      return false
    }

    return (manifestAudio?.sha256 ?? null) === context.audioSha256
  },
} satisfies CanonicalPromotionLookupSpec<
  CanonicalMealManifest,
  {
    photoSha256: string
    audioSha256: string | null
  }
>

export const documentCanonicalPromotionSpec = {
  target: 'document',
  manifestDirectory: RAW_DOCUMENTS_DIRECTORY,
  manifestSchema: canonicalDocumentManifestSchema,
  matchesManifest(
    manifest: CanonicalDocumentManifest,
    context: {
      documentSha256: string
      title: string | null
    },
  ): boolean {
    const manifestDocument = manifest.artifacts.find(
      (artifact) => artifact.role === 'source_document',
    )
    if (!manifestDocument || manifestDocument.sha256 !== context.documentSha256) {
      return false
    }

    return (
      normalizeNullableString(extractCanonicalString(manifest.provenance, 'title')) ===
      context.title
    )
  },
} satisfies CanonicalPromotionLookupSpec<
  CanonicalDocumentManifest,
  {
    documentSha256: string
    title: string | null
  }
>

function resolveDocumentAttachmentTitle(
  attachment: RuntimeAttachmentRecord & { fileName?: string | null },
): string | null {
  return normalizeNullableString(attachment.fileName)
}

function resolveCapturePromotionNote(
  capture: Pick<RuntimeCaptureRecord, 'text'>,
): string | null {
  return normalizeNullableString(capture.text)
}

async function readPromotionStore(
  paths: InboxPaths,
): Promise<PromotionStore> {
  if (!(await hasLocalStatePath({ currentPath: paths.inboxPromotionsPath }))) {
    return {
      entries: [],
    } satisfies PromotionStore
  }

  try {
    const { value } = await readVersionedJsonStateFile({
      currentPath: paths.inboxPromotionsPath,
      label: 'Inbox promotion state',
      parseValue(value) {
        return inboxPromotionStoreSchema.parse(value)
      },
      schema: INBOX_PROMOTION_STORE_SCHEMA,
      schemaVersion: INBOX_PROMOTION_STORE_SCHEMA_VERSION,
    })
    return value
  } catch (error) {
    throw new VaultCliError(
      'INBOX_PROMOTIONS_INVALID',
      'Inbox promotion state is invalid.',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

async function writePromotionStore(
  paths: InboxPaths,
  store: PromotionStore,
): Promise<void> {
  await writeVersionedJsonStateFile({
    filePath: paths.inboxPromotionsPath,
    schema: INBOX_PROMOTION_STORE_SCHEMA,
    schemaVersion: INBOX_PROMOTION_STORE_SCHEMA_VERSION,
    value: inboxPromotionStoreSchema.parse(store),
  })
}

function findAppliedPromotionEntry(
  store: PromotionStore,
  captureId: string,
  target: PromotionTarget,
): InboxPromotionEntry | undefined {
  return store.entries.find(
    (entry) =>
      entry.captureId === captureId &&
      entry.target === target &&
      entry.status === 'applied',
  )
}

function assertCanonicalPromotionStateMatches(
  existing: InboxPromotionEntry | undefined,
  canonicalPromotion: CanonicalPromotionMatch,
  target: CanonicalPromotionLookupTarget,
): void {
  if (
    existing &&
    existing.lookupId &&
    existing.relatedId &&
    (existing.lookupId !== canonicalPromotion.lookupId ||
      existing.relatedId !== canonicalPromotion.relatedId)
  ) {
    throw new VaultCliError(
      'INBOX_PROMOTION_STATE_INVALID',
      `Local ${target} promotion state does not match the canonical vault record.`,
    )
  }
}

function throwMissingCanonicalPromotionState(
  existing: InboxPromotionEntry,
  target: CanonicalPromotionLookupTarget,
): never {
  if (!existing.lookupId || !existing.relatedId) {
    throw new VaultCliError(
      'INBOX_PROMOTION_STATE_INVALID',
      `Stored ${target} promotion state is missing canonical ids.`,
    )
  }

  throw new VaultCliError(
    'INBOX_PROMOTION_CANONICAL_MISSING',
    `Local ${target} promotion state exists, but no canonical ${target} record could be verified.`,
  )
}

async function findCanonicalPromotionMatch<
  TManifest extends CanonicalPromotionManifest,
  TContext,
>(input: {
  capture: RuntimeCaptureRecord
  absoluteVaultRoot: string
  context: TContext
  spec: CanonicalPromotionLookupSpec<TManifest, TContext>
}): Promise<CanonicalPromotionMatch | null> {
  const note = normalizeNullableString(input.capture.text)
  const matches = (
    await Promise.all(
      (
        await listCanonicalManifestPaths(
          input.absoluteVaultRoot,
          input.spec.manifestDirectory,
        )
      ).map(async (manifestPath) => {
        const manifest = await readCanonicalManifest(
          input.absoluteVaultRoot,
          manifestPath,
          input.spec.manifestSchema,
        )
        if (!manifest) {
          return null
        }

        if (!input.spec.matchesManifest(manifest, input.context)) {
          return null
        }
        if (normalizeNullableString(manifest.source) !== 'import') {
          return null
        }

        const occurredAt = extractCanonicalString(
          manifest.provenance,
          'occurredAt',
        )
        if (occurredAt !== input.capture.occurredAt) {
          return null
        }

        if (
          normalizeNullableString(extractCanonicalString(manifest.provenance, 'note')) !==
          note
        ) {
          return null
        }

        const lookupId =
          normalizeNullableString(
            extractCanonicalString(manifest.provenance, 'lookupId'),
          ) ??
          normalizeNullableString(
            extractCanonicalString(manifest.provenance, 'eventId'),
          )
        if (!lookupId) {
          return null
        }

        return {
          lookupId,
          promotedAt: manifest.importedAt,
          relatedId: manifest.importId,
        }
      }),
    )
  ).filter((match): match is CanonicalPromotionMatch => match !== null)

  if (matches.length === 0) {
    return null
  }

  if (matches.length > 1) {
    throw new VaultCliError(
      'INBOX_PROMOTION_DUPLICATE_CANONICAL',
      `Multiple canonical ${input.spec.target} records match this inbox capture.`,
      {
        captureId: input.capture.captureId,
        relatedIds: matches.map((match) => match.relatedId),
      },
    )
  }

  return matches[0]
}

function upsertPromotionEntry(
  store: PromotionStore,
  input: {
    captureId: string
    target: PromotionTarget
    lookupId: string
    note: string | null
    promotedAt: string
    relatedId: string
  },
): void {
  const existingIndex = store.entries.findIndex(
    (entry) => entry.captureId === input.captureId && entry.target === input.target,
  )
  const nextEntry = {
    captureId: input.captureId,
    target: input.target,
    status: 'applied',
    promotedAt: input.promotedAt,
    lookupId: input.lookupId,
    relatedId: input.relatedId,
    note: input.note,
  } satisfies InboxPromotionEntry

  if (existingIndex === -1) {
    store.entries.push(nextEntry)
    return
  }

  store.entries[existingIndex] = nextEntry
}

function requirePromotionCapture(
  runtime: RuntimeStore,
  captureId: string,
): RuntimeCaptureRecord {
  const capture = runtime.getCapture(captureId)
  if (!capture) {
    throw new VaultCliError(
      'INBOX_CAPTURE_NOT_FOUND',
      `Inbox capture "${captureId}" was not found.`,
    )
  }

  return capture
}

async function reconcileCanonicalImportPromotion(input: {
  paths: InboxPaths
  promotionStore: PromotionStore
  existing: InboxPromotionEntry | undefined
  capture: RuntimeCaptureRecord
  clock: () => Date
  target: CanonicalPromotionLookupTarget
  canonicalPromotion: CanonicalPromotionMatch | null
  createPromotion(): Promise<{
    lookupId: string
    relatedId: string
  }>
}): Promise<{
  lookupId: string
  relatedId: string
  created: boolean
}> {
  if (input.canonicalPromotion) {
    assertCanonicalPromotionStateMatches(
      input.existing,
      input.canonicalPromotion,
      input.target,
    )
    await persistPromotionEntry({
      paths: input.paths,
      promotionStore: input.promotionStore,
      captureId: input.capture.captureId,
      target: input.target,
      lookupId: input.canonicalPromotion.lookupId,
      promotedAt: input.canonicalPromotion.promotedAt,
      relatedId: input.canonicalPromotion.relatedId,
      note: input.capture.text ?? null,
    })

    return {
      lookupId: input.canonicalPromotion.lookupId,
      relatedId: input.canonicalPromotion.relatedId,
      created: false,
    }
  }

  if (input.existing) {
    throwMissingCanonicalPromotionState(input.existing, input.target)
  }

  const createdPromotion = await input.createPromotion()
  await persistPromotionEntry({
    paths: input.paths,
    promotionStore: input.promotionStore,
    captureId: input.capture.captureId,
    target: input.target,
    lookupId: createdPromotion.lookupId,
    promotedAt: input.clock().toISOString(),
    relatedId: createdPromotion.relatedId,
    note: input.capture.text ?? null,
  })

  return {
    lookupId: createdPromotion.lookupId,
    relatedId: createdPromotion.relatedId,
    created: true,
  }
}

export async function withPromotionScope<TPrepared, TDerived, TResult>(input: {
  input: PromoteInput
  target: PromotionTarget
  loadInbox: () => Promise<InboxRuntimeModule>
  prepare(paths: InboxPaths): Promise<TPrepared>
  deriveBeforePromotionStore(input: {
    paths: InboxPaths
    capture: RuntimeCaptureRecord
    prepared: TPrepared
  }): Promise<TDerived> | TDerived
  run(scope: PromotionScope<TPrepared, TDerived>): Promise<TResult>
}): Promise<TResult> {
  const paths = await ensureInitialized(input.loadInbox, input.input.vault)
  const inboxd = await input.loadInbox()
  const prepared = await input.prepare(paths)
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot: paths.absoluteVaultRoot,
  })

  try {
    const capture = requirePromotionCapture(runtime, input.input.captureId)
    const derived = await input.deriveBeforePromotionStore({
      paths,
      capture,
      prepared,
    })
    const promotionStore = await readPromotionStore(paths)
    const existing = findAppliedPromotionEntry(
      promotionStore,
      input.input.captureId,
      input.target,
    )

    return input.run({
      input: input.input,
      paths,
      capture,
      prepared,
      derived,
      promotionStore,
      existing,
    })
  } finally {
    runtime.close()
  }
}

async function listCanonicalManifestPaths(
  absoluteVaultRoot: string,
  manifestDirectory: string,
): Promise<string[]> {
  return walkRelativeFiles(absoluteVaultRoot, manifestDirectory, 'manifest.json')
}

async function walkRelativeFiles(
  absoluteVaultRoot: string,
  relativeDirectory: string,
  fileName: string,
): Promise<string[]> {
  const absoluteDirectory = path.join(absoluteVaultRoot, relativeDirectory)
  if (!(await fileExists(absoluteDirectory))) {
    return []
  }

  const matches: string[] = []
  const stack = [absoluteDirectory]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absoluteEntry = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absoluteEntry)
        continue
      }
      if (entry.isFile() && entry.name === fileName) {
        matches.push(relativeToVault(absoluteVaultRoot, absoluteEntry))
      }
    }
  }

  return matches.sort((left, right) => left.localeCompare(right))
}

async function readCanonicalManifest<TManifest>(
  absoluteVaultRoot: string,
  relativePath: string,
  schema: z.ZodType<TManifest>,
): Promise<TManifest | null> {
  try {
    const raw = await readFile(path.join(absoluteVaultRoot, relativePath), 'utf8')
    return schema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

function extractCanonicalString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function unsupportedPromotion(
  target: 'journal' | 'experiment-note',
): VaultCliError {
  return new VaultCliError(
    'INBOX_PROMOTION_UNSUPPORTED',
    `Canonical ${target} promotion is not available yet through a safe shared runtime boundary.`,
  )
}
