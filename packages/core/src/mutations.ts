import type {
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
  eventRecordSchema,
  experimentFrontmatterSchema,
  journalDayFrontmatterSchema,
  sampleRecordSchema,
} from "@healthybob/contracts/schemas";
import { validateAgainstSchema } from "@healthybob/contracts/validate";

import type { JsonSchema } from "@healthybob/contracts/schemas";

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
import { readUtf8File, writeVaultTextFile } from "./fs.js";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "./frontmatter.js";
import { generateRecordId } from "./ids.js";
import { appendJsonlRecord, toMonthlyShardRelativePath } from "./jsonl.js";
import { sanitizePathSegment } from "./path-safety.js";
import { copyRawArtifact } from "./raw.js";
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
}

interface ImportSamplesResult {
  count: number;
  records: SampleRecord[];
  shardPaths: string[];
  raw: RawArtifact | null;
  transformId: string;
  auditPath: string;
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

interface AppendEventRecordInput<K extends EventKind> extends BuildEventRecordInput<K> {
  vaultRoot: string;
}

interface BuildSampleRecordInput {
  stream: SampleStream;
  recordedAt?: DateInput;
  source?: string;
  quality?: string;
  sample: SampleInputRecord;
  unit: string;
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
  schema: JsonSchema,
  value: unknown,
  code: string,
  message: string,
): asserts value is T {
  const errors = validateAgainstSchema(schema, value);

  if (errors.length > 0) {
    throw new VaultError(code, message, { errors });
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

  assertContractShape<EventRecordByKind<K>>(
    eventRecordSchema,
    record,
    "HB_EVENT_INVALID",
    "Event record failed contract validation before write.",
  );

  return record;
}

async function appendEventRecord<K extends EventKind>({
  vaultRoot,
  ...input
}: AppendEventRecordInput<K>): Promise<{ relativePath: string; record: EventRecordByKind<K> }> {
  const record = buildEventRecord(input);
  const relativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    record.occurredAt,
    "occurredAt",
  );

  await appendJsonlRecord({
    vaultRoot,
    relativePath,
    record,
  });

  return {
    relativePath,
    record,
  };
}

function buildSampleRecord({
  stream,
  recordedAt,
  source,
  quality,
  sample,
  unit,
}: BuildSampleRecordInput): SampleRecord {
  const recordedTimestamp = toIsoTimestamp(sample.recordedAt ?? recordedAt, "recordedAt");
  const baseRecord: LooseRecord = {
    schemaVersion: SAMPLE_SCHEMA_VERSION,
    id: generateRecordId(ID_PREFIXES.sample),
    stream,
    recordedAt: recordedTimestamp,
    dayKey: toDateOnly(recordedTimestamp),
    source: normalizeSource(source, SAMPLE_SOURCE_SET, "import"),
    quality: normalizeSource(quality, SAMPLE_QUALITY_SET, "raw"),
  };

  if (stream === "sleep_stage") {
    const record = compactRecord({
      ...baseRecord,
      stage: String(sample.stage ?? "").trim(),
      startAt: toIsoTimestamp(sample.startAt, "startAt"),
      endAt: toIsoTimestamp(sample.endAt, "endAt"),
      durationMinutes: Number(sample.durationMinutes),
      unit: normalizeNumericUnit(stream, unit),
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

  const record = compactRecord({
    ...baseRecord,
    value: sample.value,
    unit: normalizeNumericUnit(stream, unit),
  });

  assertContractShape<SampleRecord>(
    sampleRecordSchema,
    record,
    "HB_SAMPLE_INVALID",
    "Sample record failed contract validation before write.",
  );

  return record;
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
    const existingErrors = validateAgainstSchema(
      experimentFrontmatterSchema,
      existingDocument.attributes,
    );

    if (existingErrors.length > 0) {
      throw new VaultError(
        "HB_FRONTMATTER_INVALID",
        `Existing experiment "${safeSlug}" failed contract validation.`,
        {
          relativePath,
          errors: existingErrors,
        },
      );
    }

    const existingAttributes = existingDocument.attributes as unknown as ExperimentFrontmatter;

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

  await writeVaultTextFile(
    vaultRoot,
    relativePath,
    stringifyFrontmatterDocument({
      attributes: { ...attributes },
      body: `# ${normalizedTitle}\n\n## Plan\n\n## Notes\n\n`,
    }),
    { overwrite: false },
  );

  const event = await appendEventRecord({
    vaultRoot,
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

  const audit = await emitAuditRecord({
    vaultRoot,
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
  const raw = await copyRawArtifact({
    vaultRoot,
    sourcePath,
    category: "documents",
    occurredAt,
    recordId: documentId,
  });
  const event = await appendEventRecord({
    vaultRoot,
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
  const audit = await emitAuditRecord({
    vaultRoot,
    action: "document_import",
    commandName: "core.importDocument",
    summary: `Imported document ${raw.originalFileName}.`,
    occurredAt,
    files: [raw.relativePath, event.relativePath],
    targetIds: [documentId, event.record.id],
  });

  return {
    documentId,
    raw,
    event: event.record,
    eventPath: event.relativePath,
    auditPath: audit.relativePath,
  };
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
  const photo = await copyRawArtifact({
    vaultRoot,
    sourcePath: photoPath,
    category: "meal-photo",
    occurredAt,
    recordId: mealId,
    slot: "photo",
  });
  const audio = audioPath
    ? await copyRawArtifact({
        vaultRoot,
        sourcePath: audioPath,
        category: "meal-audio",
        occurredAt,
        recordId: mealId,
        slot: "audio",
      })
    : null;
  const event = await appendEventRecord({
    vaultRoot,
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
  const touchedFiles = [photo.relativePath, audio?.relativePath, event.relativePath].filter(
    (value): value is string => typeof value === "string",
  );
  const audit = await emitAuditRecord({
    vaultRoot,
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
  };
}

export async function importSamples({
  vaultRoot,
  stream,
  unit,
  samples,
  sourcePath,
  source = "import",
  quality = "raw",
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
  const transformId = generateRecordId(ID_PREFIXES.transform);
  const raw = sourcePath
    ? await copyRawArtifact({
        vaultRoot,
        sourcePath,
        category: "samples",
        occurredAt: samples[0]?.recordedAt ?? new Date(),
        recordId: transformId,
        stream: normalizedStream,
      })
    : null;

  const touchedFiles = raw ? [raw.relativePath] : [];
  const records: SampleRecord[] = [];
  const shardPaths = new Set<string>();

  for (const sample of samples) {
    const normalizedSample = assertPlainObject<SampleInputRecord>(
      sample,
      "VAULT_INVALID_SAMPLE",
      "Each sample must be a plain object.",
    );
    const record = buildSampleRecord({
      stream: normalizedStream,
      recordedAt: normalizedSample.recordedAt ?? normalizedSample.occurredAt,
      source,
      quality,
      sample: normalizedSample,
      unit,
    });
    const relativePath = toMonthlyShardRelativePath(
      `${VAULT_LAYOUT.sampleLedgerDirectory}/${normalizedStream}`,
      record.recordedAt,
      "recordedAt",
    );

    await appendJsonlRecord({
      vaultRoot,
      relativePath,
      record,
    });

    shardPaths.add(relativePath);
    records.push(record);
  }

  const sortedShardPaths = [...shardPaths].sort();
  touchedFiles.push(...sortedShardPaths);

  const audit = await emitAuditRecord({
    vaultRoot,
    action: "samples_import_csv",
    commandName: "core.importSamples",
    summary: `Imported ${records.length} ${normalizedStream} sample record(s).`,
    occurredAt: records[0]?.recordedAt ?? new Date(),
    files: touchedFiles,
    targetIds: records.map((record) => record.id),
  });

  return {
    count: records.length,
    records,
    shardPaths: sortedShardPaths,
    raw,
    transformId,
    auditPath: audit.relativePath,
  };
}
