import {
  BLOOD_TEST_FASTING_STATUSES,
  CLINICAL_ASSERTION_DOMAINS,
  CLINICAL_ASSERTION_POLARITIES,
  CLINICAL_ASSERTION_TYPES,
  ID_PREFIXES,
  SOCIAL_HISTORY_CATEGORIES,
  SOCIAL_HISTORY_STATUSES,
  TEST_RESULT_STATUSES,
  bloodTestResultSchema,
  clinicalEvidenceRefSchema,
  clinicalNoteSectionSchema,
  eventRelationLinkSchema,
  eventSourceSchema,
  externalRefSchema,
  idPattern,
  isStrictIsoDate,
  isStrictIsoDateTime,
  isValidIanaTimeZone,
  measurementEntrySchema,
  type EventRecord,
} from '@murphai/contracts'
import type {
  AppendHistoryEventInput,
  AppendHistoryEventResult,
  UpsertEventResult,
} from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { z } from 'zod'

import { loadJsonInputObject } from '../json-input.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { compactObject, toVaultCliError } from './vault-usecase-helpers.js'

type ClinicalImportRuntime = {
  appendHistoryEvent(input: AppendHistoryEventInput): Promise<AppendHistoryEventResult>
  upsertEvent(input: {
    vaultRoot: string
    payload: Record<string, unknown>
  }): Promise<UpsertEventResult>
  importEventBatch(input: {
    vaultRoot: string
    payloads: Record<string, unknown>[]
    apply?: boolean
  }): Promise<{
    applied: boolean
    receivedCount: number
    createdCount: number
    skippedExistingCount: number
    supersededCount: number
    eventIds: string[]
    eventShardPaths: string[]
    auditPath: string | null
  }>
}

export interface ClinicalImportInput {
  vault: string
  inputFile: string
}

export interface ClinicalImportResult {
  vault: string
  eventIds: string[]
  lookupId?: string
  ledgerFiles: string[]
  created?: boolean
  auditPaths: string[]
}

const RAW_PATH_PATTERN = /^raw\/[A-Za-z0-9._/-]+$/u
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

function idSchema(prefix: string) {
  return z.string().regex(new RegExp(idPattern(prefix), 'u'), `Expected ${prefix}_<ULID>.`)
}

const eventIdSchema = idSchema(ID_PREFIXES.event)
const providerIdSchema = idSchema(ID_PREFIXES.provider)
const rawRefSchema = z.string().regex(RAW_PATH_PATTERN, 'Expected a vault-relative raw/* path.')
const ISO_DATE_TIME_TEXT = z.string().refine(
  (value) => isStrictIsoDateTime(value),
  'Invalid ISO date-time string.',
)
const ISO_DATE_TEXT = z.string().refine(
  (value) => isStrictIsoDate(value),
  'Invalid ISO date string.',
)
const timeZoneTextSchema = z.string().refine(
  (value) => isValidIanaTimeZone(value),
  'Invalid IANA time zone.',
)
const slugSchema = z.string().regex(SLUG_PATTERN).max(80)
const socialHistoryCategoriesSchema = z.enum(SOCIAL_HISTORY_CATEGORIES)
const socialHistoryStatusSchema = z.enum(SOCIAL_HISTORY_STATUSES)

const commonEventPayloadSchema = z.object({
  eventId: eventIdSchema.optional(),
  occurredAt: ISO_DATE_TIME_TEXT,
  recordedAt: ISO_DATE_TIME_TEXT.optional(),
  timeZone: timeZoneTextSchema.optional(),
  source: eventSourceSchema.default('import'),
  title: z.string().min(1).max(160).optional(),
  note: z.string().min(1).max(4000).optional(),
  tags: z.array(slugSchema).max(25).optional(),
  links: z.array(eventRelationLinkSchema).max(50).optional(),
  rawRefs: z.array(rawRefSchema).max(50).optional(),
  evidence: z.array(clinicalEvidenceRefSchema).max(50).optional(),
  externalRef: externalRefSchema.optional(),
}).strict()

export const assertionImportPayloadSchema = commonEventPayloadSchema.extend({
  title: z.string().min(1).max(160).default('Clinical assertion'),
  assertion: z.enum(CLINICAL_ASSERTION_TYPES),
  domain: z.enum(CLINICAL_ASSERTION_DOMAINS).optional(),
  polarity: z.enum(CLINICAL_ASSERTION_POLARITIES).optional(),
  subject: z.string().min(1).max(240).optional(),
  assertionText: z.string().min(1).max(1000).optional(),
  bodySite: z.string().min(1).max(120).optional(),
  code: z.string().min(1).max(80).optional(),
  codeSystem: z.string().min(1).max(80).optional(),
  assertedOn: ISO_DATE_TEXT,
  sourceLabel: z.string().min(1).max(240).optional(),
})

export const vitalsImportPayloadSchema = commonEventPayloadSchema.extend({
  title: z.string().min(1).max(160).default('Vitals'),
  measurements: z.array(measurementEntrySchema).min(1).max(25),
})

export const diagnosticTestImportPayloadSchema = commonEventPayloadSchema.extend({
  title: z.string().min(1).max(160).optional(),
  testName: z.string().min(1).max(160),
  resultStatus: z.enum(TEST_RESULT_STATUSES).optional(),
  summary: z.string().min(1).max(1000).optional(),
  testCategory: z.string().min(1).max(64).optional(),
  specimenType: z.string().min(1).max(64).optional(),
  labName: z.string().min(1).max(160).optional(),
  labPanelId: z.string().min(1).max(120).optional(),
  collectedAt: ISO_DATE_TIME_TEXT.optional(),
  reportedAt: ISO_DATE_TIME_TEXT.optional(),
  fastingStatus: z.enum(BLOOD_TEST_FASTING_STATUSES).optional(),
  results: z.array(bloodTestResultSchema).min(1).max(500).optional(),
})

export const clinicalNoteImportPayloadSchema = commonEventPayloadSchema.extend({
  title: z.string().min(1).max(160).default('Clinical note'),
  note: z.string().min(1).max(4000).optional(),
  noteType: z.string().min(1).max(120).default('clinical_note'),
  authoredAt: ISO_DATE_TIME_TEXT.optional(),
  signedAt: ISO_DATE_TIME_TEXT.optional(),
  author: z.string().min(1).max(160).optional(),
  providerId: providerIdSchema.optional(),
  facility: z.string().min(1).max(160).optional(),
  encounterId: eventIdSchema.optional(),
  sections: z.array(clinicalNoteSectionSchema).min(1).max(50).optional(),
}).strict().superRefine((value, context) => {
  if (!value.note && (!value.sections || value.sections.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'clinical-note payload requires note or sections.',
      path: ['note'],
    })
  }
})

const socialHistoryEntrySchema = z.object({
  category: socialHistoryCategoriesSchema,
  status: socialHistoryStatusSchema.optional(),
  statement: z.string().min(1).max(1000),
  externalRef: externalRefSchema,
  substance: z.string().min(1).max(160).optional(),
  quantity: z.string().min(1).max(160).optional(),
  frequency: z.string().min(1).max(160).optional(),
  method: z.string().min(1).max(160).optional(),
  startedOn: ISO_DATE_TEXT.optional(),
  endedOn: ISO_DATE_TEXT.optional(),
  title: z.string().min(1).max(160).optional(),
  note: z.string().min(1).max(4000).optional(),
  sourceLabel: z.string().min(1).max(240).optional(),
  evidence: z.array(clinicalEvidenceRefSchema).max(20).optional(),
  rawRefs: z.array(rawRefSchema).max(20).optional(),
}).strict()

function socialHistoryExternalRefIdentityKey(
  externalRef: z.infer<typeof externalRefSchema>,
): string {
  return JSON.stringify([
    externalRef.system,
    externalRef.resourceType,
    externalRef.resourceId,
    externalRef.facet ?? null,
  ])
}

export const socialHistoryImportPayloadSchema = z.object({
  occurredAt: ISO_DATE_TIME_TEXT,
  recordedAt: ISO_DATE_TIME_TEXT.optional(),
  timeZone: timeZoneTextSchema.optional(),
  source: eventSourceSchema.default('import'),
  sourceLabel: z.string().min(1).max(240).optional(),
  rawRefs: z.array(rawRefSchema).max(50).optional(),
  evidence: z.array(clinicalEvidenceRefSchema).max(50).optional(),
  entries: z.array(socialHistoryEntrySchema).min(1).max(100),
}).strict().superRefine((payload, context) => {
  const seen = new Map<string, number>()

  payload.entries.forEach((entry, index) => {
    const key = socialHistoryExternalRefIdentityKey(entry.externalRef)
    const firstIndex = seen.get(key)

    if (firstIndex === undefined) {
      seen.set(key, index)
      return
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        `Duplicate social-history externalRef identity already used by entry ${firstIndex + 1}. ` +
        'Use a unique facet for each distinct clinical fact; externalRef.version is not part of retry identity.',
      path: ['entries', index, 'externalRef'],
    })
  })
})

export type AssertionImportPayload = z.infer<typeof assertionImportPayloadSchema>
export type VitalsImportPayload = z.infer<typeof vitalsImportPayloadSchema>
export type DiagnosticTestImportPayload = z.infer<typeof diagnosticTestImportPayloadSchema>
export type ClinicalNoteImportPayload = z.infer<typeof clinicalNoteImportPayloadSchema>
export type SocialHistoryImportPayload = z.infer<typeof socialHistoryImportPayloadSchema>

type SocialHistoryEntry = z.infer<typeof socialHistoryEntrySchema>

async function loadClinicalRuntime(): Promise<ClinicalImportRuntime> {
  return loadRuntimeModule<ClinicalImportRuntime>('@murphai/core')
}

function parsePayload<TPayload>(
  schema: z.ZodType<TPayload>,
  value: unknown,
  label: string,
): TPayload {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new VaultCliError('invalid_payload', `${label} payload is invalid.`, {
      errors: parsed.error.issues,
    })
  }

  return parsed.data
}

async function loadPayload<TPayload>(
  inputFile: string,
  schema: z.ZodType<TPayload>,
  label: string,
): Promise<TPayload> {
  return parsePayload(schema, await loadJsonInputObject(inputFile, `${label} payload`), label)
}

function toHistoryResult(vault: string, result: AppendHistoryEventResult): ClinicalImportResult {
  return {
    vault,
    eventIds: [result.record.id],
    lookupId: result.record.id,
    ledgerFiles: [result.relativePath],
    auditPaths: [result.auditPath],
  }
}

function toEventResult(vault: string, result: UpsertEventResult): ClinicalImportResult {
  return {
    vault,
    eventIds: [result.eventId],
    lookupId: result.eventId,
    ledgerFiles: [result.ledgerFile],
    created: result.created,
    auditPaths: [],
  }
}

function toEventBatchResult(
  vault: string,
  result: Awaited<ReturnType<ClinicalImportRuntime['importEventBatch']>>,
): ClinicalImportResult {
  const output: ClinicalImportResult = {
    vault,
    eventIds: result.eventIds,
    ledgerFiles: result.eventShardPaths,
    auditPaths: result.auditPath ? [result.auditPath] : [],
  }
  const lookupId = result.eventIds[0]
  if (lookupId) {
    output.lookupId = lookupId
  }

  return output
}

function toClinicalImportError(error: unknown): never {
  throw toVaultCliError(error, {
    EVENT_CONTRACT_INVALID: { code: 'contract_invalid' },
    EVENT_INVALID: { code: 'contract_invalid' },
    EVENT_KIND_INVALID: { code: 'invalid_payload' },
    EVENT_OCCURRED_AT_MISSING: { code: 'invalid_payload' },
    INVALID_TIMESTAMP: { code: 'invalid_timestamp' },
    VAULT_ALREADY_EXISTS: { code: 'already_exists' },
    VAULT_INVALID_INPUT: { code: 'invalid_payload' },
  })
}

function historyBase(
  vault: string,
  payload: z.infer<typeof commonEventPayloadSchema>,
): Omit<AppendHistoryEventInput, 'kind'> {
  return compactObject({
    vaultRoot: vault,
    eventId: payload.eventId,
    occurredAt: payload.occurredAt,
    recordedAt: payload.recordedAt,
    timeZone: payload.timeZone,
    source: payload.source,
    title: payload.title ?? 'Clinical import',
    note: payload.note,
    tags: payload.tags,
    links: payload.links,
    rawRefs: payload.rawRefs,
    evidence: payload.evidence,
    externalRef: payload.externalRef,
  })
}

function eventBase(payload: z.infer<typeof commonEventPayloadSchema>) {
  return compactObject({
    eventId: payload.eventId,
    occurredAt: payload.occurredAt,
    recordedAt: payload.recordedAt,
    timeZone: payload.timeZone,
    source: payload.source,
    title: payload.title,
    note: payload.note,
    tags: payload.tags,
    links: payload.links,
    rawRefs: payload.rawRefs,
    evidence: payload.evidence,
    externalRef: payload.externalRef,
  })
}

function compactEventPayload(record: Record<string, unknown>): Record<string, unknown> {
  return compactObject(record) as Record<string, unknown>
}

export function scaffoldAssertionImportPayload(): AssertionImportPayload {
  return assertionImportPayloadSchema.parse({
    eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2A100',
    occurredAt: '2026-06-17T14:00:00.000Z',
    source: 'import',
    title: 'No known drug allergies',
    assertion: 'no_known_drug_allergies',
    domain: 'allergy',
    polarity: 'absent',
    subject: 'drug allergies',
    assertedOn: '2026-06-17',
    sourceLabel: 'Synthetic allergy section',
    rawRefs: ['raw/documents/2026/06/synthetic-clinical-summary.pdf'],
  })
}

export function scaffoldVitalsImportPayload(): VitalsImportPayload {
  return vitalsImportPayloadSchema.parse({
    eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2V100',
    occurredAt: '2026-06-17T14:00:00.000Z',
    source: 'import',
    title: 'Visit vitals',
    measurements: [
      { metric: 'systolic-blood-pressure', value: 128, unit: 'mmHg' },
      { metric: 'diastolic-blood-pressure', value: 82, unit: 'mmHg' },
      { metric: 'heart-rate', value: 72, unit: 'bpm' },
    ],
    rawRefs: ['raw/documents/2026/06/synthetic-clinical-summary.pdf'],
  })
}

export function scaffoldDiagnosticTestImportPayload(): DiagnosticTestImportPayload {
  return diagnosticTestImportPayloadSchema.parse({
    eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2T100',
    occurredAt: '2026-06-17T14:00:00.000Z',
    source: 'import',
    testName: 'Urinalysis',
    resultStatus: 'normal',
    summary: 'Synthetic diagnostic-test summary.',
    testCategory: 'urinalysis',
    specimenType: 'urine',
    reportedAt: '2026-06-17T18:00:00.000Z',
    rawRefs: ['raw/documents/2026/06/synthetic-clinical-summary.pdf'],
  })
}

export function scaffoldClinicalNoteImportPayload(): ClinicalNoteImportPayload {
  return clinicalNoteImportPayloadSchema.parse({
    eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2N100',
    occurredAt: '2026-06-17T14:00:00.000Z',
    source: 'import',
    title: 'Clinical note',
    noteType: 'progress_note',
    author: 'Example clinician',
    facility: 'Example Clinic',
    sections: [
      { kind: 'assessment', heading: 'Assessment', text: 'Synthetic assessment text.' },
      { kind: 'plan', heading: 'Plan', text: 'Synthetic plan text.' },
    ],
    rawRefs: ['raw/documents/2026/06/synthetic-clinical-summary.pdf'],
  })
}

export function scaffoldSocialHistoryImportPayload(): SocialHistoryImportPayload {
  return socialHistoryImportPayloadSchema.parse({
    occurredAt: '2026-06-17T14:00:00.000Z',
    source: 'import',
    sourceLabel: 'Synthetic social-history section',
    rawRefs: ['raw/documents/2026/06/synthetic-clinical-summary.pdf'],
    entries: [
      {
        category: 'tobacco',
        status: 'former',
        statement: 'Synthetic former tobacco-use statement.',
        externalRef: {
          system: 'synthetic-pdf',
          resourceType: 'social-history-entry',
          resourceId: 'synthetic-clinical-summary',
          facet: 'tobacco',
        },
        substance: 'tobacco',
        frequency: 'historical',
      },
      {
        category: 'occupation',
        statement: 'Synthetic occupation statement.',
        externalRef: {
          system: 'synthetic-pdf',
          resourceType: 'social-history-entry',
          resourceId: 'synthetic-clinical-summary',
          facet: 'occupation',
        },
      },
    ],
  })
}

export async function saveAssertionPayload(input: {
  vault: string
  payload: AssertionImportPayload
}): Promise<ClinicalImportResult> {
  const runtime = await loadClinicalRuntime()
  try {
    const result = await runtime.appendHistoryEvent({
      ...historyBase(input.vault, input.payload),
      kind: 'clinical_assertion',
      assertion: input.payload.assertion,
      domain: input.payload.domain,
      polarity: input.payload.polarity,
      subject: input.payload.subject,
      assertionText: input.payload.assertionText,
      bodySite: input.payload.bodySite,
      code: input.payload.code,
      codeSystem: input.payload.codeSystem,
      assertedOn: input.payload.assertedOn,
      sourceLabel: input.payload.sourceLabel,
    })
    return toHistoryResult(input.vault, result)
  } catch (error) {
    toClinicalImportError(error)
  }
}

export async function importAssertionRecord(input: ClinicalImportInput): Promise<ClinicalImportResult> {
  return saveAssertionPayload({
    vault: input.vault,
    payload: await loadPayload(input.inputFile, assertionImportPayloadSchema, 'assertion'),
  })
}

export async function saveVitalsPayload(input: {
  vault: string
  payload: VitalsImportPayload
}): Promise<ClinicalImportResult> {
  const runtime = await loadClinicalRuntime()
  try {
    const result = await runtime.upsertEvent({
      vaultRoot: input.vault,
      payload: compactEventPayload({
        ...eventBase(input.payload),
        kind: 'measurement',
        measurements: input.payload.measurements,
      }),
    })
    return toEventResult(input.vault, result)
  } catch (error) {
    toClinicalImportError(error)
  }
}

export async function importVitalsRecord(input: ClinicalImportInput): Promise<ClinicalImportResult> {
  return saveVitalsPayload({
    vault: input.vault,
    payload: await loadPayload(input.inputFile, vitalsImportPayloadSchema, 'vitals'),
  })
}

export async function saveDiagnosticTestPayload(input: {
  vault: string
  payload: DiagnosticTestImportPayload
}): Promise<ClinicalImportResult> {
  const runtime = await loadClinicalRuntime()
  try {
    const result = await runtime.appendHistoryEvent({
      ...historyBase(input.vault, {
        ...input.payload,
        title: input.payload.title ?? `Test: ${input.payload.testName}`,
      }),
      kind: 'test',
      testName: input.payload.testName,
      resultStatus: input.payload.resultStatus,
      summary: input.payload.summary,
      testCategory: input.payload.testCategory,
      specimenType: input.payload.specimenType,
      labName: input.payload.labName,
      labPanelId: input.payload.labPanelId,
      collectedAt: input.payload.collectedAt,
      reportedAt: input.payload.reportedAt,
      fastingStatus: input.payload.fastingStatus,
      results: input.payload.results,
    })
    return toHistoryResult(input.vault, result)
  } catch (error) {
    toClinicalImportError(error)
  }
}

export async function importDiagnosticTestRecord(input: ClinicalImportInput): Promise<ClinicalImportResult> {
  return saveDiagnosticTestPayload({
    vault: input.vault,
    payload: await loadPayload(input.inputFile, diagnosticTestImportPayloadSchema, 'diagnostic-test'),
  })
}

function noteTextFromClinicalNote(payload: ClinicalNoteImportPayload): string {
  if (payload.note) {
    return payload.note
  }

  const sectionCount = payload.sections?.length ?? 0
  return `Structured clinical note with ${sectionCount} section${sectionCount === 1 ? '' : 's'}.`
}

export async function saveClinicalNotePayload(input: {
  vault: string
  payload: ClinicalNoteImportPayload
}): Promise<ClinicalImportResult> {
  const runtime = await loadClinicalRuntime()
  try {
    const result = await runtime.upsertEvent({
      vaultRoot: input.vault,
      payload: compactEventPayload({
        ...eventBase({
          ...input.payload,
          note: noteTextFromClinicalNote(input.payload),
        }),
        kind: 'note',
        noteType: input.payload.noteType,
        authoredAt: input.payload.authoredAt,
        signedAt: input.payload.signedAt,
        author: input.payload.author,
        providerId: input.payload.providerId,
        facility: input.payload.facility,
        encounterId: input.payload.encounterId,
        sections: input.payload.sections,
      }),
    })
    return toEventResult(input.vault, result)
  } catch (error) {
    toClinicalImportError(error)
  }
}

export async function importClinicalNoteRecord(input: ClinicalImportInput): Promise<ClinicalImportResult> {
  return saveClinicalNotePayload({
    vault: input.vault,
    payload: await loadPayload(input.inputFile, clinicalNoteImportPayloadSchema, 'clinical-note'),
  })
}

function localDateFromTimestamp(value: string): string {
  return value.slice(0, 10)
}

function socialEntryTags(category: string): string[] {
  return ['social-history', category.replace(/_/gu, '-')]
}

function limitText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function socialHistoryDetailFragments(entry: SocialHistoryEntry): string[] {
  return [
    entry.status ? `status: ${entry.status}` : undefined,
    entry.substance ? `substance: ${entry.substance}` : undefined,
    entry.quantity ? `quantity: ${entry.quantity}` : undefined,
    entry.frequency ? `frequency: ${entry.frequency}` : undefined,
    entry.method ? `method: ${entry.method}` : undefined,
    entry.startedOn ? `startedOn: ${entry.startedOn}` : undefined,
    entry.endedOn ? `endedOn: ${entry.endedOn}` : undefined,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function socialHistoryNote(entry: SocialHistoryEntry): string {
  const details = socialHistoryDetailFragments(entry)
  const parts = [
    entry.statement,
    details.length > 0 ? `Structured details: ${details.join('; ')}.` : undefined,
    entry.note,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  return limitText([...new Set(parts)].join('\n\n'), 4000)
}

function socialDuration(entry: SocialHistoryEntry): string | undefined {
  const duration = [entry.quantity, entry.frequency, entry.method, entry.startedOn, entry.endedOn]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('; ') || undefined

  return duration ? limitText(duration, 120) : undefined
}

function shouldWriteSocialAssertion(entry: SocialHistoryEntry): boolean {
  return entry.status === 'denied' || entry.status === 'never' || entry.status === 'not_applicable'
}

function shouldWriteSocialExposure(entry: SocialHistoryEntry): boolean {
  return (
    (entry.status === 'current' || entry.status === 'former') &&
    (
      entry.category === 'tobacco' ||
      entry.category === 'alcohol' ||
      entry.category === 'recreational_substance' ||
      entry.category === 'environmental_exposure'
    )
  )
}

function buildSocialHistoryEventPayload(input: {
  payload: SocialHistoryImportPayload
  entry: SocialHistoryEntry
}): Record<string, unknown> {
  const common = {
    occurredAt: input.payload.occurredAt,
    recordedAt: input.payload.recordedAt,
    timeZone: input.payload.timeZone,
    source: input.payload.source,
    title: input.entry.title ?? `Social history: ${input.entry.category.replace(/_/gu, ' ')}`,
    note: socialHistoryNote(input.entry),
    tags: socialEntryTags(input.entry.category),
    rawRefs: input.entry.rawRefs ?? input.payload.rawRefs,
    evidence: input.entry.evidence ?? input.payload.evidence,
    externalRef: input.entry.externalRef,
  }

  if (shouldWriteSocialAssertion(input.entry)) {
    return compactEventPayload({
      ...common,
      kind: 'clinical_assertion',
      assertion: input.entry.status === 'not_applicable' ? 'not_applicable' : 'denial_asserted',
      domain: 'social',
      polarity: input.entry.status === 'not_applicable' ? 'not_applicable' : 'denied',
      subject: input.entry.substance ?? input.entry.category,
      assertionText: input.entry.statement,
      assertedOn: localDateFromTimestamp(input.payload.occurredAt),
      sourceLabel: input.entry.sourceLabel ?? input.payload.sourceLabel,
    })
  }

  if (shouldWriteSocialExposure(input.entry)) {
    return compactEventPayload({
      ...common,
      kind: 'exposure',
      exposureType: input.entry.category,
      substance: input.entry.substance ?? input.entry.statement,
      duration: socialDuration(input.entry),
    })
  }

  return compactEventPayload({
    ...common,
    kind: 'note',
    noteType: 'social_history',
    sections: [
      {
        kind: 'other',
        heading: input.entry.category.replace(/_/gu, ' '),
        text: input.entry.statement,
      },
    ],
  })
}

export async function importSocialHistoryRecord(input: ClinicalImportInput): Promise<ClinicalImportResult> {
  const payload = await loadPayload(input.inputFile, socialHistoryImportPayloadSchema, 'social-history')
  const runtime = await loadClinicalRuntime()

  try {
    const result = await runtime.importEventBatch({
      vaultRoot: input.vault,
      payloads: payload.entries.map((entry) => buildSocialHistoryEventPayload({ payload, entry })),
      apply: true,
    })
    return toEventBatchResult(input.vault, result)
  } catch (error) {
    toClinicalImportError(error)
  }
}
