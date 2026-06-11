import { createHash } from "node:crypto";

import type {
  ContractSchema,
  DeviceDataOrigin,
  DocumentEventRecord,
  EventAttachment,
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
} from "@murphai/contracts";
import {
  assertContractId,
  deviceDataOriginSchema,
  experimentFrontmatterSchema,
  journalDayFrontmatterSchema,
  eventRecordSchema,
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
import { pathExists, readUtf8File, walkVaultFiles, writeVaultTextFile } from "./fs.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.ts";
import { deterministicContractId, generateRecordId } from "./ids.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "./jsonl.ts";
import {
  buildEventSpineLifecycle,
  collapseEventSpineEntries,
  eventSpineRevision,
  selectLatestEventSpineEntry,
  type EventSpineEntry,
} from "./history/event-spine.ts";
import {
  buildPublicEventImportRecord,
  loadEventLedgerShardsById,
  selectLatestMatchedEvent,
  toEventLedgerFile,
} from "./domains/events/ledger.ts";
import {
  normalizeMealNutrition,
} from "./nutrition.ts";
import { stageRawImportManifest } from "./operations/raw-manifests.ts";
import { runCanonicalWrite, type WriteBatch } from "./operations/write-batch.ts";
import { assertCanonicalWriteLockScope } from "./operations/canonical-write-lock.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { sanitizePathSegment } from "./path-safety.ts";
import { prepareInlineRawArtifact, prepareRawArtifact, resolveRawAssetDirectory } from "./raw.ts";
import { normalizeUniqueTextList } from "./bank/shared.ts";
import {
  defaultTimeZone,
  normalizeTimeZone,
  toIsoTimestamp,
  toLocalDayKey,
} from "./time.ts";
import { loadVault } from "./vault.ts";

import type { PreparedEventAttachment } from "./event-attachments.ts";
import type { RawArtifact } from "./raw.ts";
import type { DateInput, UnknownRecord } from "./types.ts";

type EventRecordByKind<K extends EventKind> = Extract<EventRecord, { kind: K }>;
type LooseRecord = Record<string, unknown>;

const DENSE_DEVICE_TELEMETRY_NOT_ALLOWED_CODE = "VAULT_DENSE_DEVICE_TELEMETRY_NOT_ALLOWED";
const DENSE_DEVICE_SAMPLES_NOT_ALLOWED_LEGACY_CODE = "VAULT_DENSE_DEVICE_SAMPLES_NOT_ALLOWED";

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
}

interface ImportDocumentResult {
  documentId: string;
  raw: RawArtifact;
  event: DocumentEventRecord;
  eventPath: string;
  auditPath: string;
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

interface DeviceRawArtifactInput extends LooseRecord {
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
  rawArtifactRoles?: unknown;
  externalRef?: unknown;
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

interface ImportDeviceBatchInput {
  vaultRoot: string;
  provider: string;
  accountId?: string;
  importedAt?: DateInput;
  source?: string;
  events?: readonly DeviceEventInput[];
  samples?: readonly DeviceSampleInput[];
  rawArtifacts?: readonly DeviceRawArtifactInput[];
  provenance?: Record<string, unknown>;
}

interface ImportDeviceBatchResult {
  importId: string;
  provider: string;
  accountId?: string;
  importedAt: string;
  events: EventRecord[];
  samples: SampleRecord[];
  eventShardPaths: string[];
  sampleShardPaths: string[];
  rawArtifacts: RawArtifact[];
  auditPath: string;
  manifestPath: string;
}

interface PreparedDeviceRawArtifact {
  role: string;
  content: string;
  raw: RawArtifact;
  metadata?: Record<string, unknown>;
  sha256: string;
}

interface NormalizedDeviceEvent {
  seed: NormalizedEventSeed<EventKind>;
  rawArtifactRoles: string[];
  recordId: string;
}

interface NormalizedDeviceSample {
  seed: NormalizedSampleSeed;
  recordId: string;
}

interface NormalizedDeviceRawArtifact {
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
  source: string;
  defaultTimeZone?: string;
  provenance: LooseRecord;
  events: NormalizedDeviceEvent[];
  samples: NormalizedDeviceSample[];
  rawArtifacts: NormalizedDeviceRawArtifact[];
}

interface PreparedJsonlEntry<RecordType extends { id: string }> {
  relativePath: string;
  record: RecordType;
}

interface JsonlAppendPlan {
  targetShardPaths: string[];
  appendedShardPaths: string[];
  appendedRecordIds: string[];
  payloads: Map<string, string>;
}

interface DeviceBatchPlan {
  importId: string;
  provider: string;
  accountId?: string;
  importedAt: string;
  source: string;
  provenance: LooseRecord;
  effectiveOccurredAt: string;
  preparedEvents: PreparedJsonlEntry<EventRecord>[];
  preparedSamples: PreparedJsonlEntry<SampleRecord>[];
  preparedRawArtifacts: PreparedDeviceRawArtifact[];
}

const MAX_DEVICE_PROVIDER_SAMPLE_ROWS_DEFAULT = 1_000;

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
): Promise<Set<string>> {
  const resolved = resolveVaultPath(vaultRoot, relativePath);

  if (!(await pathExists(resolved.absolutePath))) {
    return new Set<string>();
  }

  const records = await readJsonlRecords({
    vaultRoot,
    relativePath,
  });

  return new Set(
    records
      .map((record) => (typeof record.id === "string" ? record.id : null))
      .filter((id): id is string => id !== null),
  );
}

async function buildJsonlAppendPlan<RecordType extends { id: string }>(
  vaultRoot: string,
  entries: readonly PreparedJsonlEntry<RecordType>[],
  options: {
    dedupeWithinPlan?: boolean;
    forceAppendIds?: ReadonlySet<string>;
  } = {},
): Promise<JsonlAppendPlan> {
  assertCanonicalWriteLockScope(vaultRoot);

  const payloads = new Map<string, string>();
  const existingIdsByShard = new Map<string, Set<string>>();
  const targetShardPaths = [...new Set(entries.map((entry) => entry.relativePath))].sort();
  const appendedRecordIds: string[] = [];

  for (const entry of entries) {
    const existingIds =
      existingIdsByShard.get(entry.relativePath) ??
      (await readExistingRecordIds(vaultRoot, entry.relativePath));

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
    const rawArtifactRoles = trimStringList(eventInput.rawArtifactRoles) ?? [];
    assertNoLegacyRelatedIds({
      value: eventInput.relatedIds,
      errorCode: "VAULT_INVALID_INPUT",
      errorMessage: `Device event ${index + 1} relatedIds is no longer supported; use links.`,
    });
    const seed = buildNormalizedEventSeed({
      kind,
      occurredAt: eventInput.occurredAt ?? eventInput.recordedAt ?? context.importedAt,
      recordedAt: eventInput.recordedAt ?? eventInput.occurredAt,
      dayKey: typeof eventInput.dayKey === "string" ? eventInput.dayKey : undefined,
      timeZone: typeof eventInput.timeZone === "string" ? eventInput.timeZone : undefined,
      defaultTimeZone: context.defaultTimeZone,
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

    return {
      seed,
      rawArtifactRoles,
      recordId: deterministicContractId(
        ID_PREFIXES.event,
        stableStringify({
          provider: context.provider,
          accountId: context.accountId ?? null,
          rawArtifactRoles,
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

function normalizeDeviceRawArtifactInputs(
  rawArtifactInputs: readonly DeviceRawArtifactInput[],
  provider: string,
): NormalizedDeviceRawArtifact[] {
  const seenRawRoles = new Set<string>();

  return rawArtifactInputs.map((artifactInput, index) => {
    const role = normalizeRequiredRole(
      artifactInput.role ?? `artifact-${index + 1}`,
      `raw artifact ${index + 1} role`,
    );

    if (seenRawRoles.has(role)) {
      throw new VaultError(
        "VAULT_DUPLICATE_RAW_ROLE",
        `Device raw artifact role "${role}" may only appear once per batch.`,
      );
    }

    seenRawRoles.add(role);
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

function normalizeDeviceBatchInputs({
  provider,
  accountId,
  importedAt = new Date(),
  defaultTimeZone: fallbackTimeZone,
  source = "device",
  events = [],
  samples = [],
  rawArtifacts = [],
  provenance,
}: Omit<ImportDeviceBatchInput, "vaultRoot"> & {
  defaultTimeZone?: string;
}): NormalizedDeviceBatchInputs {
  const normalizedProvider = sanitizePathSegment(provider, "provider");
  const normalizedAccountId = typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
  const normalizedImportedAt = toIsoTimestamp(importedAt, "importedAt");
  const defaultTimeZone = normalizeTimeZone(fallbackTimeZone);
  const normalizedProvenance = normalizeLooseRecord(
    provenance,
    "VAULT_INVALID_DEVICE_PROVENANCE",
    "Device import provenance must be a plain object.",
  ) ?? {};
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
  const rawArtifactInputs = normalizeDeviceBatchObjectArray<DeviceRawArtifactInput>({
    value: rawArtifacts,
    code: "VAULT_INVALID_DEVICE_RAW_ARTIFACTS",
    message: "Device batch rawArtifacts must be an array when provided.",
    itemCode: "VAULT_INVALID_RAW_ARTIFACT",
    itemLabel: "Device raw artifact",
  });

  if (eventInputs.length === 0 && sampleInputs.length === 0 && rawArtifactInputs.length === 0) {
    throw new VaultError(
      "VAULT_INVALID_DEVICE_BATCH",
      "importDeviceBatch requires at least one event, sample, or raw artifact.",
    );
  }

  return {
    provider: normalizedProvider,
    accountId: normalizedAccountId,
    importedAt: normalizedImportedAt,
    source,
    defaultTimeZone,
    provenance: normalizedProvenance,
    events: normalizeDeviceEventInputs(eventInputs, {
      provider: normalizedProvider,
      accountId: normalizedAccountId,
      importedAt: normalizedImportedAt,
      source,
      defaultTimeZone,
    }),
    samples: normalizeDeviceSampleInputs(sampleInputs, {
      provider: normalizedProvider,
      accountId: normalizedAccountId,
      source,
      defaultTimeZone,
    }),
    rawArtifacts: normalizeDeviceRawArtifactInputs(rawArtifactInputs, normalizedProvider),
  };
}

function prepareDeviceRawArtifacts(
  rawArtifacts: readonly NormalizedDeviceRawArtifact[],
  options: {
    importId: string;
    provider: string;
    effectiveOccurredAt: string;
  },
): PreparedDeviceRawArtifact[] {
  return rawArtifacts.map((artifact) => ({
    role: artifact.role,
    content: artifact.content,
    raw: prepareInlineRawArtifact({
      fileName: artifact.fileName,
      owner: {
        kind: "device_batch",
        id: options.importId,
        partition: options.provider,
      },
      targetName: `${String(artifact.index + 1).padStart(2, "0")}-${artifact.fileName}`,
      mediaType: artifact.mediaType,
      occurredAt: options.effectiveOccurredAt,
    }),
    metadata: artifact.metadata,
    sha256: artifact.sha256,
  }));
}

function prepareDeviceEventEntries(
  events: readonly NormalizedDeviceEvent[],
  preparedRawArtifacts: readonly PreparedDeviceRawArtifact[],
): PreparedJsonlEntry<EventRecord>[] {
  const rawArtifactPathByRole = new Map(
    preparedRawArtifacts.map((artifact) => [artifact.role, artifact.raw.relativePath] as const),
  );
  const soleRawArtifact = preparedRawArtifacts.length === 1 ? preparedRawArtifacts[0] : undefined;
  const soleRawArtifactPath = soleRawArtifact && isImplicitDeviceRawRefFallbackRole(soleRawArtifact.role)
    ? soleRawArtifact.raw.relativePath
    : undefined;

  return events.map((event) => {
    const rawRefs = event.rawArtifactRoles.length > 0
      ? event.rawArtifactRoles.map((role) => {
          const rawPath = rawArtifactPathByRole.get(role);

          if (!rawPath) {
            throw new VaultError(
              "VAULT_RAW_ROLE_MISSING",
              `No staged raw artifact matched role "${role}" for device event ${event.recordId}.`,
            );
          }

          return rawPath;
        })
      : soleRawArtifactPath
        ? [soleRawArtifactPath]
        : undefined;
    return prepareStoredEventLedgerEntry(
      {
        ...event.seed,
        rawRefs,
      },
      event.recordId,
    );
  });
}

function isImplicitDeviceRawRefFallbackRole(role: string): boolean {
  return !role.startsWith("wearable-raw-receipt:")
    && !role.startsWith("wearable-raw-envelope:")
    && !role.startsWith("wearable-canonical-records:");
}

interface DeviceEventExternalRefReconciliation {
  appendEntries: PreparedJsonlEntry<EventRecord>[];
  records: EventRecord[];
  forceAppendIds: ReadonlySet<string>;
  skippedDuplicateCount: number;
  supersededCount: number;
}

// externalRef.version is intentionally NOT part of the reconcile identity:
// direct providers (WHOOP, Oura, Strava) stamp it from the record's mutable
// updated_at, so a provider-side rescore would change the key and mint a new
// event instead of superseding the existing one. Version still participates in
// content equality, so a version bump with changed data becomes a spine
// revision of the same event.
function deviceEventExternalRefKey(externalRef: ExternalRef): string {
  return stableStringify({
    system: externalRef.system,
    resourceType: externalRef.resourceType,
    resourceId: externalRef.resourceId,
    facet: externalRef.facet ?? null,
  });
}

function deviceEventContentKey(record: EventRecord): string {
  const {
    id: _id,
    rawRefs: _rawRefs,
    lifecycle: _lifecycle,
    recordedAt: _recordedAt,
    ...content
  } = record;
  return stableStringify(content);
}

interface DeviceEventShardIndex {
  latestByRefKey: Map<string, EventRecord>;
  maxRevisionById: Map<string, number>;
}

async function indexLatestDeviceEventsByExternalRef(
  vaultRoot: string,
  relativePath: string,
): Promise<DeviceEventShardIndex> {
  const latestByRefKey = new Map<string, EventRecord>();
  const maxRevisionById = new Map<string, number>();
  const resolved = resolveVaultPath(vaultRoot, relativePath);

  if (!(await pathExists(resolved.absolutePath))) {
    return { latestByRefKey, maxRevisionById };
  }

  const grouped = new Map<string, EventSpineEntry<EventRecord>[]>();

  for (const raw of await readJsonlRecords({ vaultRoot, relativePath })) {
    const parsed = safeParseContract(eventRecordSchema, raw);

    if (!parsed.success) {
      continue;
    }

    // Track the highest revision per event id across ALL rows, including
    // revisions without an externalRef (e.g. a user edit through upsertEvent
    // that did not echo the ref), so a supersede never reuses a taken
    // revision number.
    maxRevisionById.set(
      parsed.data.id,
      Math.max(maxRevisionById.get(parsed.data.id) ?? 0, eventSpineRevision(parsed.data)),
    );

    if (!parsed.data.externalRef) {
      continue;
    }

    const refKey = deviceEventExternalRefKey(parsed.data.externalRef);
    const group = grouped.get(refKey) ?? [];
    group.push({ relativePath, record: parsed.data });
    grouped.set(refKey, group);
  }

  for (const [refKey, group] of grouped) {
    // Collapse spine revisions per event id first; raw revision counts are not
    // comparable across different event ids (a deleted duplicate's tombstone
    // must not outrank a surviving live copy of the same provider record).
    // The collapse drops ids whose latest revision is deleted, so a fully
    // tombstoned ref yields no match and re-imports append a fresh event,
    // bounded by the deterministic-id skip for identical content.
    const latest = selectLatestEventSpineEntry(collapseEventSpineEntries(group));

    if (latest) {
      latestByRefKey.set(refKey, latest.record);
    }
  }

  return { latestByRefKey, maxRevisionById };
}

// Device-sync ingestion invariant 4: merge is idempotent on the record's own
// externalRef, so overlapping push/pull re-imports of the same provider record
// must not mint new events. Re-imports with identical content (ignoring
// per-import identity such as id, rawRefs, lifecycle, and recordedAt) are
// skipped; changed content appends an event-spine revision onto the existing
// event id instead of a new event.
async function reconcileDeviceEventEntriesByExternalRef(
  vaultRoot: string,
  entries: readonly PreparedJsonlEntry<EventRecord>[],
): Promise<DeviceEventExternalRefReconciliation> {
  assertCanonicalWriteLockScope(vaultRoot);

  const indexByShard = new Map<string, DeviceEventShardIndex>();
  const appendEntries: PreparedJsonlEntry<EventRecord>[] = [];
  const records: EventRecord[] = [];
  const forceAppendIds = new Set<string>();
  let skippedDuplicateCount = 0;
  let supersededCount = 0;

  for (const entry of entries) {
    const externalRef = entry.record.externalRef;

    if (!externalRef) {
      appendEntries.push(entry);
      records.push(entry.record);
      continue;
    }

    const shardIndex =
      indexByShard.get(entry.relativePath) ??
      (await indexLatestDeviceEventsByExternalRef(vaultRoot, entry.relativePath));

    indexByShard.set(entry.relativePath, shardIndex);

    const refKey = deviceEventExternalRefKey(externalRef);
    const latest = shardIndex.latestByRefKey.get(refKey);

    if (!latest) {
      shardIndex.latestByRefKey.set(refKey, entry.record);
      appendEntries.push(entry);
      records.push(entry.record);
      continue;
    }

    if (deviceEventContentKey(latest) === deviceEventContentKey(entry.record)) {
      skippedDuplicateCount += 1;
      records.push(latest);
      continue;
    }

    const revision = Math.max(
      eventSpineRevision(latest),
      shardIndex.maxRevisionById.get(latest.id) ?? 0,
    ) + 1;
    const superseding: EventRecord = {
      ...entry.record,
      id: latest.id,
      lifecycle: buildEventSpineLifecycle(revision),
    };

    forceAppendIds.add(latest.id);
    shardIndex.latestByRefKey.set(refKey, superseding);
    shardIndex.maxRevisionById.set(latest.id, revision);
    appendEntries.push({ relativePath: entry.relativePath, record: superseding });
    records.push(superseding);
    supersededCount += 1;
  }

  return {
    appendEntries,
    records,
    forceAppendIds,
    skippedDuplicateCount,
    supersededCount,
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

      const refKey = deviceEventExternalRefKey(parsed.data.externalRef);
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

function buildDeviceBatchAuditSummary(input: {
  provider: string;
  eventCount: number;
  sampleCount: number;
  skippedDuplicateCount: number;
  supersededCount: number;
}): string {
  const dedupeNotes: string[] = [];

  if (input.skippedDuplicateCount > 0) {
    dedupeNotes.push(`${input.skippedDuplicateCount} duplicate event(s) skipped by externalRef`);
  }

  if (input.supersededCount > 0) {
    dedupeNotes.push(`${input.supersededCount} event(s) updated in place by externalRef`);
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

function prepareDeviceBatchPlan({
  provider,
  accountId,
  importedAt = new Date(),
  defaultTimeZone: fallbackTimeZone,
  source = "device",
  events = [],
  samples = [],
  rawArtifacts = [],
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
    rawArtifacts,
    provenance,
  });

  const effectiveOccurredAt = earliestTimestamp(
    [
      ...normalizedInputs.events.map(({ seed }) => seed.occurredAt),
      ...normalizedInputs.samples.map(({ seed }) => seed.recordedAt),
    ],
    normalizedInputs.importedAt,
  );
  const importId = deterministicContractId(
    ID_PREFIXES.transform,
    stableStringify({
      provider: normalizedInputs.provider,
      accountId: normalizedInputs.accountId ?? null,
      eventIds: normalizedInputs.events.map(({ recordId }) => recordId),
      sampleIds: normalizedInputs.samples.map(({ recordId }) => recordId),
      rawArtifacts: normalizedInputs.rawArtifacts.map((artifact) => ({
        role: artifact.role,
        fileName: artifact.fileName,
        mediaType: artifact.mediaType ?? null,
        sha256: artifact.sha256,
      })),
    }),
  );
  const preparedRawArtifacts = prepareDeviceRawArtifacts(normalizedInputs.rawArtifacts, {
    importId,
    provider: normalizedInputs.provider,
    effectiveOccurredAt,
  });
  const preparedEvents = prepareDeviceEventEntries(normalizedInputs.events, preparedRawArtifacts);
  const preparedSamples = prepareDeviceSampleEntries(normalizedInputs.samples);

  return {
    importId,
    provider: normalizedInputs.provider,
    accountId: normalizedInputs.accountId,
    importedAt: normalizedInputs.importedAt,
    source: normalizedInputs.source,
    provenance: normalizedInputs.provenance,
    effectiveOccurredAt,
    preparedEvents,
    preparedSamples,
    preparedRawArtifacts,
  };
}

export async function importDocument({
  vaultRoot,
  sourcePath,
  occurredAt = new Date(),
  title,
  note,
  source = "import",
}: ImportDocumentInput): Promise<ImportDocumentResult> {
  const vault = await loadVault({ vaultRoot });
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
        targetIds: [documentId, event.record.id],
      });

      return {
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

export async function importDeviceBatch({
  vaultRoot,
  provider,
  accountId,
  importedAt = new Date(),
  source = "device",
  events = [],
  samples = [],
  rawArtifacts = [],
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
    rawArtifacts,
    provenance,
  });
  const eventReconciliation = await reconcileDeviceEventEntriesByExternalRef(
    vaultRoot,
    deviceBatchPlan.preparedEvents,
  );
  const eventAppendPlan = await buildJsonlAppendPlan(vaultRoot, eventReconciliation.appendEntries, {
    dedupeWithinPlan: true,
    forceAppendIds: eventReconciliation.forceAppendIds,
  });
  const sampleAppendPlan = await buildJsonlAppendPlan(vaultRoot, deviceBatchPlan.preparedSamples, {
    dedupeWithinPlan: true,
  });
  const eventRecords = eventReconciliation.records;
  const eventTargetShardPaths = [
    ...new Set(deviceBatchPlan.preparedEvents.map((entry) => entry.relativePath)),
  ].sort();
  const sampleRecords = deviceBatchPlan.preparedSamples.map((entry) => entry.record);

  return runCanonicalWrite({
    vaultRoot,
    operationType: "device_batch_import",
    summary: `Import ${deviceBatchPlan.provider} device batch ${deviceBatchPlan.importId}`,
    occurredAt: deviceBatchPlan.effectiveOccurredAt,
    mutate: async ({ batch }) => {
      const stagedRawArtifacts = [];

      for (const artifact of deviceBatchPlan.preparedRawArtifacts) {
        stagedRawArtifacts.push({
          role: artifact.role,
          raw: await batch.stageRawText({
            targetRelativePath: artifact.raw.relativePath,
            originalFileName: artifact.raw.originalFileName,
            mediaType: artifact.raw.mediaType,
            content: artifact.content,
            allowExistingMatch: true,
          }),
        });
      }

      const manifestPath = stagedRawArtifacts.length > 0
        ? await stageRawImportManifest({
            batch,
            importId: deviceBatchPlan.importId,
            importKind: "device_batch",
            importedAt: deviceBatchPlan.importedAt,
            owner: {
              kind: "device_batch",
              id: deviceBatchPlan.importId,
              partition: deviceBatchPlan.provider,
            },
            source: deviceBatchPlan.source ?? null,
            artifacts: stagedRawArtifacts,
            provenance: {
              provider: deviceBatchPlan.provider,
              accountId: deviceBatchPlan.accountId ?? null,
              importedAt: deviceBatchPlan.importedAt,
              eventCount: eventRecords.length,
              sampleCount: sampleRecords.length,
              rawArtifacts: deviceBatchPlan.preparedRawArtifacts.map((artifact) => ({
                role: artifact.role,
                relativePath: artifact.raw.relativePath,
                sha256: artifact.sha256,
                metadata: artifact.metadata ?? null,
              })),
            },
            operatorMetadata: deviceBatchPlan.provenance,
          })
        : "";
      await stageJsonlAppendPlan(batch, eventAppendPlan);
      await stageJsonlAppendPlan(batch, sampleAppendPlan);

      const touchedPaths = [
        ...deviceBatchPlan.preparedRawArtifacts.map((artifact) => artifact.raw.relativePath),
        ...(manifestPath ? [manifestPath] : []),
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
          eventCount: eventRecords.length,
          sampleCount: sampleRecords.length,
          skippedDuplicateCount: eventReconciliation.skippedDuplicateCount,
          supersededCount: eventReconciliation.supersededCount,
        }),
        occurredAt: deviceBatchPlan.importedAt,
        files: touchedPaths,
        targetIds: [deviceBatchPlan.importId],
      });

      return {
        importId: deviceBatchPlan.importId,
        provider: deviceBatchPlan.provider,
        accountId: deviceBatchPlan.accountId,
        importedAt: deviceBatchPlan.importedAt,
        events: eventRecords,
        samples: sampleRecords,
        eventShardPaths: eventTargetShardPaths,
        sampleShardPaths: sampleAppendPlan.targetShardPaths,
        rawArtifacts: deviceBatchPlan.preparedRawArtifacts.map((artifact) => artifact.raw),
        auditPath: audit.relativePath,
        manifestPath,
      };
    },
  });
}

export interface ImportEventBatchInput {
  vaultRoot: string;
  payloads: readonly LooseRecord[];
  apply?: boolean;
}

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
  eventShardPaths: string[];
  auditPath: string | null;
}

const EVENT_BATCH_FAILURE_REPORT_LIMIT = 20;

// Bulk canonical event import: every payload is validated through the same
// strict contract path as the single-event upsert before anything is staged,
// so one invalid payload rejects the whole batch. Valid rows reuse the
// device-batch externalRef reconcile (idempotent skip / in-place supersede on
// system + resourceType + resourceId + facet) and land in one canonical write
// with one audit record. Dry-run by default; `apply` commits.
export async function importEventBatch({
  vaultRoot,
  payloads,
  apply = false,
}: ImportEventBatchInput): Promise<ImportEventBatchResult> {
  const vault = await loadVault({ vaultRoot });
  const entries: PreparedJsonlEntry<EventRecord>[] = [];
  const failures: ImportEventBatchFailure[] = [];

  payloads.forEach((payload, index) => {
    try {
      const record = buildPublicEventImportRecord(payload, vault.metadata.timezone);
      entries.push({ relativePath: toEventLedgerFile(record.occurredAt), record });
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
      `${failures.length} of ${payloads.length} event payload(s) failed validation; nothing was imported.`,
      {
        failureCount: failures.length,
        failures: failures.slice(0, EVENT_BATCH_FAILURE_REPORT_LIMIT),
      },
    );
  }

  const reconciliation = await reconcileDeviceEventEntriesByExternalRef(vaultRoot, entries);
  const appendPlan = await buildJsonlAppendPlan(vaultRoot, reconciliation.appendEntries, {
    dedupeWithinPlan: true,
    forceAppendIds: reconciliation.forceAppendIds,
  });
  const appendedCount = appendPlan.appendedRecordIds.length;
  const supersededCount = reconciliation.supersededCount;
  const counts = {
    receivedCount: payloads.length,
    createdCount: appendedCount - supersededCount,
    skippedExistingCount: payloads.length - appendedCount,
    supersededCount,
  };

  if (!apply || appendedCount === 0) {
    return {
      applied: false,
      ...counts,
      eventShardPaths: appendPlan.appendedShardPaths,
      auditPath: null,
    };
  }

  const occurredAt = earliestTimestamp(entries.map((entry) => entry.record.occurredAt));

  return runCanonicalWrite({
    vaultRoot,
    operationType: "event_batch_import",
    summary: `Import event batch with ${appendedCount} appended event(s)`,
    occurredAt,
    mutate: async ({ batch }) => {
      await stageJsonlAppendPlan(batch, appendPlan);
      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "event_upsert",
        commandName: "core.importEventBatch",
        summary: `Imported event batch: ${counts.createdCount} created, ` +
          `${counts.supersededCount} updated in place, ` +
          `${counts.skippedExistingCount} skipped existing of ${counts.receivedCount} received.`,
        occurredAt,
        files: appendPlan.appendedShardPaths,
        targetIds: appendPlan.appendedRecordIds.slice(0, AUDIT_TARGET_ID_LIMIT),
      });

      return {
        applied: true,
        ...counts,
        eventShardPaths: appendPlan.appendedShardPaths,
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
