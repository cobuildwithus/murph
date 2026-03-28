import {
  BLOOD_TEST_CATEGORY,
  BLOOD_TEST_FASTING_STATUSES,
  BLOOD_TEST_RESULT_FLAGS,
  BLOOD_TEST_SPECIMEN_TYPES,
  eventRecordSchema,
  safeParseContract,
} from "@murph/contracts";

import type {
  BloodTestReferenceRange,
  BloodTestResultRecord,
} from "@murph/contracts";
import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.ts";
import { emitAuditRecord } from "../audit.ts";
import { VaultError } from "../errors.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "../jsonl.ts";
import { generateRecordId } from "../ids.ts";
import { runCanonicalWrite } from "../operations/index.ts";
import { defaultTimeZone, normalizeTimeZone, toLocalDayKey } from "../time.ts";
import { walkVaultFiles } from "../fs.ts";
import { loadVault } from "../vault.ts";

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
  BloodTestHistoryEventRecord,
  EncounterHistoryEventRecord,
  ExposureHistoryEventRecord,
  HistoryEventKind,
  HistoryEventOrder,
  HistoryEventRecord,
  HistoryEventSource,
  ListHistoryEventsInput,
  ProcedureHistoryEventRecord,
  ReadHistoryEventInput,
  ReadHistoryEventResult,
  TestHistoryEventRecord,
  TestResultStatus,
} from "./types.ts";

const HISTORY_KIND_SET = new Set<HistoryEventKind>(HEALTH_HISTORY_KINDS);
const BLOOD_TEST_RESULT_COMPARATORS = ["<", "<=", ">", ">="] as const;
const KNOWN_BLOOD_TEST_SPECIMEN_TYPES = new Set<string>(BLOOD_TEST_SPECIMEN_TYPES);

type HistorySourceRecord = Record<string, unknown>;

type EncounterHistoryFields = Pick<
  EncounterHistoryEventRecord,
  "encounterType" | "location" | "providerId"
>;
type ProcedureHistoryFields = Pick<
  ProcedureHistoryEventRecord,
  "procedure" | "status"
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
type HistoryKindFields =
  | EncounterHistoryFields
  | ProcedureHistoryFields
  | TestHistoryFields
  | AdverseEffectHistoryFields
  | ExposureHistoryFields;

function normalizeBaseEvent(
  input: AppendHistoryEventInput,
  fallbackTimeZone?: string,
) {
  const occurredAt = normalizeTimestamp(input.occurredAt, "occurredAt");
  const recordedAt = normalizeTimestamp(input.recordedAt ?? occurredAt, "recordedAt");
  const eventId = normalizeId(input.eventId, "eventId", ID_PREFIXES.event) ?? generateRecordId("event");
  const timeZone = normalizeTimeZone(input.timeZone ?? fallbackTimeZone);

  return {
    schemaVersion: "murph.event.v1" as const,
    id: eventId,
    kind: input.kind,
    occurredAt,
    recordedAt,
    dayKey: toLocalDayKey(occurredAt, timeZone ?? defaultTimeZone(), "occurredAt"),
    timeZone,
    source: optionalEnum(input.source ?? "manual", HEALTH_HISTORY_SOURCES, "source") ?? "manual",
    title: requireString(input.title, "title", 160),
    note: optionalString(input.note, "note", 4000),
    tags: normalizeTagList(input.tags, "tags"),
    relatedIds: validateSortedStringList(input.relatedIds, "relatedIds", "id", 32, 80),
    rawRefs: normalizeRelativePathList(input.rawRefs, "rawRefs"),
  };
}

function stripUndefined<TRecord>(record: TRecord): TRecord {
  return Object.fromEntries(
    Object.entries(record as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as TRecord;
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

function normalizeOptionalTimestamp(value: unknown, fieldName: string): string | undefined {
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

function normalizeTestHistoryFields(
  source: HistorySourceRecord,
): TestHistoryFields {
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

function normalizeHistoryKindFields(
  kind: HistoryEventKind,
  source: HistorySourceRecord,
): HistoryKindFields {
  switch (kind) {
    case "encounter":
      return normalizeEncounterHistoryFields(source);
    case "procedure":
      return normalizeProcedureHistoryFields(source);
    case "test":
      return normalizeTestHistoryFields(source);
    case "adverse_effect":
      return normalizeAdverseEffectHistoryFields(source);
    case "exposure":
      return normalizeExposureHistoryFields(source);
  }
}

function buildHistoryKindFields(input: AppendHistoryEventInput): HistoryKindFields {
  switch (input.kind) {
    case "encounter":
      return normalizeEncounterHistoryFields({
        encounterType: input.encounterType,
        location: input.location,
        providerId: input.providerId,
      });
    case "procedure":
      return normalizeProcedureHistoryFields({
        procedure: input.procedure,
        status: input.status,
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
  }
}

function buildHistoryEventRecord(
  input: AppendHistoryEventInput,
  fallbackTimeZone?: string,
): HistoryEventRecord {
  if (!HISTORY_KIND_SET.has(input.kind)) {
    throw new VaultError("VAULT_INVALID_INPUT", "Unsupported health history kind.");
  }

  const baseRecord = normalizeBaseEvent(input, fallbackTimeZone);
  const record = stripUndefined({
    ...baseRecord,
    kind: input.kind,
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

  const baseRecord = {
    schemaVersion: requireString(value.schemaVersion, "schemaVersion", 40) as "murph.event.v1",
    id: requireString(value.id, "id", 64),
    kind: value.kind as HistoryEventKind,
    occurredAt: normalizeTimestamp(value.occurredAt as string, "occurredAt"),
    recordedAt: normalizeTimestamp(value.recordedAt as string, "recordedAt"),
    dayKey: requireString(value.dayKey, "dayKey", 10),
    timeZone: normalizeTimeZone(optionalString(value.timeZone, "timeZone", 64)),
    source: optionalEnum(value.source, HEALTH_HISTORY_SOURCES, "source") ?? "manual",
    title: requireString(value.title, "title", 160),
    note: optionalString(value.note, "note", 4000),
    tags: normalizeTagList(value.tags, "tags"),
    relatedIds: validateSortedStringList(value.relatedIds, "relatedIds", "id", 32, 80),
    rawRefs: normalizeRelativePathList(value.rawRefs, "rawRefs"),
  };
  const record = stripUndefined({
    ...baseRecord,
    kind,
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
  const record = buildHistoryEventRecord(input, vault.metadata.timezone);
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
  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });

  const records: HistoryEventRecord[] = [];

  for (const relativePath of shardPaths) {
    const shardRecords = await readJsonlRecords({ vaultRoot, relativePath });

    for (const shardRecord of shardRecords) {
      const parsed = parseStoredHistoryEvent(shardRecord);

      if (!parsed) {
        continue;
      }

      if (kindFilter && !kindFilter.has(parsed.kind)) {
        continue;
      }

      if (sourceFilter && parsed.source !== sourceFilter) {
        continue;
      }

      if (fromTimestamp && parsed.occurredAt < fromTimestamp) {
        continue;
      }

      if (toTimestamp && parsed.occurredAt > toTimestamp) {
        continue;
      }

      records.push(parsed);
    }
  }

  records.sort((left, right) => compareIsoTimestamps(left, right, normalizedOrder));

  return normalizedLimit ? records.slice(0, normalizedLimit) : records;
}

export async function readHistoryEvent({
  vaultRoot,
  eventId,
}: ReadHistoryEventInput): Promise<ReadHistoryEventResult> {
  const normalizedEventId = normalizeId(eventId, "eventId", ID_PREFIXES.event);

  if (!normalizedEventId) {
    throw new VaultError("VAULT_INVALID_INPUT", "eventId is required.");
  }

  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });

  for (const relativePath of shardPaths) {
    const shardRecords = await readJsonlRecords({ vaultRoot, relativePath });

    for (const shardRecord of shardRecords) {
      if (!isPlainRecord(shardRecord) || shardRecord.id !== normalizedEventId) {
        continue;
      }

      const parsed = parseStoredHistoryEvent(shardRecord);

      if (!parsed) {
        throw new VaultError("VAULT_INVALID_HISTORY_EVENT", "Stored health history event is malformed.");
      }

      return {
        relativePath,
        record: parsed,
      };
    }
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
