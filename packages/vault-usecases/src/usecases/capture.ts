import path from 'node:path'

import {
  eventSourceSchema,
  rawImportManifestSchema,
  type EventAttachment,
  type EventSource,
  type JsonObject,
  type StoredMedia,
} from '@murphai/contracts'
import type {
  EventAttachmentSourceInput,
  EventDraftByKind,
} from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { pathSchema } from '@murphai/operator-config/vault-cli-contracts'
import * as z from '@murphai/contracts/zod-runtime'

import { loadJsonInputObject } from '../json-input.js'
import { loadRuntimeModule } from '../runtime-import.js'
import {
  compareByLatest,
  loadQueryRuntime,
  toCommandShowEntity,
  type QueryRecord,
} from '../commands/query-record-command-helpers.js'
import {
  asListEnvelope,
  readRawImportManifest,
  resolveRawImportManifestFile,
  toListEntity,
} from './shared.js'
import {
  compactObject,
  normalizeOptionalText,
  relativePathEntries,
  relativePathStrings,
  toEventUpsertVaultCliError,
} from './vault-usecase-helpers.js'
import {
  isExactEventLookup,
  readExactEventRecord,
} from './exact-event-record.js'

const DEFAULT_LIST_LIMIT = 50
const CAPTURE_TAG = 'capture'
const MAX_CAPTURE_BATCH_SIZE = 100
const CAPTURE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

// Owned wire-format contract for `vault-cli capture import-json --input @file`
// payloads. This is the single source of truth for both runtime validation
// (`loadStructuredCapturePayload` below) and the agent-discoverable
// `vault-cli capture payload-schema --format json` sibling, so the emitted
// contract cannot drift from what the importer actually accepts.
const captureEntryPayloadSchema = z
  .object({
    media: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Local file paths to attach as durable capture bytes. Repeat across `media` and `mediaPaths` if helpful; the importer de-duplicates them.',
      ),
    mediaPaths: z
      .array(z.string().min(1))
      .optional()
      .describe('Alias for `media`. Merged with `media` after de-duplication.'),
    title: z.string().optional(),
    note: z.string().optional(),
    occurredAt: z.string().optional(),
    source: eventSourceSchema.optional(),
    label: z.string().optional(),
    bodySite: z.string().optional(),
    collection: z.string().optional(),
    tags: z.array(z.string()).optional(),
    relatedIds: z.array(z.string()).optional(),
    externalRef: z.record(z.string(), z.unknown()).optional(),
    links: z.unknown().optional(),
    timeZone: z.string().optional(),
  })
  .strict()
  .describe(
    'Capture entry. Provide `media`/`mediaPaths` to attach durable bytes; the other fields are optional context.',
  )

export const captureImportPayloadSchema = captureEntryPayloadSchema
  .extend({
    captures: z
      .array(
        captureEntryPayloadSchema.refine(
          (entry) =>
            (entry.media?.length ?? 0) > 0 ||
            (entry.mediaPaths?.length ?? 0) > 0,
          {
            message:
              'Each captures[] entry must include media or mediaPaths; root-level defaults are not merged into batch entries.',
          },
        ),
      )
      .min(1, { message: 'captures must include at least one capture entry.' })
      .max(MAX_CAPTURE_BATCH_SIZE, {
        message: `Capture batches are limited to ${MAX_CAPTURE_BATCH_SIZE} entries.`,
      })
      .optional()
      .describe(
        'Optional batch: one capture entry per observation. Each entry must carry its own media; root-level fields apply only as non-media defaults.',
      ),
  })
  .strict()
  .describe(
    'Structured capture import payload. Use root fields for one capture, or `captures` for a batch where root-level non-media fields are defaults.',
  )

export const captureLookupSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .describe('Canonical capture event id or stable label such as evt_<ULID> or mole-left-forearm-1.')

export const captureImportManifestResultSchema = z.object({
  vault: pathSchema,
  entityId: z.string().min(1),
  lookupId: z.string().min(1),
  kind: z.literal('capture'),
  manifestFile: pathSchema,
  manifest: rawImportManifestSchema,
})

export interface CaptureEntryInput {
  media?: string[]
  mediaPaths?: string[]
  title?: string
  note?: string
  occurredAt?: string
  source?: EventSource
  label?: string
  bodySite?: string
  collection?: string
  tags?: string[]
  relatedIds?: string[]
  externalRef?: JsonObject
  links?: unknown
  timeZone?: string
}

export interface AddCaptureRecordInput extends CaptureEntryInput {
  vault: string
  inputFile?: string
  captures?: CaptureEntryInput[]
}

export interface CaptureResultItem {
  vault: string
  eventId: string
  lookupId: string
  stableLookupId: string | null
  ledgerFile: string
  created: boolean
  occurredAt: string
  kind: 'capture'
  title: string
  label: string | null
  bodySite: string | null
  collection: string | null
  tags: string[]
  media: StoredMedia[]
  manifestFile: string | null
  note: string | null
}

export interface CaptureAddResult {
  vault: string
  addedCount: number
  captures: CaptureResultItem[]
}

type CaptureNoteDraftInput = Omit<EventDraftByKind<'note'>, 'kind'>

type CaptureCoreRuntime = {
  addCapture(input: {
    vaultRoot: string
    draft: CaptureNoteDraftInput
    attachments: readonly EventAttachmentSourceInput[]
    rawImport?: {
      importId?: string
      importKind?: 'capture'
      importedAt?: string | Date
      source?: string | null
      provenance?: Record<string, unknown>
    }
  }): Promise<{
    eventId: string
    ledgerFile: string
    created: boolean
    manifestPath: string | null
    event: Extract<import('@murphai/contracts').EventRecord, { kind: 'note' }>
  }>
}

interface StructuredCapturePayload extends CaptureEntryInput {
  captures?: CaptureEntryInput[]
}

function asJsonObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new VaultCliError('invalid_payload', `${fieldName} must be an array of strings.`)
  }

  const invalidIndex = value.findIndex((entry) => typeof entry !== 'string')
  if (invalidIndex >= 0) {
    throw new VaultCliError(
      'invalid_payload',
      `${fieldName}[${invalidIndex}] must be a string.`,
    )
  }

  const stringEntries = value as string[]
  const entries = [
    ...new Set(
      stringEntries
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ]

  return entries.length > 0 ? entries : undefined
}

function normalizeSource(value: unknown, fieldName: string): EventSource | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const parsed = eventSourceSchema.safeParse(value)
  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_payload',
      `${fieldName} must be one of manual, import, device, or derived.`,
    )
  }

  return parsed.data
}

function toCaptureSlugCandidate(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/gu, '-')
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

function captureSlugOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = toCaptureSlugCandidate(value)
  return CAPTURE_SLUG_PATTERN.test(normalized) ? normalized : null
}

export function normalizeCaptureSlug(value: string, fieldName = 'label'): string {
  const normalized = captureSlugOrNull(value)

  if (!normalized) {
    throw new VaultCliError(
      'invalid_option',
      `${fieldName} must resolve to a lowercase kebab-case slug.`,
    )
  }

  return normalized
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ]
}

function normalizeTags(input: {
  label?: string
  bodySite?: string
  collection?: string
  tags?: readonly string[]
}): string[] {
  const labelSlug = input.label ? normalizeCaptureSlug(input.label, 'label') : null
  const siteSlug = input.bodySite ? normalizeCaptureSlug(input.bodySite, 'bodySite') : null
  const collectionSlug = input.collection ? normalizeCaptureSlug(input.collection, 'collection') : null
  const explicitTags = (input.tags ?? []).map((tag) => normalizeCaptureSlug(tag, 'tag'))

  return uniqueStrings([
    CAPTURE_TAG,
    labelSlug,
    siteSlug ? `site-${siteSlug}` : null,
    collectionSlug ? `collection-${collectionSlug}` : null,
    ...explicitTags,
  ])
}

function fitText(value: string, maxLength: number): string {
  const trimmed = value.trim().replace(/\s+/gu, ' ')
  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`
}

function titleFromCapture(input: {
  title?: string
  label?: string
  bodySite?: string
  collection?: string
}): string {
  const explicit = normalizeOptionalText(input.title)
  if (explicit) {
    return fitText(explicit, 160)
  }

  if (input.label) {
    return fitText(`Capture - ${normalizeCaptureSlug(input.label, 'label')}`, 160)
  }

  const bodySite = normalizeOptionalText(input.bodySite)
  if (bodySite) {
    return fitText(`Capture - ${bodySite}`, 160)
  }

  const collection = normalizeOptionalText(input.collection)
  if (collection) {
    return fitText(`Capture - ${normalizeCaptureSlug(collection, 'collection')}`, 160)
  }

  return 'Media capture'
}

function buildCaptureNote(input: {
  label?: string
  bodySite?: string
  collection?: string
  note?: string
}): string {
  const detailLines = uniqueStrings([
    input.label ? `Label: ${normalizeCaptureSlug(input.label, 'label')}` : null,
    input.bodySite ? `Body site: ${input.bodySite.trim()}` : null,
    input.collection ? `Collection: ${normalizeCaptureSlug(input.collection, 'collection')}` : null,
  ])
  const note = normalizeOptionalText(input.note)
  const sections = [
    ...(detailLines.length > 0 ? [detailLines.join('\n')] : []),
    ...(note ? [note] : []),
  ]
  const combined = sections.join('\n\n').trim()

  return combined.length > 0 ? combined.slice(0, 4000) : 'Media capture.'
}

function toStoredMediaKind(kind: EventAttachment['kind']): StoredMedia['kind'] {
  switch (kind) {
    case 'photo':
    case 'video':
    case 'gif':
    case 'image':
      return kind
    default:
      return 'other'
  }
}

function toStoredMedia(attachments: readonly EventAttachment[] | undefined): StoredMedia[] {
  return (attachments ?? []).map((attachment) => ({
    kind: toStoredMediaKind(attachment.kind),
    relativePath: attachment.relativePath,
    ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
  }))
}

function normalizeMediaPaths(input: CaptureEntryInput, fieldName: string): string[] {
  const mediaPaths = uniqueStrings([
    ...(input.mediaPaths ?? []),
    ...(input.media ?? []),
  ])

  if (mediaPaths.length === 0) {
    throw new VaultCliError(
      'invalid_option',
      `${fieldName} requires at least one media path.`,
    )
  }

  return mediaPaths
}

function normalizeCaptureEntry(
  candidate: z.output<typeof captureEntryPayloadSchema>,
  fieldName: string,
): CaptureEntryInput {
  return compactObject({
    media: optionalStringArray(candidate.media, `${fieldName}.media`),
    mediaPaths: optionalStringArray(candidate.mediaPaths, `${fieldName}.mediaPaths`),
    title: normalizeOptionalText(candidate.title) ?? undefined,
    note: normalizeOptionalText(candidate.note) ?? undefined,
    occurredAt: candidate.occurredAt,
    source: candidate.source,
    label: normalizeOptionalText(candidate.label) ?? undefined,
    bodySite: normalizeOptionalText(candidate.bodySite) ?? undefined,
    collection: normalizeOptionalText(candidate.collection) ?? undefined,
    tags: optionalStringArray(candidate.tags, `${fieldName}.tags`),
    relatedIds: optionalStringArray(candidate.relatedIds, `${fieldName}.relatedIds`),
    externalRef: candidate.externalRef as JsonObject | undefined,
    links: candidate.links,
    timeZone: candidate.timeZone,
  })
}

async function loadStructuredCapturePayload(inputFile: string): Promise<StructuredCapturePayload> {
  const payload = await loadJsonInputObject(inputFile, 'capture payload')
  const parsed = captureImportPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const pathPrefix = issue && issue.path.length > 0
      ? `capture payload.${issue.path.join('.')}`
      : 'capture payload'
    throw new VaultCliError(
      'invalid_payload',
      issue ? `${pathPrefix}: ${issue.message}` : 'capture payload is invalid.',
    )
  }
  const normalizedRoot = normalizeCaptureEntry(parsed.data, 'capture payload')
  const captures = parsed.data.captures
    ? parsed.data.captures.map((entry, index) =>
        normalizeCaptureEntry(entry, `captures[${index}]`),
      )
    : undefined

  return {
    ...normalizedRoot,
    captures,
  }
}

function mergeCaptureDefaults(
  defaults: CaptureEntryInput,
  entry: CaptureEntryInput,
): CaptureEntryInput {
  return compactObject({
    occurredAt: entry.occurredAt ?? defaults.occurredAt,
    source: entry.source ?? defaults.source,
    collection: entry.collection ?? defaults.collection,
    title: entry.title ?? defaults.title,
    note: entry.note ?? defaults.note,
    label: entry.label ?? defaults.label,
    bodySite: entry.bodySite ?? defaults.bodySite,
    tags: uniqueStrings([...(defaults.tags ?? []), ...(entry.tags ?? [])]),
    media: entry.media ?? defaults.media,
    mediaPaths: entry.mediaPaths ?? defaults.mediaPaths,
    relatedIds: entry.relatedIds ?? defaults.relatedIds,
    externalRef: entry.externalRef ?? defaults.externalRef,
    links: entry.links ?? defaults.links,
    timeZone: entry.timeZone ?? defaults.timeZone,
  })
}

function buildCaptureDraft(input: CaptureEntryInput): CaptureNoteDraftInput {
  return compactObject({
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    source: input.source ?? 'manual',
    title: titleFromCapture(input),
    note: buildCaptureNote(input),
    tags: normalizeTags(input),
    links: input.links ?? (input.relatedIds && input.relatedIds.length > 0
      ? input.relatedIds.map((targetId) => ({ type: 'related_to', targetId }))
      : undefined),
    externalRef: input.externalRef,
    timeZone: input.timeZone,
  }) as CaptureNoteDraftInput
}

async function loadCaptureCoreRuntime(): Promise<CaptureCoreRuntime> {
  return loadRuntimeModule<CaptureCoreRuntime>('@murphai/core')
}

async function addOneCaptureRecord(input: {
  vault: string
  capture: CaptureEntryInput
}): Promise<CaptureResultItem> {
  const mediaPaths = normalizeMediaPaths(input.capture, 'capture')
  const draft = buildCaptureDraft(input.capture)
  const label = input.capture.label ? normalizeCaptureSlug(input.capture.label, 'label') : null
  const collection = input.capture.collection
    ? normalizeCaptureSlug(input.capture.collection, 'collection')
    : null
  const tags = normalizeTags(input.capture)
  const core = await loadCaptureCoreRuntime()

  try {
    const result = await core.addCapture({
      vaultRoot: input.vault,
      draft,
      attachments: mediaPaths.map((sourcePath, index) => ({
        role: `media_${index + 1}`,
        sourcePath,
      })),
      rawImport: {
        importKind: 'capture',
        provenance: {
          family: 'capture',
          label,
          bodySite: normalizeOptionalText(input.capture.bodySite) ?? null,
          collection,
          tagCount: tags.length,
          mediaCount: mediaPaths.length,
        },
      },
    })

    return {
      vault: input.vault,
      eventId: result.eventId,
      lookupId: result.eventId,
      stableLookupId: label,
      ledgerFile: result.ledgerFile,
      created: result.created,
      occurredAt: result.event.occurredAt,
      kind: 'capture',
      title: result.event.title,
      label,
      bodySite: normalizeOptionalText(input.capture.bodySite) ?? null,
      collection,
      tags: result.event.tags ?? tags,
      media: toStoredMedia(result.event.attachments),
      manifestFile: result.manifestPath,
      note: normalizeOptionalText(result.event.note) ?? null,
    }
  } catch (error) {
    throw toEventUpsertVaultCliError(error)
  }
}

function ensureUniqueCaptureLabels(captures: readonly CaptureEntryInput[]): void {
  const seenByLabel = new Map<string, number>()

  captures.forEach((capture, index) => {
    const label = capture.label
      ? normalizeCaptureSlug(capture.label, `captures[${index}].label`)
      : null
    if (!label) {
      return
    }

    const previousIndex = seenByLabel.get(label)
    if (previousIndex !== undefined) {
      throw new VaultCliError(
        'invalid_payload',
        `Duplicate capture label "${label}" in batch entries ${previousIndex + 1} and ${index + 1}. ` +
          'Put multiple views of the same observation in one media array, or use unique labels.',
      )
    }

    seenByLabel.set(label, index)
  })
}

function resolveCaptureEntries(
  input: AddCaptureRecordInput,
  structuredPayload?: StructuredCapturePayload,
): CaptureEntryInput[] {
  const defaults = structuredPayload
    ? mergeCaptureDefaults(input, structuredPayload)
    : input
  const explicitCaptures = structuredPayload?.captures ?? input.captures

  if (explicitCaptures && explicitCaptures.length > 0) {
    if (explicitCaptures.length > MAX_CAPTURE_BATCH_SIZE) {
      throw new VaultCliError(
        'invalid_payload',
        `Capture batches are limited to ${MAX_CAPTURE_BATCH_SIZE} entries.`,
      )
    }

    const batchDefaults: CaptureEntryInput = {
      ...defaults,
      media: undefined,
      mediaPaths: undefined,
    }
    const captures = explicitCaptures.map((entry) =>
      mergeCaptureDefaults(batchDefaults, entry),
    )
    ensureUniqueCaptureLabels(captures)
    return captures
  }

  return [defaults]
}

export async function addCaptureRecord(input: AddCaptureRecordInput): Promise<CaptureAddResult> {
  const structuredPayload = typeof input.inputFile === 'string'
    ? await loadStructuredCapturePayload(input.inputFile)
    : undefined
  const captures = resolveCaptureEntries(input, structuredPayload)
  const results: CaptureResultItem[] = []

  for (const capture of captures) {
    results.push(await addOneCaptureRecord({
      vault: input.vault,
      capture,
    }))
  }

  return {
    vault: input.vault,
    addedCount: results.length,
    captures: results,
  }
}

function isCaptureRecord(record: QueryRecord): boolean {
  return record.family === 'event' && record.kind === 'note' && record.tags.includes(CAPTURE_TAG)
}

function requestedCaptureTags(input: {
  label?: string
  bodySite?: string
  collection?: string
  tags?: readonly string[]
}): string[] {
  const labelTag = input.label ? normalizeCaptureSlug(input.label, 'label') : null
  const siteTag = input.bodySite ? `site-${normalizeCaptureSlug(input.bodySite, 'bodySite')}` : null
  const collectionTag = input.collection
    ? `collection-${normalizeCaptureSlug(input.collection, 'collection')}`
    : null
  const explicitTags = (input.tags ?? []).map((tag) => normalizeCaptureSlug(tag, 'tag'))

  return uniqueStrings([labelTag, siteTag, collectionTag, ...explicitTags])
}

function recordMatchesAllTags(record: QueryRecord, tags: readonly string[]): boolean {
  return tags.every((tag) => record.tags.includes(tag))
}

function toCaptureShowEntity(record: QueryRecord) {
  const entity = toCommandShowEntity(record)
  return {
    ...entity,
    kind: 'capture',
    data: {
      ...entity.data,
      captureKind: record.kind,
    },
  }
}

function toCaptureListEntity(record: QueryRecord) {
  const entity = toCaptureShowEntity(record)
  return toListEntity(entity)
}

async function loadCaptureRecord(vault: string, lookup: string): Promise<QueryRecord> {
  const normalizedLookup = normalizeOptionalText(lookup)
  if (!normalizedLookup) {
    throw new VaultCliError('contract_invalid', 'Capture lookup is required.')
  }

  if (isExactEventLookup(normalizedLookup)) {
    const { record } = await readExactEventRecord({
      vault,
      lookup: normalizedLookup,
      entityLabel: 'capture',
      expectedKinds: ['note'],
    })
    if (isCaptureRecord(record)) {
      return record
    }
    throw new VaultCliError('not_found', `No capture found for "${normalizedLookup}".`)
  }

  const query = await loadQueryRuntime('capture query reads')
  const readModel = await query.readVault(vault)
  const record = query.lookupEntityById(readModel, normalizedLookup)

  if (record && isCaptureRecord(record)) {
    return record
  }

  const labelTag = captureSlugOrNull(normalizedLookup)
  if (labelTag) {
    const latestLabelMatch = query
      .listEntities(readModel, {
        families: ['event'],
        kinds: ['note'],
      })
      .filter((candidate: QueryRecord) => isCaptureRecord(candidate) && candidate.tags.includes(labelTag))
      .sort(compareByLatest)[0]

    if (latestLabelMatch) {
      return latestLabelMatch
    }
  }

  throw new VaultCliError('not_found', `No capture found for "${normalizedLookup}".`)
}

export async function showCaptureRecord(vault: string, lookup: string) {
  const record = await loadCaptureRecord(vault, lookup)

  return {
    vault,
    entity: toCaptureShowEntity(record),
  }
}

export async function listCaptureRecords(input: {
  vault: string
  from?: string
  to?: string
  label?: string
  bodySite?: string
  collection?: string
  tags?: string[]
  limit?: number
}) {
  const query = await loadQueryRuntime('capture query reads')
  const readModel = await query.readVault(input.vault)
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(DEFAULT_LIST_LIMIT * 4, Math.round(input.limit)))
      : DEFAULT_LIST_LIMIT
  const requiredTags = requestedCaptureTags(input)
  const items = query
    .listEntities(readModel, {
      families: ['event'],
      kinds: ['note'],
      from: input.from,
      to: input.to,
    })
    .filter((record: QueryRecord) => isCaptureRecord(record))
    .filter((record: QueryRecord) => recordMatchesAllTags(record, requiredTags))
    .sort(compareByLatest)
    .slice(0, limit)
    .map((record: QueryRecord) => toCaptureListEntity(record))

  return asListEnvelope(input.vault, compactObject({
    kind: 'capture',
    from: input.from,
    to: input.to,
    label: input.label ? normalizeCaptureSlug(input.label, 'label') : undefined,
    bodySite: input.bodySite ? normalizeCaptureSlug(input.bodySite, 'bodySite') : undefined,
    collection: input.collection ? normalizeCaptureSlug(input.collection, 'collection') : undefined,
    tag: requiredTags.length > 0 ? requiredTags : undefined,
    limit,
  }), items)
}

function uniqueRelativePaths(record: QueryRecord): string[] {
  return uniqueStrings([
    ...relativePathEntries(record.attributes.attachments),
    ...relativePathStrings(record.attributes.rawRefs),
    ...relativePathEntries(record.attributes.media),
  ])
}

async function resolveManifestFile(
  vault: string,
  record: QueryRecord,
): Promise<string> {
  const rawRefs = uniqueRelativePaths(record)

  if (rawRefs.length === 0) {
    throw new VaultCliError(
      'manifest_missing',
      `No raw import manifest is associated with capture "${record.entityId}".`,
    )
  }

  const directories = uniqueStrings(rawRefs.map((rawRef) => path.posix.dirname(rawRef)))
  if (directories.length !== 1) {
    throw new VaultCliError(
      'manifest_invalid',
      `Capture "${record.entityId}" references raw artifacts in multiple directories.`,
      { rawRefs },
    )
  }

  return resolveRawImportManifestFile(vault, directories[0]!)
}

export async function showCaptureManifest(vault: string, lookup: string) {
  const record = await loadCaptureRecord(vault, lookup)
  const manifestFile = await resolveManifestFile(vault, record)
  const manifest = await readRawImportManifest(vault, manifestFile)

  return {
    vault,
    entityId: record.entityId,
    lookupId: record.primaryLookupId,
    kind: 'capture' as const,
    manifestFile,
    manifest,
  }
}
