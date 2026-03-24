import { createHash } from "node:crypto";

import type {
  ContractSchema,
  DocumentEventRecord,
  ExternalRef,
  EventKind,
  EventRecord,
  EventSource,
  ExperimentEventRecord,
  ExperimentFrontmatter,
  ExperimentStatus,
  JournalDayFrontmatter,
  SampleQuality,
  SampleRecord,
  SampleSource,
  SampleStream,
} from "@healthybob/contracts";
import {
  experimentFrontmatterSchema,
  journalDayFrontmatterSchema,
  eventRecordSchema,
  safeParseContract,
  sampleRecordSchema,
} from "@healthybob/contracts";

import {
  BASELINE_EVENT_KINDS,
  BASELINE_SAMPLE_STREAMS,
  EVENT_SCHEMA_VERSION,
  EVENT_SOURCES,
  EXPERIMENT_STATUSES,
  FRONTMATTER_SCHEMA_VERSIONS,
  ID_PREFIXES,
  SAMPLE_QUALITIES,
  SAMPLE_SCHEMA_VERSION,
  SAMPLE_SOURCES,
  VAULT_LAYOUT,
} from "./constants.js";
import { emitAuditRecord } from "./audit.js";
import { VaultError } from "./errors.js";
import { pathExists, readUtf8File, writeVaultTextFile } from "./fs.js";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.js";
import { generateRecordId } from "./ids.js";
import { readJsonlRecords, toMonthlyShardRelativePath } from "./jsonl.js";
import { stageRawImportManifest } from "./operations/raw-manifests.js";
import { runCanonicalWrite, type WriteBatch } from "./operations/write-batch.js";
import { resolveVaultPath } from "./path-safety.js";
import { sanitizePathSegment } from "./path-safety.js";
import { prepareInlineRawArtifact, prepareRawArtifact } from "./raw.js";
import { toDateOnly, toIsoTimestamp } from "./time.js";
import { loadVault } from "./vault.js";

import type { RawArtifact } from "./raw.js";
import type { DateInput, FrontmatterObject, UnknownRecord } from "./types.js";

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
  events?: DeviceEventInput[];
  samples?: DeviceSampleInput[];
  rawArtifacts?: DeviceRawArtifactInput[];
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

interface BuildEventRecordInput<K extends EventKind> {
  kind: K;
  occurredAt: DateInput;
  recordedAt?: DateInput;
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
  source?: string;
  quality?: string;
  sample: SampleInputRecord;
  unit: string;
  recordId?: string;
  externalRef?: unknown;
}

const EVENT_KIND_SET = new Set<EventKind>(BASELINE_EVENT_KINDS as readonly EventKind[]);
const EVENT_SOURCE_SET = new Set<EventSource>(EVENT_SOURCES as readonly EventSource[]);
const SAMPLE_STREAM_SET = new Set<SampleStream>(BASELINE_SAMPLE_STREAMS as readonly SampleStream[]);
const SAMPLE_SOURCE_SET = new Set<SampleSource>(SAMPLE_SOURCES as readonly SampleSource[]);
const SAMPLE_QUALITY_SET = new Set<SampleQuality>(SAMPLE_QUALITIES as readonly SampleQuality[]);
const EXPERIMENT_STATUS_SET = new Set<ExperimentStatus>(
  EXPERIMENT_STATUSES as readonly ExperimentStatus[],
);

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
    throw new VaultError(code, message, { errors: result.errors });
  }
}

function normalizeSource<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : fallback;
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

function normalizeExperimentHypothesis(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function coerceExperimentStatus(value: unknown): ExperimentStatus {
  return typeof value === "string" && EXPERIMENT_STATUS_SET.has(value as ExperimentStatus)
    ? (value as ExperimentStatus)
    : "active";
}

function frontmatterString(value: FrontmatterObject, key: string): string {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : "";
}

function toExperimentComparableAttributes(
  attributes: Pick<ExperimentFrontmatter, "slug" | "status" | "title" | "startedOn" | "hypothesis"> | FrontmatterObject,
): UnknownRecord {
  return compactRecord({
    slug: frontmatterString(attributes as FrontmatterObject, "slug").trim(),
    status: coerceExperimentStatus((attributes as FrontmatterObject).status),
    title: frontmatterString(attributes as FrontmatterObject, "title").trim(),
    startedOn: frontmatterString(attributes as FrontmatterObject, "startedOn").trim(),
    hypothesis: normalizeExperimentHypothesis((attributes as FrontmatterObject).hypothesis),
  });
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

function buildEventRecord<K extends EventKind>({
  kind,
  occurredAt,
  recordedAt = new Date(),
  source,
  title,
  note,
  tags,
  relatedIds,
  rawRefs,
  externalRef,
  fields = {},
  recordId,
}: BuildEventRecordInput<K>): EventRecordByKind<K> {
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
  const record = compactRecord({
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: recordId ?? generateRecordId(ID_PREFIXES.event),
    kind,
    occurredAt: occurredTimestamp,
    recordedAt: recordedTimestamp,
    dayKey: toDateOnly(occurredTimestamp),
    source: normalizeSource(source, EVENT_SOURCE_SET, "manual"),
    title: typeof title === "string" && title.trim() ? title.trim() : kind,
    note: typeof note === "string" && note.trim() ? note.trim() : undefined,
    tags: trimStringList(tags),
    relatedIds: trimStringList(relatedIds),
    rawRefs: trimStringList(rawRefs),
    externalRef: normalizeExternalRef(externalRef),
    ...normalizedFields,
  });

  assertContractShape(
    eventRecordSchema,
    record,
    "HB_EVENT_INVALID",
    "Event record failed contract validation before write.",
  );

  return record as EventRecordByKind<K>;
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

function buildSampleRecord({
  stream,
  recordedAt,
  source,
  quality,
  sample,
  unit,
  recordId,
  externalRef,
}: BuildSampleRecordInput): SampleRecord {
  const recordedTimestamp = toIsoTimestamp(sample.recordedAt ?? recordedAt, "recordedAt");
  const baseFields: LooseRecord = {
    stream,
    recordedAt: recordedTimestamp,
    source: normalizeSource(source, SAMPLE_SOURCE_SET, "import"),
    quality: normalizeSource(quality, SAMPLE_QUALITY_SET, "raw"),
    externalRef: normalizeExternalRef(externalRef),
  };

  if (stream === "sleep_stage") {
    const fields = compactRecord({
      ...baseFields,
      stage: String(sample.stage ?? "").trim(),
      startAt: toIsoTimestamp(sample.startAt, "startAt"),
      endAt: toIsoTimestamp(sample.endAt, "endAt"),
      durationMinutes: Number(sample.durationMinutes),
      unit: normalizeNumericUnit(stream, unit),
    });
    const record = compactRecord({
      schemaVersion: SAMPLE_SCHEMA_VERSION,
      id: recordId ?? generateRecordId(ID_PREFIXES.sample),
      dayKey: toDateOnly(recordedTimestamp),
      ...fields,
    });

    assertContractShape<SampleRecord>(
      sampleRecordSchema,
      record,
      "HB_SAMPLE_INVALID",
      "Sample record failed contract validation before write.",
    );

    return record;
  }

  if (typeof sample.value !== "number" || !Number.isFinite(sample.value)) {
    throw new VaultError("VAULT_INVALID_SAMPLE", "Sample value must be a finite number.", {
      stream,
      sampleSummary: JSON.stringify(sample),
    });
  }

  const fields = compactRecord({
    ...baseFields,
    value: sample.value,
    unit: normalizeNumericUnit(stream, unit),
  });
  const record = compactRecord({
    schemaVersion: SAMPLE_SCHEMA_VERSION,
    id: recordId ?? generateRecordId(ID_PREFIXES.sample),
    dayKey: toDateOnly(recordedTimestamp),
    ...fields,
  });

  assertContractShape<SampleRecord>(
    sampleRecordSchema,
    record,
    "HB_SAMPLE_INVALID",
    "Sample record failed contract validation before write.",
  );

  return record;
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

export async function ensureJournalDay({
  vaultRoot,
  date,
}: EnsureJournalDayInput): Promise<EnsureJournalDayResult> {
  await loadVault({ vaultRoot });
  const day = toDateOnly(date, "date");
  const [year] = day.split("-");
  const relativePath = `${VAULT_LAYOUT.journalDirectory}/${year}/${day}.md`;
  const attributes: JournalDayFrontmatter = {
    schemaVersion: FRONTMATTER_SCHEMA_VERSIONS.journalDay,
    docType: "journal_day",
    dayKey: day,
    eventIds: [],
    sampleStreams: [],
  };

  assertContractShape<JournalDayFrontmatter>(
    journalDayFrontmatterSchema,
    attributes,
    "HB_FRONTMATTER_INVALID",
    "Journal frontmatter failed contract validation before write.",
  );

  try {
    await writeVaultTextFile(
      vaultRoot,
      relativePath,
      stringifyFrontmatterDocument({
        attributes: { ...attributes },
        body: `# ${day}\n\n## Summary\n\n`,
      }),
      { overwrite: false },
    );
  } catch (error) {
    if (error instanceof VaultError && error.code === "VAULT_FILE_EXISTS") {
      return {
        created: false,
        relativePath,
      };
    }

    throw error;
  }

  const audit = await emitAuditRecord({
    vaultRoot,
    action: "journal_ensure",
    commandName: "core.ensureJournalDay",
    summary: `Ensured journal page for ${day}.`,
    occurredAt: `${day}T00:00:00.000Z`,
    files: [relativePath],
  });

  return {
    created: true,
    relativePath,
    auditPath: audit.relativePath,
  };
}

export async function createExperiment({
  vaultRoot,
  slug,
  title,
  hypothesis,
  startedOn = new Date(),
  status = "active",
}: CreateExperimentInput): Promise<CreateExperimentResult> {
  await loadVault({ vaultRoot });
  const safeSlug = sanitizePathSegment(slug, "experiment");
  const startedTimestamp = toIsoTimestamp(startedOn, "startedOn");
  const startedDay = toDateOnly(startedOn, "startedOn");
  const relativePath = `${VAULT_LAYOUT.experimentsDirectory}/${safeSlug}.md`;
  const normalizedTitle = String(title ?? safeSlug).trim();
  const normalizedStatus = coerceExperimentStatus(status);
  const normalizedHypothesis = normalizeExperimentHypothesis(hypothesis);
  const comparableAttributes = toExperimentComparableAttributes({
    slug: safeSlug,
    status: normalizedStatus,
    title: normalizedTitle,
    startedOn: startedDay,
    hypothesis: normalizedHypothesis,
  });

  try {
    const existingDocument = parseFrontmatterDocument(await readUtf8File(vaultRoot, relativePath));
    const existingResult = safeParseContract(
      experimentFrontmatterSchema,
      existingDocument.attributes,
    );

    if (!existingResult.success) {
      throw new VaultError(
        "HB_FRONTMATTER_INVALID",
        `Existing experiment "${safeSlug}" failed contract validation.`,
        {
          relativePath,
          errors: existingResult.errors,
        },
      );
    }
    const existingAttributes = existingResult.data;

    if (
      JSON.stringify(toExperimentComparableAttributes(existingAttributes)) !==
      JSON.stringify(comparableAttributes)
    ) {
      throw new VaultError(
        "VAULT_EXPERIMENT_CONFLICT",
        `Experiment "${safeSlug}" already exists with different frontmatter.`,
        {
          relativePath,
          experimentId: existingAttributes.experimentId,
        },
      );
    }

    return {
      created: false,
      experiment: {
        id: existingAttributes.experimentId,
        slug: existingAttributes.slug,
        relativePath,
      },
      event: null,
      auditPath: null,
    };
  } catch (error) {
    if (!(error instanceof VaultError) || error.code !== "VAULT_FILE_MISSING") {
      throw error;
    }
  }

  const experimentId = generateRecordId(ID_PREFIXES.experiment);
  const attributes = compactRecord({
    schemaVersion: FRONTMATTER_SCHEMA_VERSIONS.experiment,
    docType: "experiment",
    experimentId,
    slug: safeSlug,
    status: normalizedStatus,
    title: normalizedTitle,
    startedOn: startedDay,
    hypothesis: normalizedHypothesis,
  });

  assertContractShape<ExperimentFrontmatter>(
    experimentFrontmatterSchema,
    attributes,
    "HB_FRONTMATTER_INVALID",
    "Experiment frontmatter failed contract validation before write.",
  );
  const markdown = stringifyFrontmatterDocument({
    attributes: { ...attributes },
    body: `# ${normalizedTitle}\n\n## Plan\n\n## Notes\n\n`,
  });
  const event = prepareEventRecord({
    kind: "experiment_event",
    occurredAt: startedTimestamp,
    source: "manual",
    title: normalizedTitle,
    relatedIds: [experimentId],
    fields: {
      experimentId,
      experimentSlug: safeSlug,
      phase: "start",
    },
  });

  return runCanonicalWrite({
    vaultRoot,
    operationType: "experiment_create",
    summary: `Create experiment ${safeSlug}`,
    occurredAt: startedTimestamp,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(relativePath, markdown, { overwrite: false });
      await stageJsonlRecord(batch, event.relativePath, event.record);
      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "experiment_create",
        commandName: "core.createExperiment",
        summary: `Created experiment ${safeSlug}.`,
        occurredAt: startedTimestamp,
        files: [relativePath, event.relativePath],
        targetIds: [experimentId, event.record.id],
      });

      return {
        created: true,
        experiment: {
          id: experimentId,
          slug: safeSlug,
          relativePath,
        },
        event: event.record,
        auditPath: audit.relativePath,
      };
    },
  });
}

export async function importDocument({
  vaultRoot,
  sourcePath,
  occurredAt = new Date(),
  title,
  note,
  source = "import",
}: ImportDocumentInput): Promise<ImportDocumentResult> {
  await loadVault({ vaultRoot });
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
        provenance: {
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
  await loadVault({ vaultRoot });

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
        provenance: {
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
  await loadVault({ vaultRoot });

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
    assertPlainObject<SampleInputRecord>(
      sample,
      "VAULT_INVALID_SAMPLE",
      "Each sample must be a plain object.",
    ),
  );
  const transformFingerprint = normalizedSamples.map((sample) =>
    buildSampleRecord({
      stream: normalizedStream,
      recordedAt: sample.recordedAt ?? sample.occurredAt,
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
  const shardPayloads = new Map<string, string>();
  const existingIdsByShard = new Map<string, Set<string>>();
  const targetShardPaths = [...new Set(preparedRecords.map((entry) => entry.relativePath))].sort();

  for (const entry of preparedRecords) {
    const existingIds =
      existingIdsByShard.get(entry.relativePath) ??
      (await readExistingRecordIds(vaultRoot, entry.relativePath));

    existingIdsByShard.set(entry.relativePath, existingIds);

    if (existingIds.has(entry.record.id)) {
      continue;
    }

    const existingPayload = shardPayloads.get(entry.relativePath) ?? "";
    shardPayloads.set(entry.relativePath, `${existingPayload}${JSON.stringify(entry.record)}\n`);
  }

  const rowProvenance = batchProvenance?.rows ?? [];
  const appendedShardPaths = [...shardPayloads.keys()].sort();
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
            provenance: {
              stream: normalizedStream,
              unit,
              importedCount: records.length,
              sampleIds: records.map((record) => record.id),
              ledgerFiles: targetShardPaths,
              sourceFileName: batchProvenance?.sourceFileName ?? raw?.originalFileName ?? null,
              importConfig: batchProvenance?.importConfig ?? null,
              rowCount: rowProvenance.length,
              rows: rowProvenance,
            },
          })
        : "";

      for (const relativePath of appendedShardPaths) {
        const payload = shardPayloads.get(relativePath);

        if (!payload) {
          continue;
        }

        await batch.stageJsonlAppend(relativePath, payload);
      }

      const touchedPaths = [...touchedFiles];
      touchedPaths.push(...(manifestPath ? [manifestPath] : []), ...appendedShardPaths);

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
        shardPaths: targetShardPaths,
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
  await loadVault({ vaultRoot });

  const normalizedProvider = sanitizePathSegment(provider, "provider");
  const normalizedAccountId = typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
  const normalizedImportedAt = toIsoTimestamp(importedAt, "importedAt");
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

  const preparedEventSeeds = eventInputs.map((eventInput, index) => {
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
    const fingerprintRecord = buildEventRecord({
      kind,
      occurredAt: eventInput.occurredAt ?? eventInput.recordedAt ?? normalizedImportedAt,
      recordedAt: eventInput.recordedAt ?? eventInput.occurredAt,
      source: eventInput.source ?? source,
      title: typeof eventInput.title === "string" ? eventInput.title : undefined,
      note: eventInput.note,
      tags: eventInput.tags,
      relatedIds: eventInput.relatedIds,
      externalRef: eventInput.externalRef,
      fields,
      recordId: `${ID_PREFIXES.event}_00000000000000000000000000`,
    });
    const { id: _recordId, rawRefs: _rawRefs, ...seedRecord } = fingerprintRecord;
    const recordId = deterministicContractId(
      ID_PREFIXES.event,
      stableStringify({
        provider: normalizedProvider,
        accountId: normalizedAccountId ?? null,
        rawArtifactRoles,
        record: seedRecord,
      }),
    );

    return {
      kind,
      occurredAt: fingerprintRecord.occurredAt,
      recordedAt: fingerprintRecord.recordedAt,
      source: fingerprintRecord.source,
      title: fingerprintRecord.title,
      note: fingerprintRecord.note,
      tags: fingerprintRecord.tags,
      relatedIds: fingerprintRecord.relatedIds,
      externalRef: fingerprintRecord.externalRef,
      fields,
      rawArtifactRoles,
      recordId,
      fingerprintRecord,
    };
  });

  const preparedSampleSeeds = sampleInputs.map((sampleInput, index) => {
    const stream = String(sampleInput.stream ?? "").trim() as SampleStream;

    if (!SAMPLE_STREAM_SET.has(stream)) {
      throw new VaultError(
        "VAULT_UNSUPPORTED_SAMPLE_STREAM",
        `Unsupported baseline sample stream "${String(sampleInput.stream ?? "")}".`,
        { index },
      );
    }

    const samplePayload = assertPlainObject<SampleInputRecord>(
      sampleInput.sample,
      "VAULT_INVALID_SAMPLE",
      `Device sample ${index + 1} must include a sample object.`,
    );
    const fingerprintRecord = buildSampleRecord({
      stream,
      recordedAt: sampleInput.recordedAt ?? samplePayload.recordedAt ?? samplePayload.occurredAt,
      source: sampleInput.source ?? source,
      quality: sampleInput.quality ?? "normalized",
      sample: samplePayload,
      unit: String(sampleInput.unit ?? ""),
      recordId: `${ID_PREFIXES.sample}_00000000000000000000000000`,
      externalRef: sampleInput.externalRef,
    });
    const { id: _recordId, ...seedRecord } = fingerprintRecord;
    const recordId = deterministicContractId(
      ID_PREFIXES.sample,
      stableStringify({
        provider: normalizedProvider,
        accountId: normalizedAccountId ?? null,
        record: seedRecord,
      }),
    );

    return {
      stream,
      recordedAt: fingerprintRecord.recordedAt,
      source: fingerprintRecord.source,
      quality: fingerprintRecord.quality,
      unit: fingerprintRecord.unit,
      sample: samplePayload,
      externalRef: fingerprintRecord.externalRef,
      recordId,
      fingerprintRecord,
    };
  });

  const seenRawRoles = new Set<string>();
  const normalizedRawArtifacts = rawArtifactInputs.map((artifactInput, index) => {
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

    const fileName =
      typeof artifactInput.fileName === "string" && artifactInput.fileName.trim()
        ? artifactInput.fileName.trim()
        : `${normalizedProvider}-${String(index + 1).padStart(2, "0")}.json`;
    const content = normalizeInlineRawContent(artifactInput.content);
    const metadata = normalizeLooseRecord(
      artifactInput.metadata,
      "VAULT_INVALID_RAW_ARTIFACT",
      `Device raw artifact ${index + 1} metadata must be a plain object.`,
    );

    return {
      role,
      fileName,
      mediaType:
        typeof artifactInput.mediaType === "string" && artifactInput.mediaType.trim()
          ? artifactInput.mediaType.trim()
          : undefined,
      content,
      metadata,
      sha256: createHash("sha256").update(content).digest("hex"),
      index,
    };
  });

  const effectiveOccurredAt = earliestTimestamp(
    [
      ...preparedEventSeeds.map(({ fingerprintRecord }) => fingerprintRecord.occurredAt),
      ...preparedSampleSeeds.map(({ fingerprintRecord }) => fingerprintRecord.recordedAt),
    ],
    normalizedImportedAt,
  );
  const importId = deterministicContractId(
    ID_PREFIXES.transform,
    stableStringify({
      provider: normalizedProvider,
      accountId: normalizedAccountId ?? null,
      eventIds: preparedEventSeeds.map(({ recordId }) => recordId),
      sampleIds: preparedSampleSeeds.map(({ recordId }) => recordId),
      rawArtifacts: normalizedRawArtifacts.map((artifact) => ({
        role: artifact.role,
        fileName: artifact.fileName,
        mediaType: artifact.mediaType ?? null,
        sha256: artifact.sha256,
      })),
    }),
  );
  const preparedRawArtifacts: PreparedDeviceRawArtifact[] = normalizedRawArtifacts.map((artifact) => ({
    role: artifact.role,
    content: artifact.content,
    raw: prepareInlineRawArtifact({
      fileName: artifact.fileName,
      targetName: `${String(artifact.index + 1).padStart(2, "0")}-${artifact.fileName}`,
      mediaType: artifact.mediaType,
      category: "integrations",
      provider: normalizedProvider,
      occurredAt: effectiveOccurredAt,
      recordId: importId,
    }),
    metadata: artifact.metadata,
    sha256: artifact.sha256,
  }));
  const rawArtifactPathByRole = new Map(
    preparedRawArtifacts.map((artifact) => [artifact.role, artifact.raw.relativePath] as const),
  );
  const soleRawArtifactPath = preparedRawArtifacts.length === 1 ? preparedRawArtifacts[0]?.raw.relativePath : undefined;

  const preparedEvents = preparedEventSeeds.map((eventSeed) => {
    const rawRefs = eventSeed.rawArtifactRoles.length > 0
      ? eventSeed.rawArtifactRoles.map((role) => {
          const rawPath = rawArtifactPathByRole.get(role);

          if (!rawPath) {
            throw new VaultError(
              "VAULT_RAW_ROLE_MISSING",
              `No staged raw artifact matched role "${role}" for device event ${eventSeed.recordId}.`,
            );
          }

          return rawPath;
        })
      : soleRawArtifactPath
        ? [soleRawArtifactPath]
        : undefined;

    return prepareEventRecord({
      kind: eventSeed.kind,
      occurredAt: eventSeed.occurredAt,
      recordedAt: eventSeed.recordedAt,
      source: eventSeed.source,
      title: eventSeed.title,
      note: eventSeed.note,
      tags: eventSeed.tags,
      relatedIds: eventSeed.relatedIds,
      rawRefs,
      externalRef: eventSeed.externalRef,
      fields: eventSeed.fields,
      recordId: eventSeed.recordId,
    });
  });
  const preparedSamples = preparedSampleSeeds.map((sampleSeed) => {
    const record = buildSampleRecord({
      stream: sampleSeed.stream,
      recordedAt: sampleSeed.recordedAt,
      source: sampleSeed.source,
      quality: sampleSeed.quality,
      sample: sampleSeed.sample,
      unit: sampleSeed.unit,
      recordId: sampleSeed.recordId,
      externalRef: sampleSeed.externalRef,
    });

    return {
      record,
      relativePath: toMonthlyShardRelativePath(
        `${VAULT_LAYOUT.sampleLedgerDirectory}/${sampleSeed.stream}`,
        record.recordedAt,
        "recordedAt",
      ),
    };
  });

  const eventRecords = preparedEvents.map((entry) => entry.record);
  const sampleRecords = preparedSamples.map((entry) => entry.record);
  const eventShardPaths = [...new Set(preparedEvents.map((entry) => entry.relativePath))].sort();
  const sampleShardPaths = [...new Set(preparedSamples.map((entry) => entry.relativePath))].sort();
  const eventPayloads = new Map<string, string>();
  const samplePayloads = new Map<string, string>();
  const existingEventIdsByShard = new Map<string, Set<string>>();
  const existingSampleIdsByShard = new Map<string, Set<string>>();

  for (const entry of preparedEvents) {
    const existingIds =
      existingEventIdsByShard.get(entry.relativePath) ??
      (await readExistingRecordIds(vaultRoot, entry.relativePath));

    existingEventIdsByShard.set(entry.relativePath, existingIds);

    if (existingIds.has(entry.record.id)) {
      continue;
    }

    existingIds.add(entry.record.id);
    const existingPayload = eventPayloads.get(entry.relativePath) ?? "";
    eventPayloads.set(entry.relativePath, `${existingPayload}${JSON.stringify(entry.record)}\n`);
  }

  for (const entry of preparedSamples) {
    const existingIds =
      existingSampleIdsByShard.get(entry.relativePath) ??
      (await readExistingRecordIds(vaultRoot, entry.relativePath));

    existingSampleIdsByShard.set(entry.relativePath, existingIds);

    if (existingIds.has(entry.record.id)) {
      continue;
    }

    existingIds.add(entry.record.id);
    const existingPayload = samplePayloads.get(entry.relativePath) ?? "";
    samplePayloads.set(entry.relativePath, `${existingPayload}${JSON.stringify(entry.record)}\n`);
  }

  const appendedEventShardPaths = [...eventPayloads.keys()].sort();
  const appendedSampleShardPaths = [...samplePayloads.keys()].sort();

  return runCanonicalWrite({
    vaultRoot,
    operationType: "device_batch_import",
    summary: `Import ${normalizedProvider} device batch ${importId}`,
    occurredAt: effectiveOccurredAt,
    mutate: async ({ batch }) => {
      const stagedRawArtifacts = [];

      for (const artifact of preparedRawArtifacts) {
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
            importId,
            importKind: "device_batch",
            importedAt: normalizedImportedAt,
            source: source ?? null,
            artifacts: stagedRawArtifacts,
            provenance: {
              provider: normalizedProvider,
              accountId: normalizedAccountId ?? null,
              importedAt: normalizedImportedAt,
              eventCount: eventRecords.length,
              sampleCount: sampleRecords.length,
              eventIds: eventRecords.map((record) => record.id),
              sampleIds: sampleRecords.map((record) => record.id),
              rawArtifacts: preparedRawArtifacts.map((artifact) => ({
                role: artifact.role,
                relativePath: artifact.raw.relativePath,
                sha256: artifact.sha256,
                metadata: artifact.metadata ?? null,
              })),
              ...normalizedProvenance,
            },
          })
        : "";

      for (const relativePath of appendedEventShardPaths) {
        const payload = eventPayloads.get(relativePath);

        if (!payload) {
          continue;
        }

        await batch.stageJsonlAppend(relativePath, payload);
      }

      for (const relativePath of appendedSampleShardPaths) {
        const payload = samplePayloads.get(relativePath);

        if (!payload) {
          continue;
        }

        await batch.stageJsonlAppend(relativePath, payload);
      }

      const touchedPaths = [
        ...preparedRawArtifacts.map((artifact) => artifact.raw.relativePath),
        ...(manifestPath ? [manifestPath] : []),
        ...appendedEventShardPaths,
        ...appendedSampleShardPaths,
      ];
      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "device_import",
        commandName: "core.importDeviceBatch",
        summary: `Imported ${normalizedProvider} device batch with ${eventRecords.length} event(s) and ${sampleRecords.length} sample(s).`,
        occurredAt: normalizedImportedAt,
        files: touchedPaths,
        targetIds: [...eventRecords.map((record) => record.id), ...sampleRecords.map((record) => record.id)],
      });

      return {
        importId,
        provider: normalizedProvider,
        accountId: normalizedAccountId,
        importedAt: normalizedImportedAt,
        events: eventRecords,
        samples: sampleRecords,
        eventShardPaths,
        sampleShardPaths,
        rawArtifacts: preparedRawArtifacts.map((artifact) => artifact.raw),
        auditPath: audit.relativePath,
        manifestPath,
      };
    },
  });
}
