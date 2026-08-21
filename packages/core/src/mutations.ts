import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

import type {
  ContractSchema,
  DeviceDataOrigin,
  DocumentEventRecord,
  EventAttachment,
  EventImportDecision,
  EventImportRetractionDecision,
  EventImportUpsertDecision,
  ExternalRef,
  EventKind,
  EventRecord,
  EventSource,
  ExperimentEventRecord,
  JournalDayFrontmatter,
  MealNutrition,
  SampleQuality,
  SampleRecord,
  SampleSource,
  SampleStream,
  IntegrationIngestReceipt,
  IntegrationIngestRecord,
} from "@murphai/contracts";
import {
  auditRecordSchema,
  assertContractId,
  collectEventRawReferencePaths,
  compareIsoTimestampsAscending,
  deviceDataOriginSchema,
  experimentFrontmatterSchema,
  externalRefSchema,
  journalDayFrontmatterSchema,
  eventRecordSchema,
  eventImportDecisionSchema,
  isWritableIsoDateTime,
  resolveFloatingIsoTimestampInTimeZone,
  safeParseContract,
  sampleRecordSchema,
} from "@murphai/contracts";

import {
  BASELINE_EVENT_KINDS,
  BASELINE_SAMPLE_STREAMS,
  EVENT_SCHEMA_VERSION,
  EVENT_SOURCES,
  FRONTMATTER_SCHEMA_VERSIONS,
  ID_PREFIXES,
  SAMPLE_QUALITIES,
  SAMPLE_SCHEMA_VERSION,
  SAMPLE_SOURCES,
  VAULT_LAYOUT,
} from "./constants.ts";
import { emitAuditRecord } from "./audit.ts";
import {
  prepareEventAttachments,
  stagePreparedEventAttachmentsInBatch,
} from "./event-attachments.ts";
import {
  assertNoLegacyRelatedIds,
  normalizeCanonicalEventLinks,
} from "./event-links.ts";
import { VaultError } from "./errors.ts";
import {
  pathExists,
  readUtf8File,
  walkVaultFiles,
  walkVaultFilesInterruptible,
  writeVaultTextFile,
} from "./fs.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.ts";
import { deterministicContractId, generateRecordId } from "./ids.ts";
import {
  readJsonlRecords,
  toMonthlyShardRelativePath,
  visitJsonlRecordsInterruptible,
} from "./jsonl.ts";
import {
  buildEventSpineLifecycle,
  collapseEventSpineEntries,
  compareEventSpineEntries,
  eventSpineRevision,
  isDeletedEventSpineRecord,
  selectLatestEventSpineEntry,
  type EventSpineEntry,
} from "./history/event-spine.ts";
import {
  buildEventImportDecisionRecord,
  buildPublicEventImportRecord,
  loadEventLedgerShardsById,
  selectLatestMatchedEvent,
  toEventLedgerFile,
} from "./domains/events/ledger.ts";
import {
  normalizeMealNutrition,
} from "./nutrition.ts";
import {
  parseRawImportManifest,
  resolveRawManifestPath,
  stageRawImportManifest,
} from "./operations/raw-manifests.ts";
import {
  runCanonicalWrite,
  type CommittedPayloadReceipt,
  type WriteBatch,
} from "./operations/write-batch.ts";
import { assertCanonicalWriteLockScope } from "./operations/canonical-write-lock.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { sanitizePathSegment } from "./path-safety.ts";
import {
  prepareInlineRawArtifact,
  prepareRawArtifact,
  rawDirectoryMatchesOwner,
  resolveRawAssetDirectory,
} from "./raw.ts";
import {
  buildIntegrationEvidencePart,
  buildIntegrationIngestAppendPlan,
  buildIntegrationIngestAppendPlanFromInspection,
  buildIntegrationIngestRecord,
  stageIntegrationIngestAppendPlan,
  compactIntegrationIngestReceipt,
  inspectIntegrationIngestIdsForImportedAt,
  selectNovelIntegrationIngestEvidence,
  type IntegrationIngestAppendPlan,
} from "./integration-ingests.ts";
import type { IntegrationEvidencePart, IntegrationIngestEventOutput } from "@murphai/contracts";
import { normalizeUniqueTextList } from "./bank/shared.ts";
import {
  defaultTimeZone,
  normalizeTimeZone,
  toIsoTimestamp,
  toLocalDayKey,
} from "./time.ts";
import { loadVault } from "./vault.ts";
import { statAndHashVaultFile } from "./raw-artifact-integrity.ts";

import type { PreparedEventAttachment } from "./event-attachments.ts";
import type { RawArtifact } from "./raw.ts";
import type { DateInput, UnknownRecord } from "./types.ts";

type EventRecordByKind<K extends EventKind> = Extract<EventRecord, { kind: K }>;
type LooseRecord = Record<string, unknown>;

const DENSE_DEVICE_TELEMETRY_NOT_ALLOWED_CODE = "VAULT_DENSE_DEVICE_TELEMETRY_NOT_ALLOWED";
const DENSE_DEVICE_SAMPLES_NOT_ALLOWED_LEGACY_CODE = "VAULT_DENSE_DEVICE_SAMPLES_NOT_ALLOWED";
const MAX_JUNCTION_DAILY_ALIAS_REPAIR_REVISIONS = 64;

const RESERVED_DEVICE_EVENT_FIELD_NAMES = new Set([
  "schemaVersion",
  "id",
  "kind",
  "occurredAt",
  "recordedAt",
  "dayKey",
  "timeZone",
  "source",
  "title",
  "note",
  "tags",
  "links",
  "rawRefs",
  "externalRef",
  "dataOrigin",
  "lifecycle",
  "attachments",
  "canonicalFact",
  "queryVisibility",
  "visibility",
]);

interface EnsureJournalDayInput {
  vaultRoot: string;
  date?: DateInput;
}

interface EnsureJournalDayResult {
  created: boolean;
  relativePath: string;
  auditPath?: string;
}

interface CreateExperimentInput {
  vaultRoot: string;
  slug: string;
  title?: string;
  hypothesis?: string;
  startedOn?: DateInput;
  status?: string;
}

interface CreateExperimentResult {
  created: boolean;
  experiment: {
    id: string;
    slug: string;
    relativePath: string;
  };
  event: ExperimentEventRecord | null;
  auditPath: string | null;
}

interface ImportDocumentInput {
  vaultRoot: string;
  sourcePath: string;
  occurredAt?: DateInput;
  title?: string;
  note?: string;
  source?: string;
  reuseExact?: boolean;
}

interface ImportDocumentResult {
  created: boolean;
  documentId: string;
  raw: RawArtifact;
  event: DocumentEventRecord;
  eventPath: string;
  auditPath: string | null;
  manifestPath: string;
}

interface AddMealInput {
  vaultRoot: string;
  mealId?: string;
  eventId?: string;
  occurredAt?: DateInput;
  note?: string;
  photoPath?: string;
  audioPath?: string;
  ingredients?: string[];
  nutrition?: MealNutrition;
  source?: string;
  tags?: string[];
  externalRef?: ExternalRef;
}

interface AddMealResult {
  mealId: string;
  event: EventRecordByKind<"meal">;
  eventPath: string;
  photo: RawArtifact | null;
  audio: RawArtifact | null;
  auditPath: string;
  manifestPath: string;
}

interface SampleImportBatchProvenance {
  sourceFileName?: string;
  importConfig?: {
    presetId?: string;
    delimiter: string;
    tsColumn: string;
    valueColumn: string;
    metadataColumns?: string[];
  };
  rowCount?: number;
  skippedCount?: number;
  skipReasons?: Array<{ count: number; reason: string }>;
}

interface SampleInputRecord extends LooseRecord {
  occurredAt?: DateInput;
  recordedAt?: DateInput;
  value?: unknown;
  stage?: unknown;
  startAt?: DateInput;
  endAt?: DateInput;
  durationMinutes?: unknown;
}

interface ImportSamplesInput {
  vaultRoot: string;
  stream: string;
  unit: string;
  samples: SampleInputRecord[];
  sourcePath?: string;
  source?: string;
  quality?: string;
  batchProvenance?: SampleImportBatchProvenance;
}

interface ImportSamplesResult {
  count: number;
  records: SampleRecord[];
  shardPaths: string[];
  raw: RawArtifact | null;
  transformId: string;
  auditPath: string;
  manifestPath: string;
}

interface DeviceEvidencePartInput extends LooseRecord {
  role?: string;
  fileName?: string;
  mediaType?: string;
  content?: unknown;
  metadata?: unknown;
}

interface DeviceEventInput extends LooseRecord {
  kind?: string;
  occurredAt?: DateInput;
  recordedAt?: DateInput;
  dayKey?: string;
  timeZone?: string;
  source?: string;
  title?: string;
  note?: string;
  tags?: unknown;
  links?: unknown;
  evidenceRoles?: unknown;
  externalRef?: unknown;
  externalRefUpdatePolicy?: unknown;
  legacyExternalRefs?: unknown;
  dataOrigin?: unknown;
  fields?: unknown;
}

interface DeviceSampleInput extends LooseRecord {
  stream?: string;
  recordedAt?: DateInput;
  dayKey?: string;
  timeZone?: string;
  source?: string;
  quality?: string;
  unit?: string;
  externalRef?: unknown;
  dataOrigin?: unknown;
  sample?: unknown;
}

interface DeviceAuthoritativeEventSetInput extends LooseRecord {
  system?: unknown;
  resourceType?: unknown;
  resourceId?: unknown;
  version?: unknown;
  facetPrefixes?: unknown;
  currentFacets?: unknown;
}

interface ImportDeviceBatchInput {
  vaultRoot: string;
  provider: string;
  accountId?: string;
  importedAt?: DateInput;
  source?: string;
  events?: readonly DeviceEventInput[];
  samples?: readonly DeviceSampleInput[];
  evidenceParts?: readonly DeviceEvidencePartInput[];
  authoritativeEventSets?: readonly DeviceAuthoritativeEventSetInput[];
  ingestReceipt?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

interface ImportDeviceBatchResultBase {
  affectedEventDayKeys?: string[];
  affectedSparseCalendarTargets?: JunctionSparseCalendarTarget[];
  applied: boolean;
  ingestId: string | null;
  ingestShardPath: string | null;
  auditPath: string | null;
  provider: string;
  accountId?: string;
  importedAt: string;
  events: EventRecord[];
  samples: SampleRecord[];
  eventShardPaths: string[];
  sampleShardPaths: string[];
  evidencePartCount: number;
  persistedEvidencePartCount: number;
}

export interface AppliedDeviceBatchImportResult extends ImportDeviceBatchResultBase {
  applied: true;
  ingestId: string;
  ingestShardPath: string;
  auditPath: string;
}

export interface NoopDeviceBatchImportResult extends ImportDeviceBatchResultBase {
  applied: false;
  ingestId: null;
  ingestShardPath: null;
  auditPath: null;
}

export type ImportDeviceBatchResult =
  | AppliedDeviceBatchImportResult
  | NoopDeviceBatchImportResult;


interface NormalizedDeviceEvent {
  seed: NormalizedEventSeed<EventKind>;
  evidenceRoles: string[];
  externalRefUpdatePolicy?: "immutable";
  legacyExternalRefs: ExternalRef[];
  recordId: string;
}

interface NormalizedDeviceSample {
  seed: NormalizedSampleSeed;
  recordId: string;
}

interface NormalizedDeviceEvidencePart {
  role: string;
  fileName: string;
  mediaType?: string;
  content: string;
  metadata?: LooseRecord;
  sha256: string;
  index: number;
}

interface NormalizedDeviceBatchInputs {
  provider: string;
  accountId?: string;
  importedAt: string;
  source: EventSource;
  defaultTimeZone?: string;
  provenance: LooseRecord;
  ingestReceipt?: IntegrationIngestReceipt;
  legacyIngestReceipt?: LooseRecord;
  events: NormalizedDeviceEvent[];
  samples: NormalizedDeviceSample[];
  evidenceParts: NormalizedDeviceEvidencePart[];
  authoritativeEventSets: NormalizedDeviceAuthoritativeEventSet[];
}

interface NormalizedDeviceAuthoritativeEventSet {
  system: string;
  resourceType: string;
  resourceId: string;
  version: string;
  facetPrefixes: readonly string[];
  currentFacets: ReadonlySet<string>;
}

interface PreparedJsonlEntry<RecordType extends { id: string }> {
  relativePath: string;
  record: RecordType;
}

interface PreparedDeviceEventEntry extends PreparedJsonlEntry<EventRecord> {
  externalRefUpdatePolicy?: "immutable";
  legacyExternalRefs: ExternalRef[];
}

interface JsonlAppendPlan {
  targetShardPaths: string[];
  appendedShardPaths: string[];
  appendedRecordIds: string[];
  payloads: Map<string, string>;
}

interface DeviceBatchPlan {
  importId: string;
  legacyImportId: string;
  provider: string;
  accountId?: string;
  importedAt: string;
  source: EventSource;
  provenance: LooseRecord;
  ingestReceipt?: IntegrationIngestReceipt;
  effectiveOccurredAt: string;
  preparedEvents: PreparedDeviceEventEntry[];
  evidenceRolesByPreparedRecordId: ReadonlyMap<string, readonly string[]>;
  preparedSamples: PreparedJsonlEntry<SampleRecord>[];
  preparedEvidenceParts: IntegrationEvidencePart[];
  authoritativeEventSets: readonly NormalizedDeviceAuthoritativeEventSet[];
}

const MAX_DEVICE_PROVIDER_SAMPLE_ROWS_DEFAULT = 1_000;
// Junction menstrual resources admit 512 dated non-BBT facts plus the
// period-length and cycle-length scalar facets for the same resource version.
const MAX_DEVICE_AUTHORITATIVE_CURRENT_FACETS = 514;

interface BuildEventRecordInput<K extends EventKind> {
  kind: K;
  occurredAt: DateInput;
  recordedAt?: DateInput;
  dayKey?: string;
  timeZone?: string;
  defaultTimeZone?: string;
  source?: string;
  title?: string;
  note?: string;
  tags?: unknown;
  links?: unknown;
  rawRefs?: unknown;
  externalRef?: unknown;
  dataOrigin?: unknown;
  fields?: LooseRecord;
  recordId?: string;
}

interface EventLinkInput {
  type: string;
  targetId: string;
}

interface BuildSampleRecordInput {
  stream: SampleStream;
  recordedAt?: DateInput;
  dayKey?: string;
  timeZone?: string;
  defaultTimeZone?: string;
  source?: string;
  quality?: string;
  sample: SampleInputRecord;
  unit: string;
  recordId?: string;
  externalRef?: unknown;
  dataOrigin?: unknown;
}

interface NormalizedEventSeed<K extends EventKind> {
  kind: K;
  occurredAt: string;
  recordedAt: string;
  dayKey: string;
  timeZone?: string;
  source: EventSource;
  title: string;
  note?: string;
  tags?: string[];
  links?: EventLinkInput[];
  rawRefs?: string[];
  externalRef?: ExternalRef;
  dataOrigin?: DeviceDataOrigin;
  fields: LooseRecord;
}

type NormalizedSampleMeasurement =
  | {
      kind: "numeric";
      value: number;
    }
  | {
      kind: "sleep_stage";
      stage: string;
      startAt: string;
      endAt: string;
      durationMinutes: number;
    };

interface NormalizedSampleSeed {
  stream: SampleStream;
  recordedAt: string;
  dayKey: string;
  timeZone?: string;
  source: SampleSource;
  quality: SampleQuality;
  externalRef?: ExternalRef;
  dataOrigin?: DeviceDataOrigin;
  unit: string;
  measurement: NormalizedSampleMeasurement;
}

const EVENT_KIND_SET = new Set<EventKind>(BASELINE_EVENT_KINDS as readonly EventKind[]);
const EVENT_SOURCE_SET = new Set<EventSource>(EVENT_SOURCES as readonly EventSource[]);
const SAMPLE_STREAM_SET = new Set<SampleStream>(BASELINE_SAMPLE_STREAMS as readonly SampleStream[]);
const SAMPLE_SOURCE_SET = new Set<SampleSource>(SAMPLE_SOURCES as readonly SampleSource[]);
const SAMPLE_QUALITY_SET = new Set<SampleQuality>(SAMPLE_QUALITIES as readonly SampleQuality[]);
function compactRecord(record: LooseRecord): UnknownRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === undefined || value === null) {
        return false;
      }

      if (Array.isArray(value)) {
        return true;
      }

      if (typeof value === "object") {
        return Object.keys(value).length > 0;
      }

      return true;
    }),
  ) as UnknownRecord;
}

function stableSortValue(value: unknown): unknown {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new VaultError(
        "VAULT_INVALID_RAW_CONTENT",
        "raw artifact content contains an invalid Date.",
      );
    }
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stableSortValue(entry));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableSortValue(entry)] as const);
    return Object.fromEntries(entries);
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortValue(value));
}

function normalizeExternalRef(value: unknown): ExternalRef | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const candidate = assertPlainObject<LooseRecord>(
    value,
    "VAULT_INVALID_EXTERNAL_REF",
    "externalRef must be a plain object.",
  );

  return compactRecord({
    system: typeof candidate.system === "string" ? candidate.system.trim() : undefined,
    resourceType: typeof candidate.resourceType === "string" ? candidate.resourceType.trim() : undefined,
    resourceId: typeof candidate.resourceId === "string" ? candidate.resourceId.trim() : undefined,
    version:
      typeof candidate.version === "string" && candidate.version.trim()
        ? candidate.version.trim()
        : undefined,
    facet:
      typeof candidate.facet === "string" && candidate.facet.trim()
        ? candidate.facet.trim()
        : undefined,
  }) as ExternalRef;
}

function normalizeLegacyExternalRefs(value: unknown, eventIndex: number): ExternalRef[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new VaultError(
      "VAULT_INVALID_EXTERNAL_REF",
      `Device event ${eventIndex + 1} legacyExternalRefs must be an array when provided.`,
    );
  }

  const legacyExternalRefs: ExternalRef[] = [];
  const seenKeys = new Set<string>();

  value.forEach((entry, refIndex) => {
    const normalized = normalizeExternalRef(entry);
    assertContractShape(
      externalRefSchema,
      normalized,
      "VAULT_INVALID_EXTERNAL_REF",
      `Device event ${eventIndex + 1} legacyExternalRefs entry ${refIndex + 1} failed contract validation.`,
    );

    const refKey = eventExternalRefKey(normalized);
    if (seenKeys.has(refKey)) {
      return;
    }

    seenKeys.add(refKey);
    legacyExternalRefs.push(normalized);
  });

  return legacyExternalRefs;
}

function normalizeDeviceDataOrigin(value: unknown): DeviceDataOrigin | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  assertContractShape<DeviceDataOrigin>(
    deviceDataOriginSchema,
    value,
    "VAULT_INVALID_DATA_ORIGIN",
    "dataOrigin failed contract validation.",
  );

  return value;
}

function normalizeLooseRecord(value: unknown, code: string, message: string): LooseRecord | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return assertPlainObject<LooseRecord>(value, code, message);
}

function normalizeDayKeyInput(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? value.trim()
    : undefined;
}

function isDateOnlyFloatingProviderDayInput(
  dayKey: string | undefined,
  dataOrigin: unknown,
): boolean {
  const normalizedDayKey = normalizeDayKeyInput(dayKey);
  if (
    !normalizedDayKey
    || !dataOrigin
    || typeof dataOrigin !== "object"
    || Array.isArray(dataOrigin)
  ) {
    return false;
  }

  const origin = dataOrigin as UnknownRecord;
  return origin.timestampSemantics === "floating"
    && origin.observedAtRaw === normalizedDayKey;
}

function normalizeRequiredRole(value: unknown, label: string): string {
  const candidate = String(value ?? "").trim();

  if (!candidate) {
    throw new VaultError("VAULT_INVALID_RAW_ROLE", `${label} must be a non-empty string.`);
  }

  return candidate;
}

function normalizeInlineRawContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (content === undefined) {
    throw new VaultError("VAULT_INVALID_RAW_CONTENT", "raw artifact content is required.");
  }

  return `${stableStringify(content)}\n`;
}

function earliestTimestamp(timestamps: readonly string[], fallback: DateInput = new Date()): string {
  if (timestamps.length === 0) {
    return toIsoTimestamp(fallback, "occurredAt");
  }

  return [...timestamps].sort()[0] as string;
}

function assertPlainObject<T extends LooseRecord>(
  value: unknown,
  code: string,
  message: string,
): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VaultError(code, message);
  }

  return value as T;
}

function assertContractShape<T>(
  schema: ContractSchema<T>,
  value: unknown,
  code: string,
  message: string,
): asserts value is T {
  const result = safeParseContract(schema, value);

  if (!result.success) {
    throw new VaultError(code, `${message} ${JSON.stringify(result.errors)}`, { errors: result.errors });
  }
}

function normalizeSource<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : fallback;
}

function normalizeSampleInputRecord(
  value: unknown,
  code: string,
  message: string,
): SampleInputRecord {
  return assertPlainObject<SampleInputRecord>(value, code, message);
}

function trimStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

function uniqueTrimmedStringList(value: unknown): string[] | undefined {
  const entries = trimStringList(value);
  return entries ? [...new Set(entries)] : undefined;
}

const NUMERIC_UNIT_ALIASES = {
  glucose: {
    "mg/dl": "mg_dL",
    "mg_dl": "mg_dL",
    mg_dL: "mg_dL",
  },
  heart_rate: {
    bpm: "bpm",
  },
  spo2: {
    "%": "%",
    percent: "%",
    percentage: "%",
    spo2_percent: "%",
  },
  hrv: {
    ms: "ms",
  },
  steps: {
    count: "count",
  },
  respiratory_rate: {
    breaths_per_minute: "breaths_per_minute",
    "breaths/minute": "breaths_per_minute",
  },
  temperature: {
    celsius: "celsius",
    c: "celsius",
  },
  sleep_stage: {
    stage: "stage",
  },
} as const;

const EVENT_VALIDATION_PLACEHOLDER_ID = `${ID_PREFIXES.event}_00000000000000000000000000`;
const SAMPLE_VALIDATION_PLACEHOLDER_ID = `${ID_PREFIXES.sample}_00000000000000000000000000`;

function normalizeNumericUnit(stream: SampleStream, unit: unknown): string {
  const normalized = String(unit ?? "").trim();
  const aliases = NUMERIC_UNIT_ALIASES[stream];
  const candidate =
    aliases[normalized as keyof typeof aliases] ??
    aliases[normalized.toLowerCase() as keyof typeof aliases];

  if (!candidate) {
    throw new VaultError(
      "VAULT_INVALID_SAMPLE_UNIT",
      `Unsupported unit "${normalized}" for stream "${stream}".`,
      {
        stream,
        unit: normalized,
      },
    );
  }

  return candidate;
}

function sampleRecordTimeBounds(records: readonly SampleRecord[]): {
  firstSampleAt: string | null;
  lastSampleAt: string | null;
} {
  let firstSampleAt: string | null = null;
  let lastSampleAt: string | null = null;

  for (const record of records) {
    if (!firstSampleAt || record.recordedAt < firstSampleAt) {
      firstSampleAt = record.recordedAt;
    }

    if (!lastSampleAt || record.recordedAt > lastSampleAt) {
      lastSampleAt = record.recordedAt;
    }
  }

  return { firstSampleAt, lastSampleAt };
}

function normalizeOptionalContractId(value: string | undefined, prefix: string, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  try {
    return assertContractId(value, prefix, fieldName);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${fieldName} must be a valid id.`;
    throw new VaultError("VAULT_INVALID_INPUT", message);
  }
}

function buildPreparedAttachmentState(
  preparedAttachments: readonly PreparedEventAttachment[],
): {
  rawRefs: string[];
} {
  return {
    rawRefs: [...new Set(preparedAttachments.map((attachment) => attachment.raw.relativePath))],
  };
}

function buildNormalizedEventSeed<K extends EventKind>({
  kind,
  occurredAt,
  recordedAt = new Date(),
  dayKey,
  timeZone,
  defaultTimeZone: fallbackTimeZone,
  source,
  title,
  note,
  tags,
  links,
  rawRefs,
  externalRef,
  dataOrigin,
  fields = {},
}: Omit<BuildEventRecordInput<K>, "recordId">): NormalizedEventSeed<K> {
  if (!EVENT_KIND_SET.has(kind)) {
    throw new VaultError(
      "VAULT_UNSUPPORTED_EVENT_KIND",
      `Unsupported baseline event kind "${kind}".`,
      {
        kind,
      },
    );
  }

  const normalizedFields = assertPlainObject<LooseRecord>(
    fields,
    "VAULT_INVALID_EVENT_FIELDS",
    "Event fields must be a plain object.",
  );
  const occurredTimestamp = toIsoTimestamp(occurredAt, "occurredAt");
  const recordedTimestamp = toIsoTimestamp(recordedAt, "recordedAt");
  const resolvedTimeZone = normalizeTimeZone(timeZone ?? fallbackTimeZone);
  const resolvedDayKey = normalizeDayKeyInput(dayKey) ??
    toLocalDayKey(occurredTimestamp, resolvedTimeZone ?? defaultTimeZone(), "occurredAt");
  const canonicalLinks = normalizeCanonicalEventLinks({
    value: links,
    errorCode: "VAULT_INVALID_INPUT",
    errorMessage: "links entries must be objects with non-empty type and targetId fields.",
  });

  const seed: NormalizedEventSeed<K> = {
    kind,
    occurredAt: occurredTimestamp,
    recordedAt: recordedTimestamp,
    dayKey: resolvedDayKey,
    timeZone: resolvedTimeZone,
    source: normalizeSource(source, EVENT_SOURCE_SET, "manual"),
    title: typeof title === "string" && title.trim() ? title.trim() : kind,
    note: typeof note === "string" && note.trim() ? note.trim() : undefined,
    tags: trimStringList(tags),
    links: canonicalLinks,
    rawRefs: trimStringList(rawRefs),
    externalRef: normalizeExternalRef(externalRef),
    dataOrigin: normalizeDeviceDataOrigin(dataOrigin),
    fields: normalizedFields,
  };

  validateEventSeed(seed);

  return seed;
}

function buildEventContractInput<K extends EventKind>(
  seed: NormalizedEventSeed<K>,
  recordId?: string,
  lifecycle?: EventRecord["lifecycle"],
): UnknownRecord {
  return compactRecord({
    ...seed.fields,
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: recordId,
    kind: seed.kind,
    occurredAt: seed.occurredAt,
    recordedAt: seed.recordedAt,
    dayKey: seed.dayKey,
    timeZone: seed.timeZone,
    source: seed.source,
    title: seed.title,
    note: seed.note,
    tags: seed.tags,
    links: seed.links?.length ? seed.links : undefined,
    rawRefs: seed.rawRefs,
    externalRef: seed.externalRef,
    dataOrigin: seed.dataOrigin,
    lifecycle,
  });
}

function validateEventSeed<K extends EventKind>(seed: NormalizedEventSeed<K>): void {
  assertContractShape(
    eventRecordSchema,
    buildEventContractInput(seed, EVENT_VALIDATION_PLACEHOLDER_ID),
    "EVENT_INVALID",
    "Event record failed contract validation before write.",
  );
}

function buildStoredEventRecord<K extends EventKind>(
  seed: NormalizedEventSeed<K>,
  recordId: string,
  lifecycle?: EventRecord["lifecycle"],
): EventRecordByKind<K> {
  const record = buildEventContractInput(seed, recordId, lifecycle);

  assertContractShape(
    eventRecordSchema,
    record,
    "EVENT_INVALID",
    "Event record failed contract validation before write.",
  );

  return record as EventRecordByKind<K>;
}

function prepareStoredEventLedgerEntry<K extends EventKind>(
  seed: NormalizedEventSeed<K>,
  recordId: string,
  lifecycle?: EventRecord["lifecycle"],
): PreparedJsonlEntry<EventRecordByKind<K>> {
  const record = buildStoredEventRecord(seed, recordId, lifecycle);

  return {
    relativePath: toMonthlyShardRelativePath(
      VAULT_LAYOUT.eventLedgerDirectory,
      record.occurredAt,
      "occurredAt",
    ),
    record,
  };
}

async function resolveExplicitEventLifecycle(input: {
  eventId: string;
  kind: EventKind;
  vaultRoot: string;
}): Promise<EventRecord["lifecycle"] | undefined> {
  const matchedShards = await loadEventLedgerShardsById(input.vaultRoot, input.eventId);
  const latestMatchedEvent = selectLatestMatchedEvent(matchedShards);

  if (!latestMatchedEvent) {
    return undefined;
  }

  if (latestMatchedEvent.record.kind !== input.kind) {
    throw new VaultError(
      "EVENT_KIND_MISMATCH",
      `Event "${input.eventId}" is already kind "${latestMatchedEvent.record.kind}" and cannot be rewritten as "${input.kind}".`,
    );
  }

  return buildEventSpineLifecycle(eventSpineRevision(latestMatchedEvent.record) + 1);
}

function prepareEventLedgerEntry<K extends EventKind>({
  recordId,
  ...input
}: BuildEventRecordInput<K>): PreparedJsonlEntry<EventRecordByKind<K>> {
  return prepareStoredEventLedgerEntry(
    buildNormalizedEventSeed(input),
    recordId ?? generateRecordId(ID_PREFIXES.event),
  );
}

async function stageJsonlRecord(
  batch: WriteBatch,
  relativePath: string,
  record: object,
): Promise<string> {
  return batch.stageJsonlAppend(relativePath, `${JSON.stringify(record)}\n`);
}

function buildNormalizedSampleSeed({
  stream,
  recordedAt,
  dayKey,
  timeZone,
  defaultTimeZone: fallbackTimeZone,
  source,
  quality,
  sample,
  unit,
  externalRef,
  dataOrigin,
}: Omit<BuildSampleRecordInput, "recordId">): NormalizedSampleSeed {
  const recordedTimestamp = toIsoTimestamp(sample.recordedAt ?? recordedAt, "recordedAt");
  const normalizedUnit = normalizeNumericUnit(stream, unit);
  const resolvedTimeZone = normalizeTimeZone(timeZone ?? fallbackTimeZone);
  const resolvedDayKey = normalizeDayKeyInput(dayKey) ??
    toLocalDayKey(recordedTimestamp, resolvedTimeZone ?? defaultTimeZone(), "recordedAt");

  const baseSeed = {
    stream,
    recordedAt: recordedTimestamp,
    dayKey: resolvedDayKey,
    timeZone: resolvedTimeZone,
    source: normalizeSource(source, SAMPLE_SOURCE_SET, "import"),
    quality: normalizeSource(quality, SAMPLE_QUALITY_SET, "raw"),
    externalRef: normalizeExternalRef(externalRef),
    dataOrigin: normalizeDeviceDataOrigin(dataOrigin),
  };

  const seed: NormalizedSampleSeed = stream === "sleep_stage"
    ? {
      ...baseSeed,
      unit: normalizedUnit,
      measurement: {
        kind: "sleep_stage",
        stage: String(sample.stage ?? "").trim(),
        startAt: toIsoTimestamp(sample.startAt, "startAt"),
        endAt: toIsoTimestamp(sample.endAt, "endAt"),
        durationMinutes: Number(sample.durationMinutes),
      },
    }
    : (() => {
        if (typeof sample.value !== "number" || !Number.isFinite(sample.value)) {
          throw new VaultError("VAULT_INVALID_SAMPLE", "Sample value must be a finite number.", {
            stream,
            sampleSummary: JSON.stringify(sample),
          });
        }

        return {
          ...baseSeed,
          unit: normalizedUnit,
          measurement: {
            kind: "numeric",
            value: sample.value,
          },
        };
      })();

  assertContractShape<SampleRecord>(
    sampleRecordSchema,
    materializeSampleRecord({ seed, recordId: SAMPLE_VALIDATION_PLACEHOLDER_ID }),
    "SAMPLE_INVALID",
    "Sample record failed contract validation before write.",
  );

  return seed;
}

function materializeSampleRecord({
  seed,
  recordId,
}: {
  seed: NormalizedSampleSeed;
  recordId?: string;
}): UnknownRecord {
  const measurementFields = seed.measurement.kind === "sleep_stage"
    ? {
        stage: seed.measurement.stage,
        startAt: seed.measurement.startAt,
        endAt: seed.measurement.endAt,
        durationMinutes: seed.measurement.durationMinutes,
        unit: seed.unit,
      }
    : {
        value: seed.measurement.value,
        unit: seed.unit,
      };

  return compactRecord({
    schemaVersion: SAMPLE_SCHEMA_VERSION,
    id: recordId,
    dayKey: seed.dayKey,
    timeZone: seed.timeZone,
    stream: seed.stream,
    recordedAt: seed.recordedAt,
    source: seed.source,
    quality: seed.quality,
    externalRef: seed.externalRef,
    dataOrigin: seed.dataOrigin,
    ...measurementFields,
  });
}

function finalizeSampleRecord({
  seed,
  recordId,
}: {
  seed: NormalizedSampleSeed;
  recordId: string;
}): SampleRecord {
  const record = materializeSampleRecord({ seed, recordId });

  assertContractShape<SampleRecord>(
    sampleRecordSchema,
    record,
    "SAMPLE_INVALID",
    "Sample record failed contract validation before write.",
  );

  return record;
}

function buildSampleRecord({
  recordId,
  ...input
}: BuildSampleRecordInput): SampleRecord {
  return finalizeSampleRecord({
    seed: buildNormalizedSampleSeed(input),
    recordId: recordId ?? generateRecordId(ID_PREFIXES.sample),
  });
}

async function readExistingRecordIds(
  vaultRoot: string,
  relativePath: string,
  signal?: AbortSignal | null,
): Promise<Set<string>> {
  signal?.throwIfAborted();
  const resolved = resolveVaultPath(vaultRoot, relativePath);

  if (!(await pathExists(resolved.absolutePath))) {
    return new Set<string>();
  }

  const ids = new Set<string>();
  await visitJsonlRecordsInterruptible({
    vaultRoot,
    relativePath,
    signal,
    visit(record) {
      if (typeof record.id === "string") {
        ids.add(record.id);
      }
    },
  });
  return ids;
}

async function buildJsonlAppendPlan<RecordType extends { id: string }>(
  vaultRoot: string,
  entries: readonly PreparedJsonlEntry<RecordType>[],
  options: {
    dedupeWithinPlan?: boolean;
    forceAppendIds?: ReadonlySet<string>;
    signal?: AbortSignal | null;
  } = {},
): Promise<JsonlAppendPlan> {
  assertCanonicalWriteLockScope(vaultRoot);

  const payloads = new Map<string, string>();
  const existingIdsByShard = new Map<string, Set<string>>();
  const targetShardPaths = [...new Set(entries.map((entry) => entry.relativePath))].sort();
  const appendedRecordIds: string[] = [];

  for (const entry of entries) {
    options.signal?.throwIfAborted();
    const existingIds =
      existingIdsByShard.get(entry.relativePath) ??
      (await readExistingRecordIds(vaultRoot, entry.relativePath, options.signal));

    existingIdsByShard.set(entry.relativePath, existingIds);

    if (existingIds.has(entry.record.id) && !options.forceAppendIds?.has(entry.record.id)) {
      continue;
    }

    if (options.dedupeWithinPlan) {
      existingIds.add(entry.record.id);
    }

    appendedRecordIds.push(entry.record.id);
    const existingPayload = payloads.get(entry.relativePath) ?? "";
    payloads.set(entry.relativePath, `${existingPayload}${JSON.stringify(entry.record)}\n`);
  }

  return {
    targetShardPaths,
    appendedShardPaths: [...payloads.keys()].sort(),
    appendedRecordIds,
    payloads,
  };
}

async function stageJsonlAppendPlan(batch: WriteBatch, appendPlan: JsonlAppendPlan): Promise<void> {
  for (const relativePath of appendPlan.appendedShardPaths) {
    const payload = appendPlan.payloads.get(relativePath);

    if (!payload) {
      continue;
    }

    await batch.stageJsonlAppend(relativePath, payload);
  }
}

function normalizeDeviceEventInputs(
  eventInputs: readonly DeviceEventInput[],
  context: Pick<NormalizedDeviceBatchInputs, "provider" | "accountId" | "importedAt" | "source" | "defaultTimeZone">,
): NormalizedDeviceEvent[] {
  return eventInputs.map((eventInput, index) => {
    const kind = String(eventInput.kind ?? "").trim() as EventKind;

    if (!EVENT_KIND_SET.has(kind)) {
      throw new VaultError(
        "VAULT_UNSUPPORTED_EVENT_KIND",
        `Unsupported baseline event kind "${String(eventInput.kind ?? "")}".`,
        { index },
      );
    }

    const fields = normalizeLooseRecord(
      eventInput.fields,
      "VAULT_INVALID_EVENT_FIELDS",
      `Device event ${index + 1} fields must be a plain object.`,
    ) ?? {};
    assertNoReservedDeviceEventFields(fields, index);
    const evidenceRoles = trimStringList(eventInput.evidenceRoles) ?? [];
    assertNoLegacyRelatedIds({
      value: eventInput.relatedIds,
      errorCode: "VAULT_INVALID_INPUT",
      errorMessage: `Device event ${index + 1} relatedIds is no longer supported; use links.`,
    });
    const normalizedLegacyExternalRefs = normalizeLegacyExternalRefs(eventInput.legacyExternalRefs, index);
    const externalRefUpdatePolicy = eventInput.externalRefUpdatePolicy;
    if (externalRefUpdatePolicy !== undefined && externalRefUpdatePolicy !== "immutable") {
      throw new VaultError(
        "VAULT_INVALID_EXTERNAL_REF",
        `Device event ${index + 1} externalRefUpdatePolicy must be "immutable" when provided.`,
      );
    }
    const inputDayKey = typeof eventInput.dayKey === "string" ? eventInput.dayKey : undefined;
    const inputTimeZone = typeof eventInput.timeZone === "string" ? eventInput.timeZone : undefined;
    const preservesProviderDayWithoutTimeZone = Boolean(
      inputDayKey &&
        !inputTimeZone &&
        (
          context.provider === "junction"
          || isJunctionSleepStageExternalRefInput(eventInput.externalRef)
          || isDateOnlyFloatingProviderDayInput(inputDayKey, eventInput.dataOrigin)
        ),
    );
    const seed = buildNormalizedEventSeed({
      kind,
      occurredAt: eventInput.occurredAt ?? eventInput.recordedAt ?? context.importedAt,
      recordedAt: eventInput.recordedAt ?? eventInput.occurredAt,
      dayKey: inputDayKey,
      timeZone: inputTimeZone,
      defaultTimeZone: preservesProviderDayWithoutTimeZone ? undefined : context.defaultTimeZone,
      source: eventInput.source ?? context.source,
      title: typeof eventInput.title === "string" ? eventInput.title : undefined,
      note: eventInput.note,
      tags: eventInput.tags,
      links: eventInput.links,
      externalRef: eventInput.externalRef,
      dataOrigin: eventInput.dataOrigin,
      fields,
    });
    const { rawRefs: _rawRefs, ...seedRecord } = buildEventContractInput(seed);
    const seedExternalRefKey = seed.externalRef ? eventExternalRefKey(seed.externalRef) : undefined;
    const legacyExternalRefs = normalizedLegacyExternalRefs.filter((externalRef) =>
      eventExternalRefKey(externalRef) !== seedExternalRefKey
    );

    if (legacyExternalRefs.length > 0 && !seed.externalRef) {
      throw new VaultError(
        "VAULT_INVALID_EXTERNAL_REF",
        `Device event ${index + 1} legacyExternalRefs require externalRef.`,
      );
    }

    if (externalRefUpdatePolicy === "immutable" && !seed.externalRef) {
      throw new VaultError(
        "VAULT_INVALID_EXTERNAL_REF",
        `Device event ${index + 1} immutable externalRefUpdatePolicy requires externalRef.`,
      );
    }

    return {
      seed,
      evidenceRoles,
      ...(externalRefUpdatePolicy === "immutable" ? { externalRefUpdatePolicy } : {}),
      legacyExternalRefs,
      recordId: deterministicContractId(
        ID_PREFIXES.event,
        stableStringify({
          provider: context.provider,
          accountId: context.accountId ?? null,
          rawArtifactRoles: evidenceRoles,
          record: seedRecord,
        }),
      ),
    };
  });
}

function assertNoReservedDeviceEventFields(fields: LooseRecord, index: number): void {
  const reservedFieldName = Object.keys(fields).find((fieldName) =>
    RESERVED_DEVICE_EVENT_FIELD_NAMES.has(fieldName),
  );

  if (!reservedFieldName) {
    return;
  }

  throw new VaultError(
    "VAULT_INVALID_EVENT_FIELDS",
    `Device event ${index + 1} fields cannot override reserved event field "${reservedFieldName}".`,
    {
      field: reservedFieldName,
      index,
    },
  );
}

function normalizeDeviceSampleInputs(
  sampleInputs: readonly DeviceSampleInput[],
  context: Pick<NormalizedDeviceBatchInputs, "provider" | "accountId" | "source" | "defaultTimeZone">,
): NormalizedDeviceSample[] {
  return sampleInputs.map((sampleInput, index) => {
    const stream = String(sampleInput.stream ?? "").trim() as SampleStream;

    if (!SAMPLE_STREAM_SET.has(stream)) {
      throw new VaultError(
        "VAULT_UNSUPPORTED_SAMPLE_STREAM",
        `Unsupported baseline sample stream "${String(sampleInput.stream ?? "")}".`,
        { index },
      );
    }

    const sample = normalizeSampleInputRecord(
      sampleInput.sample,
      "VAULT_INVALID_SAMPLE",
      `Device sample ${index + 1} must include a sample object.`,
    );
    const seed = buildNormalizedSampleSeed({
      stream,
      recordedAt: sampleInput.recordedAt ?? sample.recordedAt ?? sample.occurredAt,
      dayKey: typeof sampleInput.dayKey === "string" ? sampleInput.dayKey : undefined,
      timeZone: typeof sampleInput.timeZone === "string" ? sampleInput.timeZone : undefined,
      defaultTimeZone: context.defaultTimeZone,
      source: sampleInput.source ?? context.source,
      quality: sampleInput.quality ?? "normalized",
      sample,
      unit: String(sampleInput.unit ?? ""),
      externalRef: sampleInput.externalRef,
      dataOrigin: sampleInput.dataOrigin,
    });
    const record = materializeSampleRecord({ seed });

    return {
      seed,
      recordId: deterministicContractId(
        ID_PREFIXES.sample,
        stableStringify({
          provider: context.provider,
          accountId: context.accountId ?? null,
          record,
        }),
      ),
    };
  });
}

function normalizeDeviceEvidencePartInputs(
  evidencePartInputs: readonly DeviceEvidencePartInput[],
  provider: string,
): NormalizedDeviceEvidencePart[] {
  const seenEvidenceRoles = new Set<string>();

  return evidencePartInputs.map((artifactInput, index) => {
    const role = normalizeRequiredRole(
      artifactInput.role ?? `artifact-${index + 1}`,
      `evidence part ${index + 1} role`,
    );

    if (seenEvidenceRoles.has(role)) {
      throw new VaultError(
        "VAULT_DUPLICATE_EVIDENCE_ROLE",
        `Device evidence role "${role}" may only appear once per batch.`,
      );
    }

    seenEvidenceRoles.add(role);
    const content = normalizeInlineRawContent(artifactInput.content);

    return {
      role,
      fileName:
        typeof artifactInput.fileName === "string" && artifactInput.fileName.trim()
          ? artifactInput.fileName.trim()
          : `${provider}-${String(index + 1).padStart(2, "0")}.json`,
      mediaType:
        typeof artifactInput.mediaType === "string" && artifactInput.mediaType.trim()
          ? artifactInput.mediaType.trim()
          : undefined,
      content,
      metadata: normalizeLooseRecord(
        artifactInput.metadata,
        "VAULT_INVALID_RAW_ARTIFACT",
        `Device raw artifact ${index + 1} metadata must be a plain object.`,
      ),
      sha256: createHash("sha256").update(content).digest("hex"),
      index,
    };
  });
}

function normalizeDeviceBatchObjectArray<T extends LooseRecord>(input: {
  value: unknown;
  code: string;
  message: string;
  itemCode: string;
  itemLabel: string;
}): T[] {
  if (input.value === undefined) {
    return [];
  }

  if (!Array.isArray(input.value)) {
    throw new VaultError(input.code, input.message);
  }

  return input.value.map((entry, index) =>
    assertPlainObject<T>(
      entry,
      input.itemCode,
      `${input.itemLabel} ${index + 1} must be a plain object.`,
    ),
  );
}

function normalizeDeviceAuthoritativeEventSets(
  inputs: readonly DeviceAuthoritativeEventSetInput[],
  events: readonly NormalizedDeviceEvent[],
): NormalizedDeviceAuthoritativeEventSet[] {
  if (inputs.length > 128) {
    throw new VaultError(
      "VAULT_INVALID_DEVICE_AUTHORITATIVE_EVENT_SETS",
      "Device batch authoritativeEventSets exceeds 128 resources.",
    );
  }

  const sets = inputs.map((input, index): NormalizedDeviceAuthoritativeEventSet => {
    const parsedRef = safeParseContract(externalRefSchema, {
      system: input.system,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      version: input.version,
    });
    if (!parsedRef.success || !parsedRef.data.version || !isWritableIsoDateTime(parsedRef.data.version)) {
      throw new VaultError(
        "VAULT_INVALID_DEVICE_AUTHORITATIVE_EVENT_SET",
        `Device authoritative event set ${index + 1} requires a valid versioned externalRef identity.`,
      );
    }
    const facetPrefixes = normalizeUniqueTextList(
      input.facetPrefixes,
      `authoritativeEventSets[${index}].facetPrefixes`,
      32,
      200,
    );
    const currentFacets = normalizeUniqueTextList(
      input.currentFacets,
      `authoritativeEventSets[${index}].currentFacets`,
      MAX_DEVICE_AUTHORITATIVE_CURRENT_FACETS,
      200,
    ) ?? [];
    if (!facetPrefixes || facetPrefixes.length === 0) {
      throw new VaultError(
        "VAULT_INVALID_DEVICE_AUTHORITATIVE_EVENT_SET",
        `Device authoritative event set ${index + 1} requires at least one facet prefix.`,
      );
    }
    const ownsFacet = (facet: string): boolean => facetPrefixes.some((prefix) =>
      facet === prefix || facet.startsWith(`${prefix}-`)
    );
    if (currentFacets.some((facet) => !ownsFacet(facet))) {
      throw new VaultError(
        "VAULT_INVALID_DEVICE_AUTHORITATIVE_EVENT_SET",
        `Device authoritative event set ${index + 1} contains a current facet outside its owned prefixes.`,
      );
    }

    return {
      system: parsedRef.data.system,
      resourceType: parsedRef.data.resourceType,
      resourceId: parsedRef.data.resourceId,
      version: parsedRef.data.version,
      facetPrefixes: [...facetPrefixes].sort(),
      currentFacets: new Set(currentFacets),
    };
  });
  const identityKeys = sets.map((set) => stableStringify({
    system: set.system,
    resourceType: set.resourceType,
    resourceId: set.resourceId,
  }));
  if (new Set(identityKeys).size !== identityKeys.length) {
    throw new VaultError(
      "VAULT_INVALID_DEVICE_AUTHORITATIVE_EVENT_SETS",
      "Device batch authoritativeEventSets contains duplicate resource identities.",
    );
  }

  for (const set of sets) {
    for (const facet of set.currentFacets) {
      // Unversioned members follow complete-set reconciliation: the set's
      // version orders only retraction tombstones, while member events collapse
      // by semantic content and reassert through the serialized set seam.
      const hasCurrentEvent = events.some(({ seed }) =>
        seed.externalRef?.system === set.system
        && seed.externalRef.resourceType === set.resourceType
        && seed.externalRef.resourceId === set.resourceId
        && (seed.externalRef.version === set.version
          || seed.externalRef.version === undefined)
        && seed.externalRef.facet === facet
      );
      if (!hasCurrentEvent) {
        throw new VaultError(
          "VAULT_INVALID_DEVICE_AUTHORITATIVE_EVENT_SET",
          `Device authoritative event set current facet "${facet}" has no matching current event.`,
        );
      }
    }
  }

  return sets;
}

function normalizeDeviceBatchInputs({
  provider,
  accountId,
  importedAt = new Date(),
  defaultTimeZone: fallbackTimeZone,
  source = "device",
  events = [],
  samples = [],
  evidenceParts = [],
  authoritativeEventSets = [],
  ingestReceipt,
  provenance,
}: Omit<ImportDeviceBatchInput, "vaultRoot"> & {
  defaultTimeZone?: string;
}): NormalizedDeviceBatchInputs {
  const normalizedProvider = sanitizePathSegment(provider, "provider");
  const normalizedAccountId = typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
  const normalizedImportedAt = toIsoTimestamp(importedAt, "importedAt");
  const normalizedSource = normalizeSource(source, EVENT_SOURCE_SET, "device");
  const defaultTimeZone = normalizeTimeZone(fallbackTimeZone);
  const normalizedProvenance = normalizeLooseRecord(
    provenance,
    "VAULT_INVALID_DEVICE_PROVENANCE",
    "Device import provenance must be a plain object.",
  ) ?? {};
  const legacyIngestReceipt = normalizeLooseRecord(
    ingestReceipt,
    "INTEGRATION_INGEST_RECEIPT_INVALID",
    "Device ingest receipt must be a plain object.",
  );
  const normalizedIngestReceipt = compactIntegrationIngestReceipt(legacyIngestReceipt);
  const eventInputs = normalizeDeviceBatchObjectArray<DeviceEventInput>({
    value: events,
    code: "VAULT_INVALID_DEVICE_EVENTS",
    message: "Device batch events must be an array when provided.",
    itemCode: "VAULT_INVALID_EVENT",
    itemLabel: "Device event",
  });
  const sampleInputs = normalizeDeviceBatchObjectArray<DeviceSampleInput>({
    value: samples,
    code: "VAULT_INVALID_DEVICE_SAMPLES",
    message: "Device batch samples must be an array when provided.",
    itemCode: "VAULT_INVALID_SAMPLE",
    itemLabel: "Device sample",
  });
  const evidencePartInputs = normalizeDeviceBatchObjectArray<DeviceEvidencePartInput>({
    value: evidenceParts,
    code: "VAULT_INVALID_DEVICE_RAW_ARTIFACTS",
    message: "Device batch evidenceParts must be an array when provided.",
    itemCode: "VAULT_INVALID_RAW_ARTIFACT",
    itemLabel: "Device raw artifact",
  });
  const authoritativeEventSetInputs = normalizeDeviceBatchObjectArray<DeviceAuthoritativeEventSetInput>({
    value: authoritativeEventSets,
    code: "VAULT_INVALID_DEVICE_AUTHORITATIVE_EVENT_SETS",
    message: "Device batch authoritativeEventSets must be an array when provided.",
    itemCode: "VAULT_INVALID_DEVICE_AUTHORITATIVE_EVENT_SET",
    itemLabel: "Device authoritative event set",
  });

  if (
    eventInputs.length === 0
    && sampleInputs.length === 0
    && evidencePartInputs.length === 0
    && !normalizedIngestReceipt
  ) {
    throw new VaultError(
      "VAULT_INVALID_DEVICE_BATCH",
      "importDeviceBatch requires at least one event, sample, evidence part, or ingest receipt.",
    );
  }

  const normalizedEvents = normalizeDeviceEventInputs(eventInputs, {
    provider: normalizedProvider,
    accountId: normalizedAccountId,
    importedAt: normalizedImportedAt,
    source: normalizedSource,
    defaultTimeZone,
  });

  return {
    provider: normalizedProvider,
    accountId: normalizedAccountId,
    importedAt: normalizedImportedAt,
    source: normalizedSource,
    defaultTimeZone,
    provenance: normalizedProvenance,
    ingestReceipt: normalizedIngestReceipt,
    legacyIngestReceipt,
    events: normalizedEvents,
    samples: normalizeDeviceSampleInputs(sampleInputs, {
      provider: normalizedProvider,
      accountId: normalizedAccountId,
      source: normalizedSource,
      defaultTimeZone,
    }),
    evidenceParts: normalizeDeviceEvidencePartInputs(evidencePartInputs, normalizedProvider),
    authoritativeEventSets: normalizeDeviceAuthoritativeEventSets(
      authoritativeEventSetInputs,
      normalizedEvents,
    ),
  };
}

function prepareDeviceEvidenceParts(
  evidenceParts: readonly NormalizedDeviceEvidencePart[],
): IntegrationEvidencePart[] {
  return evidenceParts.map((part) =>
    buildIntegrationEvidencePart({
      role: part.role,
      fileName: part.fileName,
      mediaType: part.mediaType ?? "application/json",
      content: part.content,
      metadata: part.metadata,
    })
  );
}

interface PreparedDeviceEventPlan {
  entries: PreparedDeviceEventEntry[];
  evidenceRolesByPreparedRecordId: ReadonlyMap<string, readonly string[]>;
}

function prepareDeviceEventEntries(
  events: readonly NormalizedDeviceEvent[],
  evidenceParts: readonly IntegrationEvidencePart[],
): PreparedDeviceEventPlan {
  const availableRoles = new Set(evidenceParts.map((part) => part.role));
  const soleEvidencePart = evidenceParts.length === 1 ? evidenceParts[0] : undefined;
  const soleEvidenceRole = soleEvidencePart && isImplicitDeviceEvidenceFallbackRole(soleEvidencePart.role)
    ? soleEvidencePart.role
    : undefined;
  const evidenceRolesByPreparedRecordId = new Map<string, readonly string[]>();

  const entries = events.map((event) => {
    const roles = event.evidenceRoles.length > 0
      ? event.evidenceRoles.map((role) => {
          if (!availableRoles.has(role)) {
            throw new VaultError(
              "VAULT_EVIDENCE_ROLE_MISSING",
              `No integration evidence part matched role "${role}" for device event ${event.recordId}.`,
              { eventId: event.recordId, role },
            );
          }
          return role;
        })
      : soleEvidenceRole
        ? [soleEvidenceRole]
        : [];
    const uniqueRoles = [...new Set(roles)];
    evidenceRolesByPreparedRecordId.set(event.recordId, uniqueRoles);
    return {
      ...prepareStoredEventLedgerEntry(event.seed, event.recordId),
      ...(event.externalRefUpdatePolicy
        ? { externalRefUpdatePolicy: event.externalRefUpdatePolicy }
        : {}),
      legacyExternalRefs: event.legacyExternalRefs,
    };
  });

  return { entries, evidenceRolesByPreparedRecordId };
}

function isImplicitDeviceEvidenceFallbackRole(role: string): boolean {
  return !role.startsWith("wearable-canonical-records:")
    && !role.startsWith("wearable-raw-receipt:");
}

interface EventExternalRefReconciliation {
  appendEntries: PreparedJsonlEntry<EventRecord>[];
  appendRecordIdByPreparedRecordId: ReadonlyMap<string, string>;
  records: EventRecord[];
  forceAppendIds: ReadonlySet<string>;
  retainedPreparedIds: ReadonlySet<string>;
  skippedDuplicateCount: number;
  supersededCount: number;
  retractedCount: number;
}

// externalRef.version is intentionally NOT part of the reconcile identity:
// direct providers (WHOOP, Oura, Strava) stamp it from the record's mutable
// updated_at, so a provider-side rescore would change the key and mint a new
// event instead of superseding the existing one. Version still participates in
// content equality, so a version bump with changed data becomes a spine
// revision of the same event.
function eventExternalRefKey(externalRef: ExternalRef): string {
  return stableStringify({
    system: externalRef.system,
    resourceType: externalRef.resourceType,
    resourceId: externalRef.resourceId,
    facet: externalRef.facet ?? null,
  });
}

function compareIncomingExternalRefVersion(
  existing: ExternalRef,
  incoming: ExternalRef,
): number | null {
  const existingVersion = existing.version;
  const incomingVersion = incoming.version;
  if (
    !existingVersion
    || !incomingVersion
    || !isWritableIsoDateTime(existingVersion)
    || !isWritableIsoDateTime(incomingVersion)
  ) {
    return null;
  }

  return compareIsoTimestampsAscending(incomingVersion, existingVersion);
}

const JUNCTION_SPARSE_INTERVAL_RESOURCE_TYPE_SUFFIXES = [
  "-caffeine",
  "-mindfulness-minutes",
  "-water",
] as const;
const MAX_JUNCTION_SPARSE_AFFECTED_DAY_KEYS = 64;

interface JunctionSparseCalendarTarget {
  dayKey: string;
  sourceInstanceId?: string | null;
  sourceProviderSlug: string;
  sourceType?: string;
}

function isJunctionSparseIntervalExternalRef(externalRef: ExternalRef): boolean {
  return externalRef.system === "junction"
    && externalRef.facet === "interval"
    && JUNCTION_SPARSE_INTERVAL_RESOURCE_TYPE_SUFFIXES.some((suffix) =>
      externalRef.resourceType.endsWith(suffix)
    );
}

function junctionSparseAffectedCalendarTargets(
  events: readonly EventRecord[],
  index: EventExternalRefIndex,
): JunctionSparseCalendarTarget[] {
  const targets = new Map<string, JunctionSparseCalendarTarget>();
  for (const event of events) {
    if (!event.externalRef || !isJunctionSparseIntervalExternalRef(event.externalRef)) {
      continue;
    }
    const sourceProviderSlug = event.dataOrigin?.sourceProviderSlug;
    const externalRefSourceProviderSlug = JUNCTION_SPARSE_INTERVAL_RESOURCE_TYPE_SUFFIXES
      .find((suffix) => event.externalRef?.resourceType.endsWith(suffix));
    const resolvedSourceProviderSlug = sourceProviderSlug ?? (
      externalRefSourceProviderSlug
        ? event.externalRef.resourceType.slice(
            "junction-".length,
            -externalRefSourceProviderSlug.length,
          )
        : ""
    );
    if (!resolvedSourceProviderSlug) {
      continue;
    }
    const addTarget = (dayKey: string) => {
      const target: JunctionSparseCalendarTarget = {
        dayKey,
        sourceProviderSlug: resolvedSourceProviderSlug,
        ...(event.dataOrigin?.sourceInstanceId === undefined
          ? {}
          : { sourceInstanceId: event.dataOrigin.sourceInstanceId }),
        ...(event.dataOrigin?.sourceType
          ? { sourceType: event.dataOrigin.sourceType }
          : {}),
      };
      targets.set(stableStringify(target), target);
    };
    addTarget(event.dayKey);
    // Include the immediately displaced provider day so the caller can persist
    // one calendar-refresh job for each side of this accepted transition.
    const previousRevision = eventSpineRevision(event) - 1;
    if (previousRevision < 1) {
      continue;
    }
    const dayHistory = index.junctionSparseDayHistoryById.get(event.id);
    const previousDayKey = dayHistory?.latest.revision === previousRevision
      ? dayHistory.latest.dayKey
      : dayHistory?.previous?.revision === previousRevision
        ? dayHistory.previous.dayKey
        : undefined;
    if (previousDayKey) {
      addTarget(previousDayKey);
    }
  }
  const affectedTargets = [...targets.values()].sort((left, right) =>
    left.dayKey.localeCompare(right.dayKey)
    || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
    || (left.sourceType ?? "").localeCompare(right.sourceType ?? "")
    || (left.sourceInstanceId ?? "").localeCompare(right.sourceInstanceId ?? "")
  );
  const affectedDayKeys = new Set(affectedTargets.map((target) => target.dayKey));
  if (
    affectedDayKeys.size > MAX_JUNCTION_SPARSE_AFFECTED_DAY_KEYS
    || affectedTargets.length > MAX_JUNCTION_SPARSE_AFFECTED_DAY_KEYS
  ) {
    throw new VaultError(
      "DEVICE_IMPORT_AFFECTED_DAY_LIMIT_EXCEEDED",
      "Junction sparse import exceeded the affected provider-day limit; nothing was imported.",
      {
        affectedDayCount: affectedDayKeys.size,
        affectedTargetCount: affectedTargets.length,
        maxAllowed: MAX_JUNCTION_SPARSE_AFFECTED_DAY_KEYS,
      },
    );
  }
  return affectedTargets;
}

function junctionSparseAffectedDayKeys(
  targets: readonly JunctionSparseCalendarTarget[],
): string[] {
  return [...new Set(targets.map((target) => target.dayKey))].sort();
}

// Device-sync content equality ignores per-import identity (id, lifecycle,
// recordedAt) AND rawRefs, because device imports mint fresh raw-artifact
// paths on every sync run. Member-edit comparison additionally excludes the
// immutable provider attribution fields while retaining every public edit.
function eventContentKey(
  record: EventRecord,
  options: { includeProviderAttribution: boolean },
): string {
  const {
    id: _id,
    rawRefs: _rawRefs,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    ...content
  } = record;
  if (options.includeProviderAttribution) {
    return stableStringify(content);
  }

  const {
    dataOrigin: _dataOrigin,
    externalRef: _externalRef,
    ...memberMutableContent
  } = content;
  return stableStringify(memberMutableContent);
}

function deviceEventContentKey(record: EventRecord): string {
  const {
    id: _id,
    rawRefs: _rawRefs,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    externalRef,
    dataOrigin,
    ...semanticContent
  } = record;
  return stableStringify({
    ...semanticContent,
    // Identity and source ordering are enforced independently. Keeping them
    // out of semantic equality prevents a newer provider capture/version from
    // masquerading as a health-data change over a member-authored revision.
    externalRef: externalRef
      ? {
          system: externalRef.system,
          resourceType: externalRef.resourceType,
          resourceId: externalRef.resourceId,
          facet: externalRef.facet ?? null,
        }
      : null,
    dataOrigin: dataOrigin
      ? {
          // This is the fixed data-origin schema discriminator, not the
          // provider resource version used for ordering.
          version: dataOrigin.version,
          aggregatorProvider: dataOrigin.aggregatorProvider ?? null,
          sourceProviderSlug: dataOrigin.sourceProviderSlug ?? null,
          sourceType: dataOrigin.sourceType ?? null,
          sourceInstanceId: dataOrigin.sourceInstanceId ?? null,
        }
      : null,
  });
}

function deviceEventContentFingerprint(record: EventRecord): string {
  return createHash("sha256").update(deviceEventContentKey(record)).digest("hex");
}

// Public bulk-import content equality also ignores per-import identity (id,
// lifecycle, and recordedAt, which defaults to the import wall clock), but it
// keeps rawRefs. For unversioned rows, a rawRefs-only correction supersedes the
// stored event. Comparable versioned rows are ordered by source revision:
// older revisions are skipped, equal revisions must replay-match or the batch
// is rejected as a conflict, and newer revisions supersede.
function eventImportContentKey(record: EventRecord): string {
  const {
    id: _id,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    ...content
  } = record;
  return stableStringify(content);
}

// Equal source revisions must compare caller-supplied provenance while
// ignoring vault-local day placement and equivalent version lexemes.
function eventImportVersionedReplayContentKey(record: EventRecord): string {
  const {
    id: _id,
    dayKey: _dayKey,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    externalRef,
    ...content
  } = record;
  const semanticExternalRef = externalRef
    ? {
        system: externalRef.system,
        resourceType: externalRef.resourceType,
        resourceId: externalRef.resourceId,
        facet: externalRef.facet,
      }
    : undefined;
  return stableStringify({ ...content, externalRef: semanticExternalRef });
}

// Comparable source revisions describe the provider resource, not the local
// retrieval that happened to carry it. Ignore capture-local provenance, the
// vault-timezone-derived day key, and the version lexeme while deciding
// whether an equal revision is a replay.
function eventImportSourceSemanticContentKey(record: EventRecord): string {
  const {
    id: _id,
    dayKey: _dayKey,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    rawRefs: _rawRefs,
    evidence: _evidence,
    externalRef,
    ...content
  } = record;
  const semanticExternalRef = externalRef
    ? {
        system: externalRef.system,
        resourceType: externalRef.resourceType,
        resourceId: externalRef.resourceId,
        facet: externalRef.facet,
      }
    : undefined;
  return stableStringify({ ...content, externalRef: semanticExternalRef });
}

type PreparedEventImportDecision =
  | {
      action: "upsert";
      allowsKindReplacement: boolean;
      entry: PreparedJsonlEntry<EventRecord>;
      expectedLatest?: EventImportUpsertDecision["expectedLatest"];
    }
  | {
      action: "retract";
      externalRef: EventImportRetractionDecision["externalRef"];
      evidence?: EventRecord["evidence"];
      reason: EventImportRetractionDecision["reason"];
      markerEntry: PreparedJsonlEntry<EventRecord>;
    };

const EVENT_IMPORT_RETRACTION_MARKER_NOTE_TYPE = "event_import_retraction_marker";

interface EventImportReconciliation {
  appendEntries: PreparedJsonlEntry<EventRecord>[];
  forceAppendIds: ReadonlySet<string>;
  createdCount: number;
  skippedExistingCount: number;
  supersededCount: number;
  retractedCount: number;
  eventIds: string[];
  retractedEventIds: string[];
  eventShardPaths: string[];
}

function preparedEventImportDecisionExternalRef(
  decision: PreparedEventImportDecision,
): ExternalRef | undefined {
  return decision.action === "retract"
    ? decision.externalRef
    : decision.entry.record.externalRef;
}

function orderEventImportDecisionsBySourceVersion(
  decisions: readonly PreparedEventImportDecision[],
): PreparedEventImportDecision[] {
  const ordered = [...decisions];
  const groups = new Map<string, Array<{ decision: PreparedEventImportDecision; index: number }>>();

  decisions.forEach((decision, index) => {
    const externalRef = preparedEventImportDecisionExternalRef(decision);
    const isExplicitDecision = decision.action === "retract" || decision.allowsKindReplacement;
    if (
      !isExplicitDecision
      || !externalRef?.version
      || !isWritableIsoDateTime(externalRef.version)
    ) {
      return;
    }

    const refKey = eventExternalRefKey(externalRef);
    const group = groups.get(refKey) ?? [];
    group.push({ decision, index });
    groups.set(refKey, group);
  });

  for (const group of groups.values()) {
    const sortedDecisions = group
      .map(({ decision }) => decision)
      .sort((left, right) => {
        const leftRef = preparedEventImportDecisionExternalRef(left);
        const rightRef = preparedEventImportDecisionExternalRef(right);
        return compareIsoTimestampsAscending(leftRef?.version ?? "", rightRef?.version ?? "");
      });
    group.forEach(({ index }, groupIndex) => {
      ordered[index] = sortedDecisions[groupIndex]!;
    });
  }

  return ordered;
}

interface EventExternalRefIndex {
  aliasRepairContaminatedEventIds: Set<string>;
  aliasRepairContaminatedRefKeys: Set<string>;
  aliasRepairHistoryById: Map<string, EventSpineEntry<EventRecord>[]>;
  liveOwnerIdsByRefKey: Map<string, Set<string>>;
  junctionSparseDayHistoryById: Map<string, {
    latest: { dayKey: string; revision: number };
    previous?: { dayKey: string; revision: number };
  }>;
  deviceOwnerRevisionsByRefKeyAndFingerprint: Map<
    string,
    Map<string, Map<string, Set<number>>>
  >;
  junctionNoIdProfilePredecessorsByScope: Map<
    string,
    IndexedEventExternalRefMatch[]
  >;
  latestByRefKey: Map<string, IndexedEventExternalRefMatch>;
  latestById: Map<string, EventRecord>;
  maxRevisionById: Map<string, number>;
  revisionsById: Map<string, Set<number>>;
}

interface IndexedEventExternalRefMatch {
  indexedExternalRef: ExternalRef;
  indexedRecord: EventRecord;
  relativePath: string;
  record: EventRecord;
}

interface EventExternalRefIndexState {
  latestDeviceExternalRefEntryByRefKey: Map<string, EventSpineEntry<EventRecord>>;
  latestExternalRefEntry: EventSpineEntry<EventRecord> | null;
  latestEntry: EventSpineEntry<EventRecord>;
}

async function indexLatestEventsByExternalRef(
  vaultRoot: string,
  relativePaths: readonly string[],
  signal?: AbortSignal | null,
): Promise<EventExternalRefIndex> {
  const aliasRepairContaminatedEventIds = new Set<string>();
  const aliasRepairContaminatedRefKeys = new Set<string>();
  const deviceOwnerRevisionsByRefKeyAndFingerprint = new Map<
    string,
    Map<string, Map<string, Set<number>>>
  >();
  const junctionSparseDayHistoryById: EventExternalRefIndex["junctionSparseDayHistoryById"] =
    new Map();
  const liveOwnerIdsByRefKey = new Map<string, Set<string>>();
  const latestByRefKey = new Map<string, IndexedEventExternalRefMatch>();
  const latestById = new Map<string, EventRecord>();
  const maxRevisionById = new Map<string, number>();
  const revisionsById = new Map<string, Set<number>>();
  const entriesById = new Map<string, EventExternalRefIndexState>();

  for (const relativePath of relativePaths) {
    signal?.throwIfAborted();
    const resolved = resolveVaultPath(vaultRoot, relativePath);

    if (!(await pathExists(resolved.absolutePath))) {
      continue;
    }

    await visitJsonlRecordsInterruptible({
      vaultRoot,
      relativePath,
      signal,
      visit(raw) {
        signal?.throwIfAborted();
        const parsed = safeParseContract(eventRecordSchema, raw);

        if (!parsed.success) {
          if (isLooseRecordValue(raw)) {
            if (typeof raw.id === "string" && raw.id.length > 0) {
              aliasRepairContaminatedEventIds.add(raw.id);
            }
            const rejectedRefKey = readRejectedEventExternalRefKey(raw.externalRef);
            if (rejectedRefKey) {
              aliasRepairContaminatedRefKeys.add(rejectedRefKey);
            }
          }
          return;
        }
        const entry = { relativePath, record: parsed.data };
        maxRevisionById.set(
          entry.record.id,
          Math.max(maxRevisionById.get(entry.record.id) ?? 0, eventSpineRevision(entry.record)),
        );
        const revisions = revisionsById.get(entry.record.id) ?? new Set<number>();
        const revision = eventSpineRevision(entry.record);
        revisions.add(revision);
        revisionsById.set(entry.record.id, revisions);
        if (
          entry.record.externalRef
          && isJunctionSparseIntervalExternalRef(entry.record.externalRef)
        ) {
          const candidate = { dayKey: entry.record.dayKey, revision };
          const history = junctionSparseDayHistoryById.get(entry.record.id);
          if (!history || revision > history.latest.revision) {
            junctionSparseDayHistoryById.set(entry.record.id, {
              latest: candidate,
              ...(history ? { previous: history.latest } : {}),
            });
          } else if (
            revision < history.latest.revision
            && (!history.previous || revision > history.previous.revision)
          ) {
            junctionSparseDayHistoryById.set(entry.record.id, {
              latest: history.latest,
              previous: candidate,
            });
          }
        }

        const state = entriesById.get(entry.record.id);
        const latestDeviceExternalRefEntryByRefKey =
          state?.latestDeviceExternalRefEntryByRefKey ?? new Map<string, EventSpineEntry<EventRecord>>();

        if (entry.record.source === "device" && entry.record.externalRef) {
          const refKey = eventExternalRefKey(entry.record.externalRef);
          const ownersByFingerprint = deviceOwnerRevisionsByRefKeyAndFingerprint.get(refKey)
            ?? new Map<string, Map<string, Set<number>>>();
          const fingerprint = deviceEventContentFingerprint(entry.record);
          const revisionsByOwnerId = ownersByFingerprint.get(fingerprint)
            ?? new Map<string, Set<number>>();
          const ownerRevisions = revisionsByOwnerId.get(entry.record.id) ?? new Set<number>();
          ownerRevisions.add(eventSpineRevision(entry.record));
          revisionsByOwnerId.set(entry.record.id, ownerRevisions);
          ownersByFingerprint.set(fingerprint, revisionsByOwnerId);
          deviceOwnerRevisionsByRefKeyAndFingerprint.set(refKey, ownersByFingerprint);
          const latestDeviceExternalRefEntry = latestDeviceExternalRefEntryByRefKey.get(refKey);
          if (!latestDeviceExternalRefEntry || compareEventSpineEntries(latestDeviceExternalRefEntry, entry) < 0) {
            latestDeviceExternalRefEntryByRefKey.set(refKey, entry);
          }
        }

        const latestExternalRefEntry = entry.record.externalRef &&
            (!state?.latestExternalRefEntry || compareEventSpineEntries(state.latestExternalRefEntry, entry) < 0)
          ? entry
          : state?.latestExternalRefEntry ?? null;

        entriesById.set(entry.record.id, {
          latestDeviceExternalRefEntryByRefKey,
          latestEntry: !state || compareEventSpineEntries(state.latestEntry, entry) < 0
            ? entry
            : state.latestEntry,
          latestExternalRefEntry,
        });
      },
    });
  }

  const groupedByRefKey = new Map<string, IndexedEventExternalRefMatch[]>();

  for (const state of entriesById.values()) {
    signal?.throwIfAborted();
    // Collapse each event id globally before indexing external refs. An event
    // whose latest revision moved to a corrected ref must not remain
    // discoverable through an older historical ref.
    const latestForId = state.latestEntry;
    latestById.set(latestForId.record.id, latestForId.record);
    const externalRefEntry = latestForId.record.externalRef
      ? latestForId
      : state.latestExternalRefEntry;

    if (!externalRefEntry?.record.externalRef) {
      continue;
    }

    const refKey = eventExternalRefKey(externalRefEntry.record.externalRef);
    const indexedExternalRefEntry =
      state.latestDeviceExternalRefEntryByRefKey.get(refKey) ?? externalRefEntry;
    const refGroup = groupedByRefKey.get(refKey) ?? [];
    const indexedMatch = {
      indexedExternalRef: indexedExternalRefEntry.record.externalRef ?? externalRefEntry.record.externalRef,
      indexedRecord: indexedExternalRefEntry.record,
      relativePath: latestForId.relativePath,
      record: latestForId.record,
    };
    refGroup.push(indexedMatch);
    groupedByRefKey.set(refKey, refGroup);
    if (!isDeletedEventSpineRecord(latestForId.record)) {
      const liveOwnerIds = liveOwnerIdsByRefKey.get(refKey) ?? new Set<string>();
      liveOwnerIds.add(latestForId.record.id);
      liveOwnerIdsByRefKey.set(refKey, liveOwnerIds);
    }
  }

  for (const [refKey, group] of groupedByRefKey) {
    signal?.throwIfAborted();
    // Preserve the prior duplicate-ref behavior: if multiple live ids still
    // claim one external ref, reconcile against the latest comparable spine.
    const latest = selectLatestIndexedEventExternalRefMatch(group);

    if (latest) {
      latestByRefKey.set(refKey, latest);
    }
  }

  const junctionNoIdProfilePredecessorsByScope =
    indexJunctionNoIdProfilePredecessors(latestByRefKey.values());

  return {
    aliasRepairContaminatedEventIds,
    aliasRepairContaminatedRefKeys,
    aliasRepairHistoryById: new Map(),
    deviceOwnerRevisionsByRefKeyAndFingerprint,
    junctionNoIdProfilePredecessorsByScope,
    junctionSparseDayHistoryById,
    latestByRefKey,
    latestById,
    liveOwnerIdsByRefKey,
    maxRevisionById,
    revisionsById,
  };
}

async function loadBoundedAliasRepairHistories(
  vaultRoot: string,
  relativePaths: readonly string[],
  eventIds: ReadonlySet<string>,
): Promise<Map<string, EventSpineEntry<EventRecord>[]>> {
  const histories = new Map<string, EventSpineEntry<EventRecord>[]>();
  for (const relativePath of relativePaths) {
    await visitJsonlRecordsInterruptible({
      vaultRoot,
      relativePath,
      visit(raw) {
        const parsed = safeParseContract(eventRecordSchema, raw);
        if (!parsed.success || !eventIds.has(parsed.data.id)) {
          return;
        }
        const history = histories.get(parsed.data.id) ?? [];
        if (history.length <= MAX_JUNCTION_DAILY_ALIAS_REPAIR_REVISIONS) {
          history.push({ relativePath, record: parsed.data });
          histories.set(parsed.data.id, history);
        }
      },
    });
  }
  for (const history of histories.values()) {
    history.sort((left, right) =>
      eventSpineRevision(left.record) - eventSpineRevision(right.record)
    );
  }
  return histories;
}

function isSameObservationFacet(existing: EventRecord, incoming: EventRecord): boolean {
  return existing.kind === "observation" &&
    incoming.kind === "observation" &&
    existing.metric === incoming.metric &&
    existing.unit === incoming.unit &&
    existing.observationGrain === incoming.observationGrain;
}

function isSameObservationValue(existing: EventRecord, incoming: EventRecord): boolean {
  return isSameObservationFacet(existing, incoming) &&
    existing.kind === "observation" &&
    incoming.kind === "observation" &&
    existing.value === incoming.value;
}

const JUNCTION_SLEEP_STAGE_METRIC_FACETS = new Set([
  "sleep-awake-minutes",
  "sleep-light-minutes",
  "sleep-deep-minutes",
  "sleep-rem-minutes",
]);
const JUNCTION_SLEEP_STAGE_SUMMARY_NORMALIZER_VERSION = "junction-sleep-stage-summary.v1";
const JUNCTION_SLEEP_STAGE_CYCLE_FALLBACK_NORMALIZER_VERSION = "junction-sleep-stage-cycle-fallback.v1";
const JUNCTION_NO_ID_PROFILE_NORMALIZER_VERSION = "junction-no-id-profile.v1";
const JUNCTION_STABLE_PROFILE_CREATED_AT_NORMALIZER_VERSION =
  "junction-stable-profile-created-at.v1";

function deviceDataOriginSourceMatches(
  existing: DeviceDataOrigin | undefined,
  incoming: DeviceDataOrigin | undefined,
): boolean {
  if (!existing || !incoming) {
    return false;
  }

  let compared = false;
  for (const key of ["aggregatorProvider", "sourceProviderSlug", "sourceType", "sourceInstanceId"] as const) {
    const existingValue = existing[key];
    const incomingValue = incoming[key];

    if (existingValue === undefined && incomingValue === undefined) {
      continue;
    }

    compared = true;
    if (existingValue !== incomingValue) {
      return false;
    }
  }

  return compared;
}

function junctionNoIdProfileScopeKey(
  externalRef: ExternalRef | undefined,
  origin: DeviceDataOrigin | undefined,
): string | null {
  if (
    externalRef?.system !== "junction"
    || !externalRef.resourceType.endsWith("-profile")
    || typeof externalRef.facet !== "string"
    || !/^profile-[a-f0-9]{16}$/u.test(externalRef.resourceId)
    || origin?.sourceProviderSlug === undefined
  ) {
    return null;
  }

  return stableStringify({
    resourceType: externalRef.resourceType,
    facet: externalRef.facet,
    aggregatorProvider: origin.aggregatorProvider,
    sourceProviderSlug: origin.sourceProviderSlug,
    sourceType: origin.sourceType,
    sourceInstanceId: origin.sourceInstanceId,
  });
}

function junctionNoIdProfileResourceId(
  origin: DeviceDataOrigin,
  occurredAt: string,
): string {
  return `profile-${createHash("sha256")
    .update(JSON.stringify([
      "profile",
      origin.sourceProviderSlug,
      origin.sourceType,
      origin.sourceInstanceId,
      occurredAt,
    ]))
    .digest("hex")
    .slice(0, 16)}`;
}

function junctionNoIdProfileProviderBaselineRevision(
  match: IndexedEventExternalRefMatch,
): string | null {
  const externalRef = match.indexedExternalRef;
  const providerRecord = match.indexedRecord;
  const origin = providerRecord.dataOrigin;
  const isCurrentNoIdProfile = origin?.normalizerVersion
    === JUNCTION_NO_ID_PROFILE_NORMALIZER_VERSION;
  const isLegacyNoIdProfile = origin?.normalizerVersion === "junction-normalizer.v1";
  const persistedRevision = isCurrentNoIdProfile
    ? externalRef.version
    : externalRef.version ?? providerRecord.occurredAt;
  if (
    (!isCurrentNoIdProfile && !isLegacyNoIdProfile)
    || !junctionNoIdProfileScopeKey(externalRef, origin)
    || persistedRevision === undefined
    || !isWritableIsoDateTime(persistedRevision)
    || !isWritableIsoDateTime(providerRecord.occurredAt)
    || origin?.observedAtRaw !== providerRecord.occurredAt
    || (isLegacyNoIdProfile && providerRecord.occurredAt !== persistedRevision)
  ) {
    return null;
  }

  const expectedResourceId = junctionNoIdProfileResourceId(origin, providerRecord.occurredAt);
  return externalRef.resourceId === expectedResourceId ? persistedRevision : null;
}

function junctionNoIdProfilePredecessorRevision(
  match: IndexedEventExternalRefMatch,
): string | null {
  return isDeletedEventSpineRecord(match.record)
    ? null
    : junctionNoIdProfileProviderBaselineRevision(match);
}

function isJunctionNoIdProfilePredecessor(
  match: IndexedEventExternalRefMatch,
): boolean {
  return junctionNoIdProfileProviderBaselineRevision(match) !== null;
}

function indexJunctionNoIdProfilePredecessors(
  matches: Iterable<IndexedEventExternalRefMatch>,
): Map<string, IndexedEventExternalRefMatch[]> {
  const byScope = new Map<string, IndexedEventExternalRefMatch[]>();
  for (const match of matches) {
    if (!isJunctionNoIdProfilePredecessor(match)) {
      continue;
    }

    const scopeKey = junctionNoIdProfileScopeKey(
      match.indexedExternalRef,
      match.indexedRecord.dataOrigin,
    );
    if (!scopeKey) {
      continue;
    }

    const scopedMatches = byScope.get(scopeKey) ?? [];
    scopedMatches.push(match);
    byScope.set(scopeKey, scopedMatches);
  }
  return byScope;
}

function isIncomingJunctionNoIdProfile(record: EventRecord): boolean {
  return record.dataOrigin?.normalizerVersion === JUNCTION_NO_ID_PROFILE_NORMALIZER_VERSION
    && junctionNoIdProfileScopeKey(record.externalRef, record.dataOrigin) !== null;
}

function isIncomingJunctionStableProfileCreatedAt(record: EventRecord): boolean {
  return record.dataOrigin?.normalizerVersion === JUNCTION_STABLE_PROFILE_CREATED_AT_NORMALIZER_VERSION
    && junctionNoIdProfileScopeKey(record.externalRef, record.dataOrigin) !== null;
}

function isExactJunctionProfileCreatedAtTimestampReplay(
  existing: EventRecord,
  incoming: EventRecord,
): boolean {
  const existingRef = existing.externalRef;
  const incomingRef = incoming.externalRef;
  const existingOrigin = existing.dataOrigin;
  const incomingOrigin = incoming.dataOrigin;
  const existingRevision = existingRef?.version ?? existing.occurredAt;
  const existingScopeKey = junctionNoIdProfileScopeKey(existingRef, existingOrigin);
  const incomingScopeKey = junctionNoIdProfileScopeKey(incomingRef, incomingOrigin);
  if (
    !existingOrigin
    || !incomingOrigin
    || existingScopeKey === null
    || existingScopeKey !== incomingScopeKey
    || !existingRef
    || !incomingRef?.version
    || !isWritableIsoDateTime(existingRevision)
    || !isWritableIsoDateTime(incomingRef.version)
    || !isWritableIsoDateTime(existing.occurredAt)
    || !isWritableIsoDateTime(existing.recordedAt)
    || !isWritableIsoDateTime(incoming.occurredAt)
    || !isWritableIsoDateTime(incoming.recordedAt)
    || compareIsoTimestampsAscending(incomingRef.version, existingRevision) !== 0
    || (
      !isDeletedEventSpineRecord(existing)
      && compareIsoTimestampsAscending(existing.recordedAt, existing.occurredAt) !== 0
    )
    || (
      isDeletedEventSpineRecord(existing)
      && compareIsoTimestampsAscending(existing.recordedAt, existing.occurredAt) < 0
    )
    || existing.dayKey !== toIsoTimestamp(existing.occurredAt, "existing.occurredAt").slice(0, 10)
    || compareIsoTimestampsAscending(incoming.occurredAt, existing.occurredAt) >= 0
    || compareIsoTimestampsAscending(incoming.recordedAt, incoming.occurredAt) !== 0
    || incoming.dayKey !== toIsoTimestamp(incoming.occurredAt, "incoming.occurredAt").slice(0, 10)
    || existingOrigin.observedAtRaw !== existing.occurredAt
    || incomingOrigin.observedAtRaw !== incoming.occurredAt
    || !deviceDataOriginSourceMatches(existingOrigin, incomingOrigin)
    || existingOrigin.timeZoneOffsetMinutes !== incomingOrigin.timeZoneOffsetMinutes
    || existingOrigin.timestampSemantics !== incomingOrigin.timestampSemantics
    || existingOrigin.originConfidence !== incomingOrigin.originConfidence
  ) {
    return false;
  }

  return deviceEventContentKey({
    ...existing,
    occurredAt: incoming.occurredAt,
    recordedAt: incoming.recordedAt,
    dayKey: incoming.dayKey,
    externalRef: incomingRef,
    dataOrigin: incomingOrigin,
  }) === deviceEventContentKey(incoming);
}

// One released Junction normalizer pinned stable-profile occurrence to the
// mutable updated-at revision. The successor pins occurrence to created-at but
// deliberately keeps updated-at as source ordering. Admit only that exact,
// one-way timestamp-only replay so the generic equal-revision guard remains
// fail-closed for health-data changes.
function isJunctionStableProfileCreatedAtTimestampMigration(
  existing: EventRecord,
  incoming: EventRecord,
): boolean {
  const existingRef = existing.externalRef;
  const incomingRef = incoming.externalRef;
  return isIncomingJunctionStableProfileCreatedAt(incoming)
    && existing.dataOrigin?.normalizerVersion === "junction-normalizer.v1"
    && existingRef?.version !== undefined
    && incomingRef !== undefined
    && eventExternalRefKey(existingRef) === eventExternalRefKey(incomingRef)
    && isExactJunctionProfileCreatedAtTimestampReplay(existing, incoming);
}

// Revision-2 admission is account-wide, so a released no-ID profile can be
// replayed after created_at becomes available while updated_at (the provider
// revision) is unchanged. Its timestamp-derived resource identity changes,
// but the replay must not split a member edit or bypass a deletion. Retain the
// old identity only for this exact timestamp-only transition; changed health
// data at the same source revision remains a conflict.
function isJunctionNoIdProfileEqualRevisionTimestampReplay(
  existing: EventRecord,
  incoming: EventRecord,
): boolean {
  const existingRef = existing.externalRef;
  const incomingRef = incoming.externalRef;
  const existingOrigin = existing.dataOrigin;
  const incomingOrigin = incoming.dataOrigin;
  if (
    !isIncomingJunctionNoIdProfile(incoming)
    || !existingRef
    || !incomingRef
    || !existingOrigin
    || !incomingOrigin
    || eventExternalRefKey(existingRef) === eventExternalRefKey(incomingRef)
    || junctionNoIdProfileResourceId(existingOrigin, existing.occurredAt)
      !== existingRef.resourceId
    || junctionNoIdProfileResourceId(incomingOrigin, incoming.occurredAt)
      !== incomingRef.resourceId
    || !(
      existingOrigin.normalizerVersion === "junction-normalizer.v1"
      || existingOrigin.normalizerVersion === JUNCTION_NO_ID_PROFILE_NORMALIZER_VERSION
    )
  ) {
    return false;
  }

  return isExactJunctionProfileCreatedAtTimestampReplay(existing, incoming);
}

function isMemberDeletedJunctionStableProfile(
  existing: EventRecord,
  incoming: EventRecord,
): boolean {
  const existingRef = existing.externalRef;
  const incomingRef = incoming.externalRef;
  if (!existingRef || !incomingRef) {
    return false;
  }
  return isDeletedEventSpineRecord(existing)
    && isIncomingJunctionStableProfileCreatedAt(incoming)
    && junctionNoIdProfileScopeKey(existingRef, existing.dataOrigin) !== null
    && eventExternalRefKey(existingRef) === eventExternalRefKey(incomingRef)
    && deviceDataOriginSourceMatches(existing.dataOrigin, incoming.dataOrigin)
    && existingRef?.version !== undefined
    && isWritableIsoDateTime(existingRef.version)
    && isWritableIsoDateTime(existing.recordedAt)
    && compareIsoTimestampsAscending(existing.recordedAt, existingRef.version) > 0;
}

function isDateLikeWhoopBodyMeasurementResourceId(resourceId: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(resourceId) ||
    /^date:\d{4}-\d{2}-\d{2}$/u.test(resourceId);
}

function isScopedDateLikeWhoopBodyMeasurementResourceId(resourceId: string): boolean {
  return /(?:^|\/)date:\d{4}-\d{2}-\d{2}$/u.test(resourceId);
}

function isWhoopBodyMeasurementDateOnlyLegacyRef(
  legacyExternalRef: ExternalRef,
  incoming: EventRecord,
): boolean {
  return legacyExternalRef.system === "whoop" &&
    legacyExternalRef.resourceType === "body-measurement" &&
    isDateLikeWhoopBodyMeasurementResourceId(legacyExternalRef.resourceId) &&
    incoming.externalRef?.system === "whoop" &&
    incoming.externalRef.resourceType === "body-measurement" &&
    isScopedDateLikeWhoopBodyMeasurementResourceId(incoming.externalRef.resourceId);
}

function isJunctionSleepStageExternalRefInput(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const externalRef = value as UnknownRecord;
  return externalRef.system === "junction" &&
    typeof externalRef.resourceType === "string" &&
    /^junction-[a-z0-9-]+-sleep$/u.test(externalRef.resourceType) &&
    typeof externalRef.facet === "string" &&
    JUNCTION_SLEEP_STAGE_METRIC_FACETS.has(externalRef.facet);
}

function isJunctionSleepStageObservation(record: EventRecord): boolean {
  return record.kind === "observation" &&
    isJunctionSleepStageExternalRefInput(record.externalRef);
}

function isJunctionSleepStageSummaryObservation(record: EventRecord): boolean {
  return isJunctionSleepStageObservation(record) &&
    record.dataOrigin?.normalizerVersion === JUNCTION_SLEEP_STAGE_SUMMARY_NORMALIZER_VERSION;
}

function isJunctionSleepStageCycleFallbackObservation(record: EventRecord): boolean {
  return isJunctionSleepStageObservation(record) &&
    record.dataOrigin?.normalizerVersion === JUNCTION_SLEEP_STAGE_CYCLE_FALLBACK_NORMALIZER_VERSION;
}

function isJunctionSleepStageSummaryLegacyRef(
  legacyExternalRef: ExternalRef,
  incoming: EventRecord,
): boolean {
  return isJunctionSleepStageSummaryObservation(incoming) &&
    legacyExternalRef.system === "junction" &&
    incoming.externalRef?.system === "junction" &&
    legacyExternalRef.resourceType === incoming.externalRef.resourceType &&
    /^junction-[a-z0-9-]+-sleep$/u.test(legacyExternalRef.resourceType) &&
    legacyExternalRef.facet !== undefined &&
    legacyExternalRef.facet === incoming.externalRef.facet &&
    JUNCTION_SLEEP_STAGE_METRIC_FACETS.has(legacyExternalRef.facet);
}

function hasStableJunctionSleepStageSummaryLegacyProof(
  existing: IndexedEventExternalRefMatch,
  incoming: EventRecord,
): boolean {
  if (!isSameObservationFacet(existing.record, incoming)) {
    return false;
  }

  const existingDataOrigin = existing.indexedRecord.dataOrigin ?? existing.record.dataOrigin;
  return existing.record.occurredAt === incoming.occurredAt &&
    deviceDataOriginSourceMatches(existingDataOrigin, incoming.dataOrigin);
}

function shouldKeepExistingJunctionSleepStageSummaryObservation(
  existing: EventRecord,
  incoming: EventRecord,
): boolean {
  if (!isSameObservationFacet(existing, incoming)) {
    return false;
  }

  return isJunctionSleepStageSummaryObservation(existing) &&
    isJunctionSleepStageCycleFallbackObservation(incoming);
}

const JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_TYPE =
  "companion-whoop-metadata-unverified";
const JUNCTION_SPARSE_FLOATING_FALLBACK_NORMALIZER_VERSION =
  "junction-sparse-timeseries.floating-fallback.v2";

function resolveJunctionFloatingFallbackTime(
  existing: EventRecord | undefined,
  incoming: EventRecord,
): EventRecord | null {
  if (
    incoming.externalRef?.system !== "junction"
    || incoming.dataOrigin?.normalizerVersion
      !== JUNCTION_SPARSE_FLOATING_FALLBACK_NORMALIZER_VERSION
    || incoming.dataOrigin.timestampSemantics !== "floating"
  ) {
    return incoming;
  }

  if (!incoming.timeZone) {
    return incoming;
  }

  // Junction documents Libre's +00:00 values as wall clocks, not instants.
  // The importer carries those raw wall values through a schema-valid transient
  // event. Resolve them only after stable external identity lookup, so a matched
  // row uses its event spine's accepted zone while a new row uses the incoming
  // fallback zone. Each endpoint resolves independently across DST transitions.
  const acceptedExisting = existing?.externalRef?.system === "junction"
    && existing.dataOrigin?.timestampSemantics === "floating"
    && deviceDataOriginSourceMatches(existing.dataOrigin, incoming.dataOrigin)
    ? existing
    : undefined;
  const targetTimeZone = acceptedExisting?.timeZone ?? incoming.timeZone;
  const startRaw = incoming.dataOrigin.observedAtRaw;
  if (typeof startRaw !== "string") {
    return incoming;
  }
  const resolvedOccurrence = resolveFloatingIsoTimestampInTimeZone(
    startRaw,
    targetTimeZone,
  );
  const resolvedStart = incoming.kind === "intervention_session"
    && typeof incoming.fields?.["start-at"] === "string"
    ? resolveFloatingIsoTimestampInTimeZone(
        incoming.fields["start-at"],
        targetTimeZone,
      )
    : undefined;
  const resolvedStartAt = resolvedStart?.timestamp;
  const resolvedEndAt = incoming.kind === "intervention_session"
    && typeof incoming.fields?.["end-at"] === "string"
    ? resolveFloatingIsoTimestampInTimeZone(
        incoming.fields["end-at"],
        targetTimeZone,
      )?.timestamp
    : undefined;
  if (
    !resolvedOccurrence
    || (
      incoming.kind === "intervention_session"
      && (
        !resolvedStartAt
        || !resolvedEndAt
        || Date.parse(resolvedEndAt) < Date.parse(resolvedStartAt)
      )
    )
  ) {
    return null;
  }
  const resolvedInterventionFields = incoming.kind === "intervention_session"
    && incoming.fields
    ? {
        ...incoming.fields,
        ...(resolvedStartAt ? { "start-at": resolvedStartAt } : {}),
        ...(resolvedEndAt ? { "end-at": resolvedEndAt } : {}),
      }
    : undefined;
  const canonicalOccurrence = incoming.kind === "intervention_session"
    && resolvedStartAt
    ? resolvedStartAt
    : resolvedOccurrence.timestamp;
  const canonicalDayKey = incoming.kind === "intervention_session"
    && resolvedStart
    ? resolvedStart.dayKey
    : resolvedOccurrence.dayKey;
  return {
    ...incoming,
    occurredAt: canonicalOccurrence,
    recordedAt: acceptedExisting?.recordedAt ?? incoming.recordedAt,
    dayKey: canonicalDayKey,
    timeZone: targetTimeZone,
    ...(incoming.kind === "intervention_session" && resolvedInterventionFields
      ? { fields: resolvedInterventionFields }
      : {}),
  };
}

function resolveJunctionFloatingFallbackEntries(
  entries: readonly PreparedDeviceEventEntry[],
  context: DeviceEventIdentityContext,
): PreparedDeviceEventEntry[] {
  return entries.flatMap((entry) => {
    if (
      entry.record.externalRef?.system !== "junction"
      || entry.record.dataOrigin?.normalizerVersion
        !== JUNCTION_SPARSE_FLOATING_FALLBACK_NORMALIZER_VERSION
    ) {
      return [entry];
    }
    const resolved = resolveDeviceEventIdentity(entry, context, { strict: true });
    const indexedProviderMatch = resolved?.matchedEntries.find(
      (match) => match.indexedMatch.record.id === resolved.latest?.id,
    )?.indexedMatch ?? resolved?.matchedEntries[0]?.indexedMatch;
    const canonicalRecord = resolveJunctionFloatingFallbackTime(
      indexedProviderMatch?.indexedRecord,
      entry.record,
    );
    return canonicalRecord
      ? [{
          ...entry,
          relativePath: toEventLedgerFile(canonicalRecord.occurredAt),
          record: canonicalRecord,
        }]
      : [];
  });
}

function parseJunctionCompanionSyncVersion(version: string | undefined): number | undefined {
  if (!version || !/^(?:0|[1-9]\d*)$/u.test(version)) {
    return undefined;
  }

  const parsed = Number(version);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function shouldKeepExistingJunctionCompanionHealthMetadata(
  existing: EventRecord,
  incoming: EventRecord,
): boolean {
  if (
    existing.kind !== "observation"
    || incoming.kind !== "observation"
    || existing.externalRef?.system !== "junction"
    || incoming.externalRef?.system !== "junction"
    || existing.dataOrigin?.sourceType !== JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_TYPE
    || incoming.dataOrigin?.sourceType !== JUNCTION_COMPANION_HEALTH_METADATA_SOURCE_TYPE
  ) {
    return false;
  }

  const existingVersion = parseJunctionCompanionSyncVersion(existing.externalRef.version);
  if (existingVersion === undefined) {
    return false;
  }

  const incomingVersion = parseJunctionCompanionSyncVersion(incoming.externalRef.version);
  return incomingVersion === undefined || incomingVersion <= existingVersion;
}

function hasStableLegacyOccurrenceProof(
  existing: IndexedEventExternalRefMatch,
  incoming: EventRecord,
  legacyExternalRef: ExternalRef,
): boolean {
  if (isWhoopBodyMeasurementDateOnlyLegacyRef(legacyExternalRef, incoming)) {
    return existing.record.recordedAt === incoming.recordedAt &&
      isSameObservationValue(existing.record, incoming);
  }

  if (existing.indexedRecord.occurredAt === incoming.occurredAt || existing.record.occurredAt === incoming.occurredAt) {
    const existingDataOrigin = existing.indexedRecord.dataOrigin ?? existing.record.dataOrigin;
    if (existingDataOrigin || incoming.dataOrigin) {
      return deviceDataOriginSourceMatches(existingDataOrigin, incoming.dataOrigin) &&
        isSameObservationValue(existing.record, incoming);
    }

    return isSameObservationValue(existing.record, incoming);
  }

  return false;
}

function isCompatibleLegacyExternalRefMatch(
  existing: IndexedEventExternalRefMatch,
  incoming: EventRecord,
  legacyExternalRef: ExternalRef,
): boolean {
  if (existing.record.kind !== incoming.kind) {
    return false;
  }

  if (existing.indexedExternalRef.system !== legacyExternalRef.system ||
    existing.indexedExternalRef.resourceType !== legacyExternalRef.resourceType ||
    existing.indexedExternalRef.facet !== legacyExternalRef.facet ||
    incoming.externalRef?.system !== legacyExternalRef.system ||
    incoming.externalRef.resourceType !== legacyExternalRef.resourceType ||
    incoming.externalRef.facet !== legacyExternalRef.facet) {
    return false;
  }

  if (isWhoopBodyMeasurementDateOnlyLegacyRef(legacyExternalRef, incoming)) {
    return isSameObservationFacet(existing.record, incoming) &&
      hasStableLegacyOccurrenceProof(existing, incoming, legacyExternalRef);
  }

  if (isJunctionSleepStageSummaryLegacyRef(legacyExternalRef, incoming)) {
    return hasStableJunctionSleepStageSummaryLegacyProof(existing, incoming);
  }

  return existing.record.dayKey === incoming.dayKey ||
    (isSameObservationFacet(existing.record, incoming) &&
      hasStableLegacyOccurrenceProof(existing, incoming, legacyExternalRef));
}

function selectLatestIndexedEventExternalRefMatch(
  entries: readonly IndexedEventExternalRefMatch[],
): IndexedEventExternalRefMatch | null {
  if (entries.length === 0) {
    return null;
  }

  const hasOrderedImportSourceVersions = entries.every((entry) =>
    entry.record.source === "import"
    && entry.indexedExternalRef.version !== undefined
    && isWritableIsoDateTime(entry.indexedExternalRef.version)
  );
  if (hasOrderedImportSourceVersions) {
    return entries.reduce((latest, candidate) => {
      const sourceVersionComparison = compareIncomingExternalRefVersion(
        latest.indexedExternalRef,
        candidate.indexedExternalRef,
      );
      if (sourceVersionComparison !== null && sourceVersionComparison !== 0) {
        return sourceVersionComparison > 0 ? candidate : latest;
      }

      const latestDeleted = isDeletedEventSpineRecord(latest.record);
      const candidateDeleted = isDeletedEventSpineRecord(candidate.record);
      if (latestDeleted !== candidateDeleted) {
        return candidateDeleted ? latest : candidate;
      }

      const recordedAtComparison = compareIsoTimestampsAscending(
        candidate.record.recordedAt,
        latest.record.recordedAt,
      );
      if (recordedAtComparison !== 0) {
        return recordedAtComparison > 0 ? candidate : latest;
      }
      if (candidate.relativePath !== latest.relativePath) {
        return candidate.relativePath > latest.relativePath ? candidate : latest;
      }
      return candidate.record.id > latest.record.id ? candidate : latest;
    });
  }

  const liveEntries = entries.filter((entry) => !isDeletedEventSpineRecord(entry.record));
  const candidates = liveEntries.length > 0 ? liveEntries : entries;

  return candidates.reduce((latest, candidate) =>
    compareEventSpineEntries(latest, candidate) >= 0 ? latest : candidate
  );
}

function toIndexedExternalRefMatch(
  record: EventRecord,
  externalRef: ExternalRef,
  relativePath = "",
): IndexedEventExternalRefMatch {
  return {
    indexedExternalRef: externalRef,
    indexedRecord: record,
    relativePath,
    record,
  };
}

interface LegacyExternalRefReservation {
  entry: PreparedDeviceEventEntry;
  indexedMatch: IndexedEventExternalRefMatch;
}

interface DeviceEventIdentityContext {
  index: EventExternalRefIndex;
  legacyReservations: ReadonlyMap<string, LegacyExternalRefReservation>;
}

interface ResolvedDeviceEventIdentity {
  associationSafe: boolean;
  latest: EventRecord | undefined;
  matchedEntries: Array<{ refKey: string; indexedMatch: IndexedEventExternalRefMatch }>;
  refKey: string;
}

interface CurrentDeviceEventOwners {
  allExist: boolean;
  associationSafePreparedIds: ReadonlySet<string>;
  canonicalIdByPreparedId: ReadonlyMap<string, string>;
  currentRecordByPreparedId: ReadonlyMap<string, EventRecord>;
  historicalContentOwnerRevisionsByPreparedId: ReadonlyMap<
    string,
    ReadonlyMap<string, ReadonlySet<number>>
  >;
  historicallyDeliveredPreparedIds: ReadonlySet<string>;
  incomingNewerPreparedIds: ReadonlySet<string>;
  physicallyExistingPreparedIds: ReadonlySet<string>;
}

function userAuthoredEventStateKey(record: EventRecord): string {
  return eventContentKey(record, { includeProviderAttribution: false });
}

function hasHistoricalExternalRefUserAuthoredChanges(match: IndexedEventExternalRefMatch): boolean {
  return eventSpineRevision(match.record) > eventSpineRevision(match.indexedRecord) &&
    userAuthoredEventStateKey(match.record) !== userAuthoredEventStateKey(match.indexedRecord);
}

function buildLegacyExternalRefReservations(
  entries: readonly PreparedDeviceEventEntry[],
  index: EventExternalRefIndex,
): Map<string, LegacyExternalRefReservation> {
  const reservations = new Map<string, LegacyExternalRefReservation>();

  const reserve = (
    entry: PreparedDeviceEventEntry,
    refKey: string,
    indexedMatch: IndexedEventExternalRefMatch,
  ): void => {
    const existing = reservations.get(refKey);
    if (existing && existing.entry !== entry) {
      const externalRef = indexedMatch.indexedExternalRef;
      throw new VaultError(
        "EVENT_EXTERNAL_REF_ALIAS_CONFLICT",
        `Event legacy externalRef "${externalRef.system}/${externalRef.resourceType}/` +
          `${externalRef.resourceId}${externalRef.facet ? `#${externalRef.facet}` : ""}" ` +
          "matched multiple incoming device events; ambiguous legacy cleanup must be repaired explicitly.",
      );
    }

    reservations.set(refKey, { entry, indexedMatch });
  };

  for (const entry of entries) {
    const externalRef = entry.record.externalRef;
    if (!externalRef) {
      continue;
    }

    const primaryRefKey = eventExternalRefKey(externalRef);
    const dailyAliasOwnerSplit = resolveJunctionDailyAggregateAliasOwnerSplit(
      entry,
      index,
    );
    for (const legacyExternalRef of entry.legacyExternalRefs) {
      const legacyRefKey = eventExternalRefKey(legacyExternalRef);
      if (legacyRefKey === primaryRefKey) {
        continue;
      }

      const persistedAliasMatch = dailyAliasOwnerSplit?.legacyRefKey === legacyRefKey
        ? dailyAliasOwnerSplit.legacyOwner
        : undefined;
      const indexedMatch = persistedAliasMatch ?? index.latestByRefKey.get(legacyRefKey);
      if (
        !indexedMatch
        || (
          !persistedAliasMatch
          && !isCompatibleLegacyExternalRefMatch(
            indexedMatch,
            entry.record,
            legacyExternalRef,
          )
        )
      ) {
        continue;
      }

      reserve(entry, legacyRefKey, indexedMatch);
    }

    if (!isIncomingJunctionNoIdProfile(entry.record)) {
      continue;
    }

    const scopeKey = junctionNoIdProfileScopeKey(externalRef, entry.record.dataOrigin);
    const incomingRevision = externalRef.version;
    if (!scopeKey || !incomingRevision || !isWritableIsoDateTime(incomingRevision)) {
      continue;
    }
    const scopedMatches = (index.junctionNoIdProfilePredecessorsByScope.get(scopeKey) ?? [])
      .filter((match) => eventExternalRefKey(match.indexedExternalRef) !== primaryRefKey);
    const equalRevisionMatches = scopedMatches.filter((match) => {
      const predecessorRevision = junctionNoIdProfileProviderBaselineRevision(match);
      return predecessorRevision !== null
        && compareIsoTimestampsAscending(incomingRevision, predecessorRevision) === 0;
    });
    if (equalRevisionMatches.length > 1) {
      throw new VaultError(
        "EVENT_EXTERNAL_REF_ALIAS_CONFLICT",
        `Junction profile externalRef "${externalRef.system}/${externalRef.resourceType}/` +
          `${externalRef.resourceId}${externalRef.facet ? `#${externalRef.facet}` : ""}" ` +
          "matched multiple persisted identities at the same provider revision; nothing was imported.",
      );
    }
    const equalRevisionMatch = equalRevisionMatches[0];
    if (equalRevisionMatch) {
      if (!isJunctionNoIdProfileEqualRevisionTimestampReplay(
        equalRevisionMatch.indexedRecord,
        entry.record,
      )) {
        throw new VaultError(
          "EVENT_SOURCE_REVISION_CONFLICT",
          `Junction profile externalRef "${externalRef.system}/${externalRef.resourceType}/` +
            `${externalRef.resourceId}${externalRef.facet ? `#${externalRef.facet}` : ""}" ` +
            `has conflicting content for source revision "${incomingRevision}"; nothing was imported.`,
        );
      }
      reserve(
        entry,
        eventExternalRefKey(equalRevisionMatch.indexedExternalRef),
        equalRevisionMatch,
      );
      continue;
    }

    const predecessorMatches = scopedMatches.filter((match) => {
      const predecessorRevision = junctionNoIdProfilePredecessorRevision(match);
      return predecessorRevision !== null
        && compareIsoTimestampsAscending(incomingRevision, predecessorRevision) > 0;
    });
    if (predecessorMatches.length > 1) {
      throw new VaultError(
        "EVENT_EXTERNAL_REF_ALIAS_CONFLICT",
        `Junction profile externalRef "${externalRef.system}/${externalRef.resourceType}/` +
          `${externalRef.resourceId}${externalRef.facet ? `#${externalRef.facet}` : ""}" ` +
          "matched multiple persisted predecessor identities; nothing was imported.",
      );
    }
    const predecessor = predecessorMatches[0];
    if (predecessor) {
      reserve(entry, eventExternalRefKey(predecessor.indexedExternalRef), predecessor);
    }
  }

  return reservations;
}

async function buildDeviceEventIdentityContext(
  vaultRoot: string,
  entries: readonly PreparedDeviceEventEntry[],
  authoritativeEventSets: readonly NormalizedDeviceAuthoritativeEventSet[] = [],
): Promise<DeviceEventIdentityContext> {
  if (entries.length === 0 && authoritativeEventSets.length === 0) {
    return {
      index: {
        aliasRepairContaminatedEventIds: new Set(),
        aliasRepairContaminatedRefKeys: new Set(),
        aliasRepairHistoryById: new Map(),
        deviceOwnerRevisionsByRefKeyAndFingerprint: new Map(),
        junctionNoIdProfilePredecessorsByScope: new Map(),
        junctionSparseDayHistoryById: new Map(),
        latestByRefKey: new Map(),
        latestById: new Map(),
        liveOwnerIdsByRefKey: new Map(),
        maxRevisionById: new Map(),
        revisionsById: new Map(),
      },
      legacyReservations: new Map(),
    };
  }
  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  const index = await indexLatestEventsByExternalRef(vaultRoot, shardPaths);
  const context: DeviceEventIdentityContext = { index, legacyReservations: new Map() };
  // A legitimate primary spine may advance before the duplicate is repaired.
  // Load only structural candidates first so reservations can use the bounded
  // common-initial-history proof instead of latest-record equality.
  const aliasRepairOwnerIds = new Set<string>();
  for (const entry of entries) {
    const ownerSplit = resolveStructuralJunctionDailyAggregateAliasOwnerSplit(
      entry,
      index,
    );
    if (!ownerSplit) {
      continue;
    }
    assertJunctionDailyAggregateAliasHistoryIsUncontaminated(entry, context);
    aliasRepairOwnerIds.add(ownerSplit.primaryOwner.record.id);
    aliasRepairOwnerIds.add(ownerSplit.legacyOwner.record.id);
  }
  if (aliasRepairOwnerIds.size > 0) {
    index.aliasRepairHistoryById = await loadBoundedAliasRepairHistories(
      vaultRoot,
      shardPaths,
      aliasRepairOwnerIds,
    );
  }
  context.legacyReservations = buildLegacyExternalRefReservations(entries, index);
  return context;
}

function cloneDeviceEventIdentityContext(
  context: DeviceEventIdentityContext,
): DeviceEventIdentityContext {
  return {
    index: {
      aliasRepairContaminatedEventIds: new Set(
        context.index.aliasRepairContaminatedEventIds,
      ),
      aliasRepairContaminatedRefKeys: new Set(
        context.index.aliasRepairContaminatedRefKeys,
      ),
      aliasRepairHistoryById: new Map(
        [...context.index.aliasRepairHistoryById].map(([id, history]) => [id, [...history]]),
      ),
      deviceOwnerRevisionsByRefKeyAndFingerprint:
        context.index.deviceOwnerRevisionsByRefKeyAndFingerprint,
      junctionNoIdProfilePredecessorsByScope:
        context.index.junctionNoIdProfilePredecessorsByScope,
      junctionSparseDayHistoryById: context.index.junctionSparseDayHistoryById,
      latestByRefKey: new Map(context.index.latestByRefKey),
      latestById: new Map(context.index.latestById),
      liveOwnerIdsByRefKey: new Map(
        [...context.index.liveOwnerIdsByRefKey].map(([key, ids]) => [key, new Set(ids)]),
      ),
      maxRevisionById: new Map(context.index.maxRevisionById),
      revisionsById: new Map(
        [...context.index.revisionsById].map(([id, revisions]) => [id, new Set(revisions)]),
      ),
    },
    legacyReservations: new Map(context.legacyReservations),
  };
}

function buildEmptyDeviceEventIdentityContext(
  entries: readonly PreparedDeviceEventEntry[],
): DeviceEventIdentityContext {
  const index: EventExternalRefIndex = {
    aliasRepairContaminatedEventIds: new Set(),
    aliasRepairContaminatedRefKeys: new Set(),
    aliasRepairHistoryById: new Map(),
    deviceOwnerRevisionsByRefKeyAndFingerprint: new Map(),
    junctionNoIdProfilePredecessorsByScope: new Map(),
    junctionSparseDayHistoryById: new Map(),
    latestByRefKey: new Map(),
    latestById: new Map(),
    liveOwnerIdsByRefKey: new Map(),
    maxRevisionById: new Map(),
    revisionsById: new Map(),
  };
  return {
    index,
    legacyReservations: buildLegacyExternalRefReservations(entries, index),
  };
}

function eventSpineRevisionsAreComplete(
  index: EventExternalRefIndex,
  eventId: string,
): boolean {
  const maxRevision = index.maxRevisionById.get(eventId) ?? 0;
  const revisions = index.revisionsById.get(eventId);
  return Number.isSafeInteger(maxRevision)
    && maxRevision > 0
    && revisions !== undefined
    && revisions.size === maxRevision;
}

interface DeviceEventAliasRepairContext {
  evidenceByRole: ReadonlyMap<string, IntegrationEvidencePart>;
  evidenceRolesByPreparedRecordId: ReadonlyMap<string, readonly string[]>;
}

interface JunctionDailyAggregateAliasEvidence {
  dayKey: string;
  legacyDayKey: string;
  resource: string;
}

interface JunctionDailyAggregateAliasOverlay {
  links: NonNullable<EventRecord["links"]>;
  memberAuthored: boolean;
  note?: string;
  tags: NonNullable<EventRecord["tags"]>;
}

interface JunctionDailyAggregateAliasOwnerSplit {
  legacyOwner: IndexedEventExternalRefMatch;
  legacyRefKey: string;
  primaryOwner: IndexedEventExternalRefMatch;
  primaryRefKey: string;
  resource: string;
}

interface JunctionDailyAggregateAliasHistoryProof
  extends JunctionDailyAggregateAliasOwnerSplit {
  legacyOverlay: JunctionDailyAggregateAliasOverlay;
  primaryOverlay: JunctionDailyAggregateAliasOverlay;
}

interface JunctionDailyAggregateAliasRepairPlan {
  legacyRefKey: string;
  loserPath: string;
  loserTombstone: EventRecord;
  overlaySurvivor?: EventRecord;
  primaryExternalRef: ExternalRef;
  primaryRefKey: string;
  providerSurvivor: EventRecord;
  survivorPath: string;
}

function buildDeviceEventAliasRepairContext(
  plan: Pick<DeviceBatchPlan, "evidenceRolesByPreparedRecordId" | "preparedEvidenceParts">,
): DeviceEventAliasRepairContext {
  return {
    evidenceByRole: new Map(plan.preparedEvidenceParts.map((part) => [part.role, part])),
    evidenceRolesByPreparedRecordId: plan.evidenceRolesByPreparedRecordId,
  };
}

function isLooseRecordValue(value: unknown): value is LooseRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRejectedEventExternalRefKey(value: unknown): string | undefined {
  if (!isLooseRecordValue(value)) {
    return undefined;
  }
  const parsed = safeParseContract(externalRefSchema, {
    system: value.system,
    resourceType: value.resourceType,
    resourceId: value.resourceId,
    ...(value.facet === undefined ? {} : { facet: value.facet }),
    ...(value.version === undefined ? {} : { version: value.version }),
  });
  return parsed.success ? eventExternalRefKey(parsed.data) : undefined;
}

function junctionDailyAggregateAliasRefShape(externalRef: ExternalRef): string {
  return stableStringify({
    facet: externalRef.facet ?? null,
    resourceType: externalRef.resourceType,
    system: externalRef.system,
    version: externalRef.version ?? null,
  });
}

function junctionDailyAggregateAliasOriginKey(
  origin: DeviceDataOrigin | undefined,
): string | null {
  if (!origin) {
    return null;
  }
  const { observedAtRaw: _observedAtRaw, ...stableOrigin } = origin;
  return stableStringify(stableOrigin);
}

function junctionDailyAggregateAliasHistoricalOriginMatches(
  historical: DeviceDataOrigin | undefined,
  current: DeviceDataOrigin,
): boolean {
  if (!historical) {
    return false;
  }
  if (junctionDailyAggregateAliasOriginKey(historical)
    === junctionDailyAggregateAliasOriginKey(current)) {
    return true;
  }
  if (historical.timeZoneOffsetMinutes !== undefined) {
    return false;
  }
  const {
    observedAtRaw: _historicalObservedAtRaw,
    timeZoneOffsetMinutes: _historicalOffset,
    ...stableHistorical
  } = historical;
  const {
    observedAtRaw: _currentObservedAtRaw,
    timeZoneOffsetMinutes: _currentOffset,
    ...stableCurrent
  } = current;
  return stableStringify(stableHistorical) === stableStringify(stableCurrent);
}

function junctionDailyAggregateProviderStateKey(record: EventRecord): string {
  const {
    dataOrigin: _dataOrigin,
    dayKey: _dayKey,
    externalRef: _externalRef,
    id: _id,
    lifecycle: _lifecycle,
    links: _links,
    note: _note,
    recordedAt: _recordedAt,
    source: _source,
    tags: _tags,
    ...providerState
  } = record;
  return stableStringify(providerState);
}

function isJunctionDailyAggregateAliasCandidate(entry: PreparedDeviceEventEntry): boolean {
  const externalRef = entry.record.externalRef;
  const legacyExternalRef = entry.legacyExternalRefs[0];
  return externalRef !== undefined
    && legacyExternalRef !== undefined
    && entry.legacyExternalRefs.length === 1
    && entry.record.kind === "observation"
    && entry.record.source === "device"
    && entry.record.dataOrigin?.aggregatorProvider === "junction"
    && entry.record.dataOrigin.normalizerVersion === "junction-normalizer.v1"
    && externalRef.system === "junction"
    && externalRef.version === undefined
    && legacyExternalRef.version === undefined
    && eventExternalRefKey(externalRef) !== eventExternalRefKey(legacyExternalRef)
    && junctionDailyAggregateAliasRefShape(externalRef)
      === junctionDailyAggregateAliasRefShape(legacyExternalRef)
    && entry.record.note === undefined
    && entry.record.tags === undefined
    && entry.record.links === undefined
    && entry.record.rawRefs === undefined
    && entry.record.evidence === undefined
    && entry.record.attachments === undefined;
}

function resolveStructuralJunctionDailyAggregateAliasOwnerSplit(
  entry: PreparedDeviceEventEntry,
  index: EventExternalRefIndex,
): JunctionDailyAggregateAliasOwnerSplit | null {
  const externalRef = entry.record.externalRef;
  const legacyExternalRef = entry.legacyExternalRefs[0];
  if (
    !externalRef
    || !legacyExternalRef
    || !isJunctionDailyAggregateAliasCandidate(entry)
  ) {
    return null;
  }
  const primaryRefKey = eventExternalRefKey(externalRef);
  const legacyRefKey = eventExternalRefKey(legacyExternalRef);
  const primaryOwnerIds = index.liveOwnerIdsByRefKey.get(primaryRefKey)
    ?? new Set<string>();
  const legacyOwnerIds = index.liveOwnerIdsByRefKey.get(legacyRefKey)
    ?? new Set<string>();
  if (primaryOwnerIds.size === 0 || legacyOwnerIds.size === 0) {
    return null;
  }

  const primaryOwner = index.latestByRefKey.get(primaryRefKey);
  const legacyOwner = index.latestByRefKey.get(legacyRefKey);
  if (!primaryOwner || !legacyOwner) {
    return null;
  }

  const primaryProviderRecord = primaryOwner.indexedRecord;
  const legacyProviderRecord = legacyOwner.indexedRecord;
  const primaryOrigin = primaryProviderRecord.dataOrigin;
  const legacyOrigin = legacyProviderRecord.dataOrigin;
  const incomingOrigin = entry.record.dataOrigin;
  const observedAtRaw = incomingOrigin?.observedAtRaw;
  const observedAtRawPrefix = `${entry.record.dayKey}:`;
  const resource = observedAtRaw?.startsWith(observedAtRawPrefix)
    && observedAtRaw.endsWith(":daily")
    ? observedAtRaw.slice(observedAtRawPrefix.length, -":daily".length)
    : "";
  if (
    primaryProviderRecord.dayKey !== entry.record.dayKey
    || !isSameObservationFacet(primaryProviderRecord, entry.record)
    || !isSameObservationFacet(primaryProviderRecord, legacyProviderRecord)
    || junctionDailyAggregateAliasRefShape(primaryOwner.indexedExternalRef)
      !== junctionDailyAggregateAliasRefShape(externalRef)
    || junctionDailyAggregateAliasRefShape(legacyOwner.indexedExternalRef)
      !== junctionDailyAggregateAliasRefShape(legacyExternalRef)
    || !primaryOrigin
    || !legacyOrigin
    || !incomingOrigin
    || resource.length === 0
    || !deviceDataOriginSourceMatches(primaryOrigin, incomingOrigin)
    || !deviceDataOriginSourceMatches(legacyOrigin, incomingOrigin)
  ) {
    return null;
  }

  const distinctOwnerIds = new Set([...primaryOwnerIds, ...legacyOwnerIds]);
  if (distinctOwnerIds.size < 2) {
    return null;
  }
  if (
    primaryOwnerIds.size !== 1
    || legacyOwnerIds.size !== 1
    || distinctOwnerIds.size !== 2
  ) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_OWNER_REFUSED",
      "Junction daily aggregate alias repair requires exactly one live owner per claimed reference.",
    );
  }
  if (
    !primaryOwnerIds.has(primaryOwner.record.id)
    || !legacyOwnerIds.has(legacyOwner.record.id)
    || primaryOwner.record.id === legacyOwner.record.id
  ) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_OWNER_REFUSED",
      "Junction daily aggregate alias repair could not prove the two live reference owners.",
    );
  }

  return { legacyOwner, legacyRefKey, primaryOwner, primaryRefKey, resource };
}

function assertJunctionDailyAggregateAliasHistoryIsUncontaminated(
  entry: PreparedDeviceEventEntry,
  context: DeviceEventIdentityContext,
): void {
  const externalRef = entry.record.externalRef;
  const legacyExternalRef = entry.legacyExternalRefs[0];
  if (!externalRef || !legacyExternalRef) {
    return;
  }
  const primaryRefKey = eventExternalRefKey(externalRef);
  const legacyRefKey = eventExternalRefKey(legacyExternalRef);
  const ownerIds = new Set([
    ...(context.index.liveOwnerIdsByRefKey.get(primaryRefKey) ?? []),
    ...(context.index.liveOwnerIdsByRefKey.get(legacyRefKey) ?? []),
  ]);
  if (
    [...ownerIds].some((id) => context.index.aliasRepairContaminatedEventIds.has(id))
    || context.index.aliasRepairContaminatedRefKeys.has(primaryRefKey)
    || context.index.aliasRepairContaminatedRefKeys.has(legacyRefKey)
  ) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_HISTORY_REFUSED",
      "Junction daily aggregate alias repair found a schema-rejected candidate revision.",
    );
  }
}

function parseJunctionDailyAggregateAliasEvidence(
  entry: PreparedDeviceEventEntry,
  context: DeviceEventAliasRepairContext,
): JunctionDailyAggregateAliasEvidence {
  const roles = context.evidenceRolesByPreparedRecordId.get(entry.record.id) ?? [];
  const part = roles.length === 1 ? context.evidenceByRole.get(roles[0]!) : undefined;
  const metadata = part?.metadata;
  if (
    !part
    || !isLooseRecordValue(metadata)
    || metadata.artifactClass !== "compact_provider_timeseries_aggregate"
    || metadata.provider !== "junction"
    || metadata.resourceCategory !== "timeseries_daily_aggregate"
    || metadata.retentionClass !== "provider_evidence"
  ) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_EVIDENCE_REFUSED",
      "Junction daily aggregate alias repair requires one exact compact provider evidence role.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(part.content);
  } catch {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_EVIDENCE_REFUSED",
      "Junction daily aggregate alias repair evidence was not valid JSON.",
    );
  }
  if (!isLooseRecordValue(parsed)) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_EVIDENCE_REFUSED",
      "Junction daily aggregate alias repair evidence did not contain an object.",
    );
  }

  const legacyDayKeys = parsed.legacyDayKeys;
  const origin = entry.record.dataOrigin;
  if (
    parsed.schema !== "junction.timeseries_daily_aggregate.v1"
    || parsed.provider !== "junction"
    || typeof parsed.resource !== "string"
    || parsed.resource.length === 0
    || metadata.resource !== parsed.resource
    || typeof parsed.dayKey !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/u.test(parsed.dayKey)
    || parsed.dayKey !== entry.record.dayKey
    || typeof parsed.sourceProviderSlug !== "string"
    || parsed.sourceProviderSlug.length === 0
    || typeof parsed.sampleCount !== "number"
    || !Number.isSafeInteger(parsed.sampleCount)
    || parsed.sampleCount <= 0
    || !Array.isArray(legacyDayKeys)
    || legacyDayKeys.length !== 1
    || typeof legacyDayKeys[0] !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/u.test(legacyDayKeys[0])
    || legacyDayKeys[0] === parsed.dayKey
    || (parsed.sourceType !== undefined && typeof parsed.sourceType !== "string")
    || (
      parsed.sourceInstanceId !== undefined
      && parsed.sourceInstanceId !== null
      && typeof parsed.sourceInstanceId !== "string"
    )
    || origin?.sourceProviderSlug !== parsed.sourceProviderSlug
    || (origin.sourceType ?? null) !== (parsed.sourceType ?? null)
    || (origin.sourceInstanceId ?? null) !== (parsed.sourceInstanceId ?? null)
    || origin.observedAtRaw !== `${parsed.dayKey}:${parsed.resource}:daily`
  ) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_EVIDENCE_REFUSED",
      "Junction daily aggregate alias repair evidence did not prove one normalized primary and legacy day split.",
    );
  }

  return {
    dayKey: parsed.dayKey,
    legacyDayKey: legacyDayKeys[0],
    resource: parsed.resource,
  };
}

function readCompleteJunctionDailyAggregateAliasHistory(
  index: EventExternalRefIndex,
  eventId: string,
): readonly EventSpineEntry<EventRecord>[] {
  const history = index.aliasRepairHistoryById.get(eventId) ?? [];
  const maxRevision = index.maxRevisionById.get(eventId) ?? 0;
  const revisions = index.revisionsById.get(eventId);
  if (
    maxRevision < 1
    || maxRevision > MAX_JUNCTION_DAILY_ALIAS_REPAIR_REVISIONS
    || !revisions
    || revisions.size !== maxRevision
    || history.length !== maxRevision
    || history.some((entry, historyIndex) =>
      eventSpineRevision(entry.record) !== historyIndex + 1
    )
  ) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_HISTORY_REFUSED",
      "Junction daily aggregate alias repair requires a complete bounded event history.",
    );
  }
  return history;
}

function junctionDailyAggregateAliasPersistedOriginsMatch(
  left: DeviceDataOrigin | undefined,
  right: DeviceDataOrigin | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }
  return junctionDailyAggregateAliasHistoricalOriginMatches(left, right)
    || junctionDailyAggregateAliasHistoricalOriginMatches(right, left);
}

function junctionDailyAggregateAliasInitialRecordMatches(
  record: EventRecord | undefined,
  input: {
    expectedDayKey: string;
    expectedExternalRef: ExternalRef;
    expectedObservedAtRaw: string;
  },
): record is EventRecord {
  return record !== undefined
    && record.source === "device"
    && !isDeletedEventSpineRecord(record)
    && record.dayKey === input.expectedDayKey
    && record.dataOrigin?.observedAtRaw === input.expectedObservedAtRaw
    && record.externalRef !== undefined
    && eventExternalRefKey(record.externalRef)
      === eventExternalRefKey(input.expectedExternalRef)
    && junctionDailyAggregateAliasRefShape(record.externalRef)
      === junctionDailyAggregateAliasRefShape(input.expectedExternalRef);
}

function analyzeJunctionDailyAggregateAliasHistoryEvolution(input: {
  allowProviderEvolution: boolean;
  expectedDayKey: string;
  expectedExternalRef: ExternalRef;
  expectedOrigin: DeviceDataOrigin;
  expectedObservedAtRaw: string;
  history: readonly EventSpineEntry<EventRecord>[];
  initialProviderStateKey: string;
  initialRecord: EventRecord;
}): JunctionDailyAggregateAliasOverlay {
  const expectedRefKey = eventExternalRefKey(input.expectedExternalRef);
  let providerStateKey = input.initialProviderStateKey;
  let memberCarrierStateKey: string | undefined;
  for (const { record } of input.history) {
    const recordProviderStateKey = junctionDailyAggregateProviderStateKey(record);
    const providerRecord = record.source === "device";
    const manualMatchesProvider = recordProviderStateKey === providerStateKey;
    const manualMatchesCarrier = memberCarrierStateKey !== undefined
      && recordProviderStateKey === memberCarrierStateKey;
    if (
      isDeletedEventSpineRecord(record)
      || (record.source !== "device" && record.source !== "manual")
      || record.dayKey !== input.expectedDayKey
      || !isSameObservationFacet(input.initialRecord, record)
      || (
        providerRecord
        && (
          !record.externalRef
          || !record.dataOrigin
        )
      )
      || (
        record.externalRef !== undefined
        && (
          eventExternalRefKey(record.externalRef) !== expectedRefKey
          || junctionDailyAggregateAliasRefShape(record.externalRef)
            !== junctionDailyAggregateAliasRefShape(input.expectedExternalRef)
        )
      )
      || (
        record.dataOrigin !== undefined
        && (
          record.dataOrigin.observedAtRaw !== input.expectedObservedAtRaw
          || !junctionDailyAggregateAliasHistoricalOriginMatches(
            record.dataOrigin,
            input.expectedOrigin,
          )
        )
      )
      || (
        providerRecord
          ? !input.allowProviderEvolution
            && recordProviderStateKey !== input.initialProviderStateKey
          : !manualMatchesProvider && !manualMatchesCarrier
      )
    ) {
      throw new VaultError(
        "EVENT_ALIAS_REPAIR_HISTORY_REFUSED",
        "Junction daily aggregate alias repair found unsupported or divergent historical state.",
      );
    }
    if (providerRecord) {
      providerStateKey = recordProviderStateKey;
    } else if (manualMatchesProvider) {
      memberCarrierStateKey = recordProviderStateKey;
    }
  }

  const latest = input.history.at(-1)?.record;
  if (!latest) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_HISTORY_REFUSED",
      "Junction daily aggregate alias repair requires a complete bounded event history.",
    );
  }
  const links = [...(latest.links ?? [])];
  const tags = [...(latest.tags ?? [])];
  return {
    links,
    memberAuthored: latest.source === "manual"
      || latest.note !== undefined
      || tags.length > 0
      || links.length > 0,
    ...(latest.note ? { note: latest.note } : {}),
    tags,
  };
}

function resolveJunctionDailyAggregateAliasOwnerSplit(
  entry: PreparedDeviceEventEntry,
  index: EventExternalRefIndex,
): JunctionDailyAggregateAliasHistoryProof | null {
  const ownerSplit = resolveStructuralJunctionDailyAggregateAliasOwnerSplit(
    entry,
    index,
  );
  const externalRef = entry.record.externalRef;
  const legacyExternalRef = entry.legacyExternalRefs[0];
  if (!ownerSplit || !externalRef || !legacyExternalRef || !entry.record.dataOrigin) {
    return null;
  }

  const primaryInitial = index.aliasRepairHistoryById.get(
    ownerSplit.primaryOwner.record.id,
  )?.[0]?.record;
  const legacyInitial = index.aliasRepairHistoryById.get(
    ownerSplit.legacyOwner.record.id,
  )?.[0]?.record;
  const legacyDayKey = ownerSplit.legacyOwner.indexedRecord.dayKey;
  // Divergent initial baselines are ordinary adjacent-day owners. Once the
  // baselines match, every later revision must satisfy the bounded evolution
  // rules before this pair can reserve or mutate either identity.
  if (
    !junctionDailyAggregateAliasInitialRecordMatches(primaryInitial, {
      expectedDayKey: entry.record.dayKey,
      expectedExternalRef: externalRef,
      expectedObservedAtRaw: `${entry.record.dayKey}:${ownerSplit.resource}:daily`,
    })
    || !junctionDailyAggregateAliasInitialRecordMatches(legacyInitial, {
      expectedDayKey: legacyDayKey,
      expectedExternalRef: legacyExternalRef,
      expectedObservedAtRaw: `${legacyDayKey}:${ownerSplit.resource}:daily`,
    })
    || !isSameObservationFacet(primaryInitial, legacyInitial)
    || junctionDailyAggregateProviderStateKey(primaryInitial)
      !== junctionDailyAggregateProviderStateKey(legacyInitial)
    || !junctionDailyAggregateAliasPersistedOriginsMatch(
      primaryInitial.dataOrigin,
      legacyInitial.dataOrigin,
    )
  ) {
    return null;
  }

  const primaryHistory = readCompleteJunctionDailyAggregateAliasHistory(
    index,
    ownerSplit.primaryOwner.record.id,
  );
  const legacyHistory = readCompleteJunctionDailyAggregateAliasHistory(
    index,
    ownerSplit.legacyOwner.record.id,
  );

  const primaryOverlay = analyzeJunctionDailyAggregateAliasHistoryEvolution({
    allowProviderEvolution: true,
    expectedDayKey: entry.record.dayKey,
    expectedExternalRef: externalRef,
    expectedOrigin: entry.record.dataOrigin,
    expectedObservedAtRaw: `${entry.record.dayKey}:${ownerSplit.resource}:daily`,
    history: primaryHistory,
    initialProviderStateKey: junctionDailyAggregateProviderStateKey(primaryInitial),
    initialRecord: primaryInitial,
  });
  const legacyOverlay = analyzeJunctionDailyAggregateAliasHistoryEvolution({
    allowProviderEvolution: false,
    expectedDayKey: legacyDayKey,
    expectedExternalRef: legacyExternalRef,
    expectedOrigin: entry.record.dataOrigin,
    expectedObservedAtRaw: `${legacyDayKey}:${ownerSplit.resource}:daily`,
    history: legacyHistory,
    initialProviderStateKey: junctionDailyAggregateProviderStateKey(legacyInitial),
    initialRecord: legacyInitial,
  });
  return { ...ownerSplit, legacyOverlay, primaryOverlay };
}

function hasJunctionDailyAggregateAliasSplit(
  entry: PreparedDeviceEventEntry,
  context: DeviceEventIdentityContext,
): boolean {
  return resolveJunctionDailyAggregateAliasOwnerSplit(entry, context.index) !== null;
}

function mergeJunctionDailyAggregateAliasOverlays(
  primary: JunctionDailyAggregateAliasOverlay,
  legacy: JunctionDailyAggregateAliasOverlay,
): JunctionDailyAggregateAliasOverlay {
  if (primary.note && legacy.note && primary.note !== legacy.note) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_OVERLAY_REFUSED",
      "Junction daily aggregate alias repair found conflicting member notes.",
    );
  }
  const linksByKey = new Map<string, NonNullable<EventRecord["links"]>[number]>();
  for (const link of [...primary.links, ...legacy.links]) {
    linksByKey.set(stableStringify(link), link);
  }
  return {
    links: [...linksByKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, link]) => link),
    memberAuthored: primary.memberAuthored || legacy.memberAuthored,
    ...(primary.note || legacy.note ? { note: primary.note ?? legacy.note } : {}),
    tags: [...new Set([...primary.tags, ...legacy.tags])].sort(),
  };
}

function buildJunctionDailyAggregateAliasRepairPlan(input: {
  aliasRepairContext?: DeviceEventAliasRepairContext;
  context: DeviceEventIdentityContext;
  entry: PreparedDeviceEventEntry;
}): JunctionDailyAggregateAliasRepairPlan | null {
  const { aliasRepairContext, context, entry } = input;
  const externalRef = entry.record.externalRef;
  const legacyExternalRef = entry.legacyExternalRefs[0];
  const ownerSplit = resolveJunctionDailyAggregateAliasOwnerSplit(
    entry,
    context.index,
  );
  if (
    !aliasRepairContext
    || !externalRef
    || !legacyExternalRef
    || !ownerSplit
  ) {
    return null;
  }
  assertJunctionDailyAggregateAliasHistoryIsUncontaminated(entry, context);

  const {
    legacyOverlay,
    legacyOwner,
    legacyRefKey,
    primaryOverlay,
    primaryOwner,
    primaryRefKey,
  } = ownerSplit;

  const evidence = parseJunctionDailyAggregateAliasEvidence(entry, aliasRepairContext);
  if (
    primaryOwner.record.dayKey !== evidence.dayKey
    || legacyOwner.record.dayKey !== evidence.legacyDayKey
    || ownerSplit.resource !== evidence.resource
  ) {
    throw new VaultError(
      "EVENT_ALIAS_REPAIR_HISTORY_REFUSED",
      "Junction daily aggregate alias repair owner days did not match the normalized evidence.",
    );
  }

  const overlay = mergeJunctionDailyAggregateAliasOverlays(primaryOverlay, legacyOverlay);
  const primaryRevision = (context.index.maxRevisionById.get(primaryOwner.record.id) ?? 0) + 1;
  const legacyRevision = (context.index.maxRevisionById.get(legacyOwner.record.id) ?? 0) + 1;
  const providerSurvivor: EventRecord = {
    ...entry.record,
    id: primaryOwner.record.id,
    lifecycle: buildEventSpineLifecycle(primaryRevision),
  };
  const loserTombstone: EventRecord = {
    ...entry.record,
    id: legacyOwner.record.id,
    lifecycle: buildEventSpineLifecycle(legacyRevision, "deleted"),
  };
  const overlaySurvivor: EventRecord | undefined = overlay.memberAuthored
    ? {
        ...providerSurvivor,
        source: "manual",
        ...(overlay.note ? { note: overlay.note } : {}),
        ...(overlay.tags.length > 0 ? { tags: overlay.tags } : {}),
        ...(overlay.links.length > 0 ? { links: overlay.links } : {}),
        lifecycle: buildEventSpineLifecycle(primaryRevision + 1),
      }
    : undefined;

  return {
    legacyRefKey,
    loserPath: legacyOwner.relativePath || toEventLedgerFile(legacyOwner.record.occurredAt),
    loserTombstone,
    ...(overlaySurvivor ? { overlaySurvivor } : {}),
    primaryExternalRef: externalRef,
    primaryRefKey,
    providerSurvivor,
    survivorPath: entry.relativePath,
  };
}

function applyJunctionDailyAggregateAliasRepairToIndex(
  plan: JunctionDailyAggregateAliasRepairPlan,
  index: EventExternalRefIndex,
): void {
  const survivor = plan.overlaySurvivor ?? plan.providerSurvivor;
  index.latestByRefKey.set(plan.primaryRefKey, {
    indexedExternalRef: plan.primaryExternalRef,
    indexedRecord: plan.providerSurvivor,
    relativePath: plan.survivorPath,
    record: survivor,
  });
  index.latestByRefKey.delete(plan.legacyRefKey);
  index.latestById.set(survivor.id, survivor);
  index.latestById.set(plan.loserTombstone.id, plan.loserTombstone);
  index.liveOwnerIdsByRefKey.set(plan.primaryRefKey, new Set([survivor.id]));
  index.liveOwnerIdsByRefKey.delete(plan.legacyRefKey);

  for (const record of [
    plan.providerSurvivor,
    ...(plan.overlaySurvivor ? [plan.overlaySurvivor] : []),
    plan.loserTombstone,
  ]) {
    const revision = eventSpineRevision(record);
    index.maxRevisionById.set(record.id, revision);
    const revisions = index.revisionsById.get(record.id) ?? new Set<number>();
    revisions.add(revision);
    index.revisionsById.set(record.id, revisions);
    const history = index.aliasRepairHistoryById.get(record.id) ?? [];
    history.push({
      relativePath: record.id === plan.loserTombstone.id
        ? plan.loserPath
        : plan.survivorPath,
      record,
    });
    index.aliasRepairHistoryById.set(record.id, history);
  }
}

function whoopSleepTypeProviderBaselineRevision(
  index: EventExternalRefIndex,
  refKey: string,
  eventId: string,
  incoming: EventRecord,
): number | null {
  if (
    incoming.kind !== "sleep_session"
    || incoming.externalRef?.system !== "whoop"
    || incoming.externalRef.resourceType !== "sleep"
    || (incoming.sleepType !== "main_sleep" && incoming.sleepType !== "nap")
  ) {
    return null;
  }

  const ownersByFingerprint = index.deviceOwnerRevisionsByRefKeyAndFingerprint.get(refKey);
  const earliestRevisionFor = (record: EventRecord): number | null => {
    const revisions = ownersByFingerprint
      ?.get(deviceEventContentFingerprint(record))
      ?.get(eventId);
    // Exact device replays do not append revisions. Use the earliest match as
    // the provider baseline because later matching revisions may be supported
    // user edits that retained source=device.
    let baselineRevision: number | null = null;
    for (const revision of revisions ?? []) {
      baselineRevision = Math.min(baselineRevision ?? revision, revision);
    }
    return baselineRevision;
  };

  const typedBaselineRevision = earliestRevisionFor(incoming);
  if (typedBaselineRevision !== null) {
    return typedBaselineRevision;
  }

  // Before sleepType normalization shipped, the provider-authored row had the
  // same content without this field. Keep that one-time legacy fallback only
  // after complete typed history fails to match.
  const { sleepType: _sleepType, ...withoutSleepType } = incoming;
  return earliestRevisionFor(withoutSleepType);
}

function resolveDeviceEventIdentity(
  entry: PreparedDeviceEventEntry,
  context: DeviceEventIdentityContext,
  options: { strict?: boolean } = {},
): ResolvedDeviceEventIdentity | null {
  const externalRef = entry.record.externalRef;
  if (!externalRef) {
    return null;
  }

  const { index, legacyReservations } = context;
  const refKey = eventExternalRefKey(externalRef);
  const reservedForLegacyClaim = legacyReservations.get(refKey);
  const primaryMatch = reservedForLegacyClaim && reservedForLegacyClaim.entry !== entry
    ? undefined
    : index.latestByRefKey.get(refKey);
  const explicitLegacyRefKeys = new Set(
    entry.legacyExternalRefs.map((legacyExternalRef) => eventExternalRefKey(legacyExternalRef)),
  );
  const legacyMatchedEntries = entry.legacyExternalRefs
    .map((legacyExternalRef) => ({
      legacyExternalRef,
      refKey: eventExternalRefKey(legacyExternalRef),
    }))
    .filter((match) => match.refKey !== refKey)
    .map(({ legacyExternalRef, refKey: legacyRefKey }) => {
      const reservation = legacyReservations.get(legacyRefKey);
      return {
        legacyExternalRef,
        refKey: legacyRefKey,
        indexedMatch: reservation?.entry === entry
          ? reservation.indexedMatch
          : index.latestByRefKey.get(legacyRefKey),
      };
    })
    .filter((match): match is {
      refKey: string;
      indexedMatch: IndexedEventExternalRefMatch;
      legacyExternalRef: ExternalRef;
    } => {
      if (!match.indexedMatch) {
        return false;
      }
      const reservation = legacyReservations.get(match.refKey);
      return (!reservation || reservation.entry === entry)
        && isCompatibleLegacyExternalRefMatch(match.indexedMatch, entry.record, match.legacyExternalRef);
    });
  const implicitReservedEntries = [...legacyReservations.entries()]
    .filter(([reservedRefKey, reservation]) =>
      reservation.entry === entry
      && reservedRefKey !== refKey
      && !explicitLegacyRefKeys.has(reservedRefKey)
    )
    .map(([reservedRefKey, reservation]) => ({
      refKey: reservedRefKey,
      indexedMatch: reservation.indexedMatch,
    }));
  const matchedEntries = [
    ...(primaryMatch ? [{ refKey, indexedMatch: primaryMatch }] : []),
    ...legacyMatchedEntries,
    ...implicitReservedEntries,
  ];
  const selectedPrimaryMatch = matchedEntries.find((match) => match.refKey === refKey);
  const latest = selectedPrimaryMatch?.indexedMatch.record ?? matchedEntries[0]?.indexedMatch.record;
  let associationSafe = true;

  for (const match of matchedEntries) {
    if (match.indexedMatch.record.kind !== entry.record.kind) {
      associationSafe = false;
      if (options.strict) {
        throw new VaultError(
          "EVENT_KIND_MISMATCH",
          `Event externalRef "${externalRef.system}/${externalRef.resourceType}/${externalRef.resourceId}` +
            `${externalRef.facet ? `#${externalRef.facet}` : ""}" already belongs to kind ` +
            `"${match.indexedMatch.record.kind}" and cannot be rewritten as "${entry.record.kind}"; nothing was imported.`,
        );
      }
    }
  }

  const matchedIds = new Set(matchedEntries.map((match) => match.indexedMatch.record.id));
  if (matchedIds.size > 1) {
    associationSafe = false;
    if (options.strict) {
      throw new VaultError(
        "EVENT_EXTERNAL_REF_ALIAS_CONFLICT",
        `Event externalRef "${externalRef.system}/${externalRef.resourceType}/${externalRef.resourceId}` +
          `${externalRef.facet ? `#${externalRef.facet}` : ""}" matched multiple live event IDs; ` +
          "ambiguous legacy cleanup must be repaired explicitly.",
      );
    }
  }

  return { associationSafe, latest, matchedEntries, refKey };
}

function mapCurrentDeviceEventOwners(
  entries: readonly PreparedDeviceEventEntry[],
  context: DeviceEventIdentityContext,
): CurrentDeviceEventOwners {
  const associationSafePreparedIds = new Set<string>();
  const canonicalIdByPreparedId = new Map<string, string>();
  const currentRecordByPreparedId = new Map<string, EventRecord>();
  const historicalContentOwnerRevisionsByPreparedId = new Map<
    string,
    ReadonlyMap<string, ReadonlySet<number>>
  >();
  const historicallyDeliveredPreparedIds = new Set<string>();
  const incomingNewerPreparedIds = new Set<string>();
  const physicallyExistingPreparedIds = new Set<string>();
  let allExist = true;
  for (const entry of entries) {
    if (context.index.latestById.has(entry.record.id)) {
      physicallyExistingPreparedIds.add(entry.record.id);
    }
    const incomingContentFingerprint = deviceEventContentFingerprint(entry.record);
    const historicalContentOwnerRevisions = new Map<string, Set<number>>();
    for (const externalRef of [entry.record.externalRef, ...entry.legacyExternalRefs]) {
      if (!externalRef) {
        continue;
      }
      const refKey = eventExternalRefKey(externalRef);
      const ownersByFingerprint =
        context.index.deviceOwnerRevisionsByRefKeyAndFingerprint.get(refKey);
      for (
        const [ownerId, revisions] of ownersByFingerprint?.get(incomingContentFingerprint) ?? []
      ) {
        const ownerRevisions = historicalContentOwnerRevisions.get(ownerId) ?? new Set<number>();
        for (const revision of revisions) {
          ownerRevisions.add(revision);
        }
        historicalContentOwnerRevisions.set(ownerId, ownerRevisions);
      }
    }
    if (historicalContentOwnerRevisions.size > 0) {
      historicalContentOwnerRevisionsByPreparedId.set(
        entry.record.id,
        new Map(historicalContentOwnerRevisions),
      );
    }
    const resolved = resolveDeviceEventIdentity(entry, context);
    if (!resolved) {
      const current = context.index.latestById.get(entry.record.id);
      canonicalIdByPreparedId.set(entry.record.id, entry.record.id);
      allExist = current !== undefined && allExist;
      if (!current) {
        associationSafePreparedIds.add(entry.record.id);
      } else {
        currentRecordByPreparedId.set(entry.record.id, current);
        if (
          !isDeletedEventSpineRecord(current)
          && deviceEventContentKey(current) === deviceEventContentKey(entry.record)
        ) {
          associationSafePreparedIds.add(entry.record.id);
        }
      }
      continue;
    }
    let current = resolved.latest;
    if (!current) {
      const historicalOwners = [...historicalContentOwnerRevisions.keys()]
        .map((ownerId) => context.index.latestById.get(ownerId))
        .filter((record): record is EventRecord => record !== undefined);
      if (historicalOwners.length === 1) {
        [current] = historicalOwners;
        historicallyDeliveredPreparedIds.add(entry.record.id);
      } else if (historicalOwners.length > 1) {
        canonicalIdByPreparedId.set(entry.record.id, entry.record.id);
        historicallyDeliveredPreparedIds.add(entry.record.id);
        allExist = false;
        continue;
      }
    }
    canonicalIdByPreparedId.set(entry.record.id, current?.id ?? entry.record.id);
    allExist = current !== undefined && allExist;
    if (!current) {
      if (resolved.associationSafe) {
        associationSafePreparedIds.add(entry.record.id);
      }
      continue;
    }
    currentRecordByPreparedId.set(entry.record.id, current);
    const incomingContentKey = deviceEventContentKey(entry.record);
    const wasPreviouslyDelivered = historicalContentOwnerRevisions.size > 0;
    const incomingExternalRef = entry.record.externalRef;
    const sourceVersionComparisons = incomingExternalRef === undefined
      ? []
      : resolved.matchedEntries.map(({ indexedMatch }) =>
          compareIncomingExternalRefVersion(
            indexedMatch.indexedExternalRef,
            incomingExternalRef,
          )
        ).filter((comparison): comparison is number => comparison !== null);
    const incomingHasEqualOrNewerComparableVersion = sourceVersionComparisons.some(
      (comparison) => comparison >= 0,
    );
    const incomingHasOnlyOlderComparableVersions = sourceVersionComparisons.length > 0
      && !incomingHasEqualOrNewerComparableVersion;
    if (sourceVersionComparisons.some((comparison) => comparison > 0)) {
      incomingNewerPreparedIds.add(entry.record.id);
    }
    if (
      wasPreviouslyDelivered
      && !incomingHasEqualOrNewerComparableVersion
      && deviceEventContentKey(current) !== incomingContentKey
    ) {
      historicallyDeliveredPreparedIds.add(entry.record.id);
    }
    if (
      resolved.associationSafe
      && !incomingHasOnlyOlderComparableVersions
      && !isDeletedEventSpineRecord(current)
      && deviceEventContentKey(current) === deviceEventContentKey(entry.record)
    ) {
      associationSafePreparedIds.add(entry.record.id);
    }
  }
  return {
    allExist,
    associationSafePreparedIds,
    canonicalIdByPreparedId,
    currentRecordByPreparedId,
    historicalContentOwnerRevisionsByPreparedId,
    historicallyDeliveredPreparedIds,
    incomingNewerPreparedIds,
    physicallyExistingPreparedIds,
  };
}

// Device-sync ingestion invariant 4: merge is idempotent on the record's own
// externalRef, so overlapping push/pull re-imports of the same provider record
// must not mint new events. Re-imports with identical content (ignoring
// per-import identity such as id, rawRefs, lifecycle, and recordedAt) are
// skipped; changed content normally appends an event-spine revision onto the
// existing event id instead of a new event. Callers may mark a capture's
// externalRef immutable when changed content must be rejected instead.
async function reconcileDeviceEventEntriesByExternalRef(
  vaultRoot: string,
  entries: readonly PreparedDeviceEventEntry[],
  existingContext?: DeviceEventIdentityContext,
  preferredCanonicalIdByPreparedId: ReadonlyMap<string, string> = new Map(),
  authoritativeEventSets: readonly NormalizedDeviceAuthoritativeEventSet[] = [],
  aliasRepairContext?: DeviceEventAliasRepairContext,
): Promise<EventExternalRefReconciliation> {
  assertCanonicalWriteLockScope(vaultRoot);
  const context = existingContext ?? await buildDeviceEventIdentityContext(vaultRoot, entries);
  const { index } = context;
  const appendEntries: PreparedJsonlEntry<EventRecord>[] = [];
  const appendRecordIdByPreparedRecordId = new Map<string, string>();
  const recordsByEntryIndex = new Map<number, EventRecord>();
  const forceAppendIds = new Set<string>();
  const retainedPreparedIds = new Set<string>();
  let skippedDuplicateCount = 0;
  let supersededCount = 0;
  let retractedCount = 0;

  const aliasRepairByEntryIndex = new Map<number, JunctionDailyAggregateAliasRepairPlan>();
  for (const [entryIndex, entry] of entries.entries()) {
    const aliasRepair = buildJunctionDailyAggregateAliasRepairPlan({
      aliasRepairContext,
      context,
      entry,
    });
    if (aliasRepair) {
      aliasRepairByEntryIndex.set(entryIndex, aliasRepair);
    }
  }
  const aliasRepairOwnerIds = new Set<string>();
  for (const aliasRepair of aliasRepairByEntryIndex.values()) {
    for (const ownerId of [
      aliasRepair.providerSurvivor.id,
      aliasRepair.loserTombstone.id,
    ]) {
      if (aliasRepairOwnerIds.has(ownerId)) {
        throw new VaultError(
          "EVENT_ALIAS_REPAIR_OWNER_REFUSED",
          "Junction daily aggregate alias repair operations cannot share persisted owners.",
        );
      }
      aliasRepairOwnerIds.add(ownerId);
    }
  }
  for (const [entryIndex, aliasRepair] of aliasRepairByEntryIndex) {
    const entry = entries[entryIndex]!;
    appendEntries.push(
      { relativePath: aliasRepair.survivorPath, record: aliasRepair.providerSurvivor },
      { relativePath: aliasRepair.loserPath, record: aliasRepair.loserTombstone },
    );
    if (aliasRepair.overlaySurvivor) {
      appendEntries.push({
        relativePath: aliasRepair.survivorPath,
        record: aliasRepair.overlaySurvivor,
      });
    }
    appendRecordIdByPreparedRecordId.set(
      entry.record.id,
      aliasRepair.providerSurvivor.id,
    );
    forceAppendIds.add(aliasRepair.providerSurvivor.id);
    forceAppendIds.add(aliasRepair.loserTombstone.id);
    recordsByEntryIndex.set(
      entryIndex,
      aliasRepair.overlaySurvivor ?? aliasRepair.providerSurvivor,
    );
    applyJunctionDailyAggregateAliasRepairToIndex(aliasRepair, index);
    supersededCount += 1;
    retractedCount += 1;
  }

  for (const [entryIndex, originalEntry] of entries.entries()) {
    if (aliasRepairByEntryIndex.has(entryIndex)) {
      continue;
    }
    let entry = originalEntry;
    const externalRef = entry.record.externalRef;

    if (!externalRef) {
      const current = index.latestById.get(entry.record.id);
      if (
        current
        && !isDeletedEventSpineRecord(current)
        && deviceEventContentKey(current) === deviceEventContentKey(entry.record)
      ) {
        skippedDuplicateCount += 1;
        retainedPreparedIds.add(entry.record.id);
        recordsByEntryIndex.set(entryIndex, current);
        continue;
      }
      appendEntries.push(entry);
      appendRecordIdByPreparedRecordId.set(entry.record.id, entry.record.id);
      recordsByEntryIndex.set(entryIndex, entry.record);
      continue;
    }

    const resolved = resolveDeviceEventIdentity(entry, context, { strict: true });
    if (!resolved) {
      throw new VaultError(
        "EVENT_EXTERNAL_REF_ALIAS_CONFLICT",
        "Device event identity unexpectedly lost its externalRef during reconciliation.",
      );
    }
    if (resolved.latest && aliasRepairOwnerIds.has(resolved.latest.id)) {
      throw new VaultError(
        "EVENT_ALIAS_REPAIR_OWNER_REFUSED",
        "Junction daily aggregate alias repair operations cannot share persisted owners.",
      );
    }
    const { matchedEntries, refKey } = resolved;
    let latest = resolved.latest;
    const migratesJunctionNoIdProfileIdentity = isIncomingJunctionNoIdProfile(entry.record)
      && matchedEntries.some((match) => match.refKey !== refKey);

    if (!latest) {
      const canonicalRecordId = preferredCanonicalIdByPreparedId.get(entry.record.id)
        ?? entry.record.id;
      const canonicalRecord = canonicalRecordId === entry.record.id
        ? entry.record
        : { ...entry.record, id: canonicalRecordId };
      index.latestByRefKey.set(refKey, toIndexedExternalRefMatch(canonicalRecord, externalRef));
      appendEntries.push({ relativePath: entry.relativePath, record: canonicalRecord });
      appendRecordIdByPreparedRecordId.set(entry.record.id, canonicalRecord.id);
      recordsByEntryIndex.set(entryIndex, canonicalRecord);
      continue;
    }

    const indexedProviderMatch = matchedEntries.find(
      (match) => match.indexedMatch.record.id === latest.id,
    )?.indexedMatch ?? matchedEntries[0]?.indexedMatch;
    const replaysJunctionNoIdProfileTimestamp = indexedProviderMatch !== undefined
      && isJunctionNoIdProfileEqualRevisionTimestampReplay(
        indexedProviderMatch.indexedRecord,
        entry.record,
      );
    if (replaysJunctionNoIdProfileTimestamp) {
      skippedDuplicateCount += 1;
      retainedPreparedIds.add(entry.record.id);
      recordsByEntryIndex.set(entryIndex, latest);
      continue;
    }
    const matchesIndexedProviderContent = indexedProviderMatch !== undefined
      && deviceEventContentKey(indexedProviderMatch.indexedRecord)
        === deviceEventContentKey(entry.record);
    const indexedSourceVersionComparison = indexedProviderMatch
      ? compareIncomingExternalRefVersion(
          indexedProviderMatch.indexedExternalRef,
          externalRef,
        )
      : null;
    const migratesJunctionStableProfileTimestamp = indexedProviderMatch !== undefined
      && isJunctionStableProfileCreatedAtTimestampMigration(
        indexedProviderMatch.indexedRecord,
        entry.record,
      );
    const retainsDeletedJunctionStableProfile = isMemberDeletedJunctionStableProfile(
      latest,
      entry.record,
    );
    if (
      isDeletedEventSpineRecord(latest)
      && (migratesJunctionStableProfileTimestamp || retainsDeletedJunctionStableProfile)
    ) {
      skippedDuplicateCount += 1;
      retainedPreparedIds.add(entry.record.id);
      recordsByEntryIndex.set(entryIndex, latest);
      continue;
    }

    const authoritativeSet = authoritativeEventSets.find((set) =>
      externalRef.system === set.system
      && externalRef.resourceType === set.resourceType
      && externalRef.resourceId === set.resourceId
      && externalRef.facet !== undefined
      && set.currentFacets.has(externalRef.facet)
    );
    if (authoritativeSet) {
      const sourceVersionComparison = compareIncomingExternalRefVersion(
        matchedEntries.find((match) => match.refKey === refKey)?.indexedMatch.indexedExternalRef
          ?? matchedEntries[0]?.indexedMatch.indexedExternalRef
          ?? latest.externalRef
          ?? externalRef,
        externalRef,
      );
      if (sourceVersionComparison !== null && sourceVersionComparison < 0) {
        skippedDuplicateCount += 1;
        recordsByEntryIndex.set(entryIndex, latest);
        continue;
      }
      if (
        sourceVersionComparison === 0
        && (
          isDeletedEventSpineRecord(latest)
          || deviceEventContentKey(latest) !== deviceEventContentKey(entry.record)
        )
        && !matchesIndexedProviderContent
        && !migratesJunctionStableProfileTimestamp
      ) {
        throw new VaultError(
          "EVENT_SOURCE_REVISION_CONFLICT",
          `Authoritative device event externalRef "${externalRef.system}/${externalRef.resourceType}/` +
            `${externalRef.resourceId}#${externalRef.facet}" has conflicting content for source revision ` +
            `"${authoritativeSet.version}"; nothing was imported.`,
        );
      }
    }

    // externalRef identity does not include kind. Event spines are kind-stable,
    // so device reconciliation must reject under-faceted provider refs instead
    // of rewriting an existing event id as a different event kind.
    if (latest.kind !== entry.record.kind) {
      throw new VaultError(
        "EVENT_KIND_MISMATCH",
        `Event externalRef "${externalRef.system}/${externalRef.resourceType}/${externalRef.resourceId}` +
          `${externalRef.facet ? `#${externalRef.facet}` : ""}" already belongs to kind ` +
          `"${latest.kind}" and cannot be rewritten as "${entry.record.kind}"; nothing was imported.`,
      );
    }

    // An unversioned member declared current by this batch's authoritative set
    // reasserts a retracted facet in serialized arrival order rather than
    // treating the tombstone's identical content as an exact replay. Ordinary
    // versionless deliveries without complete-set authority never resurrect.
    // Only provider-owned authoritative-set retractions may be reasserted.
    // Their tombstones carry the set's explicit version marker on the external
    // reference, while a member deletion preserves the member's unversioned
    // reference and must stay deleted under authoritative replay.
    const reassertsUnversionedSetMember = Boolean(
      authoritativeSet
      && indexedSourceVersionComparison === null
      && isDeletedEventSpineRecord(latest)
      && latest.source === "device"
      && latest.externalRef?.version !== undefined,
    );
    if (
      deviceEventContentKey(latest) === deviceEventContentKey(entry.record)
      && (indexedSourceVersionComparison === null || indexedSourceVersionComparison === 0)
      && !reassertsUnversionedSetMember
    ) {
      skippedDuplicateCount += 1;
      retainedPreparedIds.add(entry.record.id);
      recordsByEntryIndex.set(entryIndex, latest);
      continue;
    }

    if (matchesIndexedProviderContent && !reassertsUnversionedSetMember) {
      const historicalUserEditMatch = matchedEntries.find((match) =>
        hasHistoricalExternalRefUserAuthoredChanges(match.indexedMatch)
      );
      if (
        historicalUserEditMatch
        && indexedSourceVersionComparison !== null
        && indexedSourceVersionComparison > 0
      ) {
        const providerRevision = Math.max(
          eventSpineRevision(latest),
          index.maxRevisionById.get(latest.id) ?? 0,
        ) + 1;
        const providerBaseline: EventRecord = {
          ...entry.record,
          id: latest.id,
          lifecycle: buildEventSpineLifecycle(providerRevision),
        };
        const retainedMemberRevision: EventRecord = {
          ...latest,
          ...(migratesJunctionNoIdProfileIdentity
            ? { externalRef, dataOrigin: entry.record.dataOrigin }
            : {}),
          lifecycle: buildEventSpineLifecycle(providerRevision + 1),
        };
        const retainedMemberPath = historicalUserEditMatch.indexedMatch.relativePath
          || toEventLedgerFile(latest.occurredAt);
        forceAppendIds.add(latest.id);
        index.latestByRefKey.set(refKey, {
          indexedExternalRef: externalRef,
          indexedRecord: providerBaseline,
          relativePath: retainedMemberPath,
          record: retainedMemberRevision,
        });
        for (const { refKey: matchedRefKey, indexedMatch } of matchedEntries) {
          const currentMatch = index.latestByRefKey.get(matchedRefKey);
          if (
            matchedRefKey !== refKey
            && indexedMatch.record.id === latest.id
            && currentMatch?.record.id === latest.id
          ) {
            index.latestByRefKey.delete(matchedRefKey);
          }
        }
        index.maxRevisionById.set(latest.id, providerRevision + 1);
        appendEntries.push({ relativePath: entry.relativePath, record: providerBaseline });
        appendEntries.push({
          relativePath: retainedMemberPath,
          record: retainedMemberRevision,
        });
        appendRecordIdByPreparedRecordId.set(entry.record.id, providerBaseline.id);
        recordsByEntryIndex.set(entryIndex, retainedMemberRevision);
        supersededCount += 1;
        continue;
      }
      if (indexedSourceVersionComparison === null || indexedSourceVersionComparison === 0) {
        skippedDuplicateCount += 1;
        retainedPreparedIds.add(entry.record.id);
        recordsByEntryIndex.set(entryIndex, latest);
        continue;
      }
    }

    if (entry.externalRefUpdatePolicy === "immutable") {
      throw new VaultError(
        "EVENT_IMMUTABLE_EXTERNAL_REF_CONFLICT",
        "Immutable device event externalRef already exists with different content; nothing was imported.",
      );
    }

    if (
      indexedProviderMatch
      && isJunctionSparseIntervalExternalRef(indexedProviderMatch.indexedExternalRef)
      && isJunctionSparseIntervalExternalRef(externalRef)
      && (
        indexedProviderMatch.indexedExternalRef.version !== undefined
        || externalRef.version !== undefined
      )
    ) {
      const sourceVersionComparison = compareIncomingExternalRefVersion(
        indexedProviderMatch.indexedExternalRef,
        externalRef,
      );
      if (sourceVersionComparison === null) {
        const incomingVersion = externalRef.version;
        const existingVersion = indexedProviderMatch.indexedExternalRef.version;
        const replacesUnorderedBaseline = incomingVersion !== undefined
          && isWritableIsoDateTime(incomingVersion)
          && (existingVersion === undefined || !isWritableIsoDateTime(existingVersion));
        if (!replacesUnorderedBaseline) {
          throw new VaultError(
            "EVENT_SOURCE_REVISION_UNORDERED",
            "Changed Junction sparse intervals require comparable explicit provider revisions; nothing was imported.",
          );
        }
      }
      if (sourceVersionComparison !== null && sourceVersionComparison < 0) {
        skippedDuplicateCount += 1;
        if (eventSpineRevisionsAreComplete(index, latest.id)) {
          retainedPreparedIds.add(entry.record.id);
        }
        recordsByEntryIndex.set(entryIndex, latest);
        continue;
      }
      if (sourceVersionComparison === 0) {
        throw new VaultError(
          "EVENT_SOURCE_REVISION_CONFLICT",
          "Junction sparse interval content conflicts at the same provider revision; nothing was imported.",
        );
      }
    }

    if (
      indexedProviderMatch
      && indexedProviderMatch.indexedExternalRef.system === "whoop"
      && externalRef.system === "whoop"
    ) {
      const sourceVersionComparison = compareIncomingExternalRefVersion(
        indexedProviderMatch.indexedExternalRef,
        externalRef,
      );
      if (sourceVersionComparison !== null && sourceVersionComparison < 0) {
        skippedDuplicateCount += 1;
        if (eventSpineRevisionsAreComplete(index, latest.id)) {
          retainedPreparedIds.add(entry.record.id);
        }
        recordsByEntryIndex.set(entryIndex, latest);
        continue;
      }
      const sleepTypeBaselineRevision = sourceVersionComparison === 0
        ? whoopSleepTypeProviderBaselineRevision(index, refKey, latest.id, entry.record)
        : null;
      const hasSleepTypeProviderBaseline = sleepTypeBaselineRevision !== null;
      if (
        sourceVersionComparison === 0
        && !hasSleepTypeProviderBaseline
      ) {
        throw new VaultError(
          "EVENT_SOURCE_REVISION_CONFLICT",
          `Event externalRef "${externalRef.system}/${externalRef.resourceType}/${externalRef.resourceId}` +
            `${externalRef.facet ? `#${externalRef.facet}` : ""}" has conflicting content for source revision ` +
            `"${externalRef.version}"; nothing was imported.`,
        );
      }
      if (
        hasSleepTypeProviderBaseline
        && (
          isDeletedEventSpineRecord(latest)
          || eventSpineRevision(latest)
            !== sleepTypeBaselineRevision
          || matchedEntries.some((match) =>
            hasHistoricalExternalRefUserAuthoredChanges(match.indexedMatch)
          )
        )
      ) {
        // sleepType is provider normalization metadata. Never resurrect a
        // deleted event or replace a newer canonical revision merely to
        // backfill it; preserving this row also lets unrelated snapshot
        // resources commit.
        skippedDuplicateCount += 1;
        if (eventSpineRevisionsAreComplete(index, latest.id)) {
          retainedPreparedIds.add(entry.record.id);
        }
        recordsByEntryIndex.set(entryIndex, latest);
        continue;
      }
    }

    // Companion HealthKit sync versions are nonnegative monotonic integers.
    // Keep this comparison scoped to that closed source type: other providers
    // use timestamp-shaped versions whose ordering semantics are not universal.
    if (shouldKeepExistingJunctionCompanionHealthMetadata(latest, entry.record)) {
      if (eventSpineRevisionsAreComplete(index, latest.id)) {
        retainedPreparedIds.add(entry.record.id);
      }
      recordsByEntryIndex.set(entryIndex, latest);
      continue;
    }

    const replaysProviderOwnedRetractionWithoutSetAuthority = Boolean(
      isDeletedEventSpineRecord(latest)
      && latest.source === "device"
      && latest.externalRef?.version !== undefined
      && externalRef.version === undefined
      && !authoritativeSet,
    );
    if (replaysProviderOwnedRetractionWithoutSetAuthority) {
      skippedDuplicateCount += 1;
      retainedPreparedIds.add(entry.record.id);
      recordsByEntryIndex.set(entryIndex, latest);
      continue;
    }

    if (isDeletedEventSpineRecord(latest) && !reassertsUnversionedSetMember) {
      // A member-authored deletion tombstone (unversioned reference) stays
      // dead under authoritative replay: no append, no index change, so a
      // later empty-then-populated cadence cannot launder the deletion away.
      if (authoritativeSet && indexedSourceVersionComparison === null) {
        skippedDuplicateCount += 1;
        retainedPreparedIds.add(entry.record.id);
        recordsByEntryIndex.set(entryIndex, latest);
        continue;
      }
      index.latestByRefKey.set(refKey, toIndexedExternalRefMatch(entry.record, externalRef));
      appendEntries.push(entry);
      appendRecordIdByPreparedRecordId.set(entry.record.id, entry.record.id);
      recordsByEntryIndex.set(entryIndex, entry.record);
      continue;
    }
    // A member declared current by this batch's authoritative set falls
    // through to the superseding append below, so the reassertion lands as
    // the next serialized event-spine revision over the retraction tombstone.

    if (shouldKeepExistingJunctionSleepStageSummaryObservation(latest, entry.record)) {
      if (eventSpineRevisionsAreComplete(index, latest.id)) {
        retainedPreparedIds.add(entry.record.id);
      }
      recordsByEntryIndex.set(entryIndex, latest);
      continue;
    }

    const historicalUserEditMatch = matchedEntries.find((match) =>
      hasHistoricalExternalRefUserAuthoredChanges(match.indexedMatch)
    );

    const revision = Math.max(
      eventSpineRevision(latest),
      index.maxRevisionById.get(latest.id) ?? 0,
    ) + 1;
    const superseding: EventRecord = {
      ...entry.record,
      id: latest.id,
      lifecycle: buildEventSpineLifecycle(revision),
    };
    const migratesRetainedMemberOccurrence = migratesJunctionStableProfileTimestamp
      && indexedProviderMatch !== undefined
      && latest.occurredAt === indexedProviderMatch.indexedRecord.occurredAt
      && latest.dayKey === indexedProviderMatch.indexedRecord.dayKey;
    const retainedMemberRevision = historicalUserEditMatch
      ? {
          ...latest,
          ...(migratesJunctionStableProfileTimestamp
            ? {
                ...(migratesRetainedMemberOccurrence
                  ? { occurredAt: entry.record.occurredAt, dayKey: entry.record.dayKey }
                  : {}),
                externalRef,
                dataOrigin: entry.record.dataOrigin,
              }
            : migratesJunctionNoIdProfileIdentity
              ? { externalRef, dataOrigin: entry.record.dataOrigin }
              : {}),
          lifecycle: buildEventSpineLifecycle(revision + 1),
        }
      : null;
    const retainedMemberPath = migratesRetainedMemberOccurrence
      ? entry.relativePath
      : historicalUserEditMatch?.indexedMatch.relativePath
        || toEventLedgerFile(latest.occurredAt);

    forceAppendIds.add(latest.id);
    index.latestByRefKey.set(refKey, retainedMemberRevision
      ? {
          indexedExternalRef: externalRef,
          indexedRecord: superseding,
          relativePath: retainedMemberPath,
          record: retainedMemberRevision,
        }
      : toIndexedExternalRefMatch(superseding, externalRef));
    for (const { refKey: matchedRefKey, indexedMatch } of matchedEntries) {
      const currentMatch = index.latestByRefKey.get(matchedRefKey);
      if (
        matchedRefKey !== refKey &&
        indexedMatch.record.id === latest.id &&
        currentMatch?.record.id === latest.id
      ) {
        index.latestByRefKey.delete(matchedRefKey);
      }
    }
    index.maxRevisionById.set(latest.id, retainedMemberRevision ? revision + 1 : revision);
    appendEntries.push({ relativePath: entry.relativePath, record: superseding });
    if (retainedMemberRevision) {
      appendEntries.push({ relativePath: retainedMemberPath, record: retainedMemberRevision });
    }
    appendRecordIdByPreparedRecordId.set(entry.record.id, superseding.id);
    recordsByEntryIndex.set(entryIndex, retainedMemberRevision ?? superseding);
    supersededCount += 1;
  }

  for (const set of authoritativeEventSets) {
    const ownsFacet = (facet: string): boolean => set.facetPrefixes.some((prefix) =>
      facet === prefix || facet.startsWith(`${prefix}-`)
    );
    const candidates = [...index.latestByRefKey.entries()].filter(([, match]) => {
      const externalRef = match.record.externalRef;
      return externalRef?.system === set.system
        && externalRef.resourceType === set.resourceType
        && externalRef.resourceId === set.resourceId
        && typeof externalRef.facet === "string"
        && ownsFacet(externalRef.facet)
        && !set.currentFacets.has(externalRef.facet)
        && !isDeletedEventSpineRecord(match.record);
    });

    for (const [refKey, latestMatch] of candidates) {
      const latest = latestMatch.record;
      const latestRef = latest.externalRef;
      if (!latestRef?.facet) {
        continue;
      }
      const incomingRef: ExternalRef = { ...latestRef, version: set.version };
      const sourceVersionComparison = compareIncomingExternalRefVersion(
        latestMatch.indexedExternalRef,
        incomingRef,
      );
      if (sourceVersionComparison !== null && sourceVersionComparison < 0) {
        continue;
      }
      if (
        sourceVersionComparison === 0
        && isDeletedEventSpineRecord(latestMatch.indexedRecord)
      ) {
        continue;
      }
      if (sourceVersionComparison === 0) {
        throw new VaultError(
          "EVENT_SOURCE_REVISION_CONFLICT",
          `Authoritative device event externalRef "${set.system}/${set.resourceType}/` +
            `${set.resourceId}#${latestRef.facet}" has conflicting membership for source revision ` +
            `"${set.version}"; nothing was imported.`,
        );
      }
      const hasMemberEdit = hasHistoricalExternalRefUserAuthoredChanges(latestMatch);

      const revision = Math.max(
        eventSpineRevision(latest),
        index.maxRevisionById.get(latest.id) ?? 0,
      ) + 1;
      const tombstone: EventRecord = {
        ...latestMatch.indexedRecord,
        source: "device",
        recordedAt: set.version,
        externalRef: incomingRef,
        lifecycle: buildEventSpineLifecycle(revision, "deleted"),
      };
      const retainedMemberRevision = hasMemberEdit
        ? {
            ...latest,
            lifecycle: buildEventSpineLifecycle(revision + 1),
          }
        : null;
      const latestPath = latestMatch.relativePath || toEventLedgerFile(latest.occurredAt);

      forceAppendIds.add(latest.id);
      index.latestByRefKey.set(
        refKey,
        retainedMemberRevision
          ? {
              indexedExternalRef: incomingRef,
              indexedRecord: tombstone,
              relativePath: latestPath,
              record: retainedMemberRevision,
            }
          : toIndexedExternalRefMatch(tombstone, incomingRef, latestPath),
      );
      index.maxRevisionById.set(latest.id, retainedMemberRevision ? revision + 1 : revision);
      appendEntries.push({ relativePath: latestPath, record: tombstone });
      if (retainedMemberRevision) {
        appendEntries.push({ relativePath: latestPath, record: retainedMemberRevision });
      }
      retractedCount += 1;
    }
  }

  const records = entries.map((entry, entryIndex) => {
    const record = recordsByEntryIndex.get(entryIndex);
    if (!record) {
      throw new VaultError(
        "EVENT_EXTERNAL_REF_ALIAS_CONFLICT",
        `Device event reconciliation did not produce a result for "${entry.record.id}".`,
      );
    }
    return record;
  });

  return {
    appendEntries,
    appendRecordIdByPreparedRecordId,
    records,
    forceAppendIds,
    retainedPreparedIds,
    skippedDuplicateCount,
    supersededCount,
    retractedCount,
  };
}

// Public bulk import reconciles externalRef identity vault-wide, not per
// monthly shard: a re-import whose corrected occurredAt moves the row to a
// different month must still find and supersede the original event instead of
// minting a duplicate. This mirrors upsertEvent, which resolves an event id
// across every shard and writes the new revision into the shard for the new
// occurredAt, so an event spine may span shards and readers collapse it by id.
async function reconcileEventImportDecisionsByExternalRef(
  vaultRoot: string,
  decisions: readonly PreparedEventImportDecision[],
  signal?: AbortSignal | null,
): Promise<EventImportReconciliation> {
  assertCanonicalWriteLockScope(vaultRoot);

  const { relativePaths: shardPaths } = await walkVaultFilesInterruptible(
    vaultRoot,
    VAULT_LAYOUT.eventLedgerDirectory,
    {
    extension: ".jsonl",
      signal,
    },
  );
  const index = await indexLatestEventsByExternalRef(vaultRoot, shardPaths, signal);

  for (const decision of decisions) {
    signal?.throwIfAborted();
    if (decision.action !== "upsert" || !decision.expectedLatest) {
      continue;
    }
    const externalRef = decision.entry.record.externalRef;
    const latestById = index.latestById.get(decision.expectedLatest.eventId);
    const latestByRef = externalRef
      ? index.latestByRefKey.get(eventExternalRefKey(externalRef))?.record
      : undefined;
    if (
      !latestById
      || latestById.id !== latestByRef?.id
      || eventSpineRevision(latestById) !== decision.expectedLatest.lifecycleRevision
    ) {
      throw new VaultError(
        "EVENT_EXPECTED_LATEST_MISMATCH",
        "An imported event changed after it was inspected; the whole batch was rejected without writes.",
      );
    }
  }

  const appendEntries: PreparedJsonlEntry<EventRecord>[] = [];
  const forceAppendIds = new Set<string>();
  const eventIds: string[] = [];
  const retractedEventIds: string[] = [];
  const eventShardPaths = new Set<string>();
  const orderedDecisions = orderEventImportDecisionsBySourceVersion(decisions);
  let createdCount = 0;
  let skippedExistingCount = 0;
  let supersededCount = 0;
  let retractedCount = 0;

  for (const decision of orderedDecisions) {
    signal?.throwIfAborted();
    if (decision.action === "retract") {
      const refKey = eventExternalRefKey(decision.externalRef);
      const latestMatch = index.latestByRefKey.get(refKey);
      const latest = latestMatch?.record;
      if (!latestMatch || !latest) {
        const marker: EventRecord = {
          ...decision.markerEntry.record,
          lifecycle: buildEventSpineLifecycle(1, "deleted"),
        };
        eventShardPaths.add(decision.markerEntry.relativePath);
        index.latestByRefKey.set(
          refKey,
          toIndexedExternalRefMatch(marker, decision.externalRef, decision.markerEntry.relativePath),
        );
        index.maxRevisionById.set(marker.id, 1);
        appendEntries.push({ relativePath: decision.markerEntry.relativePath, record: marker });
        retractedEventIds.push(marker.id);
        retractedCount += 1;
        continue;
      }

      const latestPath = latestMatch?.relativePath || toEventLedgerFile(latest.occurredAt);
      eventShardPaths.add(latestPath);
      const sourceVersionComparison = compareIncomingExternalRefVersion(
        latestMatch.indexedExternalRef,
        decision.externalRef,
      );
      if (sourceVersionComparison === null) {
        throw new VaultError(
          "EVENT_SOURCE_REVISION_UNORDERED",
          `Event externalRef "${decision.externalRef.system}/${decision.externalRef.resourceType}/` +
            `${decision.externalRef.resourceId}${decision.externalRef.facet ? `#${decision.externalRef.facet}` : ""}" ` +
            "cannot be retracted without comparable source revisions; nothing was imported.",
        );
      }
      if (sourceVersionComparison < 0 || (sourceVersionComparison === 0 && isDeletedEventSpineRecord(latest))) {
        skippedExistingCount += 1;
        continue;
      }
      if (sourceVersionComparison === 0) {
        throw new VaultError(
          "EVENT_SOURCE_REVISION_CONFLICT",
          `Event externalRef "${decision.externalRef.system}/${decision.externalRef.resourceType}/` +
            `${decision.externalRef.resourceId}${decision.externalRef.facet ? `#${decision.externalRef.facet}` : ""}" ` +
            `has conflicting content for source revision "${decision.externalRef.version}"; nothing was imported.`,
        );
      }

      const revision = Math.max(
        eventSpineRevision(latest),
        index.maxRevisionById.get(latest.id) ?? 0,
      ) + 1;
      const tombstone: EventRecord = {
        ...latest,
        recordedAt: decision.markerEntry.record.recordedAt,
        externalRef: decision.externalRef,
        ...(decision.evidence ? { evidence: decision.evidence } : {}),
        ...(latest.kind === "note" && latest.noteType === EVENT_IMPORT_RETRACTION_MARKER_NOTE_TYPE
          ? { note: decision.reason }
          : {}),
        lifecycle: buildEventSpineLifecycle(revision, "deleted"),
      };

      forceAppendIds.add(latest.id);
      index.latestByRefKey.set(refKey, toIndexedExternalRefMatch(tombstone, decision.externalRef, latestPath));
      index.maxRevisionById.set(latest.id, revision);
      appendEntries.push({ relativePath: latestPath, record: tombstone });
      retractedEventIds.push(latest.id);
      retractedCount += 1;
      continue;
    }

    const entry = decision.entry;
    eventShardPaths.add(entry.relativePath);
    const externalRef = entry.record.externalRef;

    if (!externalRef) {
      appendEntries.push(entry);
      eventIds.push(entry.record.id);
      createdCount += 1;
      continue;
    }

    const refKey = eventExternalRefKey(externalRef);
    const latestMatch = index.latestByRefKey.get(refKey);
    const latest = latestMatch?.record;

    if (!latest) {
      index.latestByRefKey.set(refKey, toIndexedExternalRefMatch(entry.record, externalRef, entry.relativePath));
      appendEntries.push(entry);
      eventIds.push(entry.record.id);
      createdCount += 1;
      continue;
    }

    const sourceVersionComparison = compareIncomingExternalRefVersion(
      latestMatch.indexedExternalRef,
      externalRef,
    );
    if (sourceVersionComparison !== null) {
      if (sourceVersionComparison < 0) {
        skippedExistingCount += 1;
        continue;
      }
      if (sourceVersionComparison === 0) {
        const existingContentKey = decision.allowsKindReplacement
          ? eventImportSourceSemanticContentKey(latest)
          : eventImportVersionedReplayContentKey(latest);
        const incomingContentKey = decision.allowsKindReplacement
          ? eventImportSourceSemanticContentKey(entry.record)
          : eventImportVersionedReplayContentKey(entry.record);
        if (existingContentKey === incomingContentKey) {
          skippedExistingCount += 1;
          continue;
        }
        throw new VaultError(
          "EVENT_SOURCE_REVISION_CONFLICT",
          `Event externalRef "${externalRef.system}/${externalRef.resourceType}/${externalRef.resourceId}` +
            `${externalRef.facet ? `#${externalRef.facet}` : ""}" has conflicting content for source revision ` +
            `"${externalRef.version}"; nothing was imported.`,
        );
      }
    } else {
      // Preserve the legacy public-import contract for unversioned or
      // non-temporal sources: provenance changes remain content changes and a
      // kind mismatch remains invalid.
      if (latest.kind !== entry.record.kind) {
        throw new VaultError(
          "EVENT_KIND_MISMATCH",
          `Event externalRef "${externalRef.system}/${externalRef.resourceType}/${externalRef.resourceId}` +
            `${externalRef.facet ? `#${externalRef.facet}` : ""}" already belongs to kind ` +
            `"${latest.kind}" and cannot be rewritten as "${entry.record.kind}"; nothing was imported.`,
        );
      }
      if (eventImportContentKey(latest) === eventImportContentKey(entry.record)) {
        skippedExistingCount += 1;
        continue;
      }
    }

    if (latest.kind !== entry.record.kind && !decision.allowsKindReplacement) {
      throw new VaultError(
        "EVENT_KIND_MISMATCH",
        `Event externalRef "${externalRef.system}/${externalRef.resourceType}/${externalRef.resourceId}` +
          `${externalRef.facet ? `#${externalRef.facet}` : ""}" already belongs to kind ` +
          `"${latest.kind}" and cannot be rewritten as "${entry.record.kind}"; nothing was imported.`,
      );
    }

    if (isDeletedEventSpineRecord(latest)) {
      index.latestByRefKey.set(refKey, toIndexedExternalRefMatch(entry.record, externalRef, entry.relativePath));
      appendEntries.push(entry);
      eventIds.push(entry.record.id);
      createdCount += 1;
      continue;
    }

    if (latest.kind !== entry.record.kind) {
      const latestPath = latestMatch?.relativePath || toEventLedgerFile(latest.occurredAt);
      const revision = Math.max(
        eventSpineRevision(latest),
        index.maxRevisionById.get(latest.id) ?? 0,
      ) + 1;
      const tombstone: EventRecord = {
        ...latest,
        recordedAt: entry.record.recordedAt,
        externalRef,
        ...(entry.record.evidence ? { evidence: entry.record.evidence } : {}),
        lifecycle: buildEventSpineLifecycle(revision, "deleted"),
      };

      forceAppendIds.add(latest.id);
      index.maxRevisionById.set(latest.id, revision);
      index.latestByRefKey.set(refKey, toIndexedExternalRefMatch(entry.record, externalRef, entry.relativePath));
      appendEntries.push({ relativePath: latestPath, record: tombstone }, entry);
      eventShardPaths.add(latestPath);
      eventIds.push(entry.record.id);
      createdCount += 1;
      supersededCount += 1;
      continue;
    }

    const revision = Math.max(
      eventSpineRevision(latest),
      index.maxRevisionById.get(latest.id) ?? 0,
    ) + 1;
    const superseding: EventRecord = {
      ...entry.record,
      id: latest.id,
      lifecycle: buildEventSpineLifecycle(revision),
    };

    forceAppendIds.add(latest.id);
    index.latestByRefKey.set(refKey, toIndexedExternalRefMatch(superseding, externalRef, entry.relativePath));
    index.maxRevisionById.set(latest.id, revision);
    appendEntries.push({ relativePath: entry.relativePath, record: superseding });
    eventIds.push(superseding.id);
    supersededCount += 1;
  }

  return {
    appendEntries,
    forceAppendIds,
    createdCount,
    skippedExistingCount,
    supersededCount,
    retractedCount,
    eventIds,
    retractedEventIds,
    eventShardPaths: [...eventShardPaths].sort(),
  };
}

export interface DedupeDeviceEventsByExternalRefInput {
  vaultRoot: string;
  apply?: boolean;
}

export interface DedupeDeviceEventsByExternalRefResult {
  applied: boolean;
  scannedLiveDeviceEventCount: number;
  duplicateGroupCount: number;
  tombstonedEventCount: number;
  tombstonedByKind: Record<string, number>;
  skippedRevisedElsewhereCount: number;
  shardPaths: string[];
  auditPath: string | null;
}

const AUDIT_TARGET_ID_LIMIT = 50;

// One-time/maintenance cleanup for vaults that accumulated duplicate device
// events before importDeviceBatch merged idempotently on externalRef: group
// live device events by the same externalRef identity the importer uses, keep
// the spine-latest copy per group, and tombstone the rest (append-only spine
// deletes, same shape as deleteEvent). Dry-run by default.
export async function dedupeDeviceEventsByExternalRef({
  vaultRoot,
  apply = false,
}: DedupeDeviceEventsByExternalRefInput): Promise<DedupeDeviceEventsByExternalRefResult> {
  const shardPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  const deletedAt = new Date().toISOString();
  const groupedByShard = new Map<string, Map<string, EventSpineEntry<EventRecord>[]>>();
  // Highest revision per event id across ALL parsed rows in ALL shards,
  // including revisions without a device source or externalRef (e.g. a user
  // edit through upsertEvent that did not echo them). The device-filtered
  // grouping below cannot see those revisions, so any id with a higher
  // revision elsewhere is left untouched instead of risking a tombstone that
  // collides with or shadows the invisible revision.
  const maxRevisionById = new Map<string, number>();

  for (const relativePath of shardPaths) {
    const grouped = new Map<string, EventSpineEntry<EventRecord>[]>();

    for (const raw of await readJsonlRecords({ vaultRoot, relativePath })) {
      const parsed = safeParseContract(eventRecordSchema, raw);

      if (!parsed.success) {
        continue;
      }

      maxRevisionById.set(
        parsed.data.id,
        Math.max(maxRevisionById.get(parsed.data.id) ?? 0, eventSpineRevision(parsed.data)),
      );

      if (parsed.data.source !== "device" || !parsed.data.externalRef) {
        continue;
      }

      const refKey = eventExternalRefKey(parsed.data.externalRef);
      const group = grouped.get(refKey) ?? [];
      group.push({ relativePath, record: parsed.data });
      grouped.set(refKey, group);
    }

    if (grouped.size > 0) {
      groupedByShard.set(relativePath, grouped);
    }
  }

  const tombstonePayloadByShard = new Map<string, string>();
  const tombstonedEventIds: string[] = [];
  const tombstonedByKind: Record<string, number> = {};
  let scannedLiveDeviceEventCount = 0;
  let duplicateGroupCount = 0;
  let skippedRevisedElsewhereCount = 0;

  for (const grouped of groupedByShard.values()) {
    for (const group of grouped.values()) {
      const livePerId = collapseEventSpineEntries(group);
      scannedLiveDeviceEventCount += livePerId.length;

      if (livePerId.length <= 1) {
        continue;
      }

      const winner = selectLatestEventSpineEntry(livePerId);
      duplicateGroupCount += 1;

      for (const entry of livePerId) {
        if (entry.record.id === winner?.record.id) {
          continue;
        }

        if ((maxRevisionById.get(entry.record.id) ?? 0) > eventSpineRevision(entry.record)) {
          skippedRevisedElsewhereCount += 1;
          continue;
        }

        const tombstone = {
          ...entry.record,
          recordedAt: deletedAt,
          lifecycle: buildEventSpineLifecycle(eventSpineRevision(entry.record) + 1, "deleted"),
        };
        assertContractShape(
          eventRecordSchema,
          tombstone,
          "EVENT_CONTRACT_INVALID",
          "Deduped device event tombstone is invalid.",
        );
        tombstonePayloadByShard.set(
          entry.relativePath,
          `${tombstonePayloadByShard.get(entry.relativePath) ?? ""}${JSON.stringify(tombstone)}\n`,
        );
        tombstonedEventIds.push(entry.record.id);
        tombstonedByKind[entry.record.kind] = (tombstonedByKind[entry.record.kind] ?? 0) + 1;
      }
    }
  }

  const touchedShardPaths = [...tombstonePayloadByShard.keys()].sort();
  const truncationNote = tombstonedEventIds.length > AUDIT_TARGET_ID_LIMIT
    ? ` (first ${AUDIT_TARGET_ID_LIMIT} target ids listed)`
    : "";
  const summary =
    `Deduped device events by externalRef: tombstoned ${tombstonedEventIds.length} duplicate event(s) `
    + `across ${duplicateGroupCount} group(s), keeping the latest copy per group${truncationNote}.`;

  if (!apply || tombstonedEventIds.length === 0) {
    return {
      applied: false,
      scannedLiveDeviceEventCount,
      duplicateGroupCount,
      tombstonedEventCount: tombstonedEventIds.length,
      tombstonedByKind,
      skippedRevisedElsewhereCount,
      shardPaths: touchedShardPaths,
      auditPath: null,
    };
  }

  return runCanonicalWrite({
    vaultRoot,
    operationType: "device_event_dedupe",
    summary,
    occurredAt: deletedAt,
    mutate: async ({ batch }) => {
      for (const relativePath of touchedShardPaths) {
        const payload = tombstonePayloadByShard.get(relativePath);

        if (payload) {
          await batch.stageJsonlAppend(relativePath, payload);
        }
      }

      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "event_delete",
        commandName: "core.dedupeDeviceEventsByExternalRef",
        summary,
        occurredAt: deletedAt,
        files: touchedShardPaths,
        targetIds: tombstonedEventIds.slice(0, AUDIT_TARGET_ID_LIMIT),
      });

      return {
        applied: true,
        scannedLiveDeviceEventCount,
        duplicateGroupCount,
        tombstonedEventCount: tombstonedEventIds.length,
        tombstonedByKind,
        skippedRevisedElsewhereCount,
        shardPaths: touchedShardPaths,
        auditPath: audit.relativePath,
      };
    },
  });
}

function mapPreparedDeviceEventsToCanonicalIds(
  preparedEntries: readonly PreparedJsonlEntry<EventRecord>[],
  reconciledRecords: readonly EventRecord[],
): ReadonlyMap<string, string> {
  if (preparedEntries.length !== reconciledRecords.length) {
    throw new VaultError(
      "INTEGRATION_INGEST_EVENT_MAPPING_MISSING",
      "Device event reconciliation did not return one canonical result per prepared event.",
    );
  }
  return new Map(
    preparedEntries.map((entry, index) => [
      entry.record.id,
      reconciledRecords[index]?.id ?? entry.record.id,
    ]),
  );
}

function buildIntegrationEventOutputs(
  preparedEntries: readonly PreparedJsonlEntry<EventRecord>[],
  canonicalIdByPreparedId: ReadonlyMap<string, string>,
  evidenceRolesByPreparedId: ReadonlyMap<string, readonly string[]>,
): IntegrationIngestEventOutput[] {
  const rolesByCanonicalId = new Map<string, Set<string>>();
  for (const entry of preparedEntries) {
    const canonicalId = canonicalIdByPreparedId.get(entry.record.id);
    if (!canonicalId) {
      throw new VaultError(
        "INTEGRATION_INGEST_EVENT_MAPPING_MISSING",
        `No canonical event id was recorded for prepared event "${entry.record.id}".`,
      );
    }
    const roles = rolesByCanonicalId.get(canonicalId) ?? new Set<string>();
    for (const role of evidenceRolesByPreparedId.get(entry.record.id) ?? []) {
      roles.add(role);
    }
    rolesByCanonicalId.set(canonicalId, roles);
  }
  return [...rolesByCanonicalId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, roles]) => ({ id, roles: [...roles].sort() }));
}

function buildDeviceBatchAuditSummary(input: {
  provider: string;
  eventCount: number;
  sampleCount: number;
  skippedDuplicateCount: number;
  supersededCount: number;
  retractedCount: number;
}): string {
  const dedupeNotes: string[] = [];

  if (input.skippedDuplicateCount > 0) {
    dedupeNotes.push(`${input.skippedDuplicateCount} duplicate event(s) skipped by externalRef`);
  }

  if (input.supersededCount > 0) {
    dedupeNotes.push(`${input.supersededCount} event(s) updated in place by externalRef`);
  }

  if (input.retractedCount > 0) {
    dedupeNotes.push(`${input.retractedCount} omitted authoritative event(s) retracted`);
  }

  const dedupeSuffix = dedupeNotes.length > 0 ? ` (${dedupeNotes.join(", ")})` : "";

  return `Imported ${input.provider} device batch with ${input.eventCount} event(s) and ${input.sampleCount} sample(s)${dedupeSuffix}.`;
}

function prepareDeviceSampleEntries(
  samples: readonly NormalizedDeviceSample[],
): PreparedJsonlEntry<SampleRecord>[] {
  return samples.map((sample) => {
    const record = finalizeSampleRecord({
      seed: sample.seed,
      recordId: sample.recordId,
    });

    return {
      record,
      relativePath: toMonthlyShardRelativePath(
        `${VAULT_LAYOUT.sampleLedgerDirectory}/${sample.seed.stream}`,
        record.recordedAt,
        "recordedAt",
      ),
    };
  });
}

function buildLegacyReceiptFingerprint(
  receipt: LooseRecord | undefined,
  provider: string,
): Array<{ role: string; fileName: string; mediaType: string; sha256: string }> {
  if (!receipt) {
    return [];
  }
  const receiptId = typeof receipt.id === "string" ? receipt.id.trim() : "";
  if (!receiptId) {
    throw new VaultError(
      "INTEGRATION_INGEST_RECEIPT_INVALID",
      "Device ingest receipt requires an id.",
    );
  }
  const content = normalizeInlineRawContent(receipt);
  return [{
    role: `wearable-raw-receipt:${receiptId}`,
    fileName: `${provider}-raw-ingest-receipt-${receiptId}.json`,
    mediaType: "application/json",
    sha256: createHash("sha256").update(content).digest("hex"),
  }];
}

function prepareDeviceBatchPlan({
  provider,
  accountId,
  importedAt = new Date(),
  defaultTimeZone: fallbackTimeZone,
  source = "device",
  events = [],
  samples = [],
  evidenceParts = [],
  authoritativeEventSets = [],
  ingestReceipt,
  provenance,
}: Omit<ImportDeviceBatchInput, "vaultRoot"> & {
  defaultTimeZone?: string;
}): DeviceBatchPlan {
  const normalizedInputs = normalizeDeviceBatchInputs({
    provider,
    accountId,
    importedAt,
    defaultTimeZone: fallbackTimeZone,
    source,
    events,
    samples,
    evidenceParts,
    authoritativeEventSets,
    ingestReceipt,
    provenance,
  });

  const effectiveOccurredAt = earliestTimestamp(
    [
      ...normalizedInputs.events.map(({ seed }) => seed.occurredAt),
      ...normalizedInputs.samples.map(({ seed }) => seed.recordedAt),
    ],
    normalizedInputs.importedAt,
  );
  const rawArtifactFingerprint = [
    ...normalizedInputs.evidenceParts.map((part) => ({
      role: part.role,
      fileName: part.fileName,
      mediaType: part.mediaType ?? null,
      sha256: part.sha256,
      ...(part.metadata === undefined ? {} : { metadata: part.metadata }),
    })),
    ...buildLegacyReceiptFingerprint(normalizedInputs.ingestReceipt, normalizedInputs.provider),
  ];
  const legacyRawArtifactFingerprint = [
    ...normalizedInputs.evidenceParts.map((part) => ({
      role: part.role,
      fileName: part.fileName,
      mediaType: part.mediaType ?? null,
      sha256: part.sha256,
    })),
    ...buildLegacyReceiptFingerprint(normalizedInputs.legacyIngestReceipt, normalizedInputs.provider),
  ];
  const compactedIngestReceipt = compactIntegrationIngestReceipt(normalizedInputs.ingestReceipt);
  const buildImportId = (fingerprint: readonly unknown[]) => deterministicContractId(
    ID_PREFIXES.transform,
    stableStringify({
      provider: normalizedInputs.provider,
      accountId: normalizedInputs.accountId ?? null,
      source: normalizedInputs.source,
      importedAt: normalizedInputs.importedAt,
      provenance: normalizedInputs.provenance,
      receipt: compactedIngestReceipt ?? null,
      eventIds: normalizedInputs.events.map(({ recordId }) => recordId),
      sampleIds: normalizedInputs.samples.map(({ recordId }) => recordId),
      ...(normalizedInputs.authoritativeEventSets.length === 0
        ? {}
        : {
            authoritativeEventSets: normalizedInputs.authoritativeEventSets.map((set) => ({
              system: set.system,
              resourceType: set.resourceType,
              resourceId: set.resourceId,
              version: set.version,
              facetPrefixes: set.facetPrefixes,
              currentFacets: [...set.currentFacets].sort(),
            })),
          }),
      evidenceParts: fingerprint,
    }),
  );
  const importId = buildImportId(rawArtifactFingerprint);
  const legacyImportId = buildImportId(legacyRawArtifactFingerprint);
  const preparedEvidenceParts = prepareDeviceEvidenceParts(normalizedInputs.evidenceParts);
  const eventPlan = prepareDeviceEventEntries(normalizedInputs.events, preparedEvidenceParts);
  const preparedSamples = prepareDeviceSampleEntries(normalizedInputs.samples);

  return {
    importId,
    legacyImportId,
    provider: normalizedInputs.provider,
    accountId: normalizedInputs.accountId,
    importedAt: normalizedInputs.importedAt,
    source: normalizedInputs.source,
    provenance: normalizedInputs.provenance,
    ingestReceipt: compactedIngestReceipt,
    effectiveOccurredAt,
    preparedEvents: eventPlan.entries,
    evidenceRolesByPreparedRecordId: eventPlan.evidenceRolesByPreparedRecordId,
    preparedSamples,
    preparedEvidenceParts,
    authoritativeEventSets: normalizedInputs.authoritativeEventSets,
  };
}

async function hashSourceFile(sourcePath: string): Promise<CommittedPayloadReceipt> {
  const hash = createHash("sha256");
  let byteLength = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(sourcePath);
    stream.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += bytes.byteLength;
      hash.update(bytes);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { byteLength, sha256: hash.digest("hex") };
}

interface ExactDocumentSource {
  result: ImportDocumentResult & { created: false };
  rawRef: string;
}

const DOCUMENT_SOURCE_AUDIT_COMMAND = "core.importDocument";
const WORKOUT_SOURCE_IMPORT_AUDIT_COMMAND = "core.importEventBatch.sourceRawRefOnce";

function buildRawSourceReceiptTarget(
  sourceReceipt: CommittedPayloadReceipt,
): string {
  return `raw-source-v1:sha256:${sourceReceipt.sha256}:bytes:${sourceReceipt.byteLength}`;
}

interface ExactDocumentSourceSet {
  activityEventIdsByRawRef: ReadonlyMap<string, ReadonlySet<string>>;
  completionAuditEventIds: ReadonlySet<string>;
  deletedExactSourceExists: boolean;
  liveSources: ExactDocumentSource[];
}

function rejectDamagedExactDocumentEvidence(input: {
  documentId: string;
  manifestPath?: string;
  reason: string;
}): never {
  throw new VaultError(
    "RAW_MANIFEST_INVALID",
    "Preserved exact source evidence is incomplete or damaged. Exact reuse will not create a replacement identity.",
    {
      documentId: input.documentId,
      ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
      reason: input.reason,
    },
  );
}

async function inspectExactSourceAuditEvidence(input: {
  vaultRoot: string;
  sourceReceipt: CommittedPayloadReceipt;
}): Promise<{
  completionTargetEventIds: ReadonlySet<string>;
  documentIdsByEventId: ReadonlyMap<string, string>;
}> {
  const targetId = buildRawSourceReceiptTarget(input.sourceReceipt);
  const auditPaths = await walkVaultFiles(input.vaultRoot, VAULT_LAYOUT.auditDirectory, {
    extension: ".jsonl",
  });
  const completionTargetEventIds = new Set<string>();
  const documentIdsByEventId = new Map<string, string>();

  for (const relativePath of auditPaths) {
    for (const rawRecord of await readJsonlRecords({ vaultRoot: input.vaultRoot, relativePath })) {
      const parsed = safeParseContract(auditRecordSchema, rawRecord);
      if (
        !parsed.success
        || parsed.data.status !== "success"
        || parsed.data.targetIds?.includes(targetId) !== true
      ) {
        continue;
      }
      const targetIds = parsed.data.targetIds;
      if (parsed.data.commandName === DOCUMENT_SOURCE_AUDIT_COMMAND) {
        let documentId: string;
        let eventId: string;
        try {
          if (targetIds.length !== 3 || targetIds[0] !== targetId) {
            throw new TypeError("source receipt audit must retain exactly one owner");
          }
          documentId = assertContractId(targetIds[1], ID_PREFIXES.document, "documentId");
          eventId = assertContractId(targetIds[2], ID_PREFIXES.event, "eventId");
        } catch {
          rejectDamagedExactDocumentEvidence({
            documentId: typeof targetIds[1] === "string" ? targetIds[1] : "unknown",
            reason: "source receipt audit does not retain one valid document owner",
          });
        }
        const existing = documentIdsByEventId.get(eventId);
        if (existing && existing !== documentId) {
          rejectDamagedExactDocumentEvidence({
            documentId,
            reason: "source receipt audit assigns one event to multiple document owners",
          });
        }
        documentIdsByEventId.set(eventId, documentId);
        continue;
      }
      if (parsed.data.commandName === WORKOUT_SOURCE_IMPORT_AUDIT_COMMAND) {
        for (const candidate of targetIds.slice(1)) {
          try {
            completionTargetEventIds.add(assertContractId(candidate, ID_PREFIXES.event, "eventId"));
          } catch {
            // The bounded audit target list may contain non-event context.
          }
        }
      }
    }
  }

  return { completionTargetEventIds, documentIdsByEventId };
}

async function inspectExactDocumentSourceSet(input: {
  vaultRoot: string;
  sourceReceipt: CommittedPayloadReceipt;
}): Promise<ExactDocumentSourceSet> {
  const auditEvidence = await inspectExactSourceAuditEvidence(input);
  const emptyActivityIndex = new Map<string, ReadonlySet<string>>();
  if (
    auditEvidence.documentIdsByEventId.size === 0
    && auditEvidence.completionTargetEventIds.size === 0
  ) {
    return {
      activityEventIdsByRawRef: emptyActivityIndex,
      completionAuditEventIds: new Set<string>(),
      deletedExactSourceExists: false,
      liveSources: [],
    };
  }

  const shardPaths = await walkVaultFiles(input.vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });
  const entries: EventSpineEntry<DocumentEventRecord>[] = [];
  const activityEventIds = new Set<string>();
  const activityEventIdsByRawRef = new Map<string, Set<string>>();

  for (const relativePath of shardPaths) {
    for (const rawRecord of await readJsonlRecords({ vaultRoot: input.vaultRoot, relativePath })) {
      const parsed = safeParseContract(eventRecordSchema, rawRecord);
      const rawEventId = typeof rawRecord === "object"
        && rawRecord !== null
        && "id" in rawRecord
        && typeof rawRecord.id === "string"
        ? rawRecord.id
        : null;
      if (!parsed.success) {
        if (rawEventId && auditEvidence.documentIdsByEventId.has(rawEventId)) {
          rejectDamagedExactDocumentEvidence({
            documentId: auditEvidence.documentIdsByEventId.get(rawEventId) ?? "unknown",
            reason: "source receipt audit points to a contract-invalid document event",
          });
        }
        continue;
      }
      if (
        parsed.data.kind === "document"
        && auditEvidence.documentIdsByEventId.has(parsed.data.id)
      ) {
        entries.push({ relativePath, record: parsed.data });
      }
      if (parsed.data.kind === "activity_session") {
        activityEventIds.add(parsed.data.id);
        for (const rawRef of collectEventRawReferencePaths(parsed.data)) {
          const ids = activityEventIdsByRawRef.get(rawRef) ?? new Set<string>();
          ids.add(parsed.data.id);
          activityEventIdsByRawRef.set(rawRef, ids);
        }
      }
    }
  }

  const completionAuditEventIds = new Set(
    [...auditEvidence.completionTargetEventIds].filter((eventId) => activityEventIds.has(eventId)),
  );
  if (auditEvidence.documentIdsByEventId.size === 0) {
    if (completionAuditEventIds.size > 0) {
      rejectDamagedExactDocumentEvidence({
        documentId: "unknown",
        reason: "whole-source completion survives without its source receipt owner",
      });
    }
    return {
      activityEventIdsByRawRef,
      completionAuditEventIds,
      deletedExactSourceExists: false,
      liveSources: [],
    };
  }

  // Exact-source identity needs the latest revision even when it is a
  // tombstone. The ordinary collapse helper intentionally removes deleted
  // records, which would make a deleted source look like it never existed.
  const latestDocuments = new Map<string, EventSpineEntry<DocumentEventRecord>>();
  for (const entry of entries) {
    const current = latestDocuments.get(entry.record.id);
    if (!current || compareEventSpineEntries(current, entry) < 0) {
      latestDocuments.set(entry.record.id, entry);
    }
  }
  // The content-derived import audit owns source recreation identity. Its
  // document/event targets select the lifecycle row; that row derives the one
  // manifest and raw artifact to verify. No vault-wide manifest discovery or
  // compatibility reader participates in the decision.
  const claims = new Map<string, {
    entry: EventSpineEntry<DocumentEventRecord>;
    raw: EventAttachment;
  }>();
  for (const [eventId, documentId] of auditEvidence.documentIdsByEventId) {
    let origin: EventSpineEntry<DocumentEventRecord> | null = null;
    let raw: EventAttachment | null = null;
    for (const entry of entries) {
      if (entry.record.id !== eventId || entry.record.documentId !== documentId) {
        continue;
      }
      const candidateRaw = entry.record.attachments?.find((attachment) =>
        attachment.role === "source_document"
        && attachment.sha256 === input.sourceReceipt.sha256
      );
      if (
        candidateRaw
        && (!origin || compareEventSpineEntries(entry, origin) < 0)
      ) {
        origin = entry;
        raw = candidateRaw;
      }
    }
    if (!origin || !raw) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        reason: "source receipt audit has no matching canonical document event",
      });
    }
    claims.set(eventId, { entry: origin, raw });
  }

  const verified = new Map<string, {
    latest: EventSpineEntry<DocumentEventRecord>;
    manifestPath: string;
    raw: EventAttachment;
  }>();
  for (const claim of [...claims.values()]
    .sort((left, right) => left.entry.record.id.localeCompare(right.entry.record.id))) {
    const documentId = claim.entry.record.documentId;
    const manifestPath = resolveRawManifestPath({
      artifacts: [claim.raw],
      importId: documentId,
      importedAt: claim.entry.record.recordedAt,
    });
    const latest = latestDocuments.get(claim.entry.record.id);
    if (
      !latest
      || latest.record.documentId !== documentId
      || !claim.entry.record.rawRefs?.includes(claim.raw.relativePath)
    ) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "canonical document history does not retain one stable source owner",
      });
    }

    let manifestText: string;
    try {
      manifestText = await readUtf8File(input.vaultRoot, manifestPath);
    } catch (error) {
      if (error instanceof VaultError && error.code === "VAULT_FILE_MISSING") {
        rejectDamagedExactDocumentEvidence({
          documentId,
          manifestPath,
          reason: "required raw manifest is missing",
        });
      }
      throw error;
    }

    let manifest: ReturnType<typeof parseRawImportManifest>;
    try {
      manifest = parseRawImportManifest(JSON.parse(manifestText));
    } catch {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "required raw manifest is malformed",
      });
    }

    const sourceArtifacts = manifest.artifacts.filter((artifact) =>
      artifact.role === "source_document"
    );
    const artifact = sourceArtifacts[0];
    let resolvedManifestPath: string | null = null;
    try {
      resolvedManifestPath = resolveRawManifestPath({
        artifacts: manifest.artifacts,
        rawDirectory: manifest.rawDirectory,
        importId: manifest.importId,
        importedAt: manifest.importedAt,
      });
    } catch {
      // The shared resolver supplies the semantic owner/directory check below.
    }
    if (
      manifest.importKind !== "document"
      || manifest.importId !== documentId
      || manifest.importedAt !== claim.entry.record.recordedAt
      || manifest.owner.kind !== "document"
      || manifest.owner.id !== documentId
      || !rawDirectoryMatchesOwner(manifest.rawDirectory, manifest.owner)
      || resolvedManifestPath !== manifestPath
      || sourceArtifacts.length !== 1
      || !artifact
      || artifact.relativePath !== claim.raw.relativePath
      || artifact.originalFileName !== claim.raw.originalFileName
      || artifact.mediaType !== claim.raw.mediaType
      || artifact.byteSize !== input.sourceReceipt.byteLength
      || artifact.sha256 !== input.sourceReceipt.sha256
    ) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "raw manifest does not match its canonical document owner",
      });
    }
    const integrity = await statAndHashVaultFile(input.vaultRoot, artifact.relativePath);
    if (!integrity) {
      throw new VaultError(
        "RAW_REFERENCE_MISSING",
        "Preserved exact source evidence is missing its immutable raw artifact. Exact reuse will not create a replacement identity.",
        { documentId, manifestPath, relativePath: artifact.relativePath },
      );
    }
    if (
      integrity.byteSize !== artifact.byteSize
      || integrity.sha256 !== artifact.sha256
    ) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "raw artifact bytes do not match the immutable manifest",
      });
    }

    const latestRaw = latest.record.attachments?.find((attachment) =>
      attachment.role === "source_document"
      && attachment.relativePath === artifact.relativePath
      && attachment.sha256 === artifact.sha256
    );
    if (!latest.record.rawRefs?.includes(artifact.relativePath) || !latestRaw) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "latest document lifecycle no longer retains its source attachment",
      });
    }
    verified.set(claim.entry.record.id, {
      latest,
      manifestPath,
      raw: claim.raw,
    });
  }

  // A deleted identity must fence the whole exact-byte equivalence set. An
  // ordinary import may have created a live alias later, but returning that
  // alias would reset raw-reference-scoped workout completion.
  const deletedExactSourceExists = [...verified.values()].some(({ latest }) =>
    isDeletedEventSpineRecord(latest.record)
  );

  const liveSources: ExactDocumentSource[] = [];
  for (const stored of verified.values()) {
    const entry = stored.latest;
    if (isDeletedEventSpineRecord(entry.record)) {
      continue;
    }
    liveSources.push({
      rawRef: stored.raw.relativePath,
      result: {
        created: false,
        documentId: entry.record.documentId,
        raw: {
          relativePath: stored.raw.relativePath,
          originalFileName: stored.raw.originalFileName,
          mediaType: stored.raw.mediaType,
        },
        event: entry.record,
        eventPath: entry.relativePath,
        auditPath: null,
        manifestPath: stored.manifestPath,
      },
    });
  }

  return {
    activityEventIdsByRawRef,
    completionAuditEventIds,
    deletedExactSourceExists,
    liveSources,
  };
}

async function findExactDocumentImport(input: {
  vaultRoot: string;
  sourceReceipt: CommittedPayloadReceipt;
}): Promise<(ImportDocumentResult & { created: false }) | null> {
  const exactSources = await inspectExactDocumentSourceSet(input);
  if (exactSources.deletedExactSourceExists) {
    throw new VaultError(
      "DOCUMENT_EXACT_SOURCE_DELETED",
      "An exact source document existed but was deleted. Exact reuse will not create a replacement identity.",
    );
  }
  return exactSources.liveSources[0]?.result ?? null;
}

export const WORKOUT_SOURCE_IMPORT_STATUS_VALUES = [
  "not_imported",
  "completed",
  "partial_conflict",
] as const;

export type WorkoutSourceImportStatus =
  (typeof WORKOUT_SOURCE_IMPORT_STATUS_VALUES)[number];

async function inspectWorkoutSourceImportStatus(input: {
  vaultRoot: string;
  rawRef: string;
}): Promise<{ status: WorkoutSourceImportStatus; completionTargetId: string }> {
  const sourceIntegrity = await statAndHashVaultFile(input.vaultRoot, input.rawRef);
  if (sourceIntegrity === null) {
    throw new VaultError(
      "EVENT_BATCH_SOURCE_RAW_REF_MISSING",
      "The workout source does not exist as a vault file.",
    );
  }

  const sourceReceipt = {
    byteLength: sourceIntegrity.byteSize,
    sha256: sourceIntegrity.sha256,
  };
  const exactSources = await inspectExactDocumentSourceSet({
    vaultRoot: input.vaultRoot,
    sourceReceipt,
  });
  if (!exactSources.liveSources.some((source) => source.rawRef === input.rawRef)) {
    throw new VaultError(
      "EVENT_BATCH_SOURCE_DOCUMENT_NOT_LIVE",
      "The workout source is no longer owned by a live source document.",
    );
  }
  if (exactSources.deletedExactSourceExists) {
    throw new VaultError(
      "DOCUMENT_EXACT_SOURCE_DELETED",
      "An exact source document existed but was deleted. Workout import will not reuse a replacement identity.",
    );
  }

  const completionTargetId = buildRawSourceReceiptTarget(sourceReceipt);
  const exactRawRefs = new Set(exactSources.liveSources.map((source) => source.rawRef));
  const sourceEventIds = new Set<string>();
  for (const rawRef of exactRawRefs) {
    for (const eventId of exactSources.activityEventIdsByRawRef.get(rawRef) ?? []) {
      sourceEventIds.add(eventId);
    }
  }
  if ([...exactSources.completionAuditEventIds].some((eventId) => sourceEventIds.has(eventId))) {
    return { status: "completed", completionTargetId };
  }

  return {
    status: sourceEventIds.size > 0 ? "partial_conflict" : "not_imported",
    completionTargetId,
  };
}

export async function resolveWorkoutSourceImportStatus(input: {
  vaultRoot: string;
  rawRef: string;
}): Promise<WorkoutSourceImportStatus> {
  return (await inspectWorkoutSourceImportStatus(input)).status;
}

export async function importDocument({
  vaultRoot,
  sourcePath,
  occurredAt = new Date(),
  title,
  note,
  source = "import",
  reuseExact = false,
}: ImportDocumentInput): Promise<ImportDocumentResult> {
  const vault = await loadVault({ vaultRoot });
  const sourceReceipt = await hashSourceFile(sourcePath);
  if (reuseExact) {
    const existing = await findExactDocumentImport({ vaultRoot, sourceReceipt });
    if (existing) {
      const verifiedSourceReceipt = await hashSourceFile(sourcePath);
      if (
        verifiedSourceReceipt.byteLength !== sourceReceipt.byteLength
        || verifiedSourceReceipt.sha256 !== sourceReceipt.sha256
      ) {
        throw new VaultError(
          "DOCUMENT_SOURCE_CHANGED",
          "Document source changed while exact reuse was being verified.",
        );
      }
      return existing;
    }
  }
  const documentId = generateRecordId(ID_PREFIXES.document);
  const eventId = generateRecordId(ID_PREFIXES.event);
  const preparedAttachments = prepareEventAttachments({
    ownerKind: "document",
    ownerId: documentId,
    occurredAt,
    attachments: [
      {
        role: "source_document",
        kind: "document",
        sourcePath,
        expectedSourceReceipt: sourceReceipt,
      },
    ],
  });
  const raw = preparedAttachments[0]!.raw;
  const pendingAttachmentState = buildPreparedAttachmentState(preparedAttachments);
  const eventSeed = buildNormalizedEventSeed({
    kind: "document",
    occurredAt,
    recordedAt: new Date(),
    timeZone: vault.metadata.timezone,
    source,
    title: String(title ?? raw.originalFileName).trim(),
    note,
    links: [{ type: "related_to", targetId: documentId }],
    rawRefs: pendingAttachmentState.rawRefs,
    fields: {
      documentId,
      mimeType: raw.mediaType,
    },
  });
  return runCanonicalWrite({
    vaultRoot,
    operationType: "document_import",
    summary: `Import document ${documentId}`,
    occurredAt,
    mutate: async ({ batch }) => {
      const stagedAttachments = await stagePreparedEventAttachmentsInBatch({
        batch,
        owner: {
          kind: "document",
          id: documentId,
        },
        importId: documentId,
        importKind: "document",
        importedAt: eventSeed.recordedAt,
        source: eventSeed.source ?? source ?? null,
        attachments: preparedAttachments,
        provenance: {
          eventId,
          lookupId: documentId,
          occurredAt: eventSeed.occurredAt,
          title: eventSeed.title ?? null,
          note: eventSeed.note ?? null,
        },
      });
      if (!stagedAttachments) {
        throw new VaultError("EVENT_ATTACHMENTS_MISSING", "Document import expected one staged attachment.");
      }
      const stagedSourceAttachment = stagedAttachments.attachments.find((attachment) =>
        attachment.role === "source_document"
      );
      if (!stagedSourceAttachment) {
        throw new VaultError(
          "EVENT_ATTACHMENTS_MISSING",
          "Document import expected one source attachment receipt.",
        );
      }
      const sourceTargetId = buildRawSourceReceiptTarget({
        byteLength: sourceReceipt.byteLength,
        sha256: stagedSourceAttachment.sha256,
      });
      const event = prepareStoredEventLedgerEntry(
        {
          ...eventSeed,
          rawRefs: stagedAttachments.rawRefs,
          fields: {
            ...eventSeed.fields,
            attachments: stagedAttachments.attachments,
          },
        },
        eventId,
      );
      const manifestPath = stagedAttachments.manifestPath;
      await stageJsonlRecord(batch, event.relativePath, event.record);
      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "document_import",
        commandName: "core.importDocument",
        summary: `Imported document ${raw.originalFileName}.`,
        occurredAt,
        files: [raw.relativePath, manifestPath, event.relativePath],
        targetIds: [sourceTargetId, documentId, event.record.id],
      });

      return {
        created: true,
        documentId,
        raw,
        event: event.record,
        eventPath: event.relativePath,
        auditPath: audit.relativePath,
        manifestPath,
      };
    },
  });
}

export async function addMeal({
  vaultRoot,
  mealId: requestedMealId,
  eventId: requestedEventId,
  occurredAt = new Date(),
  note,
  photoPath,
  audioPath,
  ingredients,
  nutrition,
  source = "manual",
  tags,
  externalRef,
}: AddMealInput): Promise<AddMealResult> {
  const vault = await loadVault({ vaultRoot });
  const normalizedNote =
    typeof note === "string" && note.trim().length > 0 ? note.trim() : undefined;
  const normalizedIngredients = normalizeUniqueTextList(ingredients, "ingredients");
  const normalizedNutrition = normalizeMealNutrition(nutrition, "nutrition");

  if (!photoPath && !audioPath && !normalizedNote && !normalizedIngredients && !normalizedNutrition) {
    throw new VaultError(
      "VAULT_MEAL_CONTENT_REQUIRED",
      "Meal imports require at least one of photoPath, audioPath, note, ingredients, or nutrition.",
    );
  }

  const mealId = normalizeOptionalContractId(requestedMealId, ID_PREFIXES.meal, "mealId") ??
    generateRecordId(ID_PREFIXES.meal);
  const eventId = normalizeOptionalContractId(requestedEventId, ID_PREFIXES.event, "eventId") ??
    generateRecordId(ID_PREFIXES.event);
  const eventLifecycle = requestedEventId
    ? await resolveExplicitEventLifecycle({
        eventId,
        kind: "meal",
        vaultRoot,
      })
    : undefined;
  const preparedAttachments = prepareEventAttachments({
    ownerKind: "meal",
    ownerId: mealId,
    occurredAt,
    attachments: [
      ...(photoPath
        ? [
            {
              role: "photo",
              kind: "photo" as const,
              sourcePath: photoPath,
            },
          ]
        : []),
      ...(audioPath
        ? [
            {
              role: "audio",
              kind: "audio" as const,
              sourcePath: audioPath,
            },
          ]
        : []),
    ],
  });
  const photo = preparedAttachments.find((attachment) => attachment.role === "photo")?.raw ?? null;
  const audio = preparedAttachments.find((attachment) => attachment.role === "audio")?.raw ?? null;
  const rawDirectory = resolveRawAssetDirectory({
    owner: {
      kind: "meal",
      id: mealId,
    },
    occurredAt,
  });
  const pendingAttachmentState = buildPreparedAttachmentState(preparedAttachments);
  const eventSeed = buildNormalizedEventSeed({
    kind: "meal",
    occurredAt,
    recordedAt: new Date(),
    timeZone: vault.metadata.timezone,
    source,
    title: "Meal",
    note: normalizedNote,
    tags,
    externalRef,
    links: [{ type: "related_to", targetId: mealId }],
    rawRefs: pendingAttachmentState.rawRefs,
    fields: {
      mealId,
      ingredients: normalizedIngredients,
      nutrition: normalizedNutrition,
    },
  });
  return runCanonicalWrite({
    vaultRoot,
    operationType: "meal_import",
    summary: `Import meal ${mealId}`,
    occurredAt,
    mutate: async ({ batch }) => {
      const stagedAttachments = await stagePreparedEventAttachmentsInBatch({
        batch,
        owner: {
          kind: "meal",
          id: mealId,
        },
        importId: mealId,
        importKind: "meal",
        importedAt: eventSeed.recordedAt,
        source: eventSeed.source ?? source ?? null,
        attachments: preparedAttachments,
        provenance: {
          eventId,
          lookupId: mealId,
          occurredAt: eventSeed.occurredAt,
          note: eventSeed.note ?? null,
        },
      });
      let rawRefs = eventSeed.rawRefs;
      let attachments: EventAttachment[] | undefined;

      if (stagedAttachments) {
        rawRefs = stagedAttachments.rawRefs;
        attachments = stagedAttachments.attachments;
      }
      const manifestPath = stagedAttachments
        ? stagedAttachments.manifestPath
        : await stageRawImportManifest({
            batch,
            importId: mealId,
            importKind: "meal",
            importedAt: eventSeed.recordedAt,
            owner: {
              kind: "meal",
              id: mealId,
            },
            rawDirectory,
            source: eventSeed.source ?? source ?? null,
            artifacts: [],
            provenance: {
              eventId,
              lookupId: mealId,
              occurredAt: eventSeed.occurredAt,
              note: eventSeed.note ?? null,
            },
          });
      if (!stagedAttachments) {
        rawRefs = [manifestPath];
      }
      const event = prepareStoredEventLedgerEntry(
        {
          ...eventSeed,
          rawRefs,
          fields: {
            ...eventSeed.fields,
            attachments,
          },
        },
        eventId,
        eventLifecycle,
      );
      await stageJsonlRecord(batch, event.relativePath, event.record);
      const touchedFiles = [photo?.relativePath, audio?.relativePath, manifestPath, event.relativePath].filter(
        (value): value is string => typeof value === "string",
      );
      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "meal_add",
        commandName: "core.addMeal",
        summary: `Added meal ${mealId}.`,
        occurredAt,
        files: touchedFiles,
        targetIds: [mealId, event.record.id],
      });

      return {
        mealId,
        event: event.record,
        eventPath: event.relativePath,
        photo,
        audio,
        auditPath: audit.relativePath,
        manifestPath,
      };
    },
  });
}

export async function importSamples({
  vaultRoot,
  stream,
  unit,
  samples,
  sourcePath,
  source = "import",
  quality = "raw",
  batchProvenance,
}: ImportSamplesInput): Promise<ImportSamplesResult> {
  const vault = await loadVault({ vaultRoot });

  if (!SAMPLE_STREAM_SET.has(stream as SampleStream)) {
    throw new VaultError(
      "VAULT_UNSUPPORTED_SAMPLE_STREAM",
      `Unsupported baseline sample stream "${stream}".`,
      {
        stream,
      },
    );
  }

  if (!Array.isArray(samples) || samples.length === 0) {
    throw new VaultError("VAULT_INVALID_SAMPLES", "importSamples requires a non-empty samples array.");
  }

  const normalizedStream = stream as SampleStream;
  const normalizedSamples = samples.map((sample) =>
    normalizeSampleInputRecord(
      sample,
      "VAULT_INVALID_SAMPLE",
      "Each sample must be a plain object.",
    ),
  );
  const transformFingerprint = normalizedSamples.map((sample) => {
    const { id: _id, ...record } = buildSampleRecord({
      stream: normalizedStream,
      recordedAt: sample.recordedAt ?? sample.occurredAt,
      timeZone: vault.metadata.timezone,
      source,
      quality,
      sample,
      unit,
      recordId: `${ID_PREFIXES.sample}_00000000000000000000000000`,
    });

    return record;
  });
  const transformId = deterministicContractId(
    ID_PREFIXES.transform,
    JSON.stringify({
      stream: normalizedStream,
      unit,
      source,
      quality,
      sourcePath: sourcePath ?? null,
      samples: transformFingerprint,
    }),
  );
  const preparedRecords: Array<{ record: SampleRecord; relativePath: string }> = [];

  for (const [index, normalizedSample] of normalizedSamples.entries()) {
    const record = buildSampleRecord({
      stream: normalizedStream,
      recordedAt: normalizedSample.recordedAt ?? normalizedSample.occurredAt,
      timeZone: vault.metadata.timezone,
      source,
      quality,
      sample: normalizedSample,
      unit,
      recordId: deterministicContractId(ID_PREFIXES.sample, `${transformId}:${index}`),
    });
    const relativePath = toMonthlyShardRelativePath(
      `${VAULT_LAYOUT.sampleLedgerDirectory}/${normalizedStream}`,
      record.recordedAt,
      "recordedAt",
    );

    preparedRecords.push({ record, relativePath });
  }

  const raw = sourcePath
    ? prepareRawArtifact({
        sourcePath,
        owner: {
          kind: "sample_batch",
          id: transformId,
          partition: normalizedStream,
        },
        occurredAt: preparedRecords[0]?.record.recordedAt ?? new Date(),
      })
    : null;
  const touchedFiles = raw ? [raw.relativePath] : [];
  const records = preparedRecords.map((entry) => entry.record);
  const appendPlan = await buildJsonlAppendPlan(vaultRoot, preparedRecords);
  const rowCount = typeof batchProvenance?.rowCount === "number"
    ? Math.max(0, Math.trunc(batchProvenance.rowCount))
    : records.length;
  const skippedCount = typeof batchProvenance?.skippedCount === "number"
    ? Math.max(0, Math.trunc(batchProvenance.skippedCount))
    : Math.max(0, rowCount - records.length);
  const skipReasons = Array.isArray(batchProvenance?.skipReasons)
    ? batchProvenance.skipReasons
        .filter((entry) => typeof entry.reason === "string" && Number.isFinite(entry.count))
        .map((entry) => ({ reason: entry.reason, count: Math.max(0, Math.trunc(entry.count)) }))
    : [];
  const sampleBounds = sampleRecordTimeBounds(records);
  return runCanonicalWrite({
    vaultRoot,
    operationType: "sample_batch_import",
    summary: `Import ${normalizedStream} sample batch ${transformId}`,
    occurredAt: preparedRecords[0]?.record.recordedAt ?? new Date(),
    mutate: async ({ batch }) => {
      const stagedRaw = raw && sourcePath
        ? await batch.stageRawCopy({
            sourcePath,
            targetRelativePath: raw.relativePath,
            originalFileName: raw.originalFileName,
            mediaType: raw.mediaType,
            allowExistingMatch: true,
          })
        : null;
      const manifestPath = stagedRaw
        ? await stageRawImportManifest({
            batch,
            importId: transformId,
            importKind: "sample_batch",
            importedAt: records[0]?.recordedAt ?? new Date().toISOString(),
            owner: {
              kind: "sample_batch",
              id: transformId,
              partition: normalizedStream,
            },
            source: source ?? null,
            artifacts: [
              {
                role: "source_csv",
                raw: stagedRaw,
              },
            ],
            provenance: {
              stream: normalizedStream,
              unit,
              importedCount: records.length,
              ledgerFiles: appendPlan.targetShardPaths,
              sourceFileName: batchProvenance?.sourceFileName ?? raw?.originalFileName ?? null,
              importConfig: batchProvenance?.importConfig ?? null,
              rowCount,
              skippedCount,
              skipReasons,
              firstSampleAt: sampleBounds.firstSampleAt,
              lastSampleAt: sampleBounds.lastSampleAt,
            },
          })
        : "";
      await stageJsonlAppendPlan(batch, appendPlan);

      const touchedPaths = [...touchedFiles];
      touchedPaths.push(...(manifestPath ? [manifestPath] : []), ...appendPlan.appendedShardPaths);

      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "samples_import_csv",
        commandName: "core.importSamples",
        summary: `Imported ${records.length} ${normalizedStream} sample record(s).`,
        occurredAt: records[0]?.recordedAt ?? new Date(),
        files: touchedPaths,
        targetIds: [transformId],
      });

      return {
        count: records.length,
        records,
        shardPaths: appendPlan.targetShardPaths,
        raw,
        transformId,
        auditPath: audit.relativePath,
        manifestPath,
      };
    },
  });
}

function integrationEvidencePartIdentity(part: IntegrationEvidencePart): string {
  return stableStringify({
    role: part.role,
    fileName: part.fileName,
    mediaType: part.mediaType,
    sha256: part.sha256,
    metadata: part.metadata ?? null,
  });
}

function storedIntegrationIngestMatchesDeviceDeliveryBase(
  record: IntegrationIngestRecord,
  plan: DeviceBatchPlan,
): boolean {
  return record.provider === plan.provider
    && (record.accountId ?? null) === (plan.accountId ?? null)
    && record.source === plan.source
    && record.importedAt === plan.importedAt
    && stableStringify(record.provenance ?? {}) === stableStringify(plan.provenance)
    && stableStringify(record.receipt ?? null) === stableStringify(plan.ingestReceipt ?? null);
}

function storedIntegrationIngestIsDeviceDeliveryCandidate(
  record: IntegrationIngestRecord,
  plan: DeviceBatchPlan,
): boolean {
  if (!storedIntegrationIngestMatchesDeviceDeliveryBase(record, plan)) {
    return false;
  }
  const incomingPartIdentities = new Set(
    plan.preparedEvidenceParts.map(integrationEvidencePartIdentity),
  );
  return record.parts.every((part) => incomingPartIdentities.has(integrationEvidencePartIdentity(part)));
}

function storedIntegrationIngestMatchesDeviceDelivery(
  record: IntegrationIngestRecord,
  plan: DeviceBatchPlan,
): boolean {
  return storedIntegrationIngestMatchesDeviceDeliveryBase(record, plan)
    && stableStringify(record.parts.map(integrationEvidencePartIdentity))
      === stableStringify(plan.preparedEvidenceParts.map(integrationEvidencePartIdentity));
}

function hasAuthorizedCurrentDeviceEventOutput(
  currentEventOwners: CurrentDeviceEventOwners,
  preparedId: string,
): boolean {
  return currentEventOwners.associationSafePreparedIds.has(preparedId)
    && currentEventOwners.currentRecordByPreparedId.has(preparedId);
}

interface PreparedDeviceEventOutputOwner {
  preparedIds: ReadonlySet<string>;
}

interface PreparedDeviceEventOutputOwners {
  byOutputId: ReadonlyMap<string, PreparedDeviceEventOutputOwner>;
  byPreparedId: ReadonlyMap<string, PreparedDeviceEventOutputOwner>;
}

function buildPreparedDeviceEventOutputOwners(input: {
  baselineEventReconciliation: EventExternalRefReconciliation;
  currentEventOwners: CurrentDeviceEventOwners;
  deviceBatchPlan: DeviceBatchPlan;
}): PreparedDeviceEventOutputOwners {
  const baselineCanonicalIdByPreparedId = mapPreparedDeviceEventsToCanonicalIds(
    input.deviceBatchPlan.preparedEvents,
    input.baselineEventReconciliation.records,
  );
  const preparedIdsByBaselineCanonicalId = new Map<string, Set<string>>();
  for (const entry of input.deviceBatchPlan.preparedEvents) {
    const baselineCanonicalId = baselineCanonicalIdByPreparedId.get(entry.record.id);
    if (!baselineCanonicalId) {
      throw new VaultError(
        "INTEGRATION_INGEST_EVENT_MAPPING_MISSING",
        `No baseline canonical event id was recorded for prepared event "${entry.record.id}".`,
      );
    }
    const preparedIds = preparedIdsByBaselineCanonicalId.get(baselineCanonicalId)
      ?? new Set<string>();
    preparedIds.add(entry.record.id);
    preparedIdsByBaselineCanonicalId.set(baselineCanonicalId, preparedIds);
  }
  const ownerByBaselineCanonicalId = new Map<string, PreparedDeviceEventOutputOwner>(
    [...preparedIdsByBaselineCanonicalId].map(([canonicalId, preparedIds]) => [
      canonicalId,
      {
        preparedIds: new Set(preparedIds),
      },
    ]),
  );
  const byPreparedId = new Map<string, PreparedDeviceEventOutputOwner>();
  const byOutputId = new Map<string, PreparedDeviceEventOutputOwner>();
  const claimOutputId = (
    outputId: string,
    owner: PreparedDeviceEventOutputOwner,
  ): void => {
    const existingOwner = byOutputId.get(outputId);
    if (existingOwner && existingOwner !== owner) {
      throw new VaultError(
        "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
        `Stored canonical event "${outputId}" was claimed by multiple prepared device event spines.`,
      );
    }
    byOutputId.set(outputId, owner);
  };

  for (const entry of input.deviceBatchPlan.preparedEvents) {
    const baselineCanonicalId = baselineCanonicalIdByPreparedId.get(entry.record.id);
    const owner = baselineCanonicalId
      ? ownerByBaselineCanonicalId.get(baselineCanonicalId)
      : undefined;
    if (!owner) {
      throw new VaultError(
        "INTEGRATION_INGEST_EVENT_MAPPING_MISSING",
        `No event-spine owner was recorded for prepared event "${entry.record.id}".`,
      );
    }
    byPreparedId.set(entry.record.id, owner);
    claimOutputId(entry.record.id, owner);
    const canonicalId = input.currentEventOwners.canonicalIdByPreparedId.get(entry.record.id);
    if (canonicalId) {
      claimOutputId(canonicalId, owner);
    }
    for (
      const ownerId of input.currentEventOwners.historicalContentOwnerRevisionsByPreparedId.get(
        entry.record.id,
      )?.keys() ?? []
    ) {
      claimOutputId(ownerId, owner);
    }
  }

  return { byOutputId, byPreparedId };
}

function storedEventOutputMatchesPreparedOwner(input: {
  output: IntegrationIngestEventOutput;
  preparedEventOutputOwners: PreparedDeviceEventOutputOwners;
}): PreparedDeviceEventOutputOwner | undefined {
  return input.preparedEventOutputOwners.byOutputId.get(input.output.id);
}

function preparedIdsRetainedByStoredEventOutput(input: {
  evidenceRolesByPreparedRecordId: ReadonlyMap<string, readonly string[]>;
  output: IntegrationIngestEventOutput;
  owner: PreparedDeviceEventOutputOwner;
}): string[] | undefined {
  const outputRoles = new Set(input.output.roles);
  const preparedRolesById = [...input.owner.preparedIds]
    .map((preparedId) => ({
      preparedId,
      roles: input.evidenceRolesByPreparedRecordId.get(preparedId),
    }))
    .filter((entry): entry is { preparedId: string; roles: readonly string[] } =>
      entry.roles !== undefined
    );
  if (outputRoles.size === 0) {
    const emptyRoleOwners = preparedRolesById.filter((entry) => entry.roles.length === 0);
    return emptyRoleOwners.length === 1
      ? [emptyRoleOwners[0]!.preparedId]
      : undefined;
  }
  const preparedIdsByRole = new Map<string, string[]>();
  for (const { preparedId, roles } of preparedRolesById) {
    if (roles.length === 0 || roles.some((role) => !outputRoles.has(role))) {
      continue;
    }
    for (const role of roles) {
      const preparedIds = preparedIdsByRole.get(role) ?? [];
      preparedIds.push(preparedId);
      preparedIdsByRole.set(role, preparedIds);
    }
  }
  const retainedPreparedIds = new Set<string>();
  for (const role of outputRoles) {
    const preparedIds = preparedIdsByRole.get(role);
    if (preparedIds?.length !== 1) {
      return undefined;
    }
    retainedPreparedIds.add(preparedIds[0]!);
  }
  return [...retainedPreparedIds];
}

function storedEventOutputRolesBelongToPreparedOwner(input: {
  evidenceRolesByPreparedRecordId: ReadonlyMap<string, readonly string[]>;
  output: IntegrationIngestEventOutput;
  owner: PreparedDeviceEventOutputOwner;
}): boolean {
  if (input.output.roles.length === 0) {
    return [...input.owner.preparedIds].some((preparedId) =>
      (input.evidenceRolesByPreparedRecordId.get(preparedId) ?? []).length === 0
    );
  }
  return input.output.roles.every((role) => [...input.owner.preparedIds].some((preparedId) =>
    input.evidenceRolesByPreparedRecordId.get(preparedId)?.includes(role)
  ));
}

function storedOutputIdsByPreparedId(input: {
  evidenceRolesByPreparedRecordId: ReadonlyMap<string, readonly string[]>;
  preparedEventOutputOwners: PreparedDeviceEventOutputOwners;
  storedDeliveries: readonly IntegrationIngestRecord[];
}): {
  ownedOutputIds: ReadonlySet<string>;
  outputIdByPreparedId: ReadonlyMap<string, string>;
  unresolvedOutputIds: ReadonlySet<string>;
} {
  const ownedOutputIds = new Set<string>();
  const outputIdByPreparedId = new Map<string, string>();
  const unresolvedOutputIds = new Set<string>();
  for (const storedDelivery of input.storedDeliveries) {
    for (const output of storedDelivery.outputs.events) {
      const owner = input.preparedEventOutputOwners.byOutputId.get(output.id);
      const retainedPreparedIds = owner
        ? preparedIdsRetainedByStoredEventOutput({
            evidenceRolesByPreparedRecordId: input.evidenceRolesByPreparedRecordId,
            output,
            owner,
          })
        : undefined;
      if (!owner) {
        unresolvedOutputIds.add(output.id);
        continue;
      }
      ownedOutputIds.add(output.id);
      if (!retainedPreparedIds) {
        unresolvedOutputIds.add(output.id);
        continue;
      }
      for (const preparedId of retainedPreparedIds) {
        const storedOutputId = outputIdByPreparedId.get(preparedId);
        if (storedOutputId && storedOutputId !== output.id) {
          throw new VaultError(
            "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
            `Prepared device event "${preparedId}" maps to conflicting stored canonical events.`,
          );
        }
        outputIdByPreparedId.set(preparedId, output.id);
      }
    }
  }
  return { ownedOutputIds, outputIdByPreparedId, unresolvedOutputIds };
}

function outputOwnerHasAuthorizedCurrentEvent(
  currentEventOwners: CurrentDeviceEventOwners,
  owner: PreparedDeviceEventOutputOwner,
): boolean {
  return [...owner.preparedIds].some((preparedId) =>
    hasAuthorizedCurrentDeviceEventOutput(currentEventOwners, preparedId)
  );
}

function preparedDeviceEventRetainsCurrentOutput(input: {
  currentEventOwners: CurrentDeviceEventOwners;
  entry: PreparedDeviceEventEntry;
}): boolean {
  const preparedId = input.entry.record.id;
  if (
    hasAuthorizedCurrentDeviceEventOutput(input.currentEventOwners, preparedId)
    || input.currentEventOwners.historicallyDeliveredPreparedIds.has(preparedId)
  ) {
    return true;
  }
  const current = input.currentEventOwners.currentRecordByPreparedId.get(preparedId);
  return current !== undefined && (
    isDeletedEventSpineRecord(current)
    || (
      current.source !== "device"
      && eventSpineRevision(current) > eventSpineRevision(input.entry.record)
      && userAuthoredEventStateKey(current) !== userAuthoredEventStateKey(input.entry.record)
    )
  );
}

type StoredIntegrationIngestCurrentOutputInput = {
  allSamplesExist: boolean;
  associationEvidenceRolesByPreparedRecordId: ReadonlyMap<string, readonly string[]>;
  baselineRetainedPreparedIds: ReadonlySet<string>;
  currentEventOwners: CurrentDeviceEventOwners;
  replayRetainedPreparedIds: ReadonlySet<string>;
  deviceBatchPlan: DeviceBatchPlan;
  preparedEventOutputOwners: PreparedDeviceEventOutputOwners;
  sampleRecords: readonly SampleRecord[];
  storedDelivery: IntegrationIngestRecord;
};

function storedIntegrationIngestRetainsCurrentOutputLocators(
  input: StoredIntegrationIngestCurrentOutputInput,
): boolean {
  if (!input.allSamplesExist) {
    return false;
  }
  const associationPreparedEvents = input.deviceBatchPlan.preparedEvents.filter((entry) =>
    input.associationEvidenceRolesByPreparedRecordId.has(entry.record.id)
  );
  if (
    input.storedDelivery.outputs.events.length > 0
    && associationPreparedEvents.some((entry) =>
      !input.currentEventOwners.currentRecordByPreparedId.has(entry.record.id)
      && !input.currentEventOwners.physicallyExistingPreparedIds.has(entry.record.id)
    )
  ) {
    return false;
  }
  const currentlyOwnedAssociationEvents = associationPreparedEvents.filter((entry) => {
    const owner = input.preparedEventOutputOwners.byPreparedId.get(entry.record.id);
    return owner
      ? outputOwnerHasAuthorizedCurrentEvent(input.currentEventOwners, owner)
      : false;
  });
  const expectedEventIds = new Set(
    currentlyOwnedAssociationEvents
      .map((entry) => input.currentEventOwners.canonicalIdByPreparedId.get(entry.record.id))
      .filter((eventId): eventId is string => eventId !== undefined),
  );
  const expectedSampleIds = input.sampleRecords.map((record) => record.id).sort();
  const preparedEventById = new Map(
    input.deviceBatchPlan.preparedEvents.map((entry) => [entry.record.id, entry]),
  );
  for (const output of input.storedDelivery.outputs.events) {
    const owner = storedEventOutputMatchesPreparedOwner({
      output,
      preparedEventOutputOwners: input.preparedEventOutputOwners,
    });
    if (!owner) {
      return false;
    }
    const ownerEntries = [...owner.preparedIds]
      .map((preparedId) => preparedEventById.get(preparedId))
      .filter((entry): entry is PreparedDeviceEventEntry => entry !== undefined);
    const retainedOwnerEntries = ownerEntries.filter((entry) =>
      input.baselineRetainedPreparedIds.has(entry.record.id)
    );
    const retainsOutput = retainedOwnerEntries.length > 0
      && retainedOwnerEntries.every((entry) =>
        input.replayRetainedPreparedIds.has(entry.record.id)
      );
    if (!retainsOutput) {
      return false;
    }
  }
  return input.storedDelivery.outputs.eventIdsComplete
    && input.storedDelivery.outputs.sampleIdsComplete
    && [...expectedEventIds].every((eventId) =>
      input.storedDelivery.outputs.events.some((output) => output.id === eventId)
    )
    && stableStringify([...input.storedDelivery.outputs.sampleIds].sort()) === stableStringify(expectedSampleIds);
}

function storedIntegrationIngestRetainsCurrentOutputs(
  input: StoredIntegrationIngestCurrentOutputInput,
): boolean {
  return storedIntegrationIngestRetainsCurrentOutputLocators(input)
    && input.storedDelivery.outputs.events.every((output) => {
      const owner = storedEventOutputMatchesPreparedOwner({
        output,
        preparedEventOutputOwners: input.preparedEventOutputOwners,
      });
      return owner !== undefined
        && storedEventOutputRolesBelongToPreparedOwner({
          evidenceRolesByPreparedRecordId: input.deviceBatchPlan.evidenceRolesByPreparedRecordId,
          output,
          owner,
        });
    });
}

function buildStoredEventRepairIds(input: {
  currentEventOwners: CurrentDeviceEventOwners;
  deviceBatchPlan: DeviceBatchPlan;
  preparedEventOutputOwners: PreparedDeviceEventOutputOwners;
  storedOutputIdByPreparedId: ReadonlyMap<string, string>;
  storedDeliveries: readonly IntegrationIngestRecord[];
}): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const storedOutputRoles = new Set(
    input.storedDeliveries.flatMap((storedDelivery) =>
      storedDelivery.outputs.events.flatMap((output) => output.roles)
    ),
  );
  for (const entry of input.deviceBatchPlan.preparedEvents) {
    if (
      (
        input.currentEventOwners.currentRecordByPreparedId.has(entry.record.id)
        && input.currentEventOwners.associationSafePreparedIds.has(entry.record.id)
      )
      || input.currentEventOwners.historicalContentOwnerRevisionsByPreparedId.has(entry.record.id)
    ) {
      continue;
    }
    const storedOutputId = input.storedOutputIdByPreparedId.get(entry.record.id);
    if (storedOutputId) {
      result.set(entry.record.id, storedOutputId);
      continue;
    }
    const deliveryRoles = input.deviceBatchPlan.evidenceRolesByPreparedRecordId
      .get(entry.record.id) ?? [];
    const owner = input.preparedEventOutputOwners.byPreparedId.get(entry.record.id);
    const ownerHasStoredOutput = owner !== undefined
      && [...owner.preparedIds].some((preparedId) =>
        input.storedOutputIdByPreparedId.has(preparedId)
      );
    if (
      (deliveryRoles.length === 0 && ownerHasStoredOutput)
      || deliveryRoles.some((role) => storedOutputRoles.has(role))
    ) {
      throw new VaultError(
        "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
        "Missing device event member shares evidence with a different stored output.",
      );
    }
  }
  return result;
}

function buildStoredDeviceDeliveryNoopResult(input: {
  associationEvidenceRolesByPreparedRecordId: ReadonlyMap<string, readonly string[]>;
  currentEventOwners: CurrentDeviceEventOwners;
  deviceBatchPlan: DeviceBatchPlan;
  eventTargetShardPaths: readonly string[];
  preparedEventOutputOwners: PreparedDeviceEventOutputOwners;
  sampleRecords: readonly SampleRecord[];
  storedDelivery: IntegrationIngestRecord;
}): NoopDeviceBatchImportResult {
  const eventsById = new Map<string, EventRecord>();
  for (const output of input.storedDelivery.outputs.events) {
    const owner = storedEventOutputMatchesPreparedOwner({
      output,
      preparedEventOutputOwners: input.preparedEventOutputOwners,
    });
    if (!owner) {
      continue;
    }
    for (const preparedId of owner.preparedIds) {
      if (!hasAuthorizedCurrentDeviceEventOutput(input.currentEventOwners, preparedId)) {
        continue;
      }
      const current = input.currentEventOwners.currentRecordByPreparedId.get(preparedId);
      if (current?.id === output.id) {
        eventsById.set(current.id, current);
        break;
      }
    }
  }
  return {
    applied: false,
    ingestId: null,
    ingestShardPath: null,
    provider: input.deviceBatchPlan.provider,
    accountId: input.deviceBatchPlan.accountId,
    importedAt: input.deviceBatchPlan.importedAt,
    events: [...eventsById.values()],
    samples: [...input.sampleRecords],
    eventShardPaths: [...input.eventTargetShardPaths],
    sampleShardPaths: [
      ...new Set(input.deviceBatchPlan.preparedSamples.map((entry) => entry.relativePath)),
    ].sort(),
    evidencePartCount: input.deviceBatchPlan.preparedEvidenceParts.length,
    persistedEvidencePartCount: 0,
    auditPath: null,
  };
}

export async function importDeviceBatch({
  vaultRoot,
  provider,
  accountId,
  importedAt = new Date(),
  source = "device",
  events = [],
  samples = [],
  evidenceParts = [],
  authoritativeEventSets = [],
  ingestReceipt,
  provenance,
}: ImportDeviceBatchInput): Promise<ImportDeviceBatchResult> {
  assertDeviceSampleRowLimit(Array.isArray(samples) ? samples.length : 0);
  const vault = await loadVault({ vaultRoot });
  const deviceBatchPlan = prepareDeviceBatchPlan({
    provider,
    accountId,
    importedAt,
    defaultTimeZone: vault.metadata.timezone,
    source,
    events,
    samples,
    evidenceParts,
    authoritativeEventSets,
    ingestReceipt,
    provenance,
  });
  const sampleRecords = deviceBatchPlan.preparedSamples.map((entry) => entry.record);
  const sampleAppendPlan = await buildJsonlAppendPlan(vaultRoot, deviceBatchPlan.preparedSamples, {
    dedupeWithinPlan: true,
  });
  const initialEventIdentityContext = await buildDeviceEventIdentityContext(
    vaultRoot,
    deviceBatchPlan.preparedEvents,
    deviceBatchPlan.authoritativeEventSets,
  );
  deviceBatchPlan.preparedEvents = resolveJunctionFloatingFallbackEntries(
    deviceBatchPlan.preparedEvents,
    initialEventIdentityContext,
  );
  const eventIdentityContext: DeviceEventIdentityContext = {
    index: initialEventIdentityContext.index,
    legacyReservations: buildLegacyExternalRefReservations(
      deviceBatchPlan.preparedEvents,
      initialEventIdentityContext.index,
    ),
  };
  const aliasRepairContext = buildDeviceEventAliasRepairContext(deviceBatchPlan);
  const eventTargetShardPaths = [
    ...new Set(deviceBatchPlan.preparedEvents.map((entry) => entry.relativePath)),
  ].sort();
  const currentEventOwners = mapCurrentDeviceEventOwners(
    deviceBatchPlan.preparedEvents,
    eventIdentityContext,
  );
  const baselineEventReconciliation = await reconcileDeviceEventEntriesByExternalRef(
    vaultRoot,
    deviceBatchPlan.preparedEvents,
    buildEmptyDeviceEventIdentityContext(deviceBatchPlan.preparedEvents),
  );
  const baselineRetainedPreparedIds = new Set(
    baselineEventReconciliation.appendRecordIdByPreparedRecordId.keys(),
  );
  const baselineRecordByPreparedId = new Map(
    deviceBatchPlan.preparedEvents.map((entry, index) => [
      entry.record.id,
      baselineEventReconciliation.records[index] ?? entry.record,
    ]),
  );
  const preparedEventOutputOwners = buildPreparedDeviceEventOutputOwners({
    baselineEventReconciliation,
    currentEventOwners,
    deviceBatchPlan,
  });
  const protectedPreparedEventIds = new Set(
    deviceBatchPlan.preparedEvents
      .filter((entry) =>
        baselineRetainedPreparedIds.has(entry.record.id)
        && !hasJunctionDailyAggregateAliasSplit(entry, eventIdentityContext)
        && (
          currentEventOwners.historicallyDeliveredPreparedIds.has(entry.record.id)
          || (
            entry.record.externalRef === undefined
            && currentEventOwners.currentRecordByPreparedId.has(entry.record.id)
            && !currentEventOwners.associationSafePreparedIds.has(entry.record.id)
            && preparedDeviceEventRetainsCurrentOutput({ currentEventOwners, entry })
          )
        )
      )
      .map((entry) => entry.record.id),
  );
  const ordinaryReconciliationEntries = deviceBatchPlan.preparedEvents.filter((entry) =>
    baselineRetainedPreparedIds.has(entry.record.id)
    && !protectedPreparedEventIds.has(entry.record.id)
  );
  const currentEventReconciliation = await reconcileDeviceEventEntriesByExternalRef(
    vaultRoot,
    ordinaryReconciliationEntries,
    cloneDeviceEventIdentityContext(eventIdentityContext),
    new Map(),
    deviceBatchPlan.authoritativeEventSets,
    aliasRepairContext,
  );
  const replayRetainedPreparedIds = new Set([
    ...protectedPreparedEventIds,
    ...currentEventReconciliation.retainedPreparedIds,
  ]);
  const unresolvedBaselinePreparedIds = new Set(
    [...baselineRetainedPreparedIds].filter((preparedId) =>
      !replayRetainedPreparedIds.has(preparedId)
    ),
  );
  const associationEvidenceRolesByPreparedRecordId = new Map(
    deviceBatchPlan.preparedEvents
      .filter((entry) => baselineRetainedPreparedIds.has(entry.record.id) && (
        currentEventOwners.allExist
          ? preparedDeviceEventRetainsCurrentOutput({ currentEventOwners, entry })
          : currentEventOwners.associationSafePreparedIds.has(entry.record.id)
      )
      )
      .map((entry) => [
        entry.record.id,
        deviceBatchPlan.evidenceRolesByPreparedRecordId.get(entry.record.id) ?? [],
      ]),
  );
  const associationPreparedEvents = deviceBatchPlan.preparedEvents.filter((entry) =>
    associationEvidenceRolesByPreparedRecordId.has(entry.record.id)
  );
  const currentEventOutputs = buildIntegrationEventOutputs(
    associationPreparedEvents,
    currentEventOwners.canonicalIdByPreparedId,
    associationEvidenceRolesByPreparedRecordId,
  );
  const buildAssociationImportId = (
    eventOutputs: readonly IntegrationIngestEventOutput[],
  ): string =>
    deterministicContractId(
      ID_PREFIXES.transform,
      stableStringify({
        associationRevisionOfDeviceImportId: deviceBatchPlan.importId,
        eventOutputs,
        sampleIds: sampleRecords.map((record) => record.id).sort(),
      }),
    );
  const associationImportId = buildAssociationImportId(currentEventOutputs);
  const incrementalEvidenceImportId = deterministicContractId(
    ID_PREFIXES.transform,
    stableStringify({
      incrementalEvidenceOfDeviceImportId: deviceBatchPlan.importId,
    }),
  );
  const candidateImportIds = new Set([
    deviceBatchPlan.importId,
    deviceBatchPlan.legacyImportId,
    associationImportId,
    incrementalEvidenceImportId,
  ]);
  let ingestIdInspection = await inspectIntegrationIngestIdsForImportedAt(
    vaultRoot,
    deviceBatchPlan.importedAt,
    candidateImportIds,
  );
  const orderedCandidateImportIds = [
    deviceBatchPlan.importId,
    associationImportId,
    deviceBatchPlan.legacyImportId,
    incrementalEvidenceImportId,
  ];
  const candidateStoredDeliveries = () => orderedCandidateImportIds
    .map((id) => ingestIdInspection.invalidIds.has(id)
      ? undefined
      : ingestIdInspection.entriesById.get(id))
    .filter((record): record is IntegrationIngestRecord =>
      record !== undefined
      && record.id !== incrementalEvidenceImportId
      && storedIntegrationIngestIsDeviceDeliveryCandidate(record, deviceBatchPlan)
    );
  const matchingStoredDeliveries = () => candidateStoredDeliveries().filter((record) =>
    storedIntegrationIngestMatchesDeviceDelivery(record, deviceBatchPlan)
  );
  const partialStoredDelivery = () => {
    const record = ingestIdInspection.entriesById.get(incrementalEvidenceImportId);
    return record && storedIntegrationIngestIsDeviceDeliveryCandidate(record, deviceBatchPlan)
      ? record
      : undefined;
  };
  const storedDeliveryRetainsCurrentOutputs = (
    storedDelivery: IntegrationIngestRecord,
  ): boolean =>
    (currentEventOwners.allExist || storedDelivery.outputs.events.length === 0)
    && storedIntegrationIngestRetainsCurrentOutputs({
      allSamplesExist: sampleAppendPlan.appendedRecordIds.length === 0,
      associationEvidenceRolesByPreparedRecordId,
      baselineRetainedPreparedIds,
      currentEventOwners,
      deviceBatchPlan,
      preparedEventOutputOwners,
      replayRetainedPreparedIds,
      sampleRecords,
      storedDelivery,
    });
  const filteredMarkerRetainsCurrentOutputLocators = (
    storedDelivery: IntegrationIngestRecord,
  ): boolean =>
    (currentEventOwners.allExist || storedDelivery.outputs.events.length === 0)
    && storedIntegrationIngestRetainsCurrentOutputLocators({
      allSamplesExist: sampleAppendPlan.appendedRecordIds.length === 0,
      associationEvidenceRolesByPreparedRecordId,
      baselineRetainedPreparedIds,
      currentEventOwners,
      deviceBatchPlan,
      preparedEventOutputOwners,
      replayRetainedPreparedIds,
      sampleRecords,
      storedDelivery,
    });
  const authorizedStoredDelivery = () => {
    if (ingestIdInspection.unsafe) {
      return undefined;
    }
    return matchingStoredDeliveries().find(storedDeliveryRetainsCurrentOutputs);
  };
  const hasInvalidCandidateId = () => orderedCandidateImportIds.some((id) =>
    ingestIdInspection.invalidIds.has(id)
  );
  const assertNoCurrentImportIdConflict = (): void => {
    const current = ingestIdInspection.entriesById.get(deviceBatchPlan.importId);
    if (current && !storedIntegrationIngestIsDeviceDeliveryCandidate(current, deviceBatchPlan)) {
      throw new VaultError(
        "INTEGRATION_INGEST_ID_CONFLICT",
        `Device ingest id "${deviceBatchPlan.importId}" already belongs to a different delivery.`,
        { ingestId: deviceBatchPlan.importId },
      );
    }
    const partial = ingestIdInspection.entriesById.get(incrementalEvidenceImportId);
    if (partial && !storedIntegrationIngestIsDeviceDeliveryCandidate(partial, deviceBatchPlan)) {
      throw new VaultError(
        "INTEGRATION_INGEST_ID_CONFLICT",
        `Device ingest id "${incrementalEvidenceImportId}" already belongs to a different delivery.`,
        { ingestId: incrementalEvidenceImportId },
      );
    }
  };
  const buildExactNoopResult = (
    storedDelivery: IntegrationIngestRecord,
  ): NoopDeviceBatchImportResult => {
    const result = buildStoredDeviceDeliveryNoopResult({
      associationEvidenceRolesByPreparedRecordId,
      currentEventOwners,
      deviceBatchPlan,
      eventTargetShardPaths,
      preparedEventOutputOwners,
      sampleRecords,
      storedDelivery,
    });
    const affectedSparseCalendarTargets = junctionSparseAffectedCalendarTargets(
      result.events,
      eventIdentityContext.index,
    );
    const affectedEventDayKeys = junctionSparseAffectedDayKeys(affectedSparseCalendarTargets);
    return affectedSparseCalendarTargets.length > 0
      ? { ...result, affectedEventDayKeys, affectedSparseCalendarTargets }
      : result;
  };
  let fullInspectionAttempted = false;
  const ensureFullInspection = async (): Promise<void> => {
    if (fullInspectionAttempted || (ingestIdInspection.historyComplete && !ingestIdInspection.unsafe)) {
      return;
    }
    fullInspectionAttempted = true;
    ingestIdInspection = await inspectIntegrationIngestIdsForImportedAt(
      vaultRoot,
      deviceBatchPlan.importedAt,
      candidateImportIds,
      { fullScan: true },
    );
  };
  type ExactDeliveryState = {
    authorizedStoredDelivery?: IntegrationIngestRecord;
    evidenceRepairRequired: boolean;
    untrustedExactIdentityObserved: boolean;
  };
  const inspectExactDeliveryState = (): ExactDeliveryState => {
    assertNoCurrentImportIdConflict();
    const partial = partialStoredDelivery();
    if (partial && !filteredMarkerRetainsCurrentOutputLocators(partial)) {
      throw new VaultError(
        "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
        "Filtered device delivery marker cannot prove the current canonical outputs.",
      );
    }
    const retainedDelivery = authorizedStoredDelivery();
    if (retainedDelivery) {
      return {
        authorizedStoredDelivery: retainedDelivery,
        evidenceRepairRequired: false,
        untrustedExactIdentityObserved: false,
      };
    }
    const candidateDeliveries = candidateStoredDeliveries();
    const hasCompleteRetainedDelivery = matchingStoredDeliveries().some((storedDelivery) =>
      (currentEventOwners.allExist || storedDelivery.outputs.events.length === 0)
      && storedIntegrationIngestRetainsCurrentOutputs({
        allSamplesExist: sampleAppendPlan.appendedRecordIds.length === 0,
        associationEvidenceRolesByPreparedRecordId,
        baselineRetainedPreparedIds,
        currentEventOwners,
        deviceBatchPlan,
        preparedEventOutputOwners,
        replayRetainedPreparedIds,
        sampleRecords,
        storedDelivery,
      })
    );
    return {
      evidenceRepairRequired: hasInvalidCandidateId()
        || (candidateDeliveries.length > 0 && !hasCompleteRetainedDelivery),
      untrustedExactIdentityObserved: hasInvalidCandidateId()
        || candidateDeliveries.length > 0,
    };
  };
  const preparePersistence = async (exactState: ExactDeliveryState) => {
    const { evidenceRepairRequired } = exactState;
    if (exactState.untrustedExactIdentityObserved) {
      const owners = new Set(
        deviceBatchPlan.preparedEvents
          .filter((entry) => baselineRetainedPreparedIds.has(entry.record.id))
          .map((entry) => preparedEventOutputOwners.byPreparedId.get(entry.record.id))
          .filter((owner): owner is PreparedDeviceEventOutputOwner => owner !== undefined),
      );
      const ownerWithoutSurvivingRevision = [...owners].some((owner) =>
        ![...owner.preparedIds].some((preparedId) =>
          currentEventOwners.currentRecordByPreparedId.has(preparedId)
        )
      );
      if (ownerWithoutSurvivingRevision) {
        throw new VaultError(
          "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
          "Observed exact device delivery has no surviving event owner revision.",
        );
      }
    }
    const exactStoredDeliveries = matchingStoredDeliveries();
    for (const storedDelivery of exactStoredDeliveries) {
      for (const output of storedDelivery.outputs.events) {
        const owner = preparedEventOutputOwners.byOutputId.get(output.id);
        if (!owner) {
          continue;
        }
        if (!storedEventOutputRolesBelongToPreparedOwner({
          evidenceRolesByPreparedRecordId: deviceBatchPlan.evidenceRolesByPreparedRecordId,
          output,
          owner,
        })) {
          throw new VaultError(
            "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
            `Stored canonical event "${output.id}" has evidence roles outside its owner.`,
          );
        }
      }
    }
    const storedOutputProof = storedOutputIdsByPreparedId({
      evidenceRolesByPreparedRecordId: deviceBatchPlan.evidenceRolesByPreparedRecordId,
      preparedEventOutputOwners,
      storedDeliveries: exactStoredDeliveries,
    });
    const unresolvedPreparedIdWithoutStoredProof =
      [...unresolvedBaselinePreparedIds].find((preparedId) =>
        !storedOutputProof.outputIdByPreparedId.has(preparedId)
      );
    if (evidenceRepairRequired && unresolvedPreparedIdWithoutStoredProof !== undefined) {
      throw new VaultError(
        "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
        `Unresolved device event member "${unresolvedPreparedIdWithoutStoredProof}" has no exact stored-output proof.`,
      );
    }
    const retainedStoredEvidenceRoles = new Map(
      [...storedOutputProof.outputIdByPreparedId.keys()].map((preparedId) => [
        preparedId,
        deviceBatchPlan.evidenceRolesByPreparedRecordId.get(preparedId) ?? [],
      ]),
    );
    const acceptedEvidenceRolesByPreparedRecordId = evidenceRepairRequired
      && exactStoredDeliveries.length > 0
      ? retainedStoredEvidenceRoles
      : deviceBatchPlan.evidenceRolesByPreparedRecordId;
    const persistenceProtectedPreparedEventIds = new Set([
      ...protectedPreparedEventIds,
      ...deviceBatchPlan.preparedEvents
        .filter((entry) =>
          evidenceRepairRequired
          && baselineRetainedPreparedIds.has(entry.record.id)
          && currentEventOwners.currentRecordByPreparedId.has(entry.record.id)
          && !currentEventOwners.associationSafePreparedIds.has(entry.record.id)
          && !currentEventOwners.incomingNewerPreparedIds.has(entry.record.id)
        )
        .map((entry) => entry.record.id),
    ]);
    const reconciliationEntries = deviceBatchPlan.preparedEvents.filter(
      (entry) =>
        baselineRetainedPreparedIds.has(entry.record.id)
        && !persistenceProtectedPreparedEventIds.has(entry.record.id)
        && (
          !evidenceRepairRequired
          || acceptedEvidenceRolesByPreparedRecordId.has(entry.record.id)
        ),
    );
    const storedEventOutputs = exactStoredDeliveries.flatMap((storedDelivery) =>
      storedDelivery.outputs.events
    );
    const eventRepairRequired = evidenceRepairRequired
      && storedEventOutputs.length > 0
      && (
        storedEventOutputs.some((output) =>
          !storedOutputProof.ownedOutputIds.has(output.id)
        )
        || unresolvedBaselinePreparedIds.size > 0
      );
    const unresolvedStoredOutputId = storedOutputProof.unresolvedOutputIds.values().next().value;
    if (eventRepairRequired && unresolvedStoredOutputId !== undefined) {
      throw new VaultError(
        "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
        `Stored canonical event "${unresolvedStoredOutputId}" is not owned by the prepared device event.`,
      );
    }
    const storedEventRepairIds = eventRepairRequired
      ? buildStoredEventRepairIds({
          currentEventOwners,
          deviceBatchPlan,
          preparedEventOutputOwners,
          storedOutputIdByPreparedId: storedOutputProof.outputIdByPreparedId,
          storedDeliveries: exactStoredDeliveries,
        })
      : new Map<string, string>();
    for (const [preparedId, repairId] of storedEventRepairIds) {
      const owner = preparedEventOutputOwners.byPreparedId.get(preparedId);
      const hasSurvivingOwnerRevision = owner !== undefined
        && [...owner.preparedIds].some((ownerPreparedId) =>
          currentEventOwners.currentRecordByPreparedId.get(ownerPreparedId)?.id === repairId
        );
      if (!hasSurvivingOwnerRevision) {
        throw new VaultError(
          "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
          "Missing device event spine has no surviving owner revision.",
        );
      }
    }
    const historicalRepairEntryByPreparedId = new Map<
      string,
      PreparedJsonlEntry<EventRecord>
    >();
    const historicalRepairRevision = (
      preparedId: string,
      owner: PreparedDeviceEventOutputOwner,
      repairId: string,
    ): number => {
      const baselineRecord = baselineRecordByPreparedId.get(preparedId);
      const current = currentEventOwners.currentRecordByPreparedId.get(preparedId);
      if (!baselineRecord || !current) {
        throw new VaultError(
          "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
          "Missing historical device event revision has no surviving delivery anchor.",
        );
      }
      if (currentEventOwners.incomingNewerPreparedIds.has(preparedId)) {
        throw new VaultError(
          "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
          "Accepted device event revision has no owner-issued historical placement proof.",
        );
      }
      let candidateOffsets: Set<number> | undefined;
      for (const anchorPreparedId of owner.preparedIds) {
        if (
          !baselineRetainedPreparedIds.has(anchorPreparedId)
          || storedOutputProof.outputIdByPreparedId.get(anchorPreparedId) !== repairId
        ) {
          continue;
        }
        const anchorBaselineRecord = baselineRecordByPreparedId.get(anchorPreparedId);
        const matchedRevisions =
          currentEventOwners.historicalContentOwnerRevisionsByPreparedId
            .get(anchorPreparedId)
            ?.get(repairId);
        if (!anchorBaselineRecord || !matchedRevisions || matchedRevisions.size === 0) {
          continue;
        }
        const offsets = new Set(
          [...matchedRevisions]
            .map((revision) => revision - eventSpineRevision(anchorBaselineRecord))
            .filter((offset) => offset >= 0),
        );
        candidateOffsets = candidateOffsets === undefined
          ? offsets
          : new Set([...candidateOffsets].filter((offset) => offsets.has(offset)));
      }
      if (candidateOffsets?.size !== 1) {
        throw new VaultError(
          "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
          "Missing historical device event revision has no unique surviving delivery anchor.",
        );
      }
      return eventSpineRevision(baselineRecord) + [...candidateOffsets][0]!;
    };
    for (const entry of deviceBatchPlan.preparedEvents) {
      const repairId = storedEventRepairIds.get(entry.record.id);
      const current = currentEventOwners.currentRecordByPreparedId.get(entry.record.id);
      const owner = preparedEventOutputOwners.byPreparedId.get(entry.record.id);
      const baselineRecord = baselineRecordByPreparedId.get(entry.record.id);
      if (
        !repairId
        || !current
        || current.id !== repairId
        || isDeletedEventSpineRecord(current)
        || !owner
        || !baselineRecord
      ) {
        continue;
      }
      const repairRevision = historicalRepairRevision(entry.record.id, owner, repairId);
      if (
        !Number.isSafeInteger(repairRevision)
        || repairRevision < 1
        || repairRevision >= eventSpineRevision(current)
        || eventIdentityContext.index.revisionsById.get(repairId)?.has(repairRevision)
      ) {
        throw new VaultError(
          "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
          "Missing historical device event revision conflicts with the surviving event spine.",
        );
      }
      const repairedRecord: EventRecord = {
        ...baselineRecord,
        id: repairId,
        lifecycle: buildEventSpineLifecycle(repairRevision),
      };
      historicalRepairEntryByPreparedId.set(entry.record.id, {
        relativePath: entry.relativePath,
        record: repairedRecord,
      });
    }
    for (const preparedId of storedEventRepairIds.keys()) {
      if (!historicalRepairEntryByPreparedId.has(preparedId)) {
        throw new VaultError(
          "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
          "Missing historical device event revision could not be restored safely.",
        );
      }
    }
    const persistenceReconciliationEntries = reconciliationEntries.filter((entry) =>
      !storedEventRepairIds.has(entry.record.id)
    );
    const repairedProtectedPreparedEventCount =
      [...historicalRepairEntryByPreparedId.keys()].filter((preparedId) =>
        persistenceProtectedPreparedEventIds.has(preparedId)
      ).length;
    const reconciled = evidenceRepairRequired
      ? await reconcileDeviceEventEntriesByExternalRef(
          vaultRoot,
          persistenceReconciliationEntries,
          cloneDeviceEventIdentityContext(eventIdentityContext),
          new Map(),
          deviceBatchPlan.authoritativeEventSets,
          aliasRepairContext,
        )
      : currentEventReconciliation;
    const reconciledRecordByPreparedId = new Map(
      persistenceReconciliationEntries.map((entry, index) => [
        entry.record.id,
        reconciled.records[index] ?? entry.record,
      ]),
    );
    const eventReconciliation: EventExternalRefReconciliation = {
      ...reconciled,
      appendEntries: [
        ...reconciled.appendEntries,
        ...historicalRepairEntryByPreparedId.values(),
      ],
      appendRecordIdByPreparedRecordId: new Map([
        ...reconciled.appendRecordIdByPreparedRecordId,
        ...[...historicalRepairEntryByPreparedId].map(([preparedId, repairEntry]) => [
          preparedId,
          repairEntry.record.id,
        ] as const),
      ]),
      forceAppendIds: new Set([
        ...reconciled.forceAppendIds,
        ...[...historicalRepairEntryByPreparedId.values()].map((repairEntry) =>
          repairEntry.record.id
        ),
      ]),
      records: deviceBatchPlan.preparedEvents.map((entry) => {
        const historicalRepair = historicalRepairEntryByPreparedId.get(entry.record.id);
        if (historicalRepair) {
          return historicalRepair.record;
        }
        const current = currentEventOwners.currentRecordByPreparedId.get(entry.record.id);
        if (current && persistenceProtectedPreparedEventIds.has(entry.record.id)) {
          return current;
        }
        return reconciledRecordByPreparedId.get(entry.record.id) ?? entry.record;
      }),
      retainedPreparedIds: new Set([
        ...reconciled.retainedPreparedIds,
        ...persistenceProtectedPreparedEventIds,
      ]),
      skippedDuplicateCount: reconciled.skippedDuplicateCount
        + persistenceProtectedPreparedEventIds.size
        - repairedProtectedPreparedEventCount,
    };
    const eventAppendPlan = await buildJsonlAppendPlan(vaultRoot, eventReconciliation.appendEntries, {
      dedupeWithinPlan: true,
      forceAppendIds: eventReconciliation.forceAppendIds,
    });
    const eventRecords = eventReconciliation.records;
    const canonicalIdByPreparedId = mapPreparedDeviceEventsToCanonicalIds(
      deviceBatchPlan.preparedEvents,
      eventRecords,
    );
    const appendedEventRecordIds = new Set(eventAppendPlan.appendedRecordIds);
    const appendedPreparedEventIds = new Set(
      [...eventReconciliation.appendRecordIdByPreparedRecordId.entries()]
        .filter(([, recordId]) => appendedEventRecordIds.has(recordId))
        .map(([preparedRecordId]) => preparedRecordId),
    );
    const associablePreparedEventIds = new Set([
      ...deviceBatchPlan.preparedEvents
        .filter((entry) =>
          baselineRetainedPreparedIds.has(entry.record.id)
          && hasAuthorizedCurrentDeviceEventOutput(
            currentEventOwners,
            entry.record.id,
          )
        )
        .map((entry) => entry.record.id),
      ...[...appendedPreparedEventIds].filter((preparedId) =>
        baselineRetainedPreparedIds.has(preparedId)
      ),
    ]);
    const canonicalEventRecords = eventRecords.filter((_, index) => {
      const preparedId = deviceBatchPlan.preparedEvents[index]?.record.id;
      return preparedId !== undefined && associablePreparedEventIds.has(preparedId);
    });
    const affectedSparseCalendarTargets = junctionSparseAffectedCalendarTargets(
      canonicalEventRecords,
      eventIdentityContext.index,
    );
    const affectedEventDayKeys = junctionSparseAffectedDayKeys(affectedSparseCalendarTargets);
    const persistenceEvidenceRolesByPreparedRecordId = new Map(
      deviceBatchPlan.preparedEvents
        .filter((entry) =>
          associablePreparedEventIds.has(entry.record.id)
          && acceptedEvidenceRolesByPreparedRecordId.has(entry.record.id)
        )
        .map((entry) => [
          entry.record.id,
          acceptedEvidenceRolesByPreparedRecordId.get(entry.record.id) ?? [],
        ]),
    );
    const persistencePreparedEvents = deviceBatchPlan.preparedEvents.filter((entry) =>
      associablePreparedEventIds.has(entry.record.id)
      && persistenceEvidenceRolesByPreparedRecordId.has(entry.record.id)
    );
    const hasAppendedOutputs = eventAppendPlan.appendedRecordIds.length > 0
      || sampleAppendPlan.appendedRecordIds.length > 0;
    const eventIdsByEvidenceRole = new Map<string, Set<string>>();
    for (const entry of deviceBatchPlan.preparedEvents) {
      const canonicalEventId = canonicalIdByPreparedId.get(entry.record.id);
      if (!canonicalEventId) {
        continue;
      }
      for (const role of persistenceEvidenceRolesByPreparedRecordId.get(entry.record.id) ?? []) {
        const eventIds = eventIdsByEvidenceRole.get(role) ?? new Set<string>();
        eventIds.add(canonicalEventId);
        eventIdsByEvidenceRole.set(role, eventIds);
      }
    }
    const shouldCheckReceiptNovelty = !hasAppendedOutputs;
    const novelty = deviceBatchPlan.preparedEvidenceParts.length > 0 || (
        shouldCheckReceiptNovelty && deviceBatchPlan.ingestReceipt
      )
      ? await selectNovelIntegrationIngestEvidence({
          vaultRoot,
          provider: deviceBatchPlan.provider,
          accountId: deviceBatchPlan.accountId,
          importedAt: deviceBatchPlan.importedAt,
          parts: deviceBatchPlan.preparedEvidenceParts,
          receipt: shouldCheckReceiptNovelty ? deviceBatchPlan.ingestReceipt : undefined,
          eventIdsByRole: eventIdsByEvidenceRole,
          sampleIds: new Set(sampleRecords.map((record) => record.id)),
        })
      : { parts: [], receiptIsNovel: false };
    const partialMarkerNeedsEvidenceRepair = partialStoredDelivery() !== undefined
      && (novelty.parts.length > 0 || novelty.receiptIsNovel);
    const shouldPersistDelivery = hasAppendedOutputs
      || novelty.parts.length > 0
      || novelty.receiptIsNovel
      || evidenceRepairRequired;
    const acceptedEvidenceRoles = new Set(
      [...persistenceEvidenceRolesByPreparedRecordId.values()].flat(),
    );
    const hasUnassociatedNovelEvidence = persistencePreparedEvents.length > 0
      && novelty.parts.some((part) => !acceptedEvidenceRoles.has(part.role));
    const preparedCanonicalEventIds = deviceBatchPlan.preparedEvents.map((entry) =>
      canonicalIdByPreparedId.get(entry.record.id) ?? entry.record.id
    );
    const hasSharedCanonicalEventOwner = new Set(preparedCanonicalEventIds).size
      !== preparedCanonicalEventIds.length;
    const appendedEventEvidenceRoles = new Set(
      [...appendedPreparedEventIds].flatMap((preparedId) =>
        persistenceEvidenceRolesByPreparedRecordId.get(preparedId) ?? []
      ),
    );
    const novelEvidenceParts = new Set(novelty.parts);
    const retainedEvidenceParts = evidenceRepairRequired
      || partialMarkerNeedsEvidenceRepair
      || hasUnassociatedNovelEvidence
      || hasSharedCanonicalEventOwner
      ? deviceBatchPlan.preparedEvidenceParts
      : deviceBatchPlan.preparedEvidenceParts.filter((part) =>
          novelEvidenceParts.has(part) || appendedEventEvidenceRoles.has(part.role)
        );
    const retainedEvidenceRoles = new Set(retainedEvidenceParts.map((part) => part.role));
    const retainedEvidenceRolesByPreparedRecordId = new Map<string, readonly string[]>();
    for (const entry of deviceBatchPlan.preparedEvents) {
      retainedEvidenceRolesByPreparedRecordId.set(
        entry.record.id,
        (persistenceEvidenceRolesByPreparedRecordId.get(entry.record.id) ?? []).filter((role) =>
          retainedEvidenceRoles.has(role)
        ),
      );
    }
    const eventOutputs = buildIntegrationEventOutputs(
      shouldPersistDelivery ? persistencePreparedEvents : [],
      canonicalIdByPreparedId,
      retainedEvidenceRolesByPreparedRecordId,
    );
    const buildNoopResult = (): NoopDeviceBatchImportResult => ({
      ...(affectedEventDayKeys.length > 0
        ? { affectedEventDayKeys, affectedSparseCalendarTargets }
        : {}),
      applied: false,
      ingestId: null,
      ingestShardPath: null,
      provider: deviceBatchPlan.provider,
      accountId: deviceBatchPlan.accountId,
      importedAt: deviceBatchPlan.importedAt,
      events: canonicalEventRecords,
      samples: sampleRecords,
      eventShardPaths: eventTargetShardPaths,
      sampleShardPaths: sampleAppendPlan.targetShardPaths,
      evidencePartCount: deviceBatchPlan.preparedEvidenceParts.length,
      persistedEvidencePartCount: 0,
      auditPath: null,
    });
    return {
      affectedEventDayKeys,
      affectedSparseCalendarTargets,
      buildNoopResult,
      eventAppendPlan,
      eventOutputs,
      eventReconciliation,
      canonicalEventRecords,
      retainedEvidenceParts,
      shouldPersistDelivery,
    };
  };

  let exactState = inspectExactDeliveryState();
  if (exactState.authorizedStoredDelivery) {
    return buildExactNoopResult(exactState.authorizedStoredDelivery);
  }
  let persistence;
  try {
    persistence = await preparePersistence(exactState);
  } catch (error) {
    await ensureFullInspection();
    exactState = inspectExactDeliveryState();
    if (exactState.authorizedStoredDelivery) {
      return buildExactNoopResult(exactState.authorizedStoredDelivery);
    }
    if (!exactState.evidenceRepairRequired) {
      throw error;
    }
    persistence = await preparePersistence(exactState);
  }
  const unresolvedBaselineMember = unresolvedBaselinePreparedIds.size > 0;
  const assertInspectionCanAuthorizeNoop = (): void => {
    if (
      unresolvedBaselineMember
      && (!ingestIdInspection.historyComplete || ingestIdInspection.unsafe)
    ) {
      throw new VaultError(
        "INTEGRATION_INGEST_EVENT_MAPPING_AMBIGUOUS",
        "Unresolved device event member has no authoritative exact-delivery inspection.",
      );
    }
  };
  const incompleteInspectionCannotAuthorizeNoop = unresolvedBaselineMember
    && (!ingestIdInspection.historyComplete || ingestIdInspection.unsafe);
  if (persistence.shouldPersistDelivery || incompleteInspectionCannotAuthorizeNoop) {
    await ensureFullInspection();
    const authoritativeExactState = inspectExactDeliveryState();
    if (authoritativeExactState.authorizedStoredDelivery) {
      return buildExactNoopResult(authoritativeExactState.authorizedStoredDelivery);
    }
    persistence = await preparePersistence(authoritativeExactState);
  }
  if (!persistence.shouldPersistDelivery) {
    assertInspectionCanAuthorizeNoop();
    return persistence.buildNoopResult();
  }

  const {
    affectedEventDayKeys,
    affectedSparseCalendarTargets,
    buildNoopResult,
    eventAppendPlan,
    eventOutputs,
    eventReconciliation,
    canonicalEventRecords,
    retainedEvidenceParts,
  } = persistence;

  const currentImportIdOccupied = ingestIdInspection.entriesById.has(deviceBatchPlan.importId)
    || ingestIdInspection.invalidIds.has(deviceBatchPlan.importId);
  const finalAssociationImportId = buildAssociationImportId(eventOutputs);
  const evidenceWasFiltered = retainedEvidenceParts.length
    !== deviceBatchPlan.preparedEvidenceParts.length;
  const persistedImportId = evidenceWasFiltered
    ? incrementalEvidenceImportId
    : currentImportIdOccupied
      ? finalAssociationImportId
      : deviceBatchPlan.importId;
  const ingestRecord = buildIntegrationIngestRecord({
    id: persistedImportId,
    provider: deviceBatchPlan.provider,
    accountId: deviceBatchPlan.accountId,
    source: deviceBatchPlan.source,
    importedAt: deviceBatchPlan.importedAt,
    receipt: deviceBatchPlan.ingestReceipt,
    parts: retainedEvidenceParts,
    eventOutputs,
    eventIdsComplete: true,
    sampleIds: sampleRecords.map((record) => record.id),
    sampleIdsComplete: true,
    eventCount: eventOutputs.length,
    sampleCount: sampleRecords.length,
    provenance: deviceBatchPlan.provenance,
  });
  const persistedImportIdWasInspected = ingestIdInspection.requestedIds.has(persistedImportId);
  const ingestAppendPlan = !persistedImportIdWasInspected
      || (ingestIdInspection.unsafe && !ingestIdInspection.failOpenAppendAllowed)
    ? await buildIntegrationIngestAppendPlan(vaultRoot, [ingestRecord], {
        allowArchivedShardAmendments: true,
      })
    : buildIntegrationIngestAppendPlanFromInspection([ingestRecord], ingestIdInspection, {
        allowArchivedShardAmendments: true,
      });
  const [ingestShardPath] = ingestAppendPlan.targetShardPaths;
  if (!ingestShardPath) {
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_INVALID",
      `No integration ingest shard was prepared for "${ingestRecord.id}".`,
    );
  }
  if (
    ingestAppendPlan.appendedIds.length === 0
    && eventAppendPlan.appendedRecordIds.length === 0
    && sampleAppendPlan.appendedRecordIds.length === 0
  ) {
    assertInspectionCanAuthorizeNoop();
    return buildNoopResult();
  }

  return runCanonicalWrite({
    vaultRoot,
    operationType: "device_batch_import",
    summary: `Import ${deviceBatchPlan.provider} device batch ${persistedImportId}`,
    occurredAt: deviceBatchPlan.effectiveOccurredAt,
    mutate: async ({ batch }) => {
      await stageIntegrationIngestAppendPlan(batch, ingestAppendPlan);
      await stageJsonlAppendPlan(batch, eventAppendPlan);
      await stageJsonlAppendPlan(batch, sampleAppendPlan);

      const touchedPaths = [
        ...ingestAppendPlan.targetShardPaths,
        ...eventAppendPlan.appendedShardPaths,
        ...sampleAppendPlan.appendedShardPaths,
      ];
      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "device_import",
        commandName: "core.importDeviceBatch",
        summary: buildDeviceBatchAuditSummary({
          provider: deviceBatchPlan.provider,
          eventCount: eventOutputs.length,
          sampleCount: sampleRecords.length,
          skippedDuplicateCount: eventReconciliation.skippedDuplicateCount,
          supersededCount: eventReconciliation.supersededCount,
          retractedCount: eventReconciliation.retractedCount,
        }),
        occurredAt: deviceBatchPlan.importedAt,
        files: touchedPaths,
        targetIds: [persistedImportId],
      });

      return {
        ...(affectedEventDayKeys.length > 0
          ? { affectedEventDayKeys, affectedSparseCalendarTargets }
          : {}),
        applied: true,
        ingestId: persistedImportId,
        ingestShardPath,
        provider: deviceBatchPlan.provider,
        accountId: deviceBatchPlan.accountId,
        importedAt: deviceBatchPlan.importedAt,
        events: canonicalEventRecords,
        samples: sampleRecords,
        eventShardPaths: [
          ...new Set([
            ...eventTargetShardPaths,
            ...eventAppendPlan.targetShardPaths,
          ]),
        ].sort(),
        sampleShardPaths: sampleAppendPlan.targetShardPaths,
        evidencePartCount: deviceBatchPlan.preparedEvidenceParts.length,
        persistedEvidencePartCount: retainedEvidenceParts.length,
        auditPath: audit.relativePath,
      };
    },
  });
}

export interface ImportEventPayloadBatchInput {
  vaultRoot: string;
  payloads: readonly LooseRecord[];
  decisions?: never;
  rejectIfSourceRawRefAlreadyImported?: string;
  apply?: boolean;
  signal?: AbortSignal | null;
}

export interface ImportEventDecisionBatchInput {
  vaultRoot: string;
  decisions: readonly LooseRecord[];
  payloads?: never;
  rejectIfSourceRawRefAlreadyImported?: never;
  apply?: boolean;
  signal?: AbortSignal | null;
}

export type ImportEventBatchInput = ImportEventPayloadBatchInput | ImportEventDecisionBatchInput;

type ImportEventBatchFailure = {
  index: number;
  message: string;
};

export interface ImportEventBatchResult {
  applied: boolean;
  receivedCount: number;
  createdCount: number;
  skippedExistingCount: number;
  supersededCount: number;
  retractedCount: number;
  eventIds: string[];
  retractedEventIds: string[];
  // Monthly event shards targeted by the batch, including shards where every
  // row was skipped as existing — same semantics as importDeviceBatch.
  eventShardPaths: string[];
  auditPath: string | null;
}

const EVENT_BATCH_FAILURE_REPORT_LIMIT = 20;

// importEventBatch is public API surface, so the batch-shape invariants live
// here rather than in CLI adapters: payloads must be a non-empty array of
// plain objects.
function normalizeImportEventBatchPayloads(
  value: unknown,
  signal?: AbortSignal | null,
): LooseRecord[] {
  if (!Array.isArray(value)) {
    throw new VaultError("EVENT_BATCH_INVALID", "Event batch payloads must be an array.");
  }

  if (value.length === 0) {
    throw new VaultError("EVENT_BATCH_EMPTY", "Event batch payloads must not be empty.");
  }

  return value.map((entry, index) => {
    signal?.throwIfAborted();
    return assertPlainObject<LooseRecord>(
      entry,
      "EVENT_BATCH_INVALID",
      `Event batch payload ${index + 1} must be a plain object.`,
    );
  });
}

function normalizeImportEventBatchDecisions(
  value: unknown,
  signal?: AbortSignal | null,
): LooseRecord[] {
  if (!Array.isArray(value)) {
    throw new VaultError("EVENT_BATCH_INVALID", "Event batch decisions must be an array.");
  }

  if (value.length === 0) {
    throw new VaultError("EVENT_BATCH_EMPTY", "Event batch decisions must not be empty.");
  }

  return value.map((entry, index) => {
    signal?.throwIfAborted();
    return assertPlainObject<LooseRecord>(
      entry,
      "EVENT_BATCH_INVALID",
      `Event batch decision ${index + 1} must be a plain object.`,
    );
  });
}

// Bulk canonical event import: every payload is validated through the same
// strict contract path as the single-event upsert before anything is staged,
// so one invalid payload rejects the whole batch. Valid rows reconcile on
// externalRef vault-wide (idempotent skip / in-place supersede on system +
// resourceType + resourceId + facet, even when a corrected occurredAt moves
// the row to another monthly shard) and land in one canonical write with one
// audit record. Dry-run by default; `apply` commits.
export async function importEventBatch(input: ImportEventBatchInput): Promise<ImportEventBatchResult> {
  const { vaultRoot, apply = false, signal } = input;
  signal?.throwIfAborted();
  const usesPayloads = "payloads" in input && input.payloads !== undefined;
  const usesDecisions = "decisions" in input && input.decisions !== undefined;
  if (usesPayloads === usesDecisions) {
    throw new VaultError(
      "EVENT_BATCH_INVALID",
      "Event batch must define exactly one of payloads or decisions.",
    );
  }
  const sourceRawRef = usesPayloads
    ? input.rejectIfSourceRawRefAlreadyImported?.trim()
    : undefined;
  if (usesPayloads && input.rejectIfSourceRawRefAlreadyImported !== undefined && !sourceRawRef) {
    throw new VaultError(
      "EVENT_BATCH_INVALID",
      "Event batch source raw reference must not be empty.",
    );
  }
  const normalizedRows = usesDecisions
    ? normalizeImportEventBatchDecisions(input.decisions, signal)
    : normalizeImportEventBatchPayloads(input.payloads, signal);
  const vault = await loadVault({ vaultRoot });
  const decisions: PreparedEventImportDecision[] = [];
  const failures: ImportEventBatchFailure[] = [];
  const recordedAt = new Date().toISOString();

  normalizedRows.forEach((row, index) => {
    signal?.throwIfAborted();
    try {
      if (!usesDecisions) {
        const record = buildPublicEventImportRecord(row, vault.metadata.timezone);
        decisions.push({
          action: "upsert",
          allowsKindReplacement: false,
          entry: { relativePath: toEventLedgerFile(record.occurredAt), record },
        });
        return;
      }

      const parsed = safeParseContract(eventImportDecisionSchema, row);
      if (!parsed.success) {
        throw new Error(parsed.errors.join("; "));
      }
      const decision: EventImportDecision = parsed.data;

      if (decision.action === "retract") {
        const markerRecord = buildPublicEventImportRecord({
          kind: "note",
          occurredAt: decision.externalRef.version,
          recordedAt,
          source: "import",
          title: "Retracted imported source record",
          note: decision.reason,
          noteType: EVENT_IMPORT_RETRACTION_MARKER_NOTE_TYPE,
          ...(decision.evidence ? { evidence: decision.evidence } : {}),
          externalRef: decision.externalRef,
        }, vault.metadata.timezone);
        decisions.push({
          action: "retract",
          externalRef: decision.externalRef,
          evidence: decision.evidence,
          reason: decision.reason,
          markerEntry: {
            relativePath: toEventLedgerFile(markerRecord.occurredAt),
            record: markerRecord,
          },
        });
        return;
      }

      // Decisions are the trusted importer-owner path. Their contract permits
      // verified workout CSV evidence to retain an unknown duration, while the
      // generic public payload path above remains stricter.
      const record = buildEventImportDecisionRecord(
        { ...decision.payload },
        vault.metadata.timezone,
      );
      decisions.push({
        action: "upsert",
        allowsKindReplacement: true,
        entry: { relativePath: toEventLedgerFile(record.occurredAt), record },
        ...(decision.expectedLatest ? { expectedLatest: decision.expectedLatest } : {}),
      });
    } catch (error) {
      failures.push({
        index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  if (failures.length > 0) {
    throw new VaultError(
      "EVENT_BATCH_INVALID",
      `${failures.length} of ${normalizedRows.length} event import decision(s) failed validation; nothing was imported.`,
      {
        failureCount: failures.length,
        failures: failures.slice(0, EVENT_BATCH_FAILURE_REPORT_LIMIT),
      },
    );
  }

  let sourceCompletionTargetId: string | null = null;
  if (sourceRawRef) {
    const invalidSourceIndexes = decisions.flatMap((decision, index) =>
      decision.action === "upsert"
      && decision.entry.record.kind === "activity_session"
      && decision.entry.record.externalRef === undefined
      && collectEventRawReferencePaths(decision.entry.record).includes(sourceRawRef)
        ? []
        : [index],
    );
    if (invalidSourceIndexes.length > 0) {
      throw new VaultError(
        "EVENT_BATCH_SOURCE_ROW_INVALID",
        "Every event in a source-guarded batch must be an externalRef-free activity session that references the guarded raw source; nothing was imported.",
        { indexes: invalidSourceIndexes.slice(0, EVENT_BATCH_FAILURE_REPORT_LIMIT) },
      );
    }

    const sourceState = await inspectWorkoutSourceImportStatus({
      vaultRoot,
      rawRef: sourceRawRef,
    });
    if (sourceState.status === "completed") {
      throw new VaultError(
        "EVENT_BATCH_SOURCE_ALREADY_IMPORTED",
        "The atomic workout import for this exact source already completed; nothing was imported.",
      );
    }
    if (sourceState.status === "partial_conflict") {
      throw new VaultError(
        "EVENT_BATCH_SOURCE_PARTIAL_CONFLICT",
        "This exact source has workout history without a whole-source completion receipt; nothing was imported. Resolve the partial import before retrying.",
      );
    }
    sourceCompletionTargetId = sourceState.completionTargetId;
  }

  signal?.throwIfAborted();
  const reconciliation = await reconcileEventImportDecisionsByExternalRef(
    vaultRoot,
    decisions,
    signal,
  );
  const appendPlan = await buildJsonlAppendPlan(vaultRoot, reconciliation.appendEntries, {
    dedupeWithinPlan: true,
    forceAppendIds: reconciliation.forceAppendIds,
    signal,
  });
  signal?.throwIfAborted();
  // Target shards come from the prepared rows (pre-reconcile), matching
  // importDeviceBatch: an all-skipped batch still reports the shards it
  // evaluated.
  const appendedCount = appendPlan.appendedRecordIds.length;
  const counts = {
    receivedCount: normalizedRows.length,
    createdCount: reconciliation.createdCount,
    skippedExistingCount: reconciliation.skippedExistingCount,
    supersededCount: reconciliation.supersededCount,
    retractedCount: reconciliation.retractedCount,
    eventIds: reconciliation.eventIds,
    retractedEventIds: reconciliation.retractedEventIds,
  };

  if (!apply || appendedCount === 0) {
    return {
      applied: false,
      ...counts,
      eventShardPaths: reconciliation.eventShardPaths,
      auditPath: null,
    };
  }

  const occurredAt = earliestTimestamp(
    reconciliation.appendEntries.map((entry) => entry.record.occurredAt),
  );

  signal?.throwIfAborted();
  return runCanonicalWrite({
    vaultRoot,
    operationType: "event_batch_import",
    summary: `Import event batch with ${normalizedRows.length} decision(s)`,
    occurredAt,
    mutate: async ({ batch }) => {
      await stageJsonlAppendPlan(batch, appendPlan);
      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "event_upsert",
        commandName: sourceCompletionTargetId
          ? WORKOUT_SOURCE_IMPORT_AUDIT_COMMAND
          : "core.importEventBatch",
        summary: `Imported event batch: ${counts.createdCount} created, ` +
          `${counts.supersededCount} superseded, ` +
          `${counts.retractedCount} retracted, ` +
          `${counts.skippedExistingCount} skipped existing of ${counts.receivedCount} received.`,
        occurredAt,
        files: appendPlan.appendedShardPaths,
        targetIds: [
          ...(sourceCompletionTargetId ? [sourceCompletionTargetId] : []),
          ...new Set(appendPlan.appendedRecordIds),
        ].slice(0, AUDIT_TARGET_ID_LIMIT),
      });

      return {
        applied: true,
        ...counts,
        eventShardPaths: reconciliation.eventShardPaths,
        auditPath: audit.relativePath,
      };
    },
  });
}

function assertDeviceSampleRowLimit(sampleCount: number): void {
  if (sampleCount <= MAX_DEVICE_PROVIDER_SAMPLE_ROWS_DEFAULT) {
    return;
  }

  throw new VaultError(
    DENSE_DEVICE_TELEMETRY_NOT_ALLOWED_CODE,
    "Device provider imports must keep dense telemetry as raw evidence and emit compact product facts.",
    {
      codeAliases: [DENSE_DEVICE_SAMPLES_NOT_ALLOWED_LEGACY_CODE],
      legacyCode: DENSE_DEVICE_SAMPLES_NOT_ALLOWED_LEGACY_CODE,
      maxAllowed: MAX_DEVICE_PROVIDER_SAMPLE_ROWS_DEFAULT,
      sampleCount,
    },
  );
}
