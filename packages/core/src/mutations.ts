import { createHash } from "node:crypto";

import type {
  ContractSchema,
  DocumentEventRecord,
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
import { prepareRawArtifact } from "./raw.js";
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
  photo: RawArtifact;
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
  fields?: LooseRecord;
}

interface BuildSampleRecordInput {
  stream: SampleStream;
  recordedAt?: DateInput;
  source?: string;
  quality?: string;
  sample: SampleInputRecord;
  unit: string;
  recordId?: string;
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

function normalizeStringList(value: unknown): string[] | undefined {
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

function normalizeExperimentStatus(value: unknown): ExperimentStatus {
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
    status: normalizeExperimentStatus((attributes as FrontmatterObject).status),
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
  fields = {},
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
    id: generateRecordId(ID_PREFIXES.event),
    kind,
    occurredAt: occurredTimestamp,
    recordedAt: recordedTimestamp,
    dayKey: toDateOnly(occurredTimestamp),
    source: normalizeSource(source, EVENT_SOURCE_SET, "manual"),
    title: String(title ?? kind).trim(),
    note: typeof note === "string" && note.trim() ? note.trim() : undefined,
    tags: normalizeStringList(tags),
    relatedIds: normalizeStringList(relatedIds),
    rawRefs: normalizeStringList(rawRefs),
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
}: BuildSampleRecordInput): SampleRecord {
  const recordedTimestamp = toIsoTimestamp(sample.recordedAt ?? recordedAt, "recordedAt");
  const baseFields: LooseRecord = {
    stream,
    recordedAt: recordedTimestamp,
    source: normalizeSource(source, SAMPLE_SOURCE_SET, "import"),
    quality: normalizeSource(quality, SAMPLE_QUALITY_SET, "raw"),
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
  const normalizedStatus = normalizeExperimentStatus(status);
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

  if (!photoPath) {
    throw new VaultError("VAULT_MEAL_PHOTO_REQUIRED", "Meal imports require a photoPath.");
  }

  const mealId = generateRecordId(ID_PREFIXES.meal);
  const photo = prepareRawArtifact({
    sourcePath: photoPath,
    category: "meal-photo",
    occurredAt,
    recordId: mealId,
    slot: "photo",
  });
  const audio = audioPath
    ? prepareRawArtifact({
        sourcePath: audioPath,
        category: "meal-audio",
        occurredAt,
        recordId: mealId,
        slot: "audio",
      })
    : null;
  const event = prepareEventRecord({
    kind: "meal",
    occurredAt,
    source,
    title: "Meal",
    note,
    relatedIds: [mealId],
    rawRefs: [photo.relativePath, audio?.relativePath].filter(
      (value): value is string => typeof value === "string",
    ),
    fields: {
      mealId,
      photoPaths: [photo.relativePath],
      audioPaths: audio ? [audio.relativePath] : [],
    },
  });
  return runCanonicalWrite({
    vaultRoot,
    operationType: "meal_import",
    summary: `Import meal ${mealId}`,
    occurredAt,
    mutate: async ({ batch }) => {
      const stagedPhoto = await batch.stageRawCopy({
        sourcePath: photoPath,
        targetRelativePath: photo.relativePath,
        originalFileName: photo.originalFileName,
        mediaType: photo.mediaType,
      });
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
        source: event.record.source ?? source ?? null,
        artifacts: [
          {
            role: "photo",
            raw: stagedPhoto,
          },
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
      await stageJsonlRecord(batch, event.relativePath, event.record);
      const touchedFiles = [photo.relativePath, audio?.relativePath, manifestPath, event.relativePath].filter(
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
