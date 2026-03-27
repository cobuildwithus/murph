import { EXPERIMENT_STATUSES } from '@healthybob/contracts'
import { z } from 'incur'
import {
  loadQueryRuntime,
  type QueryCanonicalEntity,
  type QueryRuntimeModule,
  type QueryVaultRecord,
} from '../query-runtime.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  isoTimestampSchema,
  localDateSchema,
  slugSchema,
} from '../vault-cli-contracts.js'
import {
  asListEnvelope,
  readJsonPayload,
} from './shared.js'
import {
  compactObject,
  inferVaultLinkKind,
  isVaultQueryableRecordId,
  normalizeIsoTimestamp,
  normalizeOptionalText,
  toVaultCliError,
  stringArray,
  uniqueStrings,
} from './vault-usecase-helpers.js'

type JsonObject = Record<string, unknown>
type EntityFamily = 'experiment' | 'journal'
type JournalLinkKind = 'eventIds' | 'sampleStreams'
type JournalLinkOperation = 'link' | 'unlink'
type JournalLinkRuntimeInput = {
  vaultRoot: string
  date: string
  values: string[]
}
type JournalLinkRuntimeResult = {
  relativePath: string
  created: boolean
  changed: number
  eventIds: string[]
  sampleStreams: string[]
}
type JournalLinkRuntimeAction =
  | 'linkJournalEventIds'
  | 'unlinkJournalEventIds'
  | 'linkJournalStreams'
  | 'unlinkJournalStreams'

interface ExperimentJournalVaultCoreRuntime {
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
  updateExperiment(input: {
    vaultRoot: string
    relativePath: string
    title?: string
    hypothesis?: string
    startedOn?: string
    status?: string
    body?: string
    tags?: string[]
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: string
    updated: true
  }>
  checkpointExperiment(input: {
    vaultRoot: string
    relativePath: string
    occurredAt?: string
    title: string
    note?: string
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: string
    eventId: string
    ledgerFile: string
    updated: true
  }>
  stopExperiment(input: {
    vaultRoot: string
    relativePath: string
    occurredAt?: string
    title: string
    note?: string
  }): Promise<{
    experimentId: string
    slug: string
    relativePath: string
    status: string
    eventId: string
    ledgerFile: string
    updated: true
  }>
  ensureJournalDay(input: {
    vaultRoot: string
    date?: string
  }): Promise<{
    created: boolean
    relativePath: string
  }>
  appendJournal(input: {
    vaultRoot: string
    date: string
    text: string
  }): Promise<{
    relativePath: string
    created: boolean
    updated: true
  }>
  linkJournalEventIds(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  unlinkJournalEventIds(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  linkJournalStreams(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  unlinkJournalStreams(input: JournalLinkRuntimeInput): Promise<JournalLinkRuntimeResult>
  updateVaultSummary(input: {
    vaultRoot: string
    title?: string
    timezone?: string
  }): Promise<{
    metadataFile: string
    corePath: string
    title: string
    timezone: string
    updatedAt: string
    updated: true
  }>
}

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
const JOURNAL_LINK_RUNTIME_ACTIONS: Record<
  JournalLinkKind,
  Record<JournalLinkOperation, JournalLinkRuntimeAction>
> = {
  eventIds: {
    link: 'linkJournalEventIds',
    unlink: 'unlinkJournalEventIds',
  },
  sampleStreams: {
    link: 'linkJournalStreams',
    unlink: 'unlinkJournalStreams',
  },
}

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
    startedOn: input.startedOn,
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
  try {
    const result = await core.updateExperiment({
      vaultRoot: input.vault,
      relativePath: entity.path,
      title: input.title,
      hypothesis: input.hypothesis,
      startedOn: input.startedOn,
      status: input.status,
      body: input.body,
      tags: input.tags,
    })

    return {
      vault: input.vault,
      experimentId: result.experimentId,
      lookupId: result.experimentId,
      slug: result.slug,
      experimentPath: result.relativePath,
      status: result.status,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error)
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
    mode: 'checkpoint',
    occurredAt: input.occurredAt,
    title: input.title ?? 'Checkpoint',
    note: input.note,
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
  return appendExperimentLifecycleEvent({
    vault: input.vault,
    lookup: input.lookup,
    mode: 'stop',
    occurredAt: input.occurredAt,
    title: 'Stopped',
    note: input.note,
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
    .map(toShowEntity)

  return asListEnvelope(input.vault, {
    status: input.status ?? null,
    limit: input.limit,
  }, items)
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
  try {
    const result = await core.appendJournal({
      vaultRoot: input.vault,
      date: input.date,
      text: input.text,
    })

    return {
      vault: input.vault,
      date: input.date,
      lookupId: `journal:${input.date}`,
      journalPath: result.relativePath,
      created: result.created,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      HB_JOURNAL_DAY_MISSING: {
        code: 'not_found',
      },
    })
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
    kind: 'eventIds',
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
    kind: 'eventIds',
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
    kind: 'sampleStreams',
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
    kind: 'sampleStreams',
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
    .map(toShowEntity)

  return asListEnvelope(input.vault, {
    kind: 'journal_day',
    from: input.from,
    to: input.to,
    limit: input.limit,
  }, items)
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
  try {
    const result = await core.updateVaultSummary({
      vaultRoot: input.vault,
      title: input.title,
      timezone: input.timezone,
    })

    return {
      vault: input.vault,
      metadataFile: result.metadataFile,
      corePath: result.corePath,
      title: result.title,
      timezone: result.timezone,
      updatedAt: result.updatedAt,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error)
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
      protocols: readModel.protocols.length,
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
  occurredAt?: string
  title: string
  note?: string
  mode: 'checkpoint' | 'stop'
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  const entity = await requireEntityFamily(input.vault, input.lookup, 'experiment')

  try {
    const result =
      input.mode === 'checkpoint'
        ? await core.checkpointExperiment({
            vaultRoot: input.vault,
            relativePath: entity.path,
            occurredAt: input.occurredAt,
            title: input.title,
            note: input.note,
          })
        : await core.stopExperiment({
            vaultRoot: input.vault,
            relativePath: entity.path,
            occurredAt: input.occurredAt,
            title: input.title,
            note: input.note,
          })

    return {
      vault: input.vault,
      experimentId: result.experimentId,
      lookupId: result.experimentId,
      slug: result.slug,
      experimentPath: result.relativePath,
      status: result.status,
      eventId: result.eventId,
      ledgerFile: result.ledgerFile,
      updated: result.updated,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      HB_INVALID_TIMESTAMP: {
        code: 'invalid_timestamp',
      },
    })
  }
}

async function mutateJournalLinks(input: {
  vault: string
  date: string
  kind: JournalLinkKind
  values: string[]
  operation: JournalLinkOperation
}) {
  const core = await loadExperimentJournalVaultCoreRuntime()
  try {
    const action = JOURNAL_LINK_RUNTIME_ACTIONS[input.kind][input.operation]
    const result = await core[action]({
      vaultRoot: input.vault,
      date: input.date,
      values: input.values,
    })

    return {
      vault: input.vault,
      date: input.date,
      lookupId: `journal:${input.date}`,
      journalPath: result.relativePath,
      created: result.created,
      changed: result.changed,
      eventIds: result.eventIds,
      sampleStreams: result.sampleStreams,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      HB_JOURNAL_DAY_MISSING: {
        code: 'not_found',
      },
    })
  }
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

function buildEntityData(entity: QueryCanonicalEntity) {
  return compactObject({
    ...entity.attributes,
    status:
      typeof entity.attributes.status === 'string'
        ? entity.attributes.status
        : entity.status,
    experimentSlug:
      typeof entity.attributes.experimentSlug === 'string'
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
    kind: inferVaultLinkKind(id),
    queryable: isVaultQueryableRecordId(id),
  }))
}

async function loadExperimentJournalVaultQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadQueryRuntime()
}

async function loadExperimentJournalVaultCoreRuntime(): Promise<ExperimentJournalVaultCoreRuntime> {
  return loadRuntimeModule<ExperimentJournalVaultCoreRuntime>('@healthybob/core')
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
