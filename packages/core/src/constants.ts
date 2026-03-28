import {
  AUDIT_ACTORS as CONTRACT_AUDIT_ACTORS,
  AUDIT_STATUSES as CONTRACT_AUDIT_STATUSES,
  CONTRACT_SCHEMA_VERSION,
  EVENT_KINDS as CONTRACT_EVENT_KINDS,
  EVENT_SOURCES as CONTRACT_EVENT_SOURCES,
  EXPERIMENT_STATUSES as CONTRACT_EXPERIMENT_STATUSES,
  FILE_CHANGE_OPERATIONS as CONTRACT_FILE_CHANGE_OPERATIONS,
  ID_PREFIXES as CONTRACT_ID_PREFIXES,
  SAMPLE_QUALITIES as CONTRACT_SAMPLE_QUALITIES,
  SAMPLE_SOURCES as CONTRACT_SAMPLE_SOURCES,
  SAMPLE_STREAMS as CONTRACT_SAMPLE_STREAMS,
} from "@murph/contracts";

export const VAULT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.vault;

export const FRONTMATTER_SCHEMA_VERSIONS = Object.freeze({
  allergy: CONTRACT_SCHEMA_VERSION.allergyFrontmatter,
  condition: CONTRACT_SCHEMA_VERSION.conditionFrontmatter,
  core: CONTRACT_SCHEMA_VERSION.coreFrontmatter,
  experiment: CONTRACT_SCHEMA_VERSION.experimentFrontmatter,
  familyMember: CONTRACT_SCHEMA_VERSION.familyMemberFrontmatter,
  food: CONTRACT_SCHEMA_VERSION.foodFrontmatter,
  geneticVariant: CONTRACT_SCHEMA_VERSION.geneticVariantFrontmatter,
  goal: CONTRACT_SCHEMA_VERSION.goalFrontmatter,
  journalDay: CONTRACT_SCHEMA_VERSION.journalDayFrontmatter,
  profileCurrent: CONTRACT_SCHEMA_VERSION.profileCurrentFrontmatter,
  recipe: CONTRACT_SCHEMA_VERSION.recipeFrontmatter,
  protocol: CONTRACT_SCHEMA_VERSION.protocolFrontmatter,
  workoutFormat: CONTRACT_SCHEMA_VERSION.workoutFormatFrontmatter,
});

export const ASSESSMENT_RESPONSE_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.assessmentResponse;
export const EVENT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.event;
export const PROFILE_SNAPSHOT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.profileSnapshot;
export const SAMPLE_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.sample;
export const AUDIT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.audit;

export const DEFAULT_TIMEZONE = "UTC";

export const ID_PREFIXES = CONTRACT_ID_PREFIXES;

export const VAULT_LAYOUT = Object.freeze({
  metadata: "vault.json",
  coreDocument: "CORE.md",
  journalDirectory: "journal",
  allergiesDirectory: "bank/allergies",
  conditionsDirectory: "bank/conditions",
  experimentsDirectory: "bank/experiments",
  familyDirectory: "bank/family",
  foodsDirectory: "bank/foods",
  geneticsDirectory: "bank/genetics",
  goalsDirectory: "bank/goals",
  profileDirectory: "bank/profile",
  profileCurrentDocument: "bank/profile/current.md",
  providersDirectory: "bank/providers",
  recipesDirectory: "bank/recipes",
  workoutFormatsDirectory: "bank/workout-formats",
  protocolsDirectory: "bank/protocols",
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
  foodsRoot: VAULT_LAYOUT.foodsDirectory,
  geneticsRoot: VAULT_LAYOUT.geneticsDirectory,
  goalsRoot: VAULT_LAYOUT.goalsDirectory,
  journalRoot: VAULT_LAYOUT.journalDirectory,
  experimentsRoot: VAULT_LAYOUT.experimentsDirectory,
  profileCurrentDocument: VAULT_LAYOUT.profileCurrentDocument,
  profileRoot: VAULT_LAYOUT.profileDirectory,
  profileSnapshotsRoot: VAULT_LAYOUT.profileSnapshotsDirectory,
  providersRoot: VAULT_LAYOUT.providersDirectory,
  recipesRoot: VAULT_LAYOUT.recipesDirectory,
  workoutFormatsRoot: VAULT_LAYOUT.workoutFormatsDirectory,
  rawAssessmentsRoot: VAULT_LAYOUT.rawAssessmentsDirectory,
  rawRoot: VAULT_LAYOUT.rawDirectory,
  eventsRoot: VAULT_LAYOUT.eventLedgerDirectory,
  protocolsRoot: VAULT_LAYOUT.protocolsDirectory,
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
  VAULT_LAYOUT.foodsDirectory,
  VAULT_LAYOUT.geneticsDirectory,
  VAULT_LAYOUT.goalsDirectory,
  VAULT_LAYOUT.profileDirectory,
  VAULT_LAYOUT.providersDirectory,
  VAULT_LAYOUT.recipesDirectory,
  VAULT_LAYOUT.workoutFormatsDirectory,
  VAULT_LAYOUT.protocolsDirectory,
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

export const BASELINE_EVENT_KINDS = CONTRACT_EVENT_KINDS;

export const EVENT_SOURCES = CONTRACT_EVENT_SOURCES;

export const BASELINE_SAMPLE_STREAMS = CONTRACT_SAMPLE_STREAMS;

export const SAMPLE_SOURCES = CONTRACT_SAMPLE_SOURCES;

export const SAMPLE_QUALITIES = CONTRACT_SAMPLE_QUALITIES;

export const EXPERIMENT_STATUSES = CONTRACT_EXPERIMENT_STATUSES;

export const AUDIT_ACTORS = CONTRACT_AUDIT_ACTORS;
export const AUDIT_STATUSES = CONTRACT_AUDIT_STATUSES;

export const FILE_CHANGE_OPERATIONS = CONTRACT_FILE_CHANGE_OPERATIONS;
