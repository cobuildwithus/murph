import {
  BLOOD_TEST_FASTING_STATUSES,
  ID_PREFIXES,
  TEST_RESULT_STATUSES,
  bloodTestResultSchema,
  encounterDiagnosisSchema,
  externalRefSchema,
  eventRelationLinkSchema,
  eventSourceSchema,
  idPattern,
  isStrictIsoDateTime,
  type BloodTestResultRecord,
  type EncounterDiagnosis,
  type EventRecord,
  type EventSource,
  type JsonObject,
  type MeasurementEntry,
  type StoredMedia,
} from '@murphai/contracts'
import type {
  SaveEncounterBundleInput as CoreSaveEncounterBundleInput,
  SaveEncounterBundleResult as CoreSaveEncounterBundleResult,
} from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { z } from 'zod'

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

type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number]
type TestResultStatus = (typeof TEST_RESULT_STATUSES)[number]
type BloodTestFastingStatus = (typeof BLOOD_TEST_FASTING_STATUSES)[number]
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

const encounterPayloadTextSchema = z.string().min(1)
const encounterPayloadEventIdPattern = new RegExp(idPattern(ID_PREFIXES.event), 'u')
const encounterPayloadEventIdSchema = z
  .string()
  .regex(
    encounterPayloadEventIdPattern,
    'Expected canonical event id in evt_<ULID> form.',
  )
const encounterPayloadTimestampSchema = z
  .string()
  .min(1)
  .meta({ format: 'date-time' })
  .refine((value) => isStrictIsoDateTime(value), 'Invalid ISO date-time string.')
const encounterPayloadCommonEventFieldsSchema = z.object({
  eventId: encounterPayloadEventIdSchema.describe('Stable canonical event id. Required for idempotent retries.'),
  occurredAt: encounterPayloadTimestampSchema.optional().describe('ISO timestamp for this child fact. Defaults to the encounter timestamp when omitted on child facts.'),
  recordedAt: encounterPayloadTimestampSchema.optional().describe('Optional ISO timestamp for when the fact was recorded.'),
  timeZone: encounterPayloadTextSchema.optional().describe('Optional IANA timezone for the event.'),
  source: eventSourceSchema.optional().describe('Source of the extracted fact.'),
  title: encounterPayloadTextSchema.optional().describe('Optional concise title.'),
  note: encounterPayloadTextSchema.optional().describe('Optional note text.'),
  tags: z.array(z.string()).optional().describe('Optional tags.'),
  links: z.array(eventRelationLinkSchema).optional().describe('Optional canonical event relation links.'),
  rawRefs: z.array(z.string()).optional().describe('Optional vault-relative raw evidence paths.'),
})

const looseMeasurementEntryPayloadSchema = z.object({
  metric: encounterPayloadTextSchema.describe('Metric name or slug. The importer normalizes common text to a metric slug.'),
  value: z.number().describe('Numeric measurement value.'),
  unit: encounterPayloadTextSchema.describe('Measurement unit.'),
  qualifiers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  note: encounterPayloadTextSchema.optional(),
})

const looseStoredMediaPayloadSchema = z.object({
  kind: z.enum(['photo', 'video', 'gif', 'image', 'other']).optional(),
  relativePath: encounterPayloadTextSchema.describe('Vault-relative raw media path.'),
  mediaType: encounterPayloadTextSchema.optional(),
  caption: encounterPayloadTextSchema.optional(),
})

export const encounterBundlePayloadSchema = z.object({
  encounter: encounterPayloadCommonEventFieldsSchema.extend({
    occurredAt: encounterPayloadTimestampSchema.describe('ISO timestamp for the encounter.'),
    encounterType: encounterPayloadTextSchema.describe('Visit type such as office_visit, telehealth, urgent_care, or procedure_visit.'),
    location: encounterPayloadTextSchema.optional(),
    providerId: encounterPayloadTextSchema.optional(),
    clinician: encounterPayloadTextSchema.optional(),
    facility: encounterPayloadTextSchema.optional(),
    reasonForVisit: encounterPayloadTextSchema.optional(),
    assessmentText: encounterPayloadTextSchema.optional(),
    planText: encounterPayloadTextSchema.optional(),
    instructionsText: encounterPayloadTextSchema.optional(),
    followUpText: encounterPayloadTextSchema.optional(),
    diagnoses: z.array(encounterDiagnosisSchema).optional(),
  }),
  measurements: z.array(encounterPayloadCommonEventFieldsSchema.extend({
    measurements: z.array(looseMeasurementEntryPayloadSchema).min(1),
    media: z.array(looseStoredMediaPayloadSchema).optional(),
    externalRef: externalRefSchema.optional(),
  })).optional(),
  procedures: z.array(encounterPayloadCommonEventFieldsSchema.extend({
    procedure: encounterPayloadTextSchema,
    status: z.enum(PROCEDURE_STATUSES).optional(),
  })).optional(),
  tests: z.array(encounterPayloadCommonEventFieldsSchema.extend({
    testName: encounterPayloadTextSchema,
    resultStatus: z.enum(TEST_RESULT_STATUSES).optional(),
    summary: encounterPayloadTextSchema.optional(),
    testCategory: encounterPayloadTextSchema.optional(),
    specimenType: encounterPayloadTextSchema.optional(),
    labName: encounterPayloadTextSchema.optional(),
    labPanelId: encounterPayloadTextSchema.optional(),
    collectedAt: encounterPayloadTimestampSchema.optional(),
    reportedAt: encounterPayloadTimestampSchema.optional(),
    fastingStatus: z.enum(BLOOD_TEST_FASTING_STATUSES).optional(),
    results: z.array(bloodTestResultSchema).optional(),
  })).optional(),
})
export type EncounterScaffoldPayload = z.infer<typeof encounterBundlePayloadSchema>

async function loadEncounterCoreRuntime(): Promise<EncounterCoreRuntime> {
  return loadRuntimeModule<EncounterCoreRuntime>('@murphai/core')
}

function asJsonObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function invalidPayload(message: string) {
  return new VaultCliError('invalid_payload', message)
}

function requireObject(value: unknown, fieldName: string): JsonObject {
  const candidate = asJsonObject(value)
  if (!candidate) {
    throw invalidPayload(`${fieldName} must be an object.`)
  }

  return candidate
}

function requireText(value: unknown, fieldName: string): string {
  const normalized = normalizeOptionalText(valueAsString(value))
  if (!normalized) {
    throw invalidPayload(`${fieldName} is required.`)
  }

  return normalized
}

function requireEventId(value: unknown, fieldName: string): string {
  const normalized = requireText(value, fieldName)
  if (!encounterPayloadEventIdPattern.test(normalized)) {
    throw invalidPayload(`${fieldName} must be a canonical event id in evt_<ULID> form.`)
  }

  return normalized
}

function optionalText(value: unknown): string | undefined {
  return normalizeOptionalText(valueAsString(value)) ?? undefined
}

function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw invalidPayload(`${fieldName} must be an array of strings.`)
  }

  const invalidIndex = value.findIndex((entry) => typeof entry !== 'string')
  if (invalidIndex >= 0) {
    throw invalidPayload(`${fieldName}[${invalidIndex}] must be a string.`)
  }

  return normalizeStringArray(value)
}

function optionalRawRefs(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw invalidPayload(`${fieldName} must be an array of vault-relative paths.`)
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

function optionalSource(value: unknown, fieldName: string): EventSource | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const parsed = eventSourceSchema.safeParse(value)
  if (!parsed.success) {
    throw invalidPayload(`${fieldName} must be one of manual, import, device, or derived.`)
  }

  return parsed.data
}

function optionalProcedureStatus(value: unknown, fieldName: string): ProcedureStatus | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'string' || !PROCEDURE_STATUSES.includes(value as ProcedureStatus)) {
    throw invalidPayload(`${fieldName} must be one of ordered, planned, completed, or cancelled.`)
  }

  return value as ProcedureStatus
}

function optionalTestResultStatus(value: unknown, fieldName: string): TestResultStatus | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'string' || !TEST_RESULT_STATUSES.includes(value as TestResultStatus)) {
    throw invalidPayload(`${fieldName} must be one of pending, normal, abnormal, mixed, or unknown.`)
  }

  return value as TestResultStatus
}

function optionalBloodTestFastingStatus(
  value: unknown,
  fieldName: string,
): BloodTestFastingStatus | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (
    typeof value !== 'string'
    || !BLOOD_TEST_FASTING_STATUSES.includes(value as BloodTestFastingStatus)
  ) {
    throw invalidPayload(`${fieldName} must be a supported fasting status.`)
  }

  return value as BloodTestFastingStatus
}

function optionalLinks(value: unknown, fieldName: string): EventRecord['links'] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw invalidPayload(`${fieldName} must be an array of relation link objects.`)
  }

  if (value.length === 0) {
    return undefined
  }

  const links = value.map((entry, index) => {
    const parsed = eventRelationLinkSchema.safeParse(entry)
    if (!parsed.success) {
      throw invalidPayload(`${fieldName}[${index}] is not a supported event relation link.`)
    }

    return parsed.data
  })

  return links
}

function optionalExternalRef(value: unknown, fieldName: string): EventRecord['externalRef'] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const parsed = externalRefSchema.safeParse(value)
  if (!parsed.success) {
    throw invalidPayload(`${fieldName} must include system, resourceType, and resourceId.`)
  }

  return parsed.data
}

function optionalMedia(value: unknown, fieldName: string): StoredMedia[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw invalidPayload(`${fieldName} must be an array of stored media objects.`)
  }

  const media = value.map((entry, index) => {
    const candidate = asJsonObject(entry)
    if (!candidate || typeof candidate.relativePath !== 'string') {
      throw invalidPayload(`${fieldName}[${index}].relativePath is required.`)
    }

    return candidate as StoredMedia
  })

  return media.length > 0 ? media : undefined
}

function optionalMeasurements(value: unknown, fieldName: string): MeasurementEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidPayload(`${fieldName} must include at least one measurement entry.`)
  }

  return value.map((entry, index) => normalizeMeasurementEntry(entry, `${fieldName}[${index}]`))
}

function optionalDiagnoses(value: unknown, fieldName: string): EncounterDiagnosis[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw invalidPayload(`${fieldName} must be an array of diagnosis objects.`)
  }

  if (value.length === 0) {
    return undefined
  }

  const diagnoses = value.map((entry, index) => {
    const parsed = encounterDiagnosisSchema.safeParse(entry)
    if (!parsed.success) {
      throw invalidPayload(`${fieldName}[${index}] is not a valid encounter diagnosis.`)
    }

    return parsed.data
  })

  return diagnoses
}

function optionalBloodTestResults(
  value: unknown,
  fieldName: string,
): BloodTestResultRecord[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw invalidPayload(`${fieldName} must be an array of blood test result objects.`)
  }

  if (value.length === 0) {
    return undefined
  }

  return value.map((entry, index) => {
    const parsed = bloodTestResultSchema.safeParse(entry)
    if (!parsed.success) {
      throw invalidPayload(`${fieldName}[${index}] is not a valid blood test result.`)
    }

    return parsed.data
  })
}

function normalizeCommonEventFields(input: JsonObject, fieldName: string) {
  return {
    eventId: requireEventId(input.eventId, `${fieldName}.eventId`),
    occurredAt: optionalText(input.occurredAt),
    recordedAt: optionalText(input.recordedAt),
    timeZone: optionalText(input.timeZone),
    source: optionalSource(input.source, `${fieldName}.source`),
    title: optionalText(input.title),
    note: optionalText(input.note),
    tags: optionalStringArray(input.tags, `${fieldName}.tags`),
    links: optionalLinks(input.links, `${fieldName}.links`),
    rawRefs: optionalRawRefs(input.rawRefs, `${fieldName}.rawRefs`),
  }
}

function normalizeEncounterPayload(value: unknown): CoreSaveEncounterBundleInput['encounter'] {
  const encounter = requireObject(value, 'encounter')
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
    diagnoses: optionalDiagnoses(encounter.diagnoses, 'encounter.diagnoses'),
  })
}

function normalizeMeasurementPayload(
  value: unknown,
  fieldName: string,
): EncounterMeasurementPayload {
  const measurement = requireObject(value, fieldName)

  return compactObject({
    ...normalizeCommonEventFields(measurement, fieldName),
    measurements: optionalMeasurements(measurement.measurements, `${fieldName}.measurements`),
    media: optionalMedia(measurement.media, `${fieldName}.media`),
    externalRef: optionalExternalRef(measurement.externalRef, `${fieldName}.externalRef`),
  })
}

function normalizeProcedurePayload(
  value: unknown,
  fieldName: string,
): EncounterProcedurePayload {
  const procedure = requireObject(value, fieldName)

  return compactObject({
    ...normalizeCommonEventFields(procedure, fieldName),
    procedure: requireText(procedure.procedure, `${fieldName}.procedure`),
    status: optionalProcedureStatus(procedure.status, `${fieldName}.status`),
  })
}

function normalizeTestPayload(
  value: unknown,
  fieldName: string,
): EncounterTestPayload {
  const test = requireObject(value, fieldName)

  return compactObject({
    ...normalizeCommonEventFields(test, fieldName),
    testName: requireText(test.testName, `${fieldName}.testName`),
    resultStatus: optionalTestResultStatus(test.resultStatus, `${fieldName}.resultStatus`),
    summary: optionalText(test.summary),
    testCategory: optionalText(test.testCategory),
    specimenType: optionalText(test.specimenType),
    labName: optionalText(test.labName),
    labPanelId: optionalText(test.labPanelId),
    collectedAt: optionalText(test.collectedAt),
    reportedAt: optionalText(test.reportedAt),
    fastingStatus: optionalBloodTestFastingStatus(test.fastingStatus, `${fieldName}.fastingStatus`),
    results: optionalBloodTestResults(test.results, `${fieldName}.results`),
  })
}

function optionalPayloadList<TValue>(
  value: unknown,
  fieldName: string,
  normalizeEntry: (entry: unknown, entryFieldName: string) => TValue,
): TValue[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw invalidPayload(`${fieldName} must be an array.`)
  }

  if (value.length === 0) {
    return undefined
  }

  return value.map((entry, index) => normalizeEntry(entry, `${fieldName}[${index}]`))
}

export function parseEncounterBundlePayload(payload: unknown): EncounterBundlePayload {
  const input = requireObject(payload, 'encounter payload')

  return compactObject({
    encounter: normalizeEncounterPayload(input.encounter),
    measurements: optionalPayloadList(input.measurements, 'measurements', normalizeMeasurementPayload),
    procedures: optionalPayloadList(input.procedures, 'procedures', normalizeProcedurePayload),
    tests: optionalPayloadList(input.tests, 'tests', normalizeTestPayload),
  })
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
