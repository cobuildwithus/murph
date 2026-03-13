export const VAULT_SCHEMA_VERSION = "hb.vault.v1";

export const FRONTMATTER_SCHEMA_VERSIONS = Object.freeze({
  core: "hb.frontmatter.core.v1",
  experiment: "hb.frontmatter.experiment.v1",
  journalDay: "hb.frontmatter.journal-day.v1",
});

export const EVENT_SCHEMA_VERSION = "hb.event.v1";
export const SAMPLE_SCHEMA_VERSION = "hb.sample.v1";
export const AUDIT_SCHEMA_VERSION = "hb.audit.v1";

export const DEFAULT_TIMEZONE = "America/New_York";

export const ID_PREFIXES = Object.freeze({
  audit: "aud",
  document: "doc",
  event: "evt",
  experiment: "exp",
  meal: "meal",
  pack: "pack",
  provider: "prov",
  sample: "smp",
  transform: "xfm",
  vault: "vault",
});

export const VAULT_LAYOUT = Object.freeze({
  metadata: "vault.json",
  coreDocument: "CORE.md",
  journalDirectory: "journal",
  experimentsDirectory: "bank/experiments",
  providersDirectory: "bank/providers",
  rawDirectory: "raw",
  rawDocumentsDirectory: "raw/documents",
  rawMealsDirectory: "raw/meals",
  rawSamplesDirectory: "raw/samples",
  eventLedgerDirectory: "ledger/events",
  sampleLedgerDirectory: "ledger/samples",
  auditDirectory: "audit",
  exportsDirectory: "exports",
  exportPacksDirectory: "exports/packs",
});

export const VAULT_PATHS = Object.freeze({
  coreDocument: VAULT_LAYOUT.coreDocument,
  journalRoot: VAULT_LAYOUT.journalDirectory,
  experimentsRoot: VAULT_LAYOUT.experimentsDirectory,
  providersRoot: VAULT_LAYOUT.providersDirectory,
  rawRoot: VAULT_LAYOUT.rawDirectory,
  eventsRoot: VAULT_LAYOUT.eventLedgerDirectory,
  samplesRoot: VAULT_LAYOUT.sampleLedgerDirectory,
  auditRoot: VAULT_LAYOUT.auditDirectory,
  exportsRoot: VAULT_LAYOUT.exportsDirectory,
});

export const VAULT_SHARDS = Object.freeze({
  events: "ledger/events/YYYY/YYYY-MM.jsonl",
  samples: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl",
  audit: "audit/YYYY/YYYY-MM.jsonl",
});

export const REQUIRED_DIRECTORIES = Object.freeze([
  VAULT_LAYOUT.journalDirectory,
  "bank",
  VAULT_LAYOUT.experimentsDirectory,
  VAULT_LAYOUT.providersDirectory,
  "ledger",
  VAULT_LAYOUT.eventLedgerDirectory,
  VAULT_LAYOUT.sampleLedgerDirectory,
  VAULT_LAYOUT.rawDirectory,
  VAULT_LAYOUT.rawDocumentsDirectory,
  VAULT_LAYOUT.rawMealsDirectory,
  VAULT_LAYOUT.rawSamplesDirectory,
  VAULT_LAYOUT.auditDirectory,
  VAULT_LAYOUT.exportsDirectory,
  VAULT_LAYOUT.exportPacksDirectory,
]);

export const BASELINE_EVENT_KINDS = Object.freeze([
  "document",
  "meal",
  "symptom",
  "note",
  "observation",
  "experiment_event",
  "medication_intake",
  "supplement_intake",
  "activity_session",
  "sleep_session",
]);

export const EVENT_SOURCES = Object.freeze([
  "manual",
  "import",
  "device",
  "derived",
]);

export const BASELINE_SAMPLE_STREAMS = Object.freeze([
  "heart_rate",
  "hrv",
  "steps",
  "sleep_stage",
  "respiratory_rate",
  "temperature",
  "glucose",
]);

export const SAMPLE_SOURCES = Object.freeze([
  "device",
  "import",
  "manual",
  "derived",
]);

export const SAMPLE_QUALITIES = Object.freeze([
  "raw",
  "normalized",
  "derived",
]);

export const EXPERIMENT_STATUSES = Object.freeze([
  "planned",
  "active",
  "paused",
  "completed",
  "abandoned",
]);

export const AUDIT_ACTORS = Object.freeze(["cli", "core", "importer", "query"]);
export const AUDIT_STATUSES = Object.freeze(["success", "failure"]);

export const FILE_CHANGE_OPERATIONS = Object.freeze([
  "create",
  "append",
  "update",
  "copy",
]);
