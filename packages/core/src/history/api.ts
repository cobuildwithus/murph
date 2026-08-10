import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_FASTING_STATUSES,
  BLOOD_TEST_RESULT_FLAGS,
  BLOOD_TEST_SPECIMEN_TYPES,
  eventRecordSchema,
  isStrictIsoDate,
  safeParseContract,
} from "@murphai/contracts";
import { resolveWearableCanonicalMetricKey } from "@murphai/health-metrics";

import type {
  BloodTestReferenceRange,
  BloodTestResultRecord,
  EventRecord,
  MeasurementEventRecord,
} from "@murphai/contracts";
import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.ts";
import { emitAuditRecord } from "../audit.ts";
import {
  assertNoLegacyRelatedIds,
  normalizeCanonicalEventLinks,
} from "../event-links.ts";
import { VaultError } from "../errors.ts";
import {
  readJsonlRecords,
  toMonthlyShardRelativePath,
  visitJsonlRecordsInterruptible,
} from "../jsonl.ts";
import { generateRecordId } from "../ids.ts";
import { runCanonicalWrite } from "../operations/index.ts";
import { normalizeTimeZone, toDateOnly } from "../time.ts";
import {
  readUtf8File,
  walkVaultFiles,
  walkVaultFilesInterruptible,
} from "../fs.ts";
import { loadVault } from "../vault.ts";
import { buildMeasurementEventDraft } from "../domains/events.ts";
import { buildTypedEventRecord } from "../domains/events/drafts.ts";
import {
  buildEventSpineEnvelope,
  buildEventSpineLifecycle,
  collapseEventSpineEntries,
  compareEventSpineEntries,
  isDeletedEventSpineRecord,
  parseStoredEventSpineLifecycle,
} from "./event-spine.ts";

import {
  compareIsoTimestamps,
  normalizeId,
  normalizeRelativePathList,
  normalizeTagList,
  normalizeTimestamp,
  optionalEnum,
  optionalString,
  requireString,
  validateSortedStringList,
} from "./shared.ts";
import {
  ADVERSE_EFFECT_SEVERITIES,
  CLINICAL_ASSERTION_DOMAINS,
  CLINICAL_ASSERTION_POLARITIES,
  CLINICAL_ASSERTION_TYPES,
  HEALTH_HISTORY_KINDS,
  HEALTH_HISTORY_SOURCES,
  HISTORY_EVENT_ORDER,
  PROCEDURE_STATUSES,
  TEST_STATUSES,
} from "./types.ts";

import type {
  AdverseEffectHistoryEventRecord,
  AppendBloodTestInput,
  AppendBloodTestResult,
  AppendHistoryEventInput,
  AppendHistoryEventResult,
  AppendImmunizationInput,
  AppendImmunizationResult,
  BloodTestHistoryEventRecord,
  ClinicalAssertionHistoryEventRecord,
  ClinicalAssertionType,
  EncounterBundleMeasurementInput,
  EncounterBundleProcedureInput,
  EncounterBundleTestInput,
  EncounterHistoryEventRecord,
  ExposureHistoryEventRecord,
  HistoryEventKind,
  HistoryEventOrder,
  HistoryEventRecord,
  HistoryEventSource,
  ImmunizationHistoryEventRecord,
  ListHistoryEventsInput,
  ProcedureHistoryEventRecord,
  ReadHistoryEventInput,
  ReadHistoryEventResult,
  SaveEncounterBundleInput,
  SaveEncounterBundleResult,
  TestHistoryEventRecord,
  TestResultStatus,
} from "./types.ts";

const HISTORY_KIND_SET = new Set<HistoryEventKind>(HEALTH_HISTORY_KINDS);
const BLOOD_TEST_RESULT_COMPARATORS = ["<", "<=", ">", ">="] as const;
const KNOWN_BLOOD_TEST_SPECIMEN_TYPES = new Set<string>(BLOOD_TEST_SPECIMEN_TYPES);
const EVENT_TITLE_MAX_LENGTH = 160;

type HistorySourceRecord = Record<string, unknown>;
type StoredHistoryEventEntry = {
  relativePath: string;
  record: HistoryEventRecord;
};
type StoredAvailabilitySpineRecord = Pick<
  EventRecord,
  "id" | "occurredAt" | "recordedAt" | "lifecycle"
>;
type StoredAvailabilityEventEntry = {
  relativePath: string;
  record: StoredAvailabilitySpineRecord;
  value: unknown;
};

export interface ReadCanonicalEventAvailabilityInput {
  vaultRoot: string;
  shouldContinue?: () => boolean;
  signal?: AbortSignal | null;
}

export interface CanonicalEventAvailabilitySummary {
  interrupted: boolean;
  latestBloodPressureMeasurementDayKey: string | null;
  latestBloodPressureMeasurementOccurredAt: string | null;
  latestBloodTestOccurredAt: string | null;
  latestBodyMeasurementDayKey: string | null;
  latestBodyMeasurementOccurredAt: string | null;
}

const CANONICAL_BODY_MEASUREMENT_METRIC_KEYS = new Set([
  "bmi",
  "bodyFatPercentage",
  "leanBodyMassKg",
  "waistCircumference",
  "weightKg",
]);
const CANONICAL_BODY_MEASUREMENT_TYPES = new Set([
  "body_fat_pct",
  "waist",
  "weight",
]);
const STORED_DAY_GRAIN_OBSERVATION_ALIASES = new Set([
  "day",
  "daily-summary",
  "daily-timeseries-aggregate",
  "summary",
]);

type EncounterHistoryFields = Pick<
  EncounterHistoryEventRecord,
  | "encounterType"
  | "location"
  | "providerId"
  | "clinician"
  | "facility"
  | "reasonForVisit"
  | "assessmentText"
  | "planText"
  | "instructionsText"
  | "followUpText"
  | "diagnoses"
>;
type ProcedureHistoryFields = Pick<
  ProcedureHistoryEventRecord,
  "procedure" | "status"
>;
type ImmunizationHistoryFields = Pick<
  ImmunizationHistoryEventRecord,
  | "vaccineName"
  | "manufacturer"
  | "lotNumber"
  | "route"
  | "site"
  | "series"
  | "targetDiseases"
>;
type TestHistoryFields = Pick<
  TestHistoryEventRecord,
  | "testName"
  | "resultStatus"
  | "summary"
  | "testCategory"
  | "specimenType"
  | "labName"
  | "labPanelId"
  | "collectedAt"
  | "reportedAt"
  | "fastingStatus"
  | "results"
>;
type AdverseEffectHistoryFields = Pick<
  AdverseEffectHistoryEventRecord,
  "substance" | "effect" | "severity"
>;
type ExposureHistoryFields = Pick<
  ExposureHistoryEventRecord,
  "exposureType" | "substance" | "duration"
>;
type ClinicalAssertionHistoryFields = Pick<
  ClinicalAssertionHistoryEventRecord,
  | "assertion"
  | "domain"
  | "polarity"
  | "subject"
  | "assertionText"
  | "bodySite"
  | "code"
  | "codeSystem"
  | "assertedOn"
  | "sourceLabel"
>;
type HistoryKindFields =
  | EncounterHistoryFields
  | ProcedureHistoryFields
  | ImmunizationHistoryFields
  | TestHistoryFields
  | AdverseEffectHistoryFields
  | ExposureHistoryFields
  | ClinicalAssertionHistoryFields;

function stripUndefined<TRecord>(record: TRecord): TRecord {
  return Object.fromEntries(
    Object.entries(record as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as TRecord;
}

function generatedHistoryEventTitle(prefix: string, value: string): string {
  const fullTitle = `${prefix}${value}`;

  if (fullTitle.length <= EVENT_TITLE_MAX_LENGTH) {
    return fullTitle;
  }

  return `${fullTitle.slice(0, EVENT_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function optionalFiniteNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be a finite number.`);
  }

  return value;
}

function normalizeOptionalTimestamp(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizeTimestamp(value as Parameters<typeof normalizeTimestamp>[0], fieldName);
}

function normalizeToken(value: unknown, fieldName: string, maxLength = 64): string | undefined {
  const candidate = optionalString(value, fieldName, maxLength);

  if (!candidate) {
    return undefined;
  }

  return candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function normalizeSlugLike(value: unknown, fieldName: string, maxLength = 160): string | undefined {
  const candidate = optionalString(value, fieldName, maxLength);

  if (!candidate) {
    return undefined;
  }

  return candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeBloodTestReferenceRange(
  value: unknown,
  fieldName: string,
): BloodTestReferenceRange | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isPlainRecord(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an object.`);
  }

  const referenceRange = stripUndefined({
    low: optionalFiniteNumber(value.low, `${fieldName}.low`),
    high: optionalFiniteNumber(value.high, `${fieldName}.high`),
    text: optionalString(value.text, `${fieldName}.text`, 160),
  });

  if (
    referenceRange.low === undefined &&
    referenceRange.high === undefined &&
    referenceRange.text === undefined
  ) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      `${fieldName} must include at least one boundary or text range.`,
    );
  }

  return referenceRange as BloodTestReferenceRange;
}

function normalizeBloodTestResult(
  value: unknown,
  fieldName: string,
): BloodTestResultRecord {
  if (!isPlainRecord(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an object.`);
  }

  if ("valueText" in value) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      `${fieldName}.valueText is not supported. Did you mean ${fieldName}.textValue?`,
    );
  }

  const result = stripUndefined({
    analyte: requireString(value.analyte, `${fieldName}.analyte`, 160),
    slug: normalizeSlugLike(value.slug, `${fieldName}.slug`, 160),
    value: optionalFiniteNumber(value.value, `${fieldName}.value`),
    textValue: optionalString(value.textValue, `${fieldName}.textValue`, 160),
    comparator: optionalEnum(value.comparator, BLOOD_TEST_RESULT_COMPARATORS, `${fieldName}.comparator`),
    unit: optionalString(value.unit, `${fieldName}.unit`, 64),
    flag: optionalEnum(value.flag, BLOOD_TEST_RESULT_FLAGS, `${fieldName}.flag`),
    biomarkerSlug: normalizeSlugLike(value.biomarkerSlug, `${fieldName}.biomarkerSlug`, 160),
    referenceRange: normalizeBloodTestReferenceRange(value.referenceRange, `${fieldName}.referenceRange`),
    note: optionalString(value.note, `${fieldName}.note`, 240),
  });

  if (result.value === undefined && result.textValue === undefined) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      `${fieldName} must include either a numeric value or textValue.`,
    );
  }

  return result as BloodTestResultRecord;
}

function normalizeBloodTestResults(
  value: unknown,
  fieldName: string,
): BloodTestResultRecord[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an array.`);
  }

  if (value.length === 0) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must include at least one result.`);
  }

  if (value.length > 500) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} exceeds the maximum item count.`);
  }

  return value.map((entry, index) => normalizeBloodTestResult(entry, `${fieldName}[${index}]`));
}

function normalizeEncounterDiagnoses(
  value: unknown,
  fieldName: string,
): EncounterHistoryEventRecord["diagnoses"] {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} must be an array.`);
  }

  if (value.length === 0) {
    return undefined;
  }

  if (value.length > 50) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} exceeds the maximum item count.`);
  }

  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) {
      throw new VaultError("VAULT_INVALID_INPUT", `${fieldName}[${index}] must be an object.`);
    }

    return stripUndefined({
      text: requireString(entry.text, `${fieldName}[${index}].text`, 240),
      code: optionalString(entry.code, `${fieldName}[${index}].code`, 80),
      codeSystem: optionalString(entry.codeSystem, `${fieldName}[${index}].codeSystem`, 80),
      status: optionalEnum(
        entry.status,
        ["active", "inactive", "resolved", "history", "rule_out", "unknown"] as const,
        `${fieldName}[${index}].status`,
      ),
      certainty: optionalEnum(
        entry.certainty,
        ["documented", "suspected", "ruled_out", "unknown"] as const,
        `${fieldName}[${index}].certainty`,
      ),
      note: optionalString(entry.note, `${fieldName}[${index}].note`, 1000),
    });
  }) as EncounterHistoryEventRecord["diagnoses"];
}

function inferTestResultStatus(
  results: BloodTestResultRecord[] | undefined,
): TestResultStatus | undefined {
  if (!results || results.length === 0) {
    return undefined;
  }

  let hasNormal = false;
  let hasAbnormal = false;

  for (const result of results) {
    switch (result.flag) {
      case "normal":
        hasNormal = true;
        break;
      case "low":
      case "high":
      case "abnormal":
      case "critical":
        hasAbnormal = true;
        break;
      default:
        break;
    }
  }

  if (hasNormal && hasAbnormal) {
    return "mixed";
  }

  if (hasAbnormal) {
    return "abnormal";
  }

  if (hasNormal) {
    return "normal";
  }

  return undefined;
}

function normalizeEncounterHistoryFields(
  source: HistorySourceRecord,
): EncounterHistoryFields {
  return stripUndefined({
    encounterType: requireString(source.encounterType, "encounterType", 120),
    location: optionalString(source.location, "location", 160),
    providerId: optionalString(source.providerId, "providerId", 80),
    clinician: optionalString(source.clinician, "clinician", 160),
    facility: optionalString(source.facility, "facility", 160),
    reasonForVisit: optionalString(source.reasonForVisit, "reasonForVisit", 1000),
    assessmentText: optionalString(source.assessmentText, "assessmentText", 4000),
    planText: optionalString(source.planText, "planText", 4000),
    instructionsText: optionalString(source.instructionsText, "instructionsText", 4000),
    followUpText: optionalString(source.followUpText, "followUpText", 4000),
    diagnoses: normalizeEncounterDiagnoses(source.diagnoses, "diagnoses"),
  });
}

function normalizeProcedureHistoryFields(
  source: HistorySourceRecord,
): ProcedureHistoryFields {
  return stripUndefined({
    procedure: requireString(source.procedure, "procedure", 160),
    status: optionalEnum(source.status, PROCEDURE_STATUSES, "status") ?? "completed",
  });
}

function normalizeImmunizationHistoryFields(
  source: HistorySourceRecord,
): ImmunizationHistoryFields {
  return stripUndefined({
    vaccineName: requireString(source.vaccineName, "vaccineName", 160),
    manufacturer: optionalString(source.manufacturer, "manufacturer", 160),
    lotNumber: optionalString(source.lotNumber, "lotNumber", 120),
    route: optionalString(source.route, "route", 80),
    site: optionalString(source.site, "site", 80),
    series: optionalString(source.series, "series", 120),
    targetDiseases: validateSortedStringList(
      source.targetDiseases,
      "targetDiseases",
      "disease",
      25,
      120,
    ),
  });
}

function normalizeTestHistoryFields(source: HistorySourceRecord): TestHistoryFields {
  const results = normalizeBloodTestResults(
    source.results,
    "results",
  );
  const testCategory = normalizeToken(
    source.testCategory,
    "testCategory",
    64,
  );
  const specimenType = normalizeToken(
    source.specimenType,
    "specimenType",
    64,
  );
  const inferredResultStatus = inferTestResultStatus(results);
  const resultStatus =
    optionalEnum(source.resultStatus, TEST_STATUSES, "resultStatus") ?? inferredResultStatus ?? "unknown";

  return stripUndefined({
    testName: requireString(source.testName, "testName", 160),
    resultStatus,
    summary: optionalString(source.summary, "summary", 1000),
    testCategory,
    specimenType,
    labName: optionalString(source.labName, "labName", 160),
    labPanelId: optionalString(source.labPanelId, "labPanelId", 120),
    collectedAt: normalizeOptionalTimestamp(source.collectedAt, "collectedAt"),
    reportedAt: normalizeOptionalTimestamp(source.reportedAt, "reportedAt"),
    fastingStatus: optionalEnum(source.fastingStatus, BLOOD_TEST_FASTING_STATUSES, "fastingStatus"),
    results,
  });
}

function normalizeAdverseEffectHistoryFields(
  source: HistorySourceRecord,
): AdverseEffectHistoryFields {
  return stripUndefined({
    substance: requireString(source.substance, "substance", 160),
    effect: requireString(source.effect, "effect", 240),
    severity: optionalEnum(source.severity, ADVERSE_EFFECT_SEVERITIES, "severity") ?? "moderate",
  });
}

function normalizeExposureHistoryFields(
  source: HistorySourceRecord,
): ExposureHistoryFields {
  return stripUndefined({
    exposureType: requireString(source.exposureType ?? "unspecified", "exposureType", 120),
    substance: requireString(source.substance, "substance", 160),
    duration: optionalString(source.duration, "duration", 120),
  });
}

function requireClinicalAssertionType(value: unknown): ClinicalAssertionType {
  const assertion = optionalEnum(value, CLINICAL_ASSERTION_TYPES, "assertion");

  if (!assertion) {
    throw new VaultError("VAULT_INVALID_INPUT", "assertion is required.");
  }

  return assertion;
}

function normalizeRequiredDateOnly(value: unknown, fieldName: string): string {
  if (value === undefined || value === null || value === "") {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} is required.`);
  }

  return toDateOnly(value as Parameters<typeof toDateOnly>[0], fieldName);
}

function normalizeClinicalAssertionHistoryFields(
  source: HistorySourceRecord,
): ClinicalAssertionHistoryFields {
  return stripUndefined({
    assertion: requireClinicalAssertionType(source.assertion),
    domain: optionalEnum(source.domain, CLINICAL_ASSERTION_DOMAINS, "domain"),
    polarity: optionalEnum(source.polarity, CLINICAL_ASSERTION_POLARITIES, "polarity"),
    subject: optionalString(source.subject, "subject", 240),
    assertionText: optionalString(source.assertionText, "assertionText", 1000),
    bodySite: optionalString(source.bodySite, "bodySite", 120),
    code: optionalString(source.code, "code", 80),
    codeSystem: optionalString(source.codeSystem, "codeSystem", 80),
    assertedOn: normalizeRequiredDateOnly(source.assertedOn, "assertedOn"),
    sourceLabel: optionalString(source.sourceLabel, "sourceLabel", 240),
  });
}

function normalizeHistoryKindFields(
  kind: HistoryEventKind,
  source: HistorySourceRecord,
): HistoryKindFields {
  switch (kind) {
    case "encounter":
      return normalizeEncounterHistoryFields(source);
    case "procedure":
      return normalizeProcedureHistoryFields(source);
    case "immunization":
      return normalizeImmunizationHistoryFields(source);
    case "test":
      return normalizeTestHistoryFields(source);
    case "adverse_effect":
      return normalizeAdverseEffectHistoryFields(source);
    case "exposure":
      return normalizeExposureHistoryFields(source);
    case "clinical_assertion":
      return normalizeClinicalAssertionHistoryFields(source);
  }
}

function buildHistoryKindFields(input: AppendHistoryEventInput): HistoryKindFields {
  switch (input.kind) {
    case "encounter":
      return normalizeEncounterHistoryFields({
        encounterType: input.encounterType,
        location: input.location,
        providerId: input.providerId,
        clinician: input.clinician,
        facility: input.facility,
        reasonForVisit: input.reasonForVisit,
        assessmentText: input.assessmentText,
        planText: input.planText,
        instructionsText: input.instructionsText,
        followUpText: input.followUpText,
        diagnoses: input.diagnoses,
      });
    case "procedure":
      return normalizeProcedureHistoryFields({
        procedure: input.procedure,
        status: input.status,
      });
    case "immunization":
      return normalizeImmunizationHistoryFields({
        vaccineName: input.vaccineName,
        manufacturer: input.manufacturer,
        lotNumber: input.lotNumber,
        route: input.route,
        site: input.site,
        series: input.series,
        targetDiseases: input.targetDiseases,
      });
    case "test":
      return normalizeTestHistoryFields({
        testName: input.testName,
        resultStatus: input.resultStatus,
        summary: input.summary,
        testCategory: input.testCategory,
        specimenType: input.specimenType,
        labName: input.labName,
        labPanelId: input.labPanelId,
        collectedAt: input.collectedAt,
        reportedAt: input.reportedAt,
        fastingStatus: input.fastingStatus,
        results: input.results,
      });
    case "adverse_effect":
      return normalizeAdverseEffectHistoryFields({
        substance: input.substance,
        effect: input.effect,
        severity: input.severity,
      });
    case "exposure":
      return normalizeExposureHistoryFields({
        exposureType: input.exposureType,
        substance: input.substance,
        duration: input.duration,
      });
    case "clinical_assertion":
      return normalizeClinicalAssertionHistoryFields({
        assertion: input.assertion,
        domain: input.domain,
        polarity: input.polarity,
        subject: input.subject,
        assertionText: input.assertionText,
        bodySite: input.bodySite,
        code: input.code,
        codeSystem: input.codeSystem,
        assertedOn: input.assertedOn,
        sourceLabel: input.sourceLabel,
      });
  }
}

function normalizeHistoryRelationLinks({
  links,
  errorCode,
  errorMessage,
}: {
  links: unknown;
  errorCode: string;
  errorMessage: string;
}): HistoryEventRecord["links"] {
  return normalizeCanonicalEventLinks({
    value: links,
    errorCode,
    errorMessage,
  }) as HistoryEventRecord["links"];
}

function dateOnlyInputDayKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return isStrictIsoDate(trimmed) ? trimmed : undefined;
}

function buildHistoryEventRecord(
  input: AppendHistoryEventInput,
  fallbackTimeZone?: string,
): HistoryEventRecord {
  if (!HISTORY_KIND_SET.has(input.kind)) {
    throw new VaultError("VAULT_INVALID_INPUT", "Unsupported health history kind.");
  }

  const eventId = normalizeId(input.eventId, "eventId", ID_PREFIXES.event) ?? generateRecordId("event");
  const timeZone = normalizeTimeZone(input.timeZone ?? fallbackTimeZone);
  const occurredAt = normalizeTimestamp(input.occurredAt, "occurredAt");
  const recordedAt = normalizeTimestamp(input.recordedAt ?? occurredAt, "recordedAt");
  assertNoLegacyRelatedIds({
    value: Reflect.get(input, "relatedIds"),
    errorCode: "EVENT_INVALID",
    errorMessage: "History event relatedIds is no longer supported; use links.",
  });
  const relationLinks = normalizeHistoryRelationLinks({
    links: input.links,
    errorCode: "EVENT_INVALID",
    errorMessage: "History event links must contain objects with type and targetId fields.",
  });
  const baseRecord = buildEventSpineEnvelope({
    id: eventId,
    occurredAt,
    recordedAt,
    dayKey: dateOnlyInputDayKey(input.occurredAt),
    timeZone,
    fallbackTimeZone,
    source: optionalEnum(input.source ?? "manual", HEALTH_HISTORY_SOURCES, "source") ?? "manual",
    title: requireString(input.title, "title", EVENT_TITLE_MAX_LENGTH),
    note: optionalString(input.note, "note", 4000),
    tags: normalizeTagList(input.tags, "tags"),
    links: relationLinks,
    relationErrorCode: "EVENT_INVALID",
    relationErrorMessage: "History event links must contain objects with type and targetId fields.",
    rawRefs: normalizeRelativePathList(input.rawRefs, "rawRefs"),
    evidence: input.evidence,
    lifecycle: buildEventSpineLifecycle(1),
  });
  const record = stripUndefined({
    ...baseRecord,
    kind: input.kind,
    externalRef: input.externalRef,
    ...buildHistoryKindFields(input),
  });
  const result = safeParseContract(eventRecordSchema, record);

  if (!result.success) {
    throw new VaultError("EVENT_INVALID", "History event failed contract validation before write.", {
      errors: result.errors,
    });
  }

  return result.data as HistoryEventRecord;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredHistoryEvent(value: unknown): HistoryEventRecord | null {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    return null;
  }

  const kind = value.kind as HistoryEventKind;
  if (!HISTORY_KIND_SET.has(kind)) {
    return null;
  }

  const lifecycle = parseStoredEventSpineLifecycle(
    value.lifecycle,
    "VAULT_INVALID_HISTORY_EVENT",
    "Stored health history event has an invalid lifecycle.",
  );
  assertNoLegacyRelatedIds({
    value: value.relatedIds,
    errorCode: "VAULT_INVALID_HISTORY_EVENT",
    errorMessage: "Stored health history event uses deprecated relatedIds; use links.",
  });
  const relationLinks = normalizeHistoryRelationLinks({
    links: value.links,
    errorCode: "VAULT_INVALID_HISTORY_EVENT",
    errorMessage: "Stored health history event links must contain objects with type and targetId fields.",
  });

  const baseRecord = buildEventSpineEnvelope({
    schemaVersion: requireString(value.schemaVersion, "schemaVersion", 40) as HistoryEventRecord["schemaVersion"],
    id: requireString(value.id, "id", 64),
    occurredAt: normalizeTimestamp(value.occurredAt as string, "occurredAt"),
    recordedAt: normalizeTimestamp(value.recordedAt as string, "recordedAt"),
    dayKey: requireString(value.dayKey, "dayKey", 10),
    strictDayKey: true,
    invalidDayKeyCode: "VAULT_INVALID_HISTORY_EVENT",
    invalidDayKeyMessage: "Stored health history event has an invalid dayKey.",
    timeZone: normalizeTimeZone(optionalString(value.timeZone, "timeZone", 64)),
    source: optionalEnum(value.source, HEALTH_HISTORY_SOURCES, "source") ?? "manual",
    title: requireString(value.title, "title", EVENT_TITLE_MAX_LENGTH),
    note: optionalString(value.note, "note", 4000),
    tags: normalizeTagList(value.tags, "tags"),
    links: relationLinks,
    relationErrorCode: "VAULT_INVALID_HISTORY_EVENT",
    relationErrorMessage: "Stored health history event links must contain objects with type and targetId fields.",
    rawRefs: normalizeRelativePathList(value.rawRefs, "rawRefs"),
    evidence: Array.isArray(value.evidence) ? (value.evidence as HistoryEventRecord["evidence"]) : undefined,
    lifecycle,
  });
  const record = stripUndefined({
    ...baseRecord,
    kind,
    externalRef: value.externalRef,
    ...normalizeHistoryKindFields(kind, value),
  });
  const result = safeParseContract(eventRecordSchema, record);

  if (!result.success) {
    throw new VaultError("VAULT_INVALID_HISTORY_EVENT", "Stored health history event is malformed.", {
      errors: result.errors,
    });
  }

  return result.data as HistoryEventRecord;
}

async function loadStoredHistoryEntries(vaultRoot: string): Promise<StoredHistoryEventEntry[]> {
  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  const entries: StoredHistoryEventEntry[] = [];

  for (const relativePath of shardPaths) {
    const shardRecords = await readJsonlRecords({ vaultRoot, relativePath });

    for (const shardRecord of shardRecords) {
      const parsed = parseStoredHistoryEvent(shardRecord);
      if (!parsed) {
        continue;
      }

      entries.push({
        relativePath,
        record: parsed,
      });
    }
  }

  return entries;
}

async function historyEventIdExists(vaultRoot: string, eventId: string): Promise<boolean> {
  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });

  for (const relativePath of shardPaths) {
    const lines = (await readUtf8File(vaultRoot, relativePath)).split("\n").filter(Boolean);

    for (const line of lines) {
      let parsed: unknown;

      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (
        isPlainRecord(parsed)
        && parsed.id === eventId
        && typeof parsed.kind === "string"
        && HISTORY_KIND_SET.has(parsed.kind as HistoryEventKind)
      ) {
        return true;
      }
    }
  }

  return false;
}

function normalizeOrder(order: HistoryEventOrder | undefined): HistoryEventOrder {
  return optionalEnum(order ?? "desc", HISTORY_EVENT_ORDER, "order") ?? "desc";
}

function normalizeSourceFilter(source: HistoryEventSource | undefined): HistoryEventSource | undefined {
  if (source === undefined) {
    return undefined;
  }

  return optionalEnum(source, HEALTH_HISTORY_SOURCES, "source");
}

function normalizeKindFilter(kinds: HistoryEventKind[] | undefined): Set<HistoryEventKind> | null {
  if (kinds === undefined) {
    return null;
  }

  if (!Array.isArray(kinds) || kinds.length === 0) {
    return null;
  }

  const normalized = kinds.map((kind, index) => {
    const candidate = String(kind ?? "").trim();

    if (!HISTORY_KIND_SET.has(candidate as HistoryEventKind)) {
      throw new VaultError("VAULT_INVALID_INPUT", `kinds[${index}] is unsupported.`);
    }

    return candidate as HistoryEventKind;
  });

  return new Set(normalized);
}

function normalizeLimit(limit: number | undefined): number | null {
  if (limit === undefined || limit === null) {
    return null;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new VaultError("VAULT_INVALID_INPUT", "limit must be an integer between 1 and 500.");
  }

  return limit;
}

export async function appendHistoryEvent(
  input: AppendHistoryEventInput,
): Promise<AppendHistoryEventResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const requestedEventId = normalizeId(input.eventId, "eventId", ID_PREFIXES.event);
  const record = buildHistoryEventRecord(
    requestedEventId ? { ...input, eventId: requestedEventId } : input,
    vault.metadata.timezone,
  );
  const relativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    record.occurredAt,
    "occurredAt",
  );
  return runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "history_add",
    summary: `Append history event ${record.id}`,
    occurredAt: record.recordedAt,
    mutate: async ({ batch }) => {
      if (requestedEventId && (await historyEventIdExists(input.vaultRoot, requestedEventId))) {
        throw new VaultError(
          "VAULT_ALREADY_EXISTS",
          `History event "${requestedEventId}" already exists.`,
        );
      }

      await batch.stageJsonlAppend(relativePath, `${JSON.stringify(record)}\n`);
      const audit = await emitAuditRecord({
        vaultRoot: input.vaultRoot,
        batch,
        action: "history_add",
        commandName: "core.appendHistoryEvent",
        summary: `Appended ${record.kind} history event ${record.id}.`,
        occurredAt: record.recordedAt,
        targetIds: [record.id],
        changes: [
          {
            path: relativePath,
            op: "append",
          },
        ],
      });

      return {
        auditPath: audit.relativePath,
        relativePath,
        record,
      };
    },
  });
}

export async function appendBloodTest(
  input: AppendBloodTestInput,
): Promise<AppendBloodTestResult> {
  const result = await appendHistoryEvent({
    ...input,
    kind: "test",
    specimenType: input.specimenType ?? BLOOD_TEST_CATEGORY,
    testCategory: BLOOD_TEST_CATEGORY,
  });

  return {
    ...result,
    record: result.record as BloodTestHistoryEventRecord,
  };
}

export async function appendImmunization(
  input: AppendImmunizationInput,
): Promise<AppendImmunizationResult> {
  const result = await appendHistoryEvent({
    ...input,
    kind: "immunization",
  });

  return {
    ...result,
    record: result.record as ImmunizationHistoryEventRecord,
  };
}

function withEncounterLink(
  encounterId: string,
  links: EventRecord["links"],
): EventRecord["links"] {
  return [
    { type: "related_to", targetId: encounterId },
    ...(links ?? []),
  ];
}

function inheritedRawRefs(
  childRawRefs: string[] | undefined,
  encounter: EncounterHistoryEventRecord,
): string[] | undefined {
  return childRawRefs ?? encounter.rawRefs;
}

function requireEncounterBundleEventId(value: unknown, fieldName: string): string {
  const eventId = normalizeId(value, fieldName, ID_PREFIXES.event);
  if (!eventId) {
    throw new VaultError("VAULT_INVALID_INPUT", `${fieldName} is required.`);
  }

  return eventId;
}

function withInheritedEncounterDayKey<TRecord extends EventRecord>(
  record: TRecord,
  input: { occurredAt?: unknown },
  encounter: EncounterHistoryEventRecord,
): TRecord {
  return input.occurredAt === undefined ? { ...record, dayKey: encounter.dayKey } : record;
}

function buildEncounterMeasurementRecord(
  input: EncounterBundleMeasurementInput,
  encounter: EncounterHistoryEventRecord,
  eventIdFieldName: string,
  fallbackTimeZone?: string,
): MeasurementEventRecord {
  const record = buildTypedEventRecord(
    buildMeasurementEventDraft({
      id: requireEncounterBundleEventId(input.eventId, eventIdFieldName),
      occurredAt: input.occurredAt ?? encounter.occurredAt,
      recordedAt: input.recordedAt ?? encounter.recordedAt,
      timeZone: input.timeZone ?? encounter.timeZone,
      source: input.source ?? encounter.source,
      title: input.title ?? "Encounter vitals",
      note: input.note,
      tags: input.tags,
      links: withEncounterLink(encounter.id, input.links),
      rawRefs: inheritedRawRefs(input.rawRefs, encounter),
      evidence: input.evidence ?? encounter.evidence,
      externalRef: input.externalRef,
      measurements: input.measurements,
      media: input.media,
    }),
    fallbackTimeZone,
    buildEventSpineLifecycle(1),
  ) as MeasurementEventRecord;

  return withInheritedEncounterDayKey(record, input, encounter);
}

function buildEncounterProcedureRecord(
  input: EncounterBundleProcedureInput,
  encounter: EncounterHistoryEventRecord,
  vaultRoot: string,
  eventIdFieldName: string,
): ProcedureHistoryEventRecord {
  const record = buildHistoryEventRecord({
    vaultRoot,
    eventId: requireEncounterBundleEventId(input.eventId, eventIdFieldName),
    kind: "procedure",
    occurredAt: input.occurredAt ?? encounter.occurredAt,
    recordedAt: input.recordedAt ?? encounter.recordedAt,
    timeZone: input.timeZone ?? encounter.timeZone,
    source: input.source ?? encounter.source,
    title: input.title ?? generatedHistoryEventTitle("Procedure: ", input.procedure),
    note: input.note,
    tags: input.tags,
    links: withEncounterLink(encounter.id, input.links),
    rawRefs: inheritedRawRefs(input.rawRefs, encounter),
    evidence: input.evidence ?? encounter.evidence,
    procedure: input.procedure,
    status: input.status,
  }) as ProcedureHistoryEventRecord;

  return withInheritedEncounterDayKey(record, input, encounter);
}

function buildEncounterTestRecord(
  input: EncounterBundleTestInput,
  encounter: EncounterHistoryEventRecord,
  vaultRoot: string,
  eventIdFieldName: string,
): TestHistoryEventRecord {
  const record = buildHistoryEventRecord({
    vaultRoot,
    eventId: requireEncounterBundleEventId(input.eventId, eventIdFieldName),
    kind: "test",
    occurredAt: input.occurredAt ?? encounter.occurredAt,
    recordedAt: input.recordedAt ?? encounter.recordedAt,
    timeZone: input.timeZone ?? encounter.timeZone,
    source: input.source ?? encounter.source,
    title: input.title ?? generatedHistoryEventTitle("Test: ", input.testName),
    note: input.note,
    tags: input.tags,
    links: withEncounterLink(encounter.id, input.links),
    rawRefs: inheritedRawRefs(input.rawRefs, encounter),
    evidence: input.evidence ?? encounter.evidence,
    testName: input.testName,
    resultStatus: input.resultStatus,
    summary: input.summary,
    testCategory: input.testCategory,
    specimenType: input.specimenType,
    labName: input.labName,
    labPanelId: input.labPanelId,
    collectedAt: input.collectedAt,
    reportedAt: input.reportedAt,
    fastingStatus: input.fastingStatus,
    results: input.results,
  }) as TestHistoryEventRecord;

  return withInheritedEncounterDayKey(record, input, encounter);
}

async function assertBundleEventIdsAreAvailable(
  vaultRoot: string,
  records: readonly EventRecord[],
): Promise<void> {
  const requestedIds = new Set<string>();

  for (const record of records) {
    if (requestedIds.has(record.id)) {
      throw new VaultError("VAULT_INVALID_INPUT", `Encounter bundle contains duplicate event id "${record.id}".`);
    }
    requestedIds.add(record.id);
  }

  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  for (const relativePath of shardPaths) {
    const storedRecords = await readJsonlRecords({ vaultRoot, relativePath });
    for (const storedRecord of storedRecords) {
      if (
        isPlainRecord(storedRecord)
        && typeof storedRecord.id === "string"
        && requestedIds.has(storedRecord.id)
      ) {
        throw new VaultError("VAULT_ALREADY_EXISTS", `Event "${storedRecord.id}" already exists.`);
      }
    }
  }
}

function uniqueLedgerFiles(records: readonly EventRecord[]): string[] {
  return [
    ...new Set(
      records.map((record) =>
        toMonthlyShardRelativePath(
          VAULT_LAYOUT.eventLedgerDirectory,
          record.occurredAt,
          "occurredAt",
        ),
      ),
    ),
  ];
}

export async function saveEncounterBundle(
  input: SaveEncounterBundleInput,
): Promise<SaveEncounterBundleResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const encounter = buildHistoryEventRecord({
    ...input.encounter,
    eventId: requireEncounterBundleEventId(input.encounter.eventId, "encounter.eventId"),
    vaultRoot: input.vaultRoot,
    kind: "encounter",
  }, vault.metadata.timezone) as EncounterHistoryEventRecord;
  const childEvents: EventRecord[] = [
    ...(input.measurements ?? []).map((entry, index) =>
      buildEncounterMeasurementRecord(
        entry,
        encounter,
        `measurements[${index}].eventId`,
        vault.metadata.timezone,
      ),
    ),
    ...(input.procedures ?? []).map((entry, index) =>
      buildEncounterProcedureRecord(
        entry,
        encounter,
        input.vaultRoot,
        `procedures[${index}].eventId`,
      ),
    ),
    ...(input.tests ?? []).map((entry, index) =>
      buildEncounterTestRecord(
        entry,
        encounter,
        input.vaultRoot,
        `tests[${index}].eventId`,
      ),
    ),
  ];
  const records: EventRecord[] = [encounter, ...childEvents];
  const ledgerFiles = uniqueLedgerFiles(records);

  return runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: "encounter_bundle_save",
    summary: `Save encounter bundle ${encounter.id}`,
    occurredAt: encounter.recordedAt,
    mutate: async ({ batch }) => {
      await assertBundleEventIdsAreAvailable(input.vaultRoot, records);

      for (const record of records) {
        const relativePath = toMonthlyShardRelativePath(
          VAULT_LAYOUT.eventLedgerDirectory,
          record.occurredAt,
          "occurredAt",
        );
        await batch.stageJsonlAppend(relativePath, `${JSON.stringify(record)}\n`);
      }

      const audit = await emitAuditRecord({
        vaultRoot: input.vaultRoot,
        batch,
        action: "history_add",
        commandName: "core.saveEncounterBundle",
        summary: `Saved encounter bundle ${encounter.id} with ${childEvents.length} linked event(s).`,
        occurredAt: encounter.recordedAt,
        targetIds: records.map((record) => record.id),
        changes: ledgerFiles.map((relativePath) => ({
          path: relativePath,
          op: "append",
        })),
      });

      return {
        auditPath: audit.relativePath,
        encounter,
        events: records,
        ledgerFiles,
      };
    },
  });
}

export async function listHistoryEvents({
  vaultRoot,
  kinds,
  source,
  from,
  to,
  order = "desc",
  limit,
}: ListHistoryEventsInput): Promise<HistoryEventRecord[]> {
  const kindFilter = normalizeKindFilter(kinds);
  const sourceFilter = normalizeSourceFilter(source);
  const normalizedOrder = normalizeOrder(order);
  const normalizedLimit = normalizeLimit(limit);
  const fromTimestamp = from ? normalizeTimestamp(from, "from") : null;
  const toTimestamp = to ? normalizeTimestamp(to, "to") : null;
  const records: HistoryEventRecord[] = [];
  const latestEntries = collapseEventSpineEntries(await loadStoredHistoryEntries(vaultRoot));

  for (const { record } of latestEntries) {
    if (kindFilter && !kindFilter.has(record.kind)) {
      continue;
    }

    if (sourceFilter && record.source !== sourceFilter) {
      continue;
    }

    if (fromTimestamp && record.occurredAt < fromTimestamp) {
      continue;
    }

    if (toTimestamp && record.occurredAt > toTimestamp) {
      continue;
    }

    records.push(record);
  }

  records.sort((left, right) => compareIsoTimestamps(left, right, normalizedOrder));

  return normalizedLimit ? records.slice(0, normalizedLimit) : records;
}

export async function readCanonicalEventAvailabilityInterruptible(
  input: ReadCanonicalEventAvailabilityInput,
): Promise<CanonicalEventAvailabilitySummary> {
  const shouldContinue = () =>
    !input.signal?.aborted && input.shouldContinue?.() !== false;
  const walked = await walkVaultFilesInterruptible(
    input.vaultRoot,
    VAULT_LAYOUT.eventLedgerDirectory,
    {
      extension: ".jsonl",
      shouldContinue,
    },
  );
  if (walked.interrupted) {
    return interruptedCanonicalEventAvailability();
  }

  const latestByEventId = new Map<string, StoredAvailabilityEventEntry>();
  for (const relativePath of walked.relativePaths) {
    const read = await visitJsonlRecordsInterruptible({
      relativePath,
      shouldContinue,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
      visit: (shardRecord) => {
        let spineRecord: StoredAvailabilitySpineRecord | null;
        try {
          spineRecord = parseStoredAvailabilitySpineRecord(shardRecord);
        } catch (error) {
          if (storedEventMayContributeToCanonicalAvailability(shardRecord)) {
            throw error;
          }
          return;
        }
        if (!spineRecord) {
          if (storedEventMayContributeToCanonicalAvailability(shardRecord)) {
            throw new VaultError(
              "EVENT_CONTRACT_INVALID",
              "Stored availability event record has an invalid event spine.",
            );
          }
          return;
        }

        const candidate = {
          relativePath,
          record: spineRecord,
          value: shardRecord,
        };
        const current = latestByEventId.get(spineRecord.id);
        if (!current || compareEventSpineEntries(current, candidate) < 0) {
          latestByEventId.set(spineRecord.id, candidate);
        }
      },
    });
    if (read.interrupted) {
      return interruptedCanonicalEventAvailability();
    }
  }

  let latestBloodPressureMeasurementDayKey: string | null = null;
  let latestBloodPressureMeasurementOccurredAt: string | null = null;
  let latestBloodTestOccurredAt: string | null = null;
  let latestBodyMeasurementDayKey: string | null = null;
  let latestBodyMeasurementOccurredAt: string | null = null;
  for (const candidate of latestByEventId.values()) {
    if (!shouldContinue()) {
      return interruptedCanonicalEventAvailability();
    }
    if (isDeletedEventSpineRecord(candidate.record)) {
      continue;
    }

    const storedHistoryRecord = parseStoredHistoryEvent(candidate.value);
    let record: EventRecord;
    let providerBodyObservation = false;
    if (storedHistoryRecord) {
      record = storedHistoryRecord;
    } else {
      const normalizedStoredRecord = normalizeStoredAvailabilityEvent(
        candidate.value,
      );
      const parsed = safeParseContract(eventRecordSchema, normalizedStoredRecord);
      if (parsed.success) {
        record = parsed.data;
        providerBodyObservation = record.kind === "observation"
          && record.externalRef !== undefined;
      } else {
        const legacyBodyObservation =
          parseStoredProviderBodyAvailabilityEvent(normalizedStoredRecord);
        if (!legacyBodyObservation) {
          if (storedEventMayContributeToCanonicalAvailability(
            normalizedStoredRecord,
          )) {
            throw new VaultError(
              "EVENT_CONTRACT_INVALID",
              "Stored availability event record is invalid.",
              { errors: parsed.errors },
            );
          }
          continue;
        }
        record = legacyBodyObservation;
        providerBodyObservation = true;
      }
    }

    if (
      record.kind === "test"
      && isBloodTestHistoryRecord(record)
      && (
        latestBloodTestOccurredAt === null
        || record.occurredAt > latestBloodTestOccurredAt
      )
    ) {
      latestBloodTestOccurredAt = record.occurredAt;
    }
    if (
      canonicalEventContainsBodyMeasurement(record, providerBodyObservation)
      && (
        latestBodyMeasurementOccurredAt === null
        || record.occurredAt > latestBodyMeasurementOccurredAt
        || (
          record.occurredAt === latestBodyMeasurementOccurredAt
          && (
            latestBodyMeasurementDayKey === null
            || record.dayKey > latestBodyMeasurementDayKey
          )
        )
      )
    ) {
      latestBodyMeasurementOccurredAt = record.occurredAt;
      latestBodyMeasurementDayKey = record.dayKey;
    }
    if (
      canonicalEventContainsPairedBloodPressure(record)
      && (
        latestBloodPressureMeasurementOccurredAt === null
        || record.occurredAt > latestBloodPressureMeasurementOccurredAt
      )
    ) {
      latestBloodPressureMeasurementOccurredAt = record.occurredAt;
      latestBloodPressureMeasurementDayKey = record.dayKey;
    }
  }

  return {
    interrupted: false,
    latestBloodPressureMeasurementDayKey,
    latestBloodPressureMeasurementOccurredAt,
    latestBloodTestOccurredAt,
    latestBodyMeasurementDayKey,
    latestBodyMeasurementOccurredAt,
  };
}

function canonicalEventContainsBodyMeasurement(
  record: EventRecord,
  providerBodyObservation = false,
): boolean {
  if (record.kind === "observation") {
    return isCanonicalBodyMeasurementMetric(record.metric)
      && (providerBodyObservation || record.externalRef !== undefined)
      && (
        record.observationGrain === undefined
        || record.observationGrain === "summary"
      );
  }
  if (record.kind === "measurement") {
    return record.measurements.some((measurement) =>
      isCanonicalBodyMeasurementMetric(measurement.metric)
    );
  }
  if (record.kind === "body_measurement") {
    return record.measurements.some((measurement) =>
      CANONICAL_BODY_MEASUREMENT_TYPES.has(measurement.type)
    );
  }
  return false;
}

function parseStoredAvailabilitySpineRecord(
  value: unknown,
): StoredAvailabilitySpineRecord | null {
  if (
    !isPlainRecord(value)
    || typeof value.id !== "string"
    || typeof value.occurredAt !== "string"
    || typeof value.recordedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    occurredAt: value.occurredAt,
    recordedAt: value.recordedAt,
    lifecycle: parseStoredEventSpineLifecycle(
      value.lifecycle,
      "EVENT_CONTRACT_INVALID",
      "Stored availability event record has an invalid lifecycle.",
    ),
  };
}

function isCanonicalBodyMeasurementMetric(metric: string): boolean {
  const canonicalMetricKey = resolveWearableCanonicalMetricKey(metric);
  return canonicalMetricKey !== null
    && CANONICAL_BODY_MEASUREMENT_METRIC_KEYS.has(canonicalMetricKey);
}

function normalizeStoredAvailabilityEvent(value: unknown): unknown {
  if (
    !isPlainRecord(value)
    || value.kind !== "observation"
    || typeof value.observationGrain !== "string"
    || typeof value.metric !== "string"
    || !isCanonicalBodyMeasurementMetric(value.metric)
    || !isPlainRecord(value.externalRef)
    || typeof value.externalRef.system !== "string"
  ) {
    return value;
  }

  const observationGrain = value.observationGrain
    .trim()
    .toLowerCase()
    .replace(/_/gu, "-");
  if (!STORED_DAY_GRAIN_OBSERVATION_ALIASES.has(observationGrain)) {
    return value;
  }

  // The query read model has always treated these persisted provider-day
  // spellings as summary grain. Normalize only relevant provider body rows at
  // this stored-read boundary; current writes remain constrained by the
  // current event contract.
  return {
    ...value,
    observationGrain: "summary",
  };
}

function parseStoredProviderBodyAvailabilityEvent(
  value: unknown,
): EventRecord | null {
  if (
    !isPlainRecord(value)
    || value.kind !== "observation"
    || typeof value.metric !== "string"
    || !isCanonicalBodyMeasurementMetric(value.metric)
    || !isPlainRecord(value.externalRef)
    || typeof value.externalRef.system !== "string"
    || value.externalRef.system.trim().length === 0
    || !isNullableStoredProvenanceText(value.externalRef.resourceType)
    || !isNullableStoredProvenanceText(value.externalRef.resourceId)
  ) {
    return null;
  }

  const { externalRef: _legacyExternalRef, ...withoutExternalRef } = value;
  const parsed = safeParseContract(eventRecordSchema, withoutExternalRef);
  return parsed.success && parsed.data.kind === "observation"
    ? parsed.data
    : null;
}

function isNullableStoredProvenanceText(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === "string" && value.trim().length > 0);
}

function storedEventMayContributeToCanonicalAvailability(
  value: unknown,
): boolean {
  if (!isPlainRecord(value)) {
    return false;
  }

  if (value.kind === "body_measurement") {
    return true;
  }
  if (value.kind === "observation") {
    return typeof value.metric === "string"
      && isCanonicalBodyMeasurementMetric(value.metric);
  }
  if (value.kind === "test") {
    return value.testCategory === BLOOD_TEST_CATEGORY
      || (
        typeof value.specimenType === "string"
        && KNOWN_BLOOD_TEST_SPECIMEN_TYPES.has(value.specimenType)
      );
  }
  if (value.kind !== "measurement" || !Array.isArray(value.measurements)) {
    return false;
  }

  return value.measurements.some((measurement) => {
    if (!isPlainRecord(measurement) || typeof measurement.metric !== "string") {
      return false;
    }
    return isCanonicalBodyMeasurementMetric(measurement.metric)
      || measurement.metric === "systolic-blood-pressure"
      || measurement.metric === "diastolic-blood-pressure";
  });
}

function canonicalEventContainsPairedBloodPressure(record: EventRecord): boolean {
  if (record.kind !== "measurement") {
    return false;
  }
  const metrics = new Set(record.measurements.map((measurement) => measurement.metric));
  return metrics.has("systolic-blood-pressure")
    && metrics.has("diastolic-blood-pressure");
}

function interruptedCanonicalEventAvailability(): CanonicalEventAvailabilitySummary {
  return {
    interrupted: true,
    latestBloodPressureMeasurementDayKey: null,
    latestBloodPressureMeasurementOccurredAt: null,
    latestBloodTestOccurredAt: null,
    latestBodyMeasurementDayKey: null,
    latestBodyMeasurementOccurredAt: null,
  };
}

export async function readHistoryEvent({
  vaultRoot,
  eventId,
}: ReadHistoryEventInput): Promise<ReadHistoryEventResult> {
  const normalizedEventId = normalizeId(eventId, "eventId", ID_PREFIXES.event);

  if (!normalizedEventId) {
    throw new VaultError("VAULT_INVALID_INPUT", "eventId is required.");
  }

  const latestEntry = collapseEventSpineEntries(await loadStoredHistoryEntries(vaultRoot)).find(
    ({ record }) => record.id === normalizedEventId,
  );

  if (latestEntry) {
    return latestEntry;
  }

  throw new VaultError("VAULT_HISTORY_EVENT_MISSING", "Health history event was not found.");
}

export function isBloodTestHistoryRecord(record: Pick<TestHistoryEventRecord, "kind" | "testCategory" | "specimenType">) {
  return (
    record.kind === "test" &&
    (record.testCategory === BLOOD_TEST_CATEGORY ||
      (typeof record.specimenType === "string" && KNOWN_BLOOD_TEST_SPECIMEN_TYPES.has(record.specimenType)))
  );
}
