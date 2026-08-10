import {
  BLOOD_TEST_FASTING_STATUSES,
  ID_PREFIXES,
  TEST_RESULT_STATUSES,
  bloodTestResultSchema,
  clinicalEvidenceRefSchema,
  encounterDiagnosisSchema,
  externalRefSchema,
  eventRelationLinkSchema,
  eventSourceSchema,
  idPattern,
  isStrictIsoDate,
  isWritableIsoDateTime,
  isValidIanaTimeZone,
  storedMediaSchema,
  WRITABLE_ISO_DATE_TIME_PATTERN,
  type EventRecord,
  type MeasurementEntry,
} from '@murphai/contracts'
import type {
  SaveEncounterBundleInput as CoreSaveEncounterBundleInput,
  SaveEncounterBundleResult as CoreSaveEncounterBundleResult,
} from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import * as z from '@murphai/contracts/zod-runtime'

import { loadJsonInputObject } from '../json-input.js'
import { loadRuntimeModule } from '../runtime-import.js'
import {
  compactObject,
  normalizeOptionalRelativePath,
  normalizeOptionalText,
  normalizeStringArray,
  toVaultCliError,
} from './vault-usecase-helpers.js'
import { normalizeMeasurementEntry } from './measurement.js'

const PROCEDURE_STATUSES = ['ordered', 'planned', 'completed', 'cancelled'] as const
const ENCOUNTER_TITLE_MAX_LENGTH = 160
const ENCOUNTER_NOTE_MAX_LENGTH = 4000
const ENCOUNTER_TYPE_MAX_LENGTH = 120
const ENCOUNTER_LOCATION_MAX_LENGTH = 160
const ENCOUNTER_PROVIDER_ID_MAX_LENGTH = 80
const ENCOUNTER_CLINICIAN_MAX_LENGTH = 160
const ENCOUNTER_FACILITY_MAX_LENGTH = 160
const ENCOUNTER_REASON_MAX_LENGTH = 1000
const ENCOUNTER_CLINICAL_TEXT_MAX_LENGTH = 4000
const ENCOUNTER_DIAGNOSES_MAX_ITEMS = 50
const ENCOUNTER_MEASUREMENTS_MAX_ITEMS = 25
const ENCOUNTER_MEDIA_MAX_ITEMS = 10
const ENCOUNTER_RESULTS_MAX_ITEMS = 500
const ENCOUNTER_PROCEDURE_MAX_LENGTH = 160
const ENCOUNTER_TEST_NAME_MAX_LENGTH = 160
const ENCOUNTER_TEST_SUMMARY_MAX_LENGTH = 1000
const ENCOUNTER_TEST_CATEGORY_MAX_LENGTH = 64
const ENCOUNTER_TEST_SPECIMEN_TYPE_MAX_LENGTH = 64
const ENCOUNTER_TEST_LAB_NAME_MAX_LENGTH = 160
const ENCOUNTER_TEST_LAB_PANEL_ID_MAX_LENGTH = 120
const ENCOUNTER_TAG_MAX_ITEMS = 32
const ENCOUNTER_TAG_MAX_LENGTH = 80
const ENCOUNTER_RAW_REF_MAX_ITEMS = 32
const ENCOUNTER_RAW_REF_MAX_LENGTH = 240

type EncounterMeasurementPayload = NonNullable<CoreSaveEncounterBundleInput['measurements']>[number]
type EncounterProcedurePayload = NonNullable<CoreSaveEncounterBundleInput['procedures']>[number]
type EncounterTestPayload = NonNullable<CoreSaveEncounterBundleInput['tests']>[number]
type EncounterCoreRuntime = {
  saveEncounterBundle(input: CoreSaveEncounterBundleInput): Promise<CoreSaveEncounterBundleResult>
}

export interface ImportEncounterBundleRecordInput {
  vault: string
  inputFile: string
}

export interface EncounterImportResult {
  vault: string
  encounterId: string
  lookupId: string
  eventIds: string[]
  childEventIds: string[]
  ledgerFiles: string[]
  auditPath: string
}

export type EncounterBundlePayload = Omit<CoreSaveEncounterBundleInput, 'vaultRoot'>

function encounterPayloadTextSchema(maxLength = ENCOUNTER_NOTE_MAX_LENGTH): z.ZodString {
  return z.string().min(1).max(maxLength)
}

const encounterPayloadEventIdSchema = z
  .string()
  .regex(
    new RegExp(idPattern(ID_PREFIXES.event), 'u'),
    'Expected canonical event id in evt_<ULID> form.',
  )
const encounterPayloadProviderIdSchema = z
  .string()
  .max(ENCOUNTER_PROVIDER_ID_MAX_LENGTH)
  .regex(
    new RegExp(idPattern(ID_PREFIXES.provider), 'u'),
    'Expected canonical provider id in prov_<ULID> form.',
  )
const encounterPayloadRawPathSchema = z
  .string()
  .max(ENCOUNTER_RAW_REF_MAX_LENGTH)
  .regex(
    /^raw\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u,
    'Expected vault-relative raw evidence path under raw/.',
  )
const encounterPayloadTimestampSchema = z
  .union([
    z.string().meta({ format: 'date' }).refine((value) => isStrictIsoDate(value), 'Invalid ISO date string.'),
    z.string().regex(WRITABLE_ISO_DATE_TIME_PATTERN).meta({ format: 'date-time' }).refine((value) => isWritableIsoDateTime(value), 'Invalid ISO date-time string.'),
  ])
const encounterPayloadTimeZoneSchema = z
  .string()
  .min(3)
  .max(64)
  .refine((value) => isValidIanaTimeZone(value), 'Invalid IANA time zone.')

function optionalNullableSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
): z.ZodType<z.infer<TSchema> | null | undefined> {
  return z.union([schema, z.null()]).optional()
}

function optionalNullableArraySchema<TSchema extends z.ZodTypeAny>(
  itemSchema: TSchema,
): z.ZodType<Array<z.infer<TSchema>> | null | undefined> {
  return z.union([z.array(itemSchema), z.null()]).optional()
}

const optionalEncounterPayloadBoundedTextSchema = (maxLength: number) =>
  z.union([encounterPayloadTextSchema(maxLength), z.literal(''), z.null()]).optional()
const optionalEncounterPayloadTimestampSchema = z
  .union([encounterPayloadTimestampSchema, z.literal(''), z.null()])
  .optional()
const optionalEncounterPayloadTimeZoneSchema = z
  .union([encounterPayloadTimeZoneSchema, z.literal(''), z.null()])
  .optional()
const optionalEncounterPayloadProviderIdSchema = z
  .union([encounterPayloadProviderIdSchema, z.literal(''), z.null()])
  .optional()
const looseMeasurementQualifierValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const optionalLooseMeasurementQualifiersSchema = z
  .union([z.record(z.string(), looseMeasurementQualifierValueSchema), z.null()])
  .optional()
const optionalLooseMeasurementNoteSchema = z
  .union([encounterPayloadTextSchema(ENCOUNTER_CLINICAL_TEXT_MAX_LENGTH), z.literal('')])
  .optional()
const encounterPayloadCommonEventFieldsSchema = z.object({
  eventId: encounterPayloadEventIdSchema.describe('Stable canonical event id. Required for idempotent retries.'),
  occurredAt: optionalEncounterPayloadTimestampSchema.describe('ISO timestamp for this child fact. Defaults to the encounter timestamp when omitted on child facts.'),
  recordedAt: optionalEncounterPayloadTimestampSchema.describe('Optional ISO timestamp for when the fact was recorded.'),
  timeZone: optionalEncounterPayloadTimeZoneSchema.describe('Optional IANA timezone for the event.'),
  source: optionalNullableSchema(eventSourceSchema).describe('Source of the extracted fact.'),
  title: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_TITLE_MAX_LENGTH).describe('Optional concise title.'),
  note: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_NOTE_MAX_LENGTH).describe('Optional note text.'),
  tags: z.union([
    z.array(encounterPayloadTextSchema(ENCOUNTER_TAG_MAX_LENGTH)).max(ENCOUNTER_TAG_MAX_ITEMS),
    z.null(),
  ]).optional().describe('Optional tags.'),
  links: optionalNullableArraySchema(eventRelationLinkSchema).describe('Optional canonical event relation links.'),
  rawRefs: z.union([
    z.array(encounterPayloadRawPathSchema).max(ENCOUNTER_RAW_REF_MAX_ITEMS),
    z.null(),
  ]).optional().describe('Optional vault-relative raw evidence paths.'),
  evidence: z.union([
    z.array(clinicalEvidenceRefSchema).max(50),
    z.null(),
  ]).optional().describe('Optional structured source-document evidence refs.'),
}).strict()

const looseMeasurementEntryPayloadSchema = z.object({
  metric: encounterPayloadTextSchema(160).describe('Metric name or slug. The importer normalizes common text to a metric slug.'),
  value: z.number().describe('Numeric measurement value.'),
  unit: encounterPayloadTextSchema(64).describe('Measurement unit.'),
  qualifiers: optionalLooseMeasurementQualifiersSchema,
  note: optionalLooseMeasurementNoteSchema,
}).strict()

export const encounterBundlePayloadSchema = z.object({
  encounter: encounterPayloadCommonEventFieldsSchema.extend({
    occurredAt: encounterPayloadTimestampSchema.describe('ISO timestamp for the encounter.'),
    encounterType: encounterPayloadTextSchema(ENCOUNTER_TYPE_MAX_LENGTH).describe('Visit type such as office_visit, telehealth, urgent_care, or procedure_visit.'),
    location: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_LOCATION_MAX_LENGTH),
    providerId: optionalEncounterPayloadProviderIdSchema,
    clinician: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_CLINICIAN_MAX_LENGTH),
    facility: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_FACILITY_MAX_LENGTH),
    reasonForVisit: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_REASON_MAX_LENGTH),
    assessmentText: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_CLINICAL_TEXT_MAX_LENGTH),
    planText: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_CLINICAL_TEXT_MAX_LENGTH),
    instructionsText: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_CLINICAL_TEXT_MAX_LENGTH),
    followUpText: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_CLINICAL_TEXT_MAX_LENGTH),
    diagnoses: z.union([z.array(encounterDiagnosisSchema).max(ENCOUNTER_DIAGNOSES_MAX_ITEMS), z.null()]).optional(),
  }).strict(),
  measurements: z.array(encounterPayloadCommonEventFieldsSchema.extend({
    measurements: z.array(looseMeasurementEntryPayloadSchema).min(1).max(ENCOUNTER_MEASUREMENTS_MAX_ITEMS),
    media: z.union([z.array(storedMediaSchema).max(ENCOUNTER_MEDIA_MAX_ITEMS), z.null()]).optional(),
    externalRef: optionalNullableSchema(externalRefSchema),
  }).strict()).nullable().optional(),
  procedures: z.array(encounterPayloadCommonEventFieldsSchema.extend({
    procedure: encounterPayloadTextSchema(ENCOUNTER_PROCEDURE_MAX_LENGTH),
    status: optionalNullableSchema(z.enum(PROCEDURE_STATUSES)),
  }).strict()).nullable().optional(),
  tests: z.array(encounterPayloadCommonEventFieldsSchema.extend({
    testName: encounterPayloadTextSchema(ENCOUNTER_TEST_NAME_MAX_LENGTH),
    resultStatus: optionalNullableSchema(z.enum(TEST_RESULT_STATUSES)),
    summary: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_TEST_SUMMARY_MAX_LENGTH),
    testCategory: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_TEST_CATEGORY_MAX_LENGTH),
    specimenType: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_TEST_SPECIMEN_TYPE_MAX_LENGTH),
    labName: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_TEST_LAB_NAME_MAX_LENGTH),
    labPanelId: optionalEncounterPayloadBoundedTextSchema(ENCOUNTER_TEST_LAB_PANEL_ID_MAX_LENGTH),
    collectedAt: optionalEncounterPayloadTimestampSchema,
    reportedAt: optionalEncounterPayloadTimestampSchema,
    fastingStatus: optionalNullableSchema(z.enum(BLOOD_TEST_FASTING_STATUSES)),
    results: z.union([z.array(bloodTestResultSchema).max(ENCOUNTER_RESULTS_MAX_ITEMS), z.null()]).optional(),
  }).strict()).nullable().optional(),
}).strict()
export type EncounterScaffoldPayload = z.infer<typeof encounterBundlePayloadSchema>
type ParsedEncounterBundlePayload = EncounterScaffoldPayload
type ParsedEncounterPayload = ParsedEncounterBundlePayload['encounter']
type ParsedMeasurementPayload = NonNullable<ParsedEncounterBundlePayload['measurements']>[number]
type ParsedProcedurePayload = NonNullable<ParsedEncounterBundlePayload['procedures']>[number]
type ParsedTestPayload = NonNullable<ParsedEncounterBundlePayload['tests']>[number]

async function loadEncounterCoreRuntime(): Promise<EncounterCoreRuntime> {
  return loadRuntimeModule<EncounterCoreRuntime>('@murphai/core')
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function invalidPayload(message: string) {
  return new VaultCliError('invalid_payload', message)
}

function parseEncounterPayloadInput(payload: unknown): ParsedEncounterBundlePayload {
  const result = encounterBundlePayloadSchema.safeParse(payload)
  if (!result.success) {
    throw new VaultCliError('invalid_payload', 'encounter payload failed validation.', {
      issues: result.error.issues.map((issue) => issue.message),
    })
  }

  return result.data
}

function requireText(value: unknown, fieldName: string): string {
  const normalized = normalizeOptionalText(valueAsString(value))
  if (!normalized) {
    throw invalidPayload(`${fieldName} is required.`)
  }

  return normalized
}

function optionalText(value: unknown): string | undefined {
  return normalizeOptionalText(valueAsString(value)) ?? undefined
}

function optionalStringArray(value: string[] | null | undefined): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  return normalizeStringArray(value)
}

function optionalRawRefs(value: string[] | null | undefined, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const entries = value.map((entry, index) => {
    const relativePath = normalizeOptionalRelativePath(entry)
    if (!relativePath) {
      throw invalidPayload(`${fieldName}[${index}] must be a non-empty vault-relative path.`)
    }

    return relativePath
  })

  return entries.length > 0 ? [...new Set(entries)] : []
}

function optionalList<TValue>(value: TValue[] | null | undefined): TValue[] | undefined {
  if (value === undefined || value === null || value.length === 0) {
    return undefined
  }

  return value
}

function optionalEvidence(value: EventRecord['evidence'] | null | undefined): EventRecord['evidence'] | undefined {
  return optionalList(value)
}

function normalizeMeasurements(value: unknown[], fieldName: string): MeasurementEntry[] {
  return value.map((entry, index) => normalizeMeasurementEntry(entry, `${fieldName}[${index}]`))
}

function normalizeCommonEventFields(
  input: ParsedEncounterPayload | ParsedMeasurementPayload | ParsedProcedurePayload | ParsedTestPayload,
  fieldName: string,
) {
  return {
    eventId: requireText(input.eventId, `${fieldName}.eventId`),
    occurredAt: optionalText(input.occurredAt),
    recordedAt: optionalText(input.recordedAt),
    timeZone: optionalText(input.timeZone),
    source: input.source ?? undefined,
    title: optionalText(input.title),
    note: optionalText(input.note),
    tags: optionalStringArray(input.tags),
    links: optionalList(input.links),
    rawRefs: optionalRawRefs(input.rawRefs, `${fieldName}.rawRefs`),
    evidence: optionalEvidence(input.evidence),
  }
}

function normalizeEncounterPayload(encounter: ParsedEncounterPayload): CoreSaveEncounterBundleInput['encounter'] {
  const encounterType = requireText(encounter.encounterType, 'encounter.encounterType')
  const title = optionalText(encounter.title) ?? `Encounter: ${encounterType}`

  return compactObject({
    ...normalizeCommonEventFields(encounter, 'encounter'),
    occurredAt: requireText(encounter.occurredAt, 'encounter.occurredAt'),
    title,
    encounterType,
    location: optionalText(encounter.location),
    providerId: optionalText(encounter.providerId),
    clinician: optionalText(encounter.clinician),
    facility: optionalText(encounter.facility),
    reasonForVisit: optionalText(encounter.reasonForVisit),
    assessmentText: optionalText(encounter.assessmentText),
    planText: optionalText(encounter.planText),
    instructionsText: optionalText(encounter.instructionsText),
    followUpText: optionalText(encounter.followUpText),
    diagnoses: optionalList(encounter.diagnoses),
  })
}

function normalizeMeasurementPayload(
  measurement: ParsedMeasurementPayload,
  fieldName: string,
): EncounterMeasurementPayload {
  return compactObject({
    ...normalizeCommonEventFields(measurement, fieldName),
    measurements: normalizeMeasurements(measurement.measurements, `${fieldName}.measurements`),
    media: optionalList(measurement.media),
    externalRef: measurement.externalRef ?? undefined,
  })
}

function normalizeProcedurePayload(
  procedure: ParsedProcedurePayload,
  fieldName: string,
): EncounterProcedurePayload {
  return compactObject({
    ...normalizeCommonEventFields(procedure, fieldName),
    procedure: requireText(procedure.procedure, `${fieldName}.procedure`),
    status: procedure.status ?? undefined,
  })
}

function normalizeTestPayload(
  test: ParsedTestPayload,
  fieldName: string,
): EncounterTestPayload {
  return compactObject({
    ...normalizeCommonEventFields(test, fieldName),
    testName: requireText(test.testName, `${fieldName}.testName`),
    resultStatus: test.resultStatus ?? undefined,
    summary: optionalText(test.summary),
    testCategory: optionalText(test.testCategory),
    specimenType: optionalText(test.specimenType),
    labName: optionalText(test.labName),
    labPanelId: optionalText(test.labPanelId),
    collectedAt: optionalText(test.collectedAt),
    reportedAt: optionalText(test.reportedAt),
    fastingStatus: test.fastingStatus ?? undefined,
    results: optionalList(test.results),
  })
}

function optionalPayloadList<TInput, TValue>(
  value: TInput[] | null | undefined,
  fieldName: string,
  normalizeEntry: (entry: TInput, entryFieldName: string) => TValue,
): TValue[] | undefined {
  if (value === undefined || value === null || value.length === 0) {
    return undefined
  }

  return value.map((entry, index) => normalizeEntry(entry, `${fieldName}[${index}]`))
}

export function parseEncounterBundlePayload(payload: unknown): EncounterBundlePayload {
  const input = parseEncounterPayloadInput(payload)
  const normalized = compactObject({
    encounter: normalizeEncounterPayload(input.encounter),
    measurements: optionalPayloadList(input.measurements, 'measurements', normalizeMeasurementPayload),
    procedures: optionalPayloadList(input.procedures, 'procedures', normalizeProcedurePayload),
    tests: optionalPayloadList(input.tests, 'tests', normalizeTestPayload),
  })

  return normalized
}

export function scaffoldEncounterBundlePayload(): EncounterScaffoldPayload {
  return encounterBundlePayloadSchema.parse(parseEncounterBundlePayload({
    encounter: {
      eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F0',
      occurredAt: '2026-06-17T13:30:00.000Z',
      timeZone: 'America/New_York',
      source: 'import',
      title: 'Primary care visit',
      encounterType: 'office_visit',
      clinician: 'Dr. Example',
      facility: 'Example Clinic',
      reasonForVisit: 'Follow-up visit',
      assessmentText: 'Visit-scoped assessment text.',
      planText: 'Visit-scoped plan text.',
      instructionsText: 'Home-care instructions from the visit.',
      followUpText: 'Follow up in six months.',
      diagnoses: [
        {
          text: 'Essential hypertension',
          code: 'I10',
          codeSystem: 'ICD-10-CM',
          status: 'active',
          note: 'Encounter-scoped diagnosis from this visit.',
        },
      ],
      rawRefs: ['raw/documents/2026/06/visit-summary.pdf'],
      tags: ['primary-care', 'imported'],
    },
    measurements: [
      {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F1',
        title: 'Visit vitals',
        measurements: [
          {
            metric: 'systolic-blood-pressure',
            value: 128,
            unit: 'mmHg',
          },
          {
            metric: 'heart-rate',
            value: 72,
            unit: 'bpm',
          },
        ],
      },
    ],
    procedures: [
      {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F2',
        procedure: 'Screening colonoscopy',
        status: 'ordered',
      },
    ],
    tests: [
      {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F3',
        testName: 'Basic metabolic panel',
        resultStatus: 'pending',
        summary: 'Ordered after visit.',
      },
    ],
  }))
}

export async function loadEncounterBundlePayload(
  inputFile: string,
): Promise<EncounterBundlePayload> {
  return parseEncounterBundlePayload(await loadJsonInputObject(inputFile, 'encounter payload'))
}

export async function importEncounterBundleRecord(
  input: ImportEncounterBundleRecordInput,
): Promise<EncounterImportResult> {
  const payload = await loadEncounterBundlePayload(input.inputFile)
  const core = await loadEncounterCoreRuntime()

  try {
    const result = await core.saveEncounterBundle({
      vaultRoot: input.vault,
      ...payload,
    })
    const eventIds = result.events.map((event) => event.id)

    return {
      vault: input.vault,
      encounterId: result.encounter.id,
      lookupId: result.encounter.id,
      eventIds,
      childEventIds: eventIds.slice(1),
      ledgerFiles: result.ledgerFiles,
      auditPath: result.auditPath,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      EVENT_INVALID: { code: 'contract_invalid' },
      EVENT_CONTRACT_INVALID: { code: 'contract_invalid' },
      INVALID_TIMESTAMP: { code: 'invalid_timestamp' },
      VAULT_ALREADY_EXISTS: { code: 'already_exists' },
      VAULT_INVALID_INPUT: { code: 'invalid_payload' },
    })
  }
}
