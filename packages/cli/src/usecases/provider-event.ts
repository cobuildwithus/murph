import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  CONTRACT_SCHEMA_VERSION,
  EVENT_KINDS,
  ID_PREFIXES,
  eventRecordSchema,
  providerFrontmatterSchema,
  type ProviderFrontmatter,
} from '@healthybob/contracts'
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
  generateContractId,
  inferVaultLinkKind,
  isVaultQueryableRecordId,
  normalizeIsoTimestamp,
  normalizeOptionalText,
  normalizeStringArray,
  resolveVaultRelativePath,
  stringArray,
  uniqueStrings,
} from './vault-usecase-helpers.js'

type JsonObject = Record<string, unknown>

interface CanonicalWriteLockHandle {
  release(): Promise<void>
}

interface CanonicalTextWriteInput {
  relativePath: string
  content: string
  overwrite?: boolean
  allowExistingMatch?: boolean
}

interface CanonicalJsonlAppendInput {
  relativePath: string
  record: JsonObject
}

interface CanonicalDeleteInput {
  relativePath: string
}

interface FrontmatterDocument {
  attributes: JsonObject
  body: string
}

interface ProviderEventCoreRuntime {
  acquireCanonicalWriteLock(vaultRoot: string): Promise<CanonicalWriteLockHandle>
  applyCanonicalWriteBatch(input: {
    vaultRoot: string
    operationType: string
    summary: string
    occurredAt?: string | Date
    textWrites?: CanonicalTextWriteInput[]
    jsonlAppends?: CanonicalJsonlAppendInput[]
    deletes?: CanonicalDeleteInput[]
  }): Promise<{
    textWrites: string[]
    jsonlAppends: string[]
    deletes: string[]
  }>
  appendJsonlRecord<TRecord extends object>(input: {
    vaultRoot: string
    relativePath: string
    record: TRecord
  }): Promise<TRecord>
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
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
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
] as const

export const eventScaffoldKindSchema = z.enum(EVENT_WRITE_KINDS)

const reservedEventKeys = new Set([
  'schemaVersion',
  'id',
  'eventId',
  'kind',
  'occurredAt',
  'recordedAt',
  'dayKey',
  'source',
  'title',
  'note',
  'tags',
  'relatedIds',
  'rawRefs',
])

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
  const lock = await core.acquireCanonicalWriteLock(input.vault)

  try {
    const existingEntries = await readProviderEntries(input.vault)
    const normalizedTitle = input.payload.title.trim()
    const desiredSlug = normalizeProviderSlug(input.payload.slug ?? normalizedTitle)
    const requestedId = normalizeOptionalText(input.payload.providerId)
    const existingById =
      requestedId
        ? existingEntries.find(
            (entry) => entry.attributes.providerId === requestedId,
          )
        : undefined
    const slugOwner = existingEntries.find(
      (entry) => entry.attributes.slug === desiredSlug,
    )

    if (
      slugOwner &&
      requestedId &&
      slugOwner.attributes.providerId !== requestedId
    ) {
      throw new VaultCliError(
        'conflict',
        `Provider slug "${desiredSlug}" is already owned by "${slugOwner.attributes.providerId}".`,
        {
          conflictingProviderId: slugOwner.attributes.providerId,
          providerId: requestedId,
          slug: desiredSlug,
        },
      )
    }

    const existing = existingById ?? slugOwner
    const providerId = requestedId ?? existing?.attributes.providerId ?? generateContractId(ID_PREFIXES.provider)
    const relativePath = providerRelativePath(desiredSlug)
    const previousPath = existing?.relativePath ?? null
    const nextAttributes = validateProviderFrontmatter(compactObject({
      schemaVersion: CONTRACT_SCHEMA_VERSION.providerFrontmatter,
      docType: 'provider',
      providerId,
      slug: desiredSlug,
      title: normalizedTitle,
      status: input.payload.status,
      specialty: normalizeOptionalText(input.payload.specialty) ?? undefined,
      organization: normalizeOptionalText(input.payload.organization) ?? undefined,
      location: normalizeOptionalText(input.payload.location) ?? undefined,
      website: normalizeOptionalText(input.payload.website) ?? undefined,
      phone: normalizeOptionalText(input.payload.phone) ?? undefined,
      note: normalizeOptionalText(input.payload.note) ?? undefined,
      aliases: normalizeStringArray(input.payload.aliases) ?? undefined,
    }))
    const body = normalizeProviderBody(
      input.payload.body,
      existing?.body ?? null,
      nextAttributes.title,
      nextAttributes.note,
    )
    await core.applyCanonicalWriteBatch({
      vaultRoot: input.vault,
      operationType: 'provider_upsert',
      summary: `Upsert provider ${providerId}`,
      occurredAt: new Date(),
      textWrites: [
        {
          relativePath,
          content: core.stringifyFrontmatterDocument({
            attributes: nextAttributes,
            body,
          }),
          overwrite: true,
        },
      ],
      deletes:
        previousPath && previousPath !== relativePath
          ? [
              {
                relativePath: previousPath,
              },
            ]
          : [],
    })

    return {
      vault: input.vault,
      providerId,
      lookupId: providerId,
      path: relativePath,
      created: existing === undefined,
    }
  } finally {
    await lock.release()
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
  return {
    vault,
    entity: {
      id: provider.attributes.providerId,
      kind: 'provider',
      title: provider.attributes.title,
      occurredAt: null,
      path: provider.relativePath,
      markdown: provider.markdown,
      data: {
        ...provider.attributes,
      },
      links: [],
    },
  }
}

export async function listProviderRecords(input: {
  vault: string
  status?: ProviderFrontmatter['status']
  limit: number
}) {
  const providers = await readProviderEntries(input.vault)
  const items = providers
    .filter((entry) =>
      input.status ? entry.attributes.status === input.status : true,
    )
    .sort((left, right) =>
      left.attributes.title.localeCompare(right.attributes.title),
    )
    .slice(0, input.limit)
    .map((entry) => ({
      id: entry.attributes.providerId,
      kind: 'provider',
      title: entry.attributes.title,
      occurredAt: null,
      path: entry.relativePath,
      markdown: entry.markdown,
      data: {
        ...entry.attributes,
      },
      links: [],
    }))

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
  const query = await loadProviderEventQueryRuntime()
  const eventRecord = buildEventRecord(input.payload)
  const readModel = await query.readVault(input.vault)
  const existing = query.lookupRecordById(readModel, eventRecord.id)
  const ledgerFile = core.toMonthlyShardRelativePath(
    'ledger/events',
    eventRecord.occurredAt,
    'occurredAt',
  )

  if (existing && existing.recordType === 'event') {
    return {
      vault: input.vault,
      eventId: eventRecord.id,
      lookupId: eventRecord.id,
      ledgerFile: existing.sourcePath,
      created: false,
    }
  }

  await core.appendJsonlRecord({
    vaultRoot: input.vault,
    relativePath: ledgerFile,
    record: eventRecord,
  })

  return {
    vault: input.vault,
    eventId: eventRecord.id,
    lookupId: eventRecord.id,
    ledgerFile,
    created: true,
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

function buildEventRecord(payload: JsonObject) {
  const kind = eventScaffoldKindSchema.safeParse(payload.kind)
  if (!kind.success) {
    throw new VaultCliError(
      'contract_invalid',
      'Event payload requires a supported kind.',
      { errors: kind.error.flatten() },
    )
  }

  const occurredAt = normalizeTimestampInput(payload.occurredAt)
  if (!occurredAt) {
    throw new VaultCliError(
      'invalid_timestamp',
      'Event payload requires occurredAt.',
    )
  }
  const title = normalizeRequiredText(payload.title, 'Event payload requires a title.')
  const eventId = normalizeOptionalText(
    typeof payload.id === 'string' ? payload.id : valueAsString(payload.eventId),
  )
  const source = normalizeOptionalText(valueAsString(payload.source)) ?? 'manual'
  const record = compactObject({
    schemaVersion: CONTRACT_SCHEMA_VERSION.event,
    id: eventId ?? generateContractId(ID_PREFIXES.event),
    kind: kind.data,
    occurredAt,
    recordedAt: normalizeTimestampInput(payload.recordedAt) ?? new Date().toISOString(),
    dayKey:
      normalizeLocalDate(valueAsString(payload.dayKey)) ??
      occurredAt.slice(0, 10),
    source,
    title,
    note: normalizeOptionalText(valueAsString(payload.note)) ?? undefined,
    tags: normalizeStringArray(payload.tags) ?? undefined,
    relatedIds: normalizeStringArray(payload.relatedIds) ?? undefined,
    rawRefs: normalizeStringArray(payload.rawRefs) ?? undefined,
    ...eventSpecificFields(payload),
  })
  const result = eventRecordSchema.safeParse(record)

  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      `Event payload for kind "${kind.data}" is invalid.`,
      { errors: result.error.flatten() },
    )
  }

  return result.data
}

function eventSpecificFields(payload: JsonObject) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => !reservedEventKeys.has(key) && value !== undefined),
  )
}

async function requireProviderRecord(vault: string, lookup: string) {
  const entries = await readProviderEntries(vault)
  const normalizedLookup = lookup.trim()
  const entry = entries.find(
    (candidate) =>
      candidate.attributes.providerId === normalizedLookup ||
      candidate.attributes.slug === normalizedLookup,
  )

  if (!entry) {
    throw new VaultCliError('not_found', `No provider found for "${lookup}".`)
  }

  return entry
}

async function readProviderEntries(vaultRoot: string) {
  const core = await loadProviderEventCoreRuntime()
  const providersRoot = await resolveVaultRelativePath(vaultRoot, 'bank/providers')
  const files = await safeReadMarkdownFiles(providersRoot)
  const entries: Array<{
    relativePath: string
    markdown: string
    body: string
    attributes: ProviderFrontmatter
  }> = []

  for (const fileName of files) {
    const relativePath = path.posix.join('bank/providers', fileName)
    const markdown = await readFile(
      await resolveVaultRelativePath(vaultRoot, relativePath),
      'utf8',
    )
    const document = core.parseFrontmatterDocument(markdown)
    entries.push({
      relativePath,
      markdown,
      body: document.body,
      attributes: validateProviderFrontmatter(document.attributes),
    })
  }

  return entries
}

function validateProviderFrontmatter(value: unknown) {
  const result = providerFrontmatterSchema.safeParse(value)
  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      'Provider frontmatter is invalid.',
      { errors: result.error.flatten() },
    )
  }

  return result.data
}

function normalizeProviderBody(
  nextBody: string | undefined,
  existingBody: string | null,
  title: string,
  note: string | undefined,
) {
  if (typeof nextBody === 'string' && nextBody.trim().length > 0) {
    return ensureMarkdownHeading(nextBody, title)
  }

  if (typeof existingBody === 'string' && existingBody.trim().length > 0) {
    return ensureMarkdownHeading(existingBody, title)
  }

  const noteBlock = note ? `${note}\n` : ''
  return `# ${title}\n\n## Notes\n\n${noteBlock}`
}

function ensureMarkdownHeading(body: string, title: string) {
  const trimmed = body.trimStart()
  if (trimmed.startsWith('# ')) {
    return body.replace(/^# .*(?:\r?\n)?/u, `# ${title}\n`)
  }

  return `# ${title}\n\n${body.trimStart()}`
}

function providerRelativePath(slug: string) {
  return `bank/providers/${slug}.md`
}

function normalizeProviderSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  const result = slugSchema.safeParse(normalized)
  if (!result.success) {
    throw new VaultCliError(
      'contract_invalid',
      'Provider payload requires a valid slug or title-derived slug.',
      { errors: result.error.flatten() },
    )
  }

  return result.data
}

async function safeReadMarkdownFiles(directory: string) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }

    throw error
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

function normalizeTimestampInput(value: unknown) {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return undefined
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new VaultCliError(
      'invalid_timestamp',
      `Invalid timestamp "${String(value)}".`,
    )
  }

  return date.toISOString()
}

function normalizeLocalDate(value: string | undefined) {
  if (typeof value !== 'string') {
    return undefined
  }

  return LOCAL_DATE_PATTERN.test(value) ? value : undefined
}

async function loadProviderEventQueryRuntime(): Promise<QueryRuntimeModule> {
  return loadQueryRuntime()
}

async function loadProviderEventCoreRuntime(): Promise<ProviderEventCoreRuntime> {
  return loadRuntimeModule<ProviderEventCoreRuntime>('@healthybob/core')
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
