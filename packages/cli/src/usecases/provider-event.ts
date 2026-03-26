import { EVENT_KINDS } from '@healthybob/contracts'
import { z } from 'incur'
import { loadJsonInputObject } from '../json-input.js'
import { normalizeRepeatableFlagOption } from '../option-utils.js'
import {
  loadQueryRuntime,
  type QueryRuntimeModule,
  type QueryVaultRecord as QueryRecord,
} from '../query-runtime.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '../vault-cli-errors.js'
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

interface ProviderReadModel {
  providerId: string
  slug: string
  title: string
  status?: string
  relativePath: string
  markdown: string
  [key: string]: unknown
}

interface ProviderEventCoreRuntime {
  upsertProvider(input: {
    vaultRoot: string
    providerId?: string
    slug?: string
    title: string
    status?: string
    specialty?: string
    organization?: string
    location?: string
    website?: string
    phone?: string
    note?: string
    aliases?: string[]
    body?: string
  }): Promise<{
    providerId: string
    relativePath: string
    created: boolean
  }>
  upsertEvent(input: {
    vaultRoot: string
    payload: JsonObject
  }): Promise<{
    eventId: string
    ledgerFile: string
    created: boolean
  }>
  importSamples(input: {
    vaultRoot: string
    stream: string
    unit: string
    samples: Array<Record<string, unknown>>
    sourcePath?: string
    source?: string
    quality?: string
    batchProvenance?: Record<string, unknown>
  }): Promise<{
    count: number
    records: Array<{
      id: string
    }>
    shardPaths: string[]
  }>
  listProviders(vaultRoot: string): Promise<ProviderReadModel[]>
  readProvider(input: {
    vaultRoot: string
    providerId?: string
    slug?: string
  }): Promise<ProviderReadModel>
}

const providerStatusSchema = z.string().min(1)
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')

const providerPayloadSchema = z
  .object({
    providerId: z
      .string()
      .regex(/^prov_[0-9A-Za-z]+$/u)
      .optional(),
    slug: slugSchema.optional(),
    title: z.string().min(1).max(160),
    status: providerStatusSchema.default('active'),
    specialty: z.string().min(1).max(160).optional(),
    organization: z.string().min(1).max(160).optional(),
    location: z.string().min(1).max(160).optional(),
    website: z.string().min(1).max(240).optional(),
    phone: z.string().min(1).max(64).optional(),
    note: z.string().min(1).max(4000).optional(),
    aliases: z.array(z.string().min(1).max(160)).optional(),
    body: z.string().optional(),
  })
  .strict()

export type ProviderPayload = z.infer<typeof providerPayloadSchema>

const EVENT_WRITE_KINDS = [
  'symptom',
  'note',
  'observation',
  'medication_intake',
  'supplement_intake',
  'activity_session',
  'sleep_session',
  'intervention_session',
] as const

export const eventScaffoldKindSchema = z.enum(EVENT_WRITE_KINDS)

const eventTemplates: Record<(typeof EVENT_KINDS)[number], JsonObject> = {
  adverse_effect: {
    kind: 'adverse_effect',
    occurredAt: '2026-03-12T18:45:00.000Z',
    title: 'Evening headache after new supplement',
    substance: 'magnesium glycinate',
    effect: 'headache',
    severity: 'mild',
    note: 'Resolved after hydration.',
    tags: ['reaction'],
  },
  document: {
    kind: 'document',
    occurredAt: '2026-03-12T09:00:00.000Z',
    title: 'Imported care plan',
    documentId: 'doc_01JNV422Y2M5ZBV64ZP4N1DRB1',
    documentPath: 'raw/documents/2026/03/doc_01JNV422Y2M5ZBV64ZP4N1DRB1/care-plan.pdf',
    mimeType: 'application/pdf',
  },
  encounter: {
    kind: 'encounter',
    occurredAt: '2026-03-12T09:00:00.000Z',
    title: 'Primary care visit',
    encounterType: 'office_visit',
    location: 'Primary care clinic',
  },
  exposure: {
    kind: 'exposure',
    occurredAt: '2026-03-12T07:30:00.000Z',
    title: 'Secondhand smoke exposure',
    exposureType: 'environmental',
    substance: 'tobacco smoke',
    duration: '15m',
  },
  meal: {
    kind: 'meal',
    occurredAt: '2026-03-12T12:15:00.000Z',
    title: 'Lunch',
    mealId: 'meal_01JNV422Y2M5ZBV64ZP4N1DRB1',
    photoPaths: ['raw/meals/2026/03/meal_01JNV422Y2M5ZBV64ZP4N1DRB1/photo-lunch.jpg'],
    audioPaths: [],
  },
  symptom: {
    kind: 'symptom',
    occurredAt: '2026-03-12T07:15:00.000Z',
    title: 'Morning fatigue',
    symptom: 'fatigue',
    intensity: 6,
    bodySite: 'generalized',
  },
  note: {
    kind: 'note',
    occurredAt: '2026-03-12T09:30:00.000Z',
    title: 'Observation note',
    note: 'Energy was noticeably better after lunch.',
    tags: ['energy'],
  },
  observation: {
    kind: 'observation',
    occurredAt: '2026-03-12T09:10:00.000Z',
    title: 'Fasting glucose',
    metric: 'glucose',
    value: 88,
    unit: 'mg_dL',
  },
  experiment_event: {
    kind: 'experiment_event',
    occurredAt: '2026-03-12T09:00:00.000Z',
    title: 'Focus sprint checkpoint',
    experimentId: 'exp_01JNV422Y2M5ZBV64ZP4N1DRB1',
    experimentSlug: 'focus-sprint',
    phase: 'checkpoint',
  },
  medication_intake: {
    kind: 'medication_intake',
    occurredAt: '2026-03-12T08:00:00.000Z',
    title: 'Morning medication',
    medicationName: 'metformin',
    dose: 500,
    unit: 'mg',
  },
  procedure: {
    kind: 'procedure',
    occurredAt: '2026-03-12T11:00:00.000Z',
    title: 'Blood draw',
    procedure: 'venipuncture',
    status: 'completed',
  },
  supplement_intake: {
    kind: 'supplement_intake',
    occurredAt: '2026-03-12T21:00:00.000Z',
    title: 'Evening magnesium',
    supplementName: 'magnesium glycinate',
    dose: 200,
    unit: 'mg',
  },
  test: {
    kind: 'test',
    occurredAt: '2026-03-12T11:15:00.000Z',
    title: 'CMP result',
    testName: 'comprehensive_metabolic_panel',
    resultStatus: 'normal',
    summary: 'Within expected range.',
  },
  activity_session: {
    kind: 'activity_session',
    occurredAt: '2026-03-12T17:30:00.000Z',
    title: 'Evening walk',
    activityType: 'walking',
    durationMinutes: 35,
    distanceKm: 2.7,
  },
  sleep_session: {
    kind: 'sleep_session',
    occurredAt: '2026-03-12T06:45:00.000Z',
    title: 'Overnight sleep',
    startAt: '2026-03-11T22:45:00.000Z',
    endAt: '2026-03-12T06:45:00.000Z',
    durationMinutes: 480,
  },
  intervention_session: {
    kind: 'intervention_session',
    occurredAt: '2026-03-12T19:30:00.000Z',
    title: '20-minute sauna',
    interventionType: 'sauna',
    durationMinutes: 20,
    protocolId: 'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
    relatedIds: ['prot_01JNV422Y2M5ZBV64ZP4N1DRB1'],
    note: '20 min sauna after lifting.',
  },
}

export function scaffoldProviderPayload() {
  return {
    title: 'Primary Care Clinic',
    slug: 'primary-care-clinic',
    status: 'active',
    specialty: 'primary_care',
    organization: 'Neighborhood Health',
    location: 'Suite 200',
    website: 'https://example-clinic.test',
    phone: '555-0100',
    note: 'Use this record for longitudinal primary care encounters and documents.',
    aliases: ['Neighborhood Health Primary Care'],
    body: '# Primary Care Clinic\n\n## Notes\n\n',
  } satisfies ProviderPayload
}

export function parseProviderPayload(value: unknown) {
  const result = providerPayloadSchema.safeParse(value)
  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      'Provider payload is invalid.',
      { errors: result.error.flatten() },
    )
  }

  return result.data
}

export async function loadJsonInputFile(
  input: string,
  label: string,
): Promise<JsonObject> {
  return loadJsonInputObject(input, label)
}

export function scaffoldEventPayload(
  kind: (typeof EVENT_WRITE_KINDS)[number],
) {
  return structuredClone(eventTemplates[kind] ?? eventTemplates.note)
}

export async function upsertProviderRecord(input: {
  vault: string
  payload: ProviderPayload
}) {
  const core = await loadProviderEventCoreRuntime()
  try {
    const result = await core.upsertProvider({
      vaultRoot: input.vault,
      providerId: input.payload.providerId,
      slug: input.payload.slug,
      title: input.payload.title,
      status: input.payload.status,
      specialty: input.payload.specialty,
      organization: input.payload.organization,
      location: input.payload.location,
      website: input.payload.website,
      phone: input.payload.phone,
      note: input.payload.note,
      aliases: input.payload.aliases,
      body: input.payload.body,
    })

    return {
      vault: input.vault,
      providerId: result.providerId,
      lookupId: result.providerId,
      path: result.relativePath,
      created: result.created,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      HB_PROVIDER_CONFLICT: {
        code: 'conflict',
      },
      HB_PROVIDER_SLUG_INVALID: {
        code: 'contract_invalid',
      },
      HB_PROVIDER_FRONTMATTER_INVALID: {
        code: 'contract_invalid',
      },
    })
  }
}

export async function upsertProviderRecordFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = parseProviderPayload(
    await loadJsonInputFile(input.inputFile, 'provider payload'),
  )

  return upsertProviderRecord({
    vault: input.vault,
    payload,
  })
}

export async function showProviderRecord(vault: string, lookup: string) {
  const provider = await requireProviderRecord(vault, lookup)
  const data = buildProviderData(provider)
  return {
    vault,
    entity: {
      id: provider.providerId,
      kind: 'provider',
      title: provider.title,
      occurredAt: null,
      path: provider.relativePath,
      markdown: provider.markdown,
      data,
      links: [],
    },
  }
}

export async function listProviderRecords(input: {
  vault: string
  status?: string
  limit: number
}) {
  const providers = await readProviderEntries(input.vault)
  const items = providers
    .filter((entry) =>
      input.status ? entry.status === input.status : true,
    )
    .sort((left, right) =>
      left.title.localeCompare(right.title),
    )
    .slice(0, input.limit)
    .map((entry) => {
      const data = buildProviderData(entry)

      return {
        id: entry.providerId,
        kind: 'provider',
        title: entry.title,
        occurredAt: null,
        path: entry.relativePath,
        markdown: entry.markdown,
        data,
        links: [],
      }
    })

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

export async function upsertEventRecord(input: {
  vault: string
  payload: JsonObject
}) {
  const core = await loadProviderEventCoreRuntime()
  try {
    const result = await core.upsertEvent({
      vaultRoot: input.vault,
      payload: input.payload,
    })

    return {
      vault: input.vault,
      eventId: result.eventId,
      lookupId: result.eventId,
      ledgerFile: result.ledgerFile,
      created: result.created,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      HB_EVENT_KIND_INVALID: {
        code: 'contract_invalid',
      },
      HB_EVENT_OCCURRED_AT_MISSING: {
        code: 'invalid_timestamp',
      },
      HB_EVENT_CONTRACT_INVALID: {
        code: 'contract_invalid',
      },
      HB_INVALID_TIMESTAMP: {
        code: 'invalid_timestamp',
      },
      HB_INVALID_INPUT: {
        code: 'contract_invalid',
      },
    })
  }
}

export async function upsertEventRecordFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = await loadJsonInputFile(input.inputFile, 'event payload')
  return upsertEventRecord({
    vault: input.vault,
    payload,
  })
}

export async function showEventRecord(vault: string, eventId: string) {
  const query = await loadProviderEventQueryRuntime()
  const readModel = await query.readVault(vault)
  const record = query.lookupRecordById(readModel, eventId)

  if (!record || record.recordType !== 'event') {
    throw new VaultCliError('not_found', `No event found for "${eventId}".`)
  }

  return {
    vault,
    entity: toCommandShowEntity(record),
  }
}

export async function listEventRecords(input: {
  vault: string
  kind?: string
  from?: string
  to?: string
  tag?: string[]
  experiment?: string
  limit: number
}) {
  const tags = normalizeRepeatableFlagOption(input.tag, 'tag')
  const query = await loadProviderEventQueryRuntime()
  const readModel = await query.readVault(input.vault)
  const items = query
    .listRecords(readModel, {
      recordTypes: ['event'],
      kinds: input.kind ? [input.kind] : undefined,
      experimentSlug: input.experiment,
      from: input.from,
      to: input.to,
      tags,
    })
    .slice(0, input.limit)
    .map(toCommandListItem)

  return {
    vault: input.vault,
    filters: {
      kind: input.kind ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
      tag: tags ?? [],
      experiment: input.experiment ?? null,
      limit: input.limit,
    },
    items,
    count: items.length,
    nextCursor: null,
  }
}

export async function addSampleRecords(input: {
  vault: string
  payload: JsonObject
}) {
  const core = await loadProviderEventCoreRuntime()
  const stream = normalizeRequiredText(
    input.payload.stream,
    'Samples payload requires a stream.',
  )
  const unit = normalizeRequiredText(
    input.payload.unit,
    'Samples payload requires a unit.',
  )
  const source = normalizeOptionalText(valueAsString(input.payload.source)) ?? 'manual'
  const quality = normalizeOptionalText(valueAsString(input.payload.quality)) ?? 'raw'
  const sourcePath = normalizeOptionalText(valueAsString(input.payload.sourcePath)) ?? undefined
  const batchProvenance =
    typeof input.payload.batchProvenance === 'object' &&
    input.payload.batchProvenance !== null &&
    !Array.isArray(input.payload.batchProvenance)
      ? (input.payload.batchProvenance as Record<string, unknown>)
      : undefined
  const samples = Array.isArray(input.payload.samples)
    ? input.payload.samples.filter(
        (sample): sample is Record<string, unknown> =>
          typeof sample === 'object' && sample !== null && !Array.isArray(sample),
      )
    : []

  if (samples.length === 0) {
    throw new VaultCliError(
      'invalid_payload',
      'Samples payload must include a non-empty samples array.',
    )
  }

  const result = await core.importSamples({
    vaultRoot: input.vault,
    stream,
    unit,
    samples,
    sourcePath,
    source,
    quality,
    batchProvenance,
  })

  return {
    vault: input.vault,
    stream,
    source,
    quality,
    addedCount: result.count,
    lookupIds: result.records.map((record) => record.id),
    ledgerFiles: result.shardPaths,
  }
}

export async function addSampleRecordsFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = await loadJsonInputFile(input.inputFile, 'samples payload')
  return addSampleRecords({
    vault: input.vault,
    payload,
  })
}

async function requireProviderRecord(vault: string, lookup: string) {
  const normalizedLookup = lookup.trim()
  const core = await loadProviderEventCoreRuntime()

  try {
    return await core.readProvider({
      vaultRoot: vault,
      providerId: normalizedLookup,
      slug: normalizedLookup,
    })
  } catch (error) {
    throw toVaultCliError(error, {
      HB_PROVIDER_MISSING: {
        code: 'not_found',
        message: `No provider found for "${lookup}".`,
      },
      HB_PROVIDER_FRONTMATTER_INVALID: {
        code: 'contract_invalid',
      },
    })
  }
}

async function readProviderEntries(vaultRoot: string) {
  const core = await loadProviderEventCoreRuntime()
  try {
    return await core.listProviders(vaultRoot)
  } catch (error) {
    throw toVaultCliError(error, {
      HB_PROVIDER_FRONTMATTER_INVALID: {
        code: 'contract_invalid',
      },
    })
  }
}

function toCommandShowEntity(record: QueryRecord) {
  return {
    id: record.displayId,
    kind: record.kind ?? 'event',
    title: record.title ?? null,
    occurredAt: normalizeIsoTimestamp(record.occurredAt),
    path: record.sourcePath ?? null,
    markdown: record.body ?? null,
    data: compactObject({
      ...record.data,
      status: record.status ?? undefined,
      stream: record.stream ?? undefined,
      experimentSlug: record.experimentSlug ?? undefined,
    }),
    links: buildRecordLinks(record),
  }
}

function toCommandListItem(record: QueryRecord) {
  return toCommandShowEntity(record)
}

function buildRecordLinks(record: QueryRecord) {
  const links = uniqueStrings([
    ...(Array.isArray(record.relatedIds) ? record.relatedIds : []),
    ...stringArray(record.data.relatedIds),
    ...stringArray(record.data.eventIds),
  ])

  return links.map((id) => ({
    id,
    kind: inferVaultLinkKind(id, { includeProviderIds: true }),
    queryable: isVaultQueryableRecordId(id),
  }))
}

function valueAsString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function normalizeRequiredText(value: unknown, message: string) {
  const normalized = normalizeOptionalText(valueAsString(value))
  if (!normalized) {
    throw new VaultCliError('contract_invalid', message)
  }

  return normalized
}

async function loadProviderEventQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadQueryRuntime()
}

async function loadProviderEventCoreRuntime(): Promise<ProviderEventCoreRuntime> {
  return loadRuntimeModule<ProviderEventCoreRuntime>('@healthybob/core')
}

function buildProviderData(provider: ProviderReadModel) {
  const {
    relativePath: _relativePath,
    markdown: _markdown,
    body: _body,
    ...data
  } = provider as ProviderReadModel & { body?: string }
  return {
    ...data,
  }
}
