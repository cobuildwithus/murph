import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  CONTRACT_SCHEMA_VERSION,
  EXPERIMENT_STATUSES,
  ID_PREFIXES,
  coreFrontmatterSchema,
  eventRecordSchema,
  experimentFrontmatterSchema,
  journalDayFrontmatterSchema,
  vaultMetadataSchema,
} from '@healthybob/contracts'
import { z } from 'incur'
import {
  inferHealthEntityKind,
  isHealthQueryableRecordId,
} from '../health-cli-descriptors.js'
import { loadQueryRuntime, type QueryRuntimeModule } from '../query-runtime.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  isoTimestampSchema,
  localDateSchema,
  slugSchema,
} from '../vault-cli-contracts.js'
import { readJsonPayload } from './shared.js'

type JsonObject = Record<string, unknown>

type EntityFamily = 'experiment' | 'journal'
type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]

interface QueryCanonicalEntity {
  entityId: string
  primaryLookupId: string
  lookupIds: string[]
  family: string
  kind: string
  status: string | null
  occurredAt: string | null
  date: string | null
  path: string
  title: string | null
  body: string | null
  attributes: JsonObject
  relatedIds: string[]
  experimentSlug: string | null
}

interface QueryVaultRecord {
  sourcePath: string
  title: string | null
  occurredAt: string | null
  date: string | null
}

interface QueryVaultReadModel {
  metadata: JsonObject | null
  coreDocument: QueryVaultRecord | null
  experiments: QueryVaultRecord[]
  journalEntries: QueryVaultRecord[]
  events: QueryVaultRecord[]
  samples: QueryVaultRecord[]
  audits: QueryVaultRecord[]
  assessments: QueryVaultRecord[]
  profileSnapshots: QueryVaultRecord[]
  goals: QueryVaultRecord[]
  conditions: QueryVaultRecord[]
  allergies: QueryVaultRecord[]
  regimens: QueryVaultRecord[]
  history: QueryVaultRecord[]
  familyMembers: QueryVaultRecord[]
  geneticVariants: QueryVaultRecord[]
  records: QueryVaultRecord[]
}

interface ExperimentJournalVaultQueryRuntime extends QueryRuntimeModule {
  readVault(vaultRoot: string): Promise<QueryVaultReadModel>
  lookupEntityById(
    vault: QueryVaultReadModel,
    entityId: string,
  ): QueryCanonicalEntity | null
  listEntities(
    vault: QueryVaultReadModel,
    filters?: {
      families?: string[]
      statuses?: string[]
      from?: string
      to?: string
    },
  ): QueryCanonicalEntity[]
}

interface CanonicalWriteLockHandle {
  release(): Promise<void>
}

interface FrontmatterDocument {
  attributes: JsonObject
  body: string
}

interface ExperimentJournalVaultCoreRuntime {
  acquireCanonicalWriteLock(
    vaultRoot: string,
  ): Promise<CanonicalWriteLockHandle>
  createExperiment(input: {
    vaultRoot: string
    slug: string
    title?: string
    hypothesis?: string
    startedOn?: string
    status?: string
  }): Promise<{
    created?: boolean
    experiment: {
      id: string
      slug: string
      relativePath: string
    }
  }>
  ensureJournalDay(input: {
    vaultRoot: string
    date?: string
  }): Promise<{
    created: boolean
    relativePath: string
  }>
  parseFrontmatterDocument(markdown: string): FrontmatterDocument
  stringifyFrontmatterDocument(input: {
    attributes: JsonObject
    body: string
  }): string
  toMonthlyShardRelativePath(
    relativeDirectory: string,
    occurredAt: string,
    fieldName: string,
  ): string
}

const ISO_TIMESTAMP_WITH_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const experimentStatusSchema = z.enum(EXPERIMENT_STATUSES)
const experimentSelectorPayloadSchema = z
  .object({
    lookup: z.string().min(1).optional(),
    experimentId: z.string().min(1).optional(),
    slug: slugSchema.optional(),
  })
  .refine(
    (value) =>
      typeof value.lookup === 'string' ||
      typeof value.experimentId === 'string' ||
      typeof value.slug === 'string',
    'Expected one of lookup, experimentId, or slug.',
  )
const experimentUpdatePayloadSchema = experimentSelectorPayloadSchema.extend({
  title: z.string().min(1).optional(),
  hypothesis: z.string().min(1).optional(),
  startedOn: localDateSchema.optional(),
  status: experimentStatusSchema.optional(),
  body: z.string().optional(),
  tags: z.array(slugSchema).optional(),
})
const experimentCheckpointPayloadSchema = experimentSelectorPayloadSchema.extend({
  occurredAt: isoTimestampSchema.optional(),
  title: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
})

export async function createExperimentRecord(input: {
  vault: string
  slug: string
  title?: string
  hypothesis?: string
  startedOn?: string
  status?: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const result = await core.createExperiment({
    vaultRoot: input.vault,
    slug: input.slug,
    title: normalizeOptionalText(input.title) ?? input.slug,
    hypothesis: normalizeOptionalText(input.hypothesis) ?? undefined,
    startedOn: input.startedOn ?? new Date().toISOString().slice(0, 10),
    status: normalizeOptionalText(input.status) ?? 'active',
  })

  return {
    vault: input.vault,
    experimentId: result.experiment.id,
    lookupId: result.experiment.id,
    slug: result.experiment.slug,
    experimentPath: result.experiment.relativePath,
    created: result.created ?? true,
  }
}

export async function updateExperimentRecordFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = experimentUpdatePayloadSchema.parse(
    await readJsonPayload(input.inputFile, 'experiment payload'),
  )

  return updateExperimentRecord({
    vault: input.vault,
    lookup: experimentLookupFromPayload(payload),
    title: payload.title,
    hypothesis: payload.hypothesis,
    startedOn: payload.startedOn,
    status: payload.status,
    body: payload.body,
    tags: payload.tags,
  })
}

export async function updateExperimentRecord(input: {
  vault: string
  lookup: string
  title?: string
  hypothesis?: string
  startedOn?: string
  status?: string
  body?: string
  tags?: string[]
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const entity = await requireEntityFamily(input.vault, input.lookup, 'experiment')
  const relativePath = entity.path
  const absolutePath = resolveVaultRelativePath(input.vault, relativePath)
  const lock = await core.acquireCanonicalWriteLock(input.vault)

  try {
    const markdown = await readFile(absolutePath, 'utf8')
    const parsed = parseExperimentDocument(core, markdown, relativePath)
    const existing = parsed.attributes
    const nextAttributes = compactObject({
      ...existing,
      title: normalizeOptionalText(input.title) ?? existing.title,
      hypothesis:
        input.hypothesis === undefined
          ? existing.hypothesis
          : normalizeOptionalText(input.hypothesis) ?? undefined,
      startedOn: input.startedOn ?? existing.startedOn,
      status: input.status ?? existing.status,
      tags:
        input.tags === undefined
          ? existing.tags
          : normalizeStringArray(input.tags) ?? undefined,
    })
    const validated = validateExperimentFrontmatter(nextAttributes, relativePath)
    const nextMarkdown = core.stringifyFrontmatterDocument({
      attributes: validated,
      body: input.body ?? parsed.body,
    })
    await writeFile(absolutePath, nextMarkdown, 'utf8')

    return {
      vault: input.vault,
      experimentId: validated.experimentId,
      lookupId: validated.experimentId,
      slug: validated.slug,
      experimentPath: relativePath,
      status: validated.status,
      updated: true,
    }
  } finally {
    await lock.release()
  }
}

export async function checkpointExperimentRecord(input: {
  vault: string
  lookup: string
  occurredAt?: string
  title?: string
  note?: string
}) {
  return appendExperimentLifecycleEvent({
    vault: input.vault,
    lookup: input.lookup,
    phase: 'checkpoint',
    occurredAt: input.occurredAt,
    title: input.title ?? 'Checkpoint',
    note: input.note,
    nextStatus: undefined,
    endedOn: undefined,
  })
}

export async function checkpointExperimentRecordFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = experimentCheckpointPayloadSchema.parse(
    await readJsonPayload(input.inputFile, 'experiment payload'),
  )

  return checkpointExperimentRecord({
    vault: input.vault,
    lookup: experimentLookupFromPayload(payload),
    occurredAt: payload.occurredAt,
    title: payload.title,
    note: payload.note,
  })
}

export async function stopExperimentRecord(input: {
  vault: string
  lookup: string
  occurredAt?: string
  note?: string
}) {
  const occurredAt = normalizeTimestampInput(input.occurredAt ?? new Date())

  return appendExperimentLifecycleEvent({
    vault: input.vault,
    lookup: input.lookup,
    phase: 'stop',
    occurredAt,
    title: 'Stopped',
    note: input.note,
    nextStatus: 'completed',
    endedOn: occurredAt.slice(0, 10),
  })
}

function experimentLookupFromPayload(
  payload: z.infer<typeof experimentSelectorPayloadSchema>,
) {
  return payload.lookup ?? payload.experimentId ?? payload.slug ?? ''
}

export async function showExperimentRecord(vault: string, lookup: string) {
  const entity = await requireEntityFamily(vault, lookup, 'experiment')
  return {
    vault,
    entity: toShowEntity(entity),
  }
}

export async function listExperimentRecords(input: {
  vault: string
  status?: string
  limit: number
}) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await query.readVault(input.vault)
  const items = query
    .listEntities(readModel, {
      families: ['experiment'],
      statuses: input.status ? [input.status] : undefined,
    })
    .slice(0, input.limit)
    .map(toListItem)

  return {
    vault: input.vault,
    filters: {
      status: input.status ?? null,
      limit: input.limit,
    },
    items,
    count: items.length,
    nextCursor: null,
  }
}

export async function ensureJournalRecord(input: {
  vault: string
  date: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const result = await core.ensureJournalDay({
    vaultRoot: input.vault,
    date: input.date,
  })

  return {
    vault: input.vault,
    lookupId: `journal:${input.date}`,
    created: result.created,
    journalPath: result.relativePath,
  }
}

export async function appendJournalText(input: {
  vault: string
  date: string
  text: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const ensured = await core.ensureJournalDay({
    vaultRoot: input.vault,
    date: input.date,
  })
  const relativePath = ensured.relativePath
  const absolutePath = resolveVaultRelativePath(input.vault, relativePath)
  const lock = await core.acquireCanonicalWriteLock(input.vault)

  try {
    const markdown = await readExistingJournalMarkdown(absolutePath, input.date)
    const parsed = parseJournalDocument(core, markdown, relativePath)
    const nextMarkdown = core.stringifyFrontmatterDocument({
      attributes: parsed.attributes,
      body: appendMarkdownParagraph(parsed.body, input.text),
    })
    await writeFile(absolutePath, nextMarkdown, 'utf8')

    return {
      vault: input.vault,
      date: input.date,
      lookupId: `journal:${input.date}`,
      journalPath: relativePath,
      created: ensured.created,
      updated: true,
    }
  } finally {
    await lock.release()
  }
}

async function readExistingJournalMarkdown(
  absolutePath: string,
  date: string,
) {
  try {
    return await readFile(absolutePath, 'utf8')
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') {
      throw new VaultCliError('not_found', `No journal day found for "${date}".`)
    }

    throw error
  }
}

export async function linkJournalEventIds(input: {
  vault: string
  date: string
  eventIds: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    createdMessage: true,
    key: 'eventIds',
    values: input.eventIds,
    operation: 'link',
  })
}

export async function unlinkJournalEventIds(input: {
  vault: string
  date: string
  eventIds: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    createdMessage: false,
    key: 'eventIds',
    values: input.eventIds,
    operation: 'unlink',
  })
}

export async function linkJournalStreams(input: {
  vault: string
  date: string
  sampleStreams: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    createdMessage: true,
    key: 'sampleStreams',
    values: input.sampleStreams,
    operation: 'link',
  })
}

export async function unlinkJournalStreams(input: {
  vault: string
  date: string
  sampleStreams: string[]
}) {
  return mutateJournalLinks({
    vault: input.vault,
    date: input.date,
    createdMessage: false,
    key: 'sampleStreams',
    values: input.sampleStreams,
    operation: 'unlink',
  })
}

export async function showJournalRecord(vault: string, lookup: string) {
  const entity = await requireEntityFamily(vault, lookup, 'journal')
  return {
    vault,
    entity: toShowEntity(entity),
  }
}

export async function listJournalRecords(input: {
  vault: string
  from?: string
  to?: string
  limit: number
}) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await query.readVault(input.vault)
  const items = query
    .listEntities(readModel, {
      families: ['journal'],
      from: input.from,
      to: input.to,
    })
    .slice(0, input.limit)
    .map(toListItem)

  return {
    vault: input.vault,
    filters: {
      kind: 'journal_day',
      from: input.from,
      to: input.to,
      limit: input.limit,
    },
    items,
    count: items.length,
    nextCursor: null,
  }
}

export async function showVaultSummary(vault: string) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await query.readVault(vault)
  const metadata = readModel.metadata

  return {
    vault,
    schemaVersion: stringOrNull(metadata?.schemaVersion),
    vaultId: stringOrNull(metadata?.vaultId),
    title: stringOrNull(metadata?.title),
    timezone: stringOrNull(metadata?.timezone),
    createdAt: normalizeIsoTimestamp(stringOrNull(metadata?.createdAt)),
    corePath: readModel.coreDocument?.sourcePath ?? null,
    coreTitle: readModel.coreDocument?.title ?? null,
    coreUpdatedAt: normalizeIsoTimestamp(readModel.coreDocument?.occurredAt),
  }
}

export async function updateVaultSummary(input: {
  vault: string
  title?: string
  timezone?: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const metadataPath = 'vault.json'
  const corePath = 'CORE.md'
  const absoluteMetadataPath = resolveVaultRelativePath(input.vault, metadataPath)
  const absoluteCorePath = resolveVaultRelativePath(input.vault, corePath)
  const lock = await core.acquireCanonicalWriteLock(input.vault)

  try {
    const metadata = validateVaultMetadata(
      JSON.parse(await readFile(absoluteMetadataPath, 'utf8')),
    )
    const coreDocument = parseCoreDocument(
      core,
      await readFile(absoluteCorePath, 'utf8'),
      corePath,
    )
    const nextTitle = normalizeOptionalText(input.title) ?? metadata.title
    const nextTimezone = normalizeOptionalText(input.timezone) ?? metadata.timezone
    const updatedAt = new Date().toISOString()
    const nextMetadata = validateVaultMetadata({
      ...metadata,
      title: nextTitle,
      timezone: nextTimezone,
    })
    const nextCoreAttributes = validateCoreFrontmatter(compactObject({
      ...coreDocument.attributes,
      title: nextTitle,
      timezone: nextTimezone,
      updatedAt,
    }))

    await writeFile(
      absoluteMetadataPath,
      `${JSON.stringify(nextMetadata, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      absoluteCorePath,
      core.stringifyFrontmatterDocument({
        attributes: nextCoreAttributes,
        body: replaceMarkdownTitle(coreDocument.body, nextTitle),
      }),
      'utf8',
    )

    return {
      vault: input.vault,
      metadataFile: metadataPath,
      corePath,
      title: nextTitle,
      timezone: nextTimezone,
      updatedAt,
      updated: true,
    }
  } finally {
    await lock.release()
  }
}

export async function showVaultPaths(vault: string) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await query.readVault(vault)
  const metadata = readModel.metadata

  return {
    vault,
    paths: objectOrNull(metadata?.paths),
    shards: objectOrNull(metadata?.shards),
  }
}

export async function showVaultStats(vault: string) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await query.readVault(vault)

  return {
    vault,
    counts: {
      totalRecords: readModel.records.length,
      experiments: readModel.experiments.length,
      journalEntries: readModel.journalEntries.length,
      events: readModel.events.length,
      samples: readModel.samples.length,
      audits: readModel.audits.length,
      assessments: readModel.assessments.length,
      profileSnapshots: readModel.profileSnapshots.length,
      goals: readModel.goals.length,
      conditions: readModel.conditions.length,
      allergies: readModel.allergies.length,
      regimens: readModel.regimens.length,
      history: readModel.history.length,
      familyMembers: readModel.familyMembers.length,
      geneticVariants: readModel.geneticVariants.length,
    },
    latest: {
      eventOccurredAt: latestIsoTimestamp(readModel.events),
      sampleOccurredAt: latestIsoTimestamp(readModel.samples),
      journalDate: latestDate(readModel.journalEntries),
      experimentTitle: readModel.experiments.at(-1)?.title ?? null,
    },
  }
}

async function appendExperimentLifecycleEvent(input: {
  vault: string
  lookup: string
  phase: 'checkpoint' | 'stop'
  occurredAt?: string
  title: string
  note?: string
  nextStatus?: ExperimentStatus
  endedOn?: string
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const entity = await requireEntityFamily(input.vault, input.lookup, 'experiment')
  const relativePath = entity.path
  const absolutePath = resolveVaultRelativePath(input.vault, relativePath)
  const lock = await core.acquireCanonicalWriteLock(input.vault)
  const occurredAt = normalizeTimestampInput(input.occurredAt ?? new Date())

  try {
    const markdown = await readFile(absolutePath, 'utf8')
    const parsed = parseExperimentDocument(core, markdown, relativePath)
    const attributes = parsed.attributes
    const nextAttributes = validateExperimentFrontmatter(compactObject({
      ...attributes,
      endedOn: input.endedOn ?? attributes.endedOn,
      status: input.nextStatus ?? attributes.status,
    }), relativePath)
    const nextMarkdown = core.stringifyFrontmatterDocument({
      attributes: nextAttributes,
      body: appendExperimentNoteBlock(parsed.body, {
        occurredAt,
        title: input.title,
        note: input.note,
      }),
    })
    const eventRecord = buildEventRecord({
      kind: 'experiment_event',
      occurredAt,
      title: `${attributes.title} ${input.title}`.trim(),
      note: input.note,
      relatedIds: [attributes.experimentId],
      fields: {
        experimentId: attributes.experimentId,
        experimentSlug: attributes.slug,
        phase: input.phase,
      },
    })
    const ledgerFile = core.toMonthlyShardRelativePath(
      'ledger/events',
      occurredAt,
      'occurredAt',
    )

    await writeFile(absolutePath, nextMarkdown, 'utf8')
    await appendJsonLine(input.vault, ledgerFile, eventRecord)

    return {
      vault: input.vault,
      experimentId: attributes.experimentId,
      lookupId: attributes.experimentId,
      slug: attributes.slug,
      experimentPath: relativePath,
      status: nextAttributes.status,
      eventId: eventRecord.id,
      ledgerFile,
      updated: true,
    }
  } finally {
    await lock.release()
  }
}

async function mutateJournalLinks(input: {
  vault: string
  date: string
  createdMessage: boolean
  key: 'eventIds' | 'sampleStreams'
  values: string[]
  operation: 'link' | 'unlink'
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const ensured =
    input.operation === 'link'
      ? await core.ensureJournalDay({
          vaultRoot: input.vault,
          date: input.date,
        })
      : null
  const relativePath =
    ensured?.relativePath ?? `journal/${input.date.slice(0, 4)}/${input.date}.md`
  const absolutePath = resolveVaultRelativePath(input.vault, relativePath)
  const lock = await core.acquireCanonicalWriteLock(input.vault)

  try {
    const markdown = await readExistingJournalMarkdown(absolutePath, input.date)
    const parsed = parseJournalDocument(core, markdown, relativePath)
    const currentValues = new Set(parsed.attributes[input.key])
    let changed = 0

    for (const value of normalizeStringArray(input.values) ?? []) {
      if (input.operation === 'link') {
        if (!currentValues.has(value)) {
          currentValues.add(value)
          changed += 1
        }
        continue
      }

      if (currentValues.delete(value)) {
        changed += 1
      }
    }

    const nextAttributes = validateJournalFrontmatter({
      ...parsed.attributes,
      [input.key]: [...currentValues].sort((left, right) => left.localeCompare(right)),
    }, relativePath)
    await writeFile(
      absolutePath,
      core.stringifyFrontmatterDocument({
        attributes: nextAttributes,
        body: parsed.body,
      }),
      'utf8',
    )

    return {
      vault: input.vault,
      date: input.date,
      lookupId: `journal:${input.date}`,
      journalPath: relativePath,
      created: ensured?.created ?? false,
      changed,
      eventIds: nextAttributes.eventIds,
      sampleStreams: nextAttributes.sampleStreams,
    }
  } finally {
    await lock.release()
  }
}

async function appendJsonLine(
  vaultRoot: string,
  relativePath: string,
  record: JsonObject,
) {
  const absolutePath = resolveVaultRelativePath(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await appendFile(absolutePath, `${JSON.stringify(record)}\n`, 'utf8')
}

async function requireEntityFamily(
  vault: string,
  lookup: string,
  family: EntityFamily,
) {
  const query = await loadExperimentJournalVaultQueryRuntime()
  const readModel = await query.readVault(vault)
  const entity = query.lookupEntityById(readModel, lookup)

  if (!entity || entity.family !== family) {
    throw new VaultCliError('not_found', `No ${family} found for "${lookup}".`, {
      family,
      lookup,
    })
  }

  return entity
}

function parseExperimentDocument(
  core: ExperimentJournalVaultCoreRuntime,
  markdown: string,
  relativePath: string,
) {
  const document = core.parseFrontmatterDocument(markdown)
  return {
    attributes: validateExperimentFrontmatter(document.attributes, relativePath),
    body: document.body,
  }
}

function parseJournalDocument(
  core: ExperimentJournalVaultCoreRuntime,
  markdown: string,
  relativePath: string,
) {
  const document = core.parseFrontmatterDocument(markdown)
  return {
    attributes: validateJournalFrontmatter(document.attributes, relativePath),
    body: document.body,
  }
}

function parseCoreDocument(
  core: ExperimentJournalVaultCoreRuntime,
  markdown: string,
  relativePath: string,
) {
  const document = core.parseFrontmatterDocument(markdown)
  return {
    attributes: validateCoreFrontmatter(document.attributes, relativePath),
    body: document.body,
  }
}

function validateExperimentFrontmatter(
  value: unknown,
  relativePath = 'experiment',
) {
  const result = experimentFrontmatterSchema.safeParse(value)
  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      `Experiment frontmatter for "${relativePath}" is invalid.`,
      { errors: result.error.flatten() },
    )
  }

  return result.data
}

function validateJournalFrontmatter(
  value: unknown,
  relativePath = 'journal',
) {
  const result = journalDayFrontmatterSchema.safeParse(value)
  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      `Journal frontmatter for "${relativePath}" is invalid.`,
      { errors: result.error.flatten() },
    )
  }

  return result.data
}

function validateCoreFrontmatter(
  value: unknown,
  relativePath = 'CORE.md',
) {
  const result = coreFrontmatterSchema.safeParse(value)
  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      `CORE frontmatter for "${relativePath}" is invalid.`,
      { errors: result.error.flatten() },
    )
  }

  return result.data
}

function validateVaultMetadata(value: unknown) {
  const result = vaultMetadataSchema.safeParse(value)
  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      'Vault metadata is invalid.',
      { errors: result.error.flatten() },
    )
  }

  return result.data
}

function buildEventRecord(input: {
  kind: 'experiment_event'
  occurredAt: string
  title: string
  note?: string
  relatedIds?: string[]
  fields: JsonObject
}) {
  const record = compactObject({
    schemaVersion: CONTRACT_SCHEMA_VERSION.event,
    id: generateContractId(ID_PREFIXES.event),
    kind: input.kind,
    occurredAt: normalizeTimestampInput(input.occurredAt),
    recordedAt: new Date().toISOString(),
    dayKey: normalizeTimestampInput(input.occurredAt).slice(0, 10),
    source: 'manual',
    title: input.title.trim(),
    note: normalizeOptionalText(input.note) ?? undefined,
    relatedIds: normalizeStringArray(input.relatedIds),
    ...input.fields,
  })
  const result = eventRecordSchema.safeParse(record)

  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      `Event payload for kind "${input.kind}" is invalid.`,
      { errors: result.error.flatten() },
    )
  }

  return result.data as JsonObject & { id: string }
}

function toShowEntity(entity: QueryCanonicalEntity) {
  return {
    id: entity.entityId,
    kind: entity.kind,
    title: entity.title ?? null,
    occurredAt: normalizeIsoTimestamp(entity.occurredAt),
    path: entity.path ?? null,
    markdown: entity.body ?? null,
    data: buildEntityData(entity),
    links: buildEntityLinks(entity),
  }
}

function toListItem(entity: QueryCanonicalEntity) {
  return toShowEntity(entity)
}

function buildEntityData(entity: QueryCanonicalEntity) {
  return compactObject({
    ...entity.attributes,
    status:
      typeof entity.attributes.status === 'string'
        ? entity.attributes.status
        : entity.status,
    experimentSlug:
      typeof entity.attributes.experimentSlug === 'string' ||
      typeof entity.attributes.experiment_slug === 'string'
        ? undefined
        : entity.experimentSlug,
    relatedIds:
      Array.isArray(entity.attributes.relatedIds) &&
      entity.attributes.relatedIds.length > 0
        ? undefined
        : entity.relatedIds,
  })
}

function buildEntityLinks(entity: QueryCanonicalEntity) {
  const links = uniqueStrings([
    ...entity.relatedIds,
    ...stringArray(entity.attributes.eventIds),
  ])

  return links.map((id) => ({
    id,
    kind: inferLinkKind(id),
    queryable: isQueryableRecordId(id),
  }))
}

function inferLinkKind(id: string) {
  const healthKind = inferHealthEntityKind(id)
  if (healthKind) {
    return healthKind
  }

  if (id === 'core') {
    return 'core'
  }

  if (id.startsWith('aud_') || id.startsWith('audit:')) {
    return 'audit'
  }

  if (id.startsWith('evt_') || id.startsWith('event:')) {
    return 'event'
  }

  if (id.startsWith('exp_') || id.startsWith('experiment:')) {
    return 'experiment'
  }

  if (id.startsWith('journal:')) {
    return 'journal'
  }

  if (id.startsWith('smp_') || id.startsWith('sample:')) {
    return 'sample'
  }

  if (id.startsWith('meal_')) {
    return 'meal'
  }

  if (id.startsWith('doc_')) {
    return 'document'
  }

  return 'entity'
}

function isQueryableRecordId(id: string) {
  return (
    id === 'core' ||
    isHealthQueryableRecordId(id) ||
    id.startsWith('aud_') ||
    id.startsWith('evt_') ||
    id.startsWith('exp_') ||
    id.startsWith('smp_') ||
    id.startsWith('audit:') ||
    id.startsWith('event:') ||
    id.startsWith('experiment:') ||
    id.startsWith('journal:') ||
    id.startsWith('sample:')
  )
}

async function loadExperimentJournalVaultQueryRuntime(): Promise<ExperimentJournalVaultQueryRuntime> {
  return loadQueryRuntime() as Promise<ExperimentJournalVaultQueryRuntime>
}

async function loadExperimentJournalVaultCoreRuntime(): Promise<ExperimentJournalVaultCoreRuntime> {
  return loadRuntimeModule<ExperimentJournalVaultCoreRuntime>('@healthybob/core')
}

function resolveVaultRelativePath(vaultRoot: string, relativePath: string) {
  const normalized = String(relativePath).trim().replace(/\\/g, '/')

  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/u.test(normalized)
  ) {
    throw new VaultCliError(
      'invalid_path',
      `Vault-relative path "${relativePath}" is invalid.`,
    )
  }

  const absoluteRoot = path.resolve(vaultRoot)
  const absolutePath = path.resolve(absoluteRoot, normalized)
  const containment = path.relative(absoluteRoot, absolutePath)

  if (
    containment === '..' ||
    containment.startsWith(`..${path.sep}`) ||
    path.isAbsolute(containment)
  ) {
    throw new VaultCliError(
      'invalid_path',
      `Vault-relative path "${relativePath}" escapes the selected vault root.`,
    )
  }

  return absolutePath
}

function appendMarkdownParagraph(body: string, text: string) {
  const trimmedBody = body.trimEnd()
  const trimmedText = text.trim()

  if (trimmedBody.length === 0) {
    return `${trimmedText}\n`
  }

  return `${trimmedBody}\n\n${trimmedText}\n`
}

function appendExperimentNoteBlock(
  body: string,
  input: {
    occurredAt: string
    title: string
    note?: string
  },
) {
  const trimmedBody = body.trimEnd()
  const lines = [`### ${input.title} (${input.occurredAt})`]
  const note = normalizeOptionalText(input.note)

  if (note) {
    lines.push('', note)
  }

  const block = `${lines.join('\n')}\n`
  if (trimmedBody.length === 0) {
    return `## Notes\n\n${block}`
  }

  if (trimmedBody.includes('\n## Notes\n')) {
    return `${trimmedBody}\n\n${block}`
  }

  return `${trimmedBody}\n\n## Notes\n\n${block}`
}

function replaceMarkdownTitle(body: string, title: string) {
  const trimmedBody = body.trimStart()
  if (trimmedBody.startsWith('# ')) {
    return body.replace(/^# .*(?:\r?\n)?/u, `# ${title}\n`)
  }

  return `# ${title}\n\n${body.trimStart()}`
}

function normalizeOptionalText(value: string | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeIsoTimestamp(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  return ISO_TIMESTAMP_WITH_OFFSET_PATTERN.test(value) ? value : null
}

function normalizeTimestampInput(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new VaultCliError(
      'invalid_timestamp',
      `Invalid timestamp "${String(value)}".`,
    )
  }

  return date.toISOString()
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return normalized.length > 0 ? uniqueStrings(normalized) : undefined
}

function latestIsoTimestamp(records: readonly QueryVaultRecord[]) {
  const latest = [...records]
    .map((record) => normalizeIsoTimestamp(record.occurredAt))
    .filter((value): value is string => value !== null)
    .at(-1)

  return latest ?? null
}

function latestDate(records: readonly QueryVaultRecord[]) {
  const latest = [...records]
    .map((record) => record.date)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .at(-1)

  return latest ?? null
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)]
}

function compactObject(record: JsonObject) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  )
}

function generateContractId(prefix: string) {
  return `${prefix}_${generateUlid()}`
}

function generateUlid() {
  return `${encodeTime(Date.now(), 10)}${encodeRandom(16)}`
}

function encodeTime(value: number, length: number) {
  let remaining = value
  let output = ''

  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD_BASE32_ALPHABET[remaining % 32] + output
    remaining = Math.floor(remaining / 32)
  }

  return output
}

function encodeRandom(length: number) {
  return Array.from(randomBytes(length), (byte) =>
    CROCKFORD_BASE32_ALPHABET[byte % 32],
  ).join('')
}
