export const VAULT_SCHEMA_VERSION = "hb.vault.v1";

export const FRONTMATTER_SCHEMA_VERSIONS = Object.freeze({
  allergy: "hb.frontmatter.allergy.v1",
  condition: "hb.frontmatter.condition.v1",
  core: "hb.frontmatter.core.v1",
  experiment: "hb.frontmatter.experiment.v1",
  familyMember: "hb.frontmatter.family-member.v1",
  geneticVariant: "hb.frontmatter.genetic-variant.v1",
  goal: "hb.frontmatter.goal.v1",
  journalDay: "hb.frontmatter.journal-day.v1",
  profileCurrent: "hb.frontmatter.profile-current.v1",
  regimen: "hb.frontmatter.regimen.v1",
});

export const ASSESSMENT_RESPONSE_SCHEMA_VERSION = "hb.assessment-response.v1";
export const EVENT_SCHEMA_VERSION = "hb.event.v1";
export const PROFILE_SNAPSHOT_SCHEMA_VERSION = "hb.profile-snapshot.v1";
export const SAMPLE_SCHEMA_VERSION = "hb.sample.v1";
export const AUDIT_SCHEMA_VERSION = "hb.audit.v1";

export const DEFAULT_TIMEZONE = "America/New_York";

export const ID_PREFIXES = Object.freeze({
  allergy: "alg",
  assessment: "asmt",
  audit: "aud",
  condition: "cond",
  document: "doc",
  event: "evt",
  experiment: "exp",
  family: "fam",
  goal: "goal",
  meal: "meal",
  pack: "pack",
  profileSnapshot: "psnap",
  provider: "prov",
  regimen: "reg",
  sample: "smp",
  transform: "xfm",
  variant: "var",
  vault: "vault",
});

export const VAULT_LAYOUT = Object.freeze({
  metadata: "vault.json",
  coreDocument: "CORE.md",
  journalDirectory: "journal",
  allergiesDirectory: "bank/allergies",
  conditionsDirectory: "bank/conditions",
  experimentsDirectory: "bank/experiments",
  familyDirectory: "bank/family",
  geneticsDirectory: "bank/genetics",
  goalsDirectory: "bank/goals",
  profileDirectory: "bank/profile",
  profileCurrentDocument: "bank/profile/current.md",
  providersDirectory: "bank/providers",
  regimensDirectory: "bank/regimens",
  rawDirectory: "raw",
  rawAssessmentsDirectory: "raw/assessments",
  rawDocumentsDirectory: "raw/documents",
  rawMealsDirectory: "raw/meals",
  rawSamplesDirectory: "raw/samples",
  assessmentLedgerDirectory: "ledger/assessments",
  eventLedgerDirectory: "ledger/events",
  profileSnapshotsDirectory: "ledger/profile-snapshots",
  sampleLedgerDirectory: "ledger/samples",
  auditDirectory: "audit",
  exportsDirectory: "exports",
  exportPacksDirectory: "exports/packs",
});

export const VAULT_PATHS = Object.freeze({
  allergiesRoot: VAULT_LAYOUT.allergiesDirectory,
  assessmentLedgerRoot: VAULT_LAYOUT.assessmentLedgerDirectory,
  conditionsRoot: VAULT_LAYOUT.conditionsDirectory,
  coreDocument: VAULT_LAYOUT.coreDocument,
  familyRoot: VAULT_LAYOUT.familyDirectory,
  geneticsRoot: VAULT_LAYOUT.geneticsDirectory,
  goalsRoot: VAULT_LAYOUT.goalsDirectory,
  journalRoot: VAULT_LAYOUT.journalDirectory,
  experimentsRoot: VAULT_LAYOUT.experimentsDirectory,
  profileCurrentDocument: VAULT_LAYOUT.profileCurrentDocument,
  profileRoot: VAULT_LAYOUT.profileDirectory,
  profileSnapshotsRoot: VAULT_LAYOUT.profileSnapshotsDirectory,
  providersRoot: VAULT_LAYOUT.providersDirectory,
  rawAssessmentsRoot: VAULT_LAYOUT.rawAssessmentsDirectory,
  rawRoot: VAULT_LAYOUT.rawDirectory,
  eventsRoot: VAULT_LAYOUT.eventLedgerDirectory,
  regimensRoot: VAULT_LAYOUT.regimensDirectory,
  samplesRoot: VAULT_LAYOUT.sampleLedgerDirectory,
  auditRoot: VAULT_LAYOUT.auditDirectory,
  exportsRoot: VAULT_LAYOUT.exportsDirectory,
});

export const VAULT_SHARDS = Object.freeze({
  assessments: "ledger/assessments/YYYY/YYYY-MM.jsonl",
  events: "ledger/events/YYYY/YYYY-MM.jsonl",
  profileSnapshots: "ledger/profile-snapshots/YYYY/YYYY-MM.jsonl",
  samples: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl",
  audit: "audit/YYYY/YYYY-MM.jsonl",
});

export const REQUIRED_DIRECTORIES = Object.freeze([
  VAULT_LAYOUT.journalDirectory,
  "bank",
  VAULT_LAYOUT.allergiesDirectory,
  VAULT_LAYOUT.conditionsDirectory,
  VAULT_LAYOUT.experimentsDirectory,
  VAULT_LAYOUT.familyDirectory,
  VAULT_LAYOUT.geneticsDirectory,
  VAULT_LAYOUT.goalsDirectory,
  VAULT_LAYOUT.profileDirectory,
  VAULT_LAYOUT.providersDirectory,
  VAULT_LAYOUT.regimensDirectory,
  "ledger",
  VAULT_LAYOUT.assessmentLedgerDirectory,
  VAULT_LAYOUT.eventLedgerDirectory,
  VAULT_LAYOUT.profileSnapshotsDirectory,
  VAULT_LAYOUT.sampleLedgerDirectory,
  VAULT_LAYOUT.rawDirectory,
  VAULT_LAYOUT.rawAssessmentsDirectory,
  VAULT_LAYOUT.rawDocumentsDirectory,
  VAULT_LAYOUT.rawMealsDirectory,
  VAULT_LAYOUT.rawSamplesDirectory,
  VAULT_LAYOUT.auditDirectory,
  VAULT_LAYOUT.exportsDirectory,
  VAULT_LAYOUT.exportPacksDirectory,
]);

export const BASELINE_EVENT_KINDS = Object.freeze([
  "adverse_effect",
  "document",
  "encounter",
  "exposure",
  "meal",
  "symptom",
  "note",
  "observation",
  "experiment_event",
  "medication_intake",
  "procedure",
  "supplement_intake",
  "test",
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
