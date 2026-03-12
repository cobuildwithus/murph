type ContractSchemaVersion = typeof import("./constants.js").CONTRACT_SCHEMA_VERSION;
type ContractIdFormat = typeof import("./constants.js").CONTRACT_ID_FORMAT;
type FrontmatterDocTypes = typeof import("./constants.js").FRONTMATTER_DOC_TYPES;

export type EventKind = (typeof import("./constants.js").EVENT_KINDS)[number];
export type EventSource = (typeof import("./constants.js").EVENT_SOURCES)[number];
export type ExperimentPhase = (typeof import("./constants.js").EXPERIMENT_PHASES)[number];
export type SampleStream = (typeof import("./constants.js").SAMPLE_STREAMS)[number];
export type SampleSource = (typeof import("./constants.js").SAMPLE_SOURCES)[number];
export type SampleQuality = (typeof import("./constants.js").SAMPLE_QUALITIES)[number];
export type SleepStage = (typeof import("./constants.js").SLEEP_STAGES)[number];
export type AuditAction = (typeof import("./constants.js").AUDIT_ACTIONS)[number];
export type AuditActor = (typeof import("./constants.js").AUDIT_ACTORS)[number];
export type AuditStatus = (typeof import("./constants.js").AUDIT_STATUSES)[number];
export type FileChangeOperation = (typeof import("./constants.js").FILE_CHANGE_OPERATIONS)[number];
export type ExperimentStatus = (typeof import("./constants.js").EXPERIMENT_STATUSES)[number];
export type ErrorCodeValue = (typeof import("./constants.js").ERROR_CODE_VALUES)[number];

export interface ErrorCodeEntry {
  code: ErrorCodeValue;
  retryable: boolean;
  summary: string;
}

export interface VaultMetadata {
  schemaVersion: ContractSchemaVersion["vault"];
  vaultId: string;
  createdAt: string;
  title: string;
  timezone: string;
  idPolicy: {
    format: ContractIdFormat;
    prefixes: {
      audit: "aud";
      document: "doc";
      event: "evt";
      experiment: "exp";
      meal: "meal";
      pack: "pack";
      provider: "prov";
      sample: "smp";
      transform: "xfm";
      vault: "vault";
    };
  };
  paths: {
    coreDocument: "CORE.md";
    journalRoot: "journal";
    experimentsRoot: "bank/experiments";
    providersRoot: "bank/providers";
    rawRoot: "raw";
    eventsRoot: "ledger/events";
    samplesRoot: "ledger/samples";
    auditRoot: "audit";
    exportsRoot: "exports";
  };
  shards: {
    events: "ledger/events/YYYY/YYYY-MM.jsonl";
    samples: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl";
    audit: "audit/YYYY/YYYY-MM.jsonl";
  };
}

export interface EventRecordBase {
  schemaVersion: ContractSchemaVersion["event"];
  id: string;
  kind: EventKind;
  occurredAt: string;
  recordedAt: string;
  dayKey: string;
  source: EventSource;
  title: string;
  note?: string;
  tags?: string[];
  relatedIds?: string[];
  rawRefs?: string[];
}

export interface DocumentEventRecord extends EventRecordBase {
  kind: "document";
  documentId: string;
  documentPath: string;
  mimeType: string;
  providerId?: string;
}

export interface MealEventRecord extends EventRecordBase {
  kind: "meal";
  mealId: string;
  photoPaths: string[];
  audioPaths: string[];
}

export interface SymptomEventRecord extends EventRecordBase {
  kind: "symptom";
  symptom: string;
  intensity: number;
  bodySite?: string;
}

export interface NoteEventRecord extends EventRecordBase {
  kind: "note";
  note: string;
}

export interface ObservationEventRecord extends EventRecordBase {
  kind: "observation";
  metric: string;
  value: number;
  unit: string;
}

export interface ExperimentEventRecord extends EventRecordBase {
  kind: "experiment_event";
  experimentId: string;
  experimentSlug: string;
  phase: ExperimentPhase;
}

export interface MedicationIntakeEventRecord extends EventRecordBase {
  kind: "medication_intake";
  medicationName: string;
  dose: number;
  unit: string;
}

export interface SupplementIntakeEventRecord extends EventRecordBase {
  kind: "supplement_intake";
  supplementName: string;
  dose: number;
  unit: string;
}

export interface ActivitySessionEventRecord extends EventRecordBase {
  kind: "activity_session";
  activityType: string;
  durationMinutes: number;
  distanceKm?: number;
}

export interface SleepSessionEventRecord extends EventRecordBase {
  kind: "sleep_session";
  startAt: string;
  endAt: string;
  durationMinutes: number;
}

export type EventRecord =
  | DocumentEventRecord
  | MealEventRecord
  | SymptomEventRecord
  | NoteEventRecord
  | ObservationEventRecord
  | ExperimentEventRecord
  | MedicationIntakeEventRecord
  | SupplementIntakeEventRecord
  | ActivitySessionEventRecord
  | SleepSessionEventRecord;

export interface SampleRecordBase {
  schemaVersion: ContractSchemaVersion["sample"];
  id: string;
  stream: SampleStream;
  recordedAt: string;
  dayKey: string;
  source: SampleSource;
  quality: SampleQuality;
}

export interface HeartRateSampleRecord extends SampleRecordBase {
  stream: "heart_rate";
  value: number;
  unit: "bpm";
}

export interface HrvSampleRecord extends SampleRecordBase {
  stream: "hrv";
  value: number;
  unit: "ms";
}

export interface StepsSampleRecord extends SampleRecordBase {
  stream: "steps";
  value: number;
  unit: "count";
}

export interface SleepStageSampleRecord extends SampleRecordBase {
  stream: "sleep_stage";
  stage: SleepStage;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  unit: "stage";
}

export interface RespiratoryRateSampleRecord extends SampleRecordBase {
  stream: "respiratory_rate";
  value: number;
  unit: "breaths_per_minute";
}

export interface TemperatureSampleRecord extends SampleRecordBase {
  stream: "temperature";
  value: number;
  unit: "celsius";
}

export interface GlucoseSampleRecord extends SampleRecordBase {
  stream: "glucose";
  value: number;
  unit: "mg_dL";
}

export type SampleRecord =
  | HeartRateSampleRecord
  | HrvSampleRecord
  | StepsSampleRecord
  | SleepStageSampleRecord
  | RespiratoryRateSampleRecord
  | TemperatureSampleRecord
  | GlucoseSampleRecord;

export interface AuditRecord {
  schemaVersion: ContractSchemaVersion["audit"];
  id: string;
  action: AuditAction;
  status: AuditStatus;
  occurredAt: string;
  actor: AuditActor;
  commandName: string;
  summary: string;
  targetIds?: string[];
  errorCode?: ErrorCodeValue;
  changes: Array<{
    path: string;
    op: FileChangeOperation;
  }>;
}

export interface CoreFrontmatter {
  schemaVersion: ContractSchemaVersion["coreFrontmatter"];
  docType: FrontmatterDocTypes["core"];
  vaultId: string;
  title: string;
  timezone: string;
  updatedAt: string;
  activeExperimentSlugs?: string[];
}

export interface JournalDayFrontmatter {
  schemaVersion: ContractSchemaVersion["journalDayFrontmatter"];
  docType: FrontmatterDocTypes["journalDay"];
  dayKey: string;
  eventIds: string[];
  sampleStreams: SampleStream[];
}

export interface ExperimentFrontmatter {
  schemaVersion: ContractSchemaVersion["experimentFrontmatter"];
  docType: FrontmatterDocTypes["experiment"];
  experimentId: string;
  slug: string;
  status: ExperimentStatus;
  title: string;
  startedOn: string;
  endedOn?: string;
  hypothesis?: string;
  tags?: string[];
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonSchemaTypeName = "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";

export interface JsonSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  const?: JsonValue;
  enum?: readonly JsonValue[];
  type?: JsonSchemaTypeName | readonly JsonSchemaTypeName[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: readonly JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}
