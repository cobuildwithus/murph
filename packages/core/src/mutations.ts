import { createHash } from "node:crypto";

import type {
  ContractSchema,
  DocumentEventRecord,
  ExternalRef,
  EventKind,
  EventRecord,
  EventSource,
  ExperimentEventRecord,
  JournalDayFrontmatter,
  SampleQuality,
  SampleRecord,
  SampleSource,
  SampleStream,
} from "@murph/contracts";
import {
  experimentFrontmatterSchema,
  journalDayFrontmatterSchema,
  eventRecordSchema,
  safeParseContract,
  sampleRecordSchema,
} from "@murph/contracts";

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
import { VaultError } from "./errors.ts";
import { pathExists, readUtf8File, writeVaultTextFile } from "./fs.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.ts";
import { generateRecordId } from "./ids.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "./jsonl.ts";
import { stageRawImportManifest } from "./operations/raw-manifests.ts";
import { runCanonicalWrite, type WriteBatch } from "./operations/write-batch.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { sanitizePathSegment } from "./path-safety.ts";
import { prepareInlineRawArtifact, prepareRawArtifact } from "./raw.ts";
import {
  defaultTimeZone,
  normalizeTimeZone,
  toIsoTimestamp,
  toLocalDayKey,
} from "./time.ts";
import { loadVault } from "./vault.ts";

import type { RawArtifact } from "./raw.ts";
import type { DateInput, UnknownRecord } from "./types.ts";

type EventRecordByKind<K extends EventKind> = Extract<EventRecord, { kind: K }>;
type LooseRecord = Record<string, unknown>;

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
  occurredAt?: DateInput;
  note?: string;
  photoPath?: string;
  audioPath?: string;
  source?: string;
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

interface SampleImportRowProvenance {
  rowNumber: number;
  recordedAt: string;
  value: number;
  rawRecordedAt: string;
  rawValue: string;
  metadata?: Record<string, string>;
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
  rows?: SampleImportRowProvenance[];
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
  relatedIds?: unknown;
  rawArtifactRoles?: unknown;
  externalRef?: unknown;
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
  relatedIds?: unknown;
  rawRefs?: unknown;
  externalRef?: unknown;
  fields?: LooseRecord;
  recordId?: string;
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
  relatedIds?: string[];
  rawRefs?: string[];
  externalRef?: ExternalRef;
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

  return `${JSON.stringify(stableSortValue(content), null, 2)}\n`;
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

const NUMERIC_UNIT_ALIASES = {
  glucose: {
    "mg/dl": "mg_dL",
    "mg_dl": "mg_dL",
    mg_dL: "mg_dL",
  },
  heart_rate: {
    bpm: "bpm",
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

const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
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

function encodeBase32(bytes: Uint8Array, length: number): string {
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= 5 && output.length < length) {
      bits -= 5;
      output += CROCKFORD_BASE32_ALPHABET[(buffer >> bits) & 31];
    }
  }

  if (bits > 0 && output.length < length) {
    output += CROCKFORD_BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }

  return output.padEnd(length, "0").slice(0, length);
}

function deterministicContractId(prefix: string, seed: string): string {
  const hash = createHash("sha256").update(seed).digest();
  return `${prefix}_${encodeBase32(hash, 26)}`;
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
  relatedIds,
  rawRefs,
  externalRef,
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
    relatedIds: trimStringList(relatedIds),
    rawRefs: trimStringList(rawRefs),
    externalRef: normalizeExternalRef(externalRef),
    fields: normalizedFields,
  };

  assertContractShape(
    eventRecordSchema,
    materializeEventRecord({ seed, recordId: EVENT_VALIDATION_PLACEHOLDER_ID }),
    "EVENT_INVALID",
    "Event record failed contract validation before write.",
  );

  return seed;
}

function materializeEventRecord<K extends EventKind>({
  seed,
  recordId,
}: {
  seed: NormalizedEventSeed<K>;
  recordId?: string;
}): UnknownRecord {
  return compactRecord({
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
    relatedIds: seed.relatedIds,
    rawRefs: seed.rawRefs,
    externalRef: seed.externalRef,
    ...seed.fields,
  });
}

function finalizeEventRecord<K extends EventKind>({
  seed,
  recordId,
}: {
  seed: NormalizedEventSeed<K>;
  recordId: string;
}): EventRecordByKind<K> {
  const record = materializeEventRecord({ seed, recordId });

  assertContractShape(
    eventRecordSchema,
    record,
    "EVENT_INVALID",
    "Event record failed contract validation before write.",
  );

  return record as EventRecordByKind<K>;
}

function buildEventRecord<K extends EventKind>({
  recordId,
  ...input
}: BuildEventRecordInput<K>): EventRecordByKind<K> {
  return finalizeEventRecord({
    seed: buildNormalizedEventSeed(input),
    recordId: recordId ?? generateRecordId(ID_PREFIXES.event),
  });
}

function prepareEventRecord<K extends EventKind>(
  input: BuildEventRecordInput<K>,
): { relativePath: string; record: EventRecordByKind<K> } {
  const record = buildEventRecord(input);
  return {
    relativePath: toMonthlyShardRelativePath(
      VAULT_LAYOUT.eventLedgerDirectory,
      record.occurredAt,
      "occurredAt",
    ),
    record,
  };
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
  } = {},
): Promise<JsonlAppendPlan> {
  const payloads = new Map<string, string>();
  const existingIdsByShard = new Map<string, Set<string>>();
  const targetShardPaths = [...new Set(entries.map((entry) => entry.relativePath))].sort();

  for (const entry of entries) {
    const existingIds =
      existingIdsByShard.get(entry.relativePath) ??
      (await readExistingRecordIds(vaultRoot, entry.relativePath));

    existingIdsByShard.set(entry.relativePath, existingIds);

    if (existingIds.has(entry.record.id)) {
      continue;
    }

    if (options.dedupeWithinPlan) {
      existingIds.add(entry.record.id);
    }

    const existingPayload = payloads.get(entry.relativePath) ?? "";
    payloads.set(entry.relativePath, `${existingPayload}${JSON.stringify(entry.record)}\n`);
  }

  return {
    targetShardPaths,
    appendedShardPaths: [...payloads.keys()].sort(),
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
    const rawArtifactRoles = trimStringList(eventInput.rawArtifactRoles) ?? [];
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
      relatedIds: eventInput.relatedIds,
      externalRef: eventInput.externalRef,
      fields,
    });
    const { rawRefs: _rawRefs, ...seedRecord } = materializeEventRecord({ seed });

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
  const eventInputs = Array.isArray(events)
    ? events.map((event, index) =>
        assertPlainObject<DeviceEventInput>(
          event,
          "VAULT_INVALID_EVENT",
          `Device event ${index + 1} must be a plain object.`,
        ),
      )
    : [];
  const sampleInputs = Array.isArray(samples)
    ? samples.map((sample, index) =>
        assertPlainObject<DeviceSampleInput>(
          sample,
          "VAULT_INVALID_SAMPLE",
          `Device sample ${index + 1} must be a plain object.`,
        ),
      )
    : [];
  const rawArtifactInputs = Array.isArray(rawArtifacts)
    ? rawArtifacts.map((artifact, index) =>
        assertPlainObject<DeviceRawArtifactInput>(
          artifact,
          "VAULT_INVALID_RAW_ARTIFACT",
          `Device raw artifact ${index + 1} must be a plain object.`,
        ),
      )
    : [];

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
      targetName: `${String(artifact.index + 1).padStart(2, "0")}-${artifact.fileName}`,
      mediaType: artifact.mediaType,
      category: "integrations",
      provider: options.provider,
      occurredAt: options.effectiveOccurredAt,
      recordId: options.importId,
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
  const soleRawArtifactPath = preparedRawArtifacts.length === 1 ? preparedRawArtifacts[0]?.raw.relativePath : undefined;

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
    const record = finalizeEventRecord({
      seed: {
        ...event.seed,
        rawRefs,
      },
      recordId: event.recordId,
    });

    return {
      record,
      relativePath: toMonthlyShardRelativePath(
        VAULT_LAYOUT.eventLedgerDirectory,
        record.occurredAt,
        "occurredAt",
      ),
    };
  });
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
  const raw = prepareRawArtifact({
    sourcePath,
    category: "documents",
    occurredAt,
    recordId: documentId,
  });
  const event = prepareEventRecord({
    kind: "document",
    occurredAt,
    timeZone: vault.metadata.timezone,
    source,
    title: String(title ?? raw.originalFileName).trim(),
    note,
    relatedIds: [documentId],
    rawRefs: [raw.relativePath],
    fields: {
      documentId,
      documentPath: raw.relativePath,
      mimeType: raw.mediaType,
    },
  });
  return runCanonicalWrite({
    vaultRoot,
    operationType: "document_import",
    summary: `Import document ${documentId}`,
    occurredAt,
    mutate: async ({ batch }) => {
      const stagedRaw = await batch.stageRawCopy({
        sourcePath,
        targetRelativePath: raw.relativePath,
        originalFileName: raw.originalFileName,
        mediaType: raw.mediaType,
      });
      const manifestPath = await stageRawImportManifest({
        batch,
        importId: documentId,
        importKind: "document",
        importedAt: event.record.recordedAt ?? event.record.occurredAt,
        source: event.record.source ?? source ?? null,
        artifacts: [
          {
            role: "source_document",
            raw: stagedRaw,
          },
        ],
        canonicalProvenance: {
          eventId: event.record.id,
          lookupId: event.record.id,
          occurredAt: event.record.occurredAt,
          title: event.record.title ?? null,
          note: event.record.note ?? null,
        },
      });
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
  occurredAt = new Date(),
  note,
  photoPath,
  audioPath,
  source = "manual",
}: AddMealInput): Promise<AddMealResult> {
  const vault = await loadVault({ vaultRoot });

  if (!photoPath && !audioPath && !note) {
    throw new VaultError(
      "VAULT_MEAL_CONTENT_REQUIRED",
      "Meal imports require at least one of photoPath, audioPath, or note.",
    );
  }

  const mealId = generateRecordId(ID_PREFIXES.meal);
  const photo = photoPath
    ? prepareRawArtifact({
        sourcePath: photoPath,
        category: "meal-photo",
        occurredAt,
        recordId: mealId,
        slot: "photo",
      })
    : null;
  const audio = audioPath
    ? prepareRawArtifact({
        sourcePath: audioPath,
        category: "meal-audio",
        occurredAt,
        recordId: mealId,
        slot: "audio",
      })
    : null;
  const rawDirectory = resolveRawMealDirectory(occurredAt, mealId);
  const event = prepareEventRecord({
    kind: "meal",
    occurredAt,
    timeZone: vault.metadata.timezone,
    source,
    title: "Meal",
    note,
    relatedIds: [mealId],
    rawRefs: [photo?.relativePath, audio?.relativePath].filter(
      (value): value is string => typeof value === "string",
    ),
    fields: {
      mealId,
      photoPaths: photo ? [photo.relativePath] : [],
      audioPaths: audio ? [audio.relativePath] : [],
    },
  });
  return runCanonicalWrite({
    vaultRoot,
    operationType: "meal_import",
    summary: `Import meal ${mealId}`,
    occurredAt,
    mutate: async ({ batch }) => {
      const stagedPhoto = photo && photoPath
        ? await batch.stageRawCopy({
            sourcePath: photoPath,
            targetRelativePath: photo.relativePath,
            originalFileName: photo.originalFileName,
            mediaType: photo.mediaType,
          })
        : null;
      const stagedAudio = audio
        ? await batch.stageRawCopy({
            sourcePath: audioPath as string,
            targetRelativePath: audio.relativePath,
            originalFileName: audio.originalFileName,
            mediaType: audio.mediaType,
          })
        : null;
      const manifestPath = await stageRawImportManifest({
        batch,
        importId: mealId,
        importKind: "meal",
        importedAt: event.record.recordedAt ?? event.record.occurredAt,
        rawDirectory,
        source: event.record.source ?? source ?? null,
        artifacts: [
          ...(stagedPhoto
            ? [
                {
                  role: "photo",
                  raw: stagedPhoto,
                },
              ]
            : []),
          ...(stagedAudio
            ? [
                {
                  role: "audio",
                  raw: stagedAudio,
                },
              ]
            : []),
        ],
        canonicalProvenance: {
          eventId: event.record.id,
          lookupId: event.record.id,
          occurredAt: event.record.occurredAt,
          note: event.record.note ?? null,
        },
      });
      if (!stagedPhoto && !stagedAudio) {
        event.record.rawRefs = [manifestPath];
      }
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

function resolveRawMealDirectory(occurredAt: DateInput, mealId: string): string {
  const timestamp = toIsoTimestamp(occurredAt, "occurredAt");
  return `${VAULT_LAYOUT.rawMealsDirectory}/${timestamp.slice(0, 4)}/${timestamp.slice(5, 7)}/${mealId}`;
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
  const transformFingerprint = normalizedSamples.map((sample) =>
    buildSampleRecord({
      stream: normalizedStream,
      recordedAt: sample.recordedAt ?? sample.occurredAt,
      timeZone: vault.metadata.timezone,
      source,
      quality,
      sample,
      unit,
      recordId: `${ID_PREFIXES.sample}_00000000000000000000000000`,
    }),
  );
  const transformId = deterministicContractId(
    ID_PREFIXES.transform,
    JSON.stringify({
      stream: normalizedStream,
      unit,
      source,
      quality,
      sourcePath: sourcePath ?? null,
      rows: transformFingerprint.map(({ id, ...record }) => record),
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
        category: "samples",
        occurredAt: preparedRecords[0]?.record.recordedAt ?? new Date(),
        recordId: transformId,
        stream: normalizedStream,
        allowExistingMatch: true,
      })
    : null;
  const touchedFiles = raw ? [raw.relativePath] : [];
  const records = preparedRecords.map((entry) => entry.record);
  const appendPlan = await buildJsonlAppendPlan(vaultRoot, preparedRecords);
  const rowProvenance = batchProvenance?.rows ?? [];
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
            source: source ?? null,
            artifacts: [
              {
                role: "source_csv",
                raw: stagedRaw,
              },
            ],
            canonicalProvenance: {
              stream: normalizedStream,
              unit,
              importedCount: records.length,
              sampleIds: records.map((record) => record.id),
              ledgerFiles: appendPlan.targetShardPaths,
              sourceFileName: batchProvenance?.sourceFileName ?? raw?.originalFileName ?? null,
              importConfig: batchProvenance?.importConfig ?? null,
              rowCount: rowProvenance.length,
              rows: rowProvenance,
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
        targetIds: records.map((record) => record.id),
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
  const eventAppendPlan = await buildJsonlAppendPlan(vaultRoot, deviceBatchPlan.preparedEvents, {
    dedupeWithinPlan: true,
  });
  const sampleAppendPlan = await buildJsonlAppendPlan(vaultRoot, deviceBatchPlan.preparedSamples, {
    dedupeWithinPlan: true,
  });
  const eventRecords = deviceBatchPlan.preparedEvents.map((entry) => entry.record);
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
            source: deviceBatchPlan.source ?? null,
            artifacts: stagedRawArtifacts,
            canonicalProvenance: {
              provider: deviceBatchPlan.provider,
              accountId: deviceBatchPlan.accountId ?? null,
              importedAt: deviceBatchPlan.importedAt,
              eventCount: eventRecords.length,
              sampleCount: sampleRecords.length,
              eventIds: eventRecords.map((record) => record.id),
              sampleIds: sampleRecords.map((record) => record.id),
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
        summary: `Imported ${deviceBatchPlan.provider} device batch with ${eventRecords.length} event(s) and ${sampleRecords.length} sample(s).`,
        occurredAt: deviceBatchPlan.importedAt,
        files: touchedPaths,
        targetIds: [...eventRecords.map((record) => record.id), ...sampleRecords.map((record) => record.id)],
      });

      return {
        importId: deviceBatchPlan.importId,
        provider: deviceBatchPlan.provider,
        accountId: deviceBatchPlan.accountId,
        importedAt: deviceBatchPlan.importedAt,
        events: eventRecords,
        samples: sampleRecords,
        eventShardPaths: eventAppendPlan.targetShardPaths,
        sampleShardPaths: sampleAppendPlan.targetShardPaths,
        rawArtifacts: deviceBatchPlan.preparedRawArtifacts.map((artifact) => artifact.raw),
        auditPath: audit.relativePath,
        manifestPath,
      };
    },
  });
}
