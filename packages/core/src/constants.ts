import {
  AUDIT_ACTORS as CONTRACT_AUDIT_ACTORS,
  AUDIT_STATUSES as CONTRACT_AUDIT_STATUSES,
  CONTRACT_SCHEMA_VERSION,
  CURRENT_VAULT_FORMAT_VERSION as CONTRACT_CURRENT_VAULT_FORMAT_VERSION,
  EVENT_KINDS as CONTRACT_EVENT_KINDS,
  EVENT_SOURCES as CONTRACT_EVENT_SOURCES,
  EXPERIMENT_STATUSES as CONTRACT_EXPERIMENT_STATUSES,
  FILE_CHANGE_OPERATIONS as CONTRACT_FILE_CHANGE_OPERATIONS,
  ID_PREFIXES as CONTRACT_ID_PREFIXES,
  REQUIRED_VAULT_DIRECTORIES as CONTRACT_REQUIRED_VAULT_DIRECTORIES,
  SAMPLE_QUALITIES as CONTRACT_SAMPLE_QUALITIES,
  SAMPLE_SOURCES as CONTRACT_SAMPLE_SOURCES,
  SAMPLE_STREAMS as CONTRACT_SAMPLE_STREAMS,
  VAULT_LAYOUT as CONTRACT_VAULT_LAYOUT,
  VAULT_SHARDS as CONTRACT_VAULT_SHARDS,
} from "@murphai/contracts";

export const VAULT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.vault;
export const CURRENT_VAULT_FORMAT_VERSION = CONTRACT_CURRENT_VAULT_FORMAT_VERSION;

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
  recipe: CONTRACT_SCHEMA_VERSION.recipeFrontmatter,
  protocol: CONTRACT_SCHEMA_VERSION.protocolFrontmatter,
  workoutFormat: CONTRACT_SCHEMA_VERSION.workoutFormatFrontmatter,
});

export const ASSESSMENT_RESPONSE_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.assessmentResponse;
export const EVENT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.event;
export const SAMPLE_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.sample;
export const AUDIT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.audit;

export const DEFAULT_TIMEZONE = "UTC";

export const ID_PREFIXES = CONTRACT_ID_PREFIXES;

export const VAULT_LAYOUT = CONTRACT_VAULT_LAYOUT;

export const VAULT_PATHS = Object.freeze({
  allergiesRoot: VAULT_LAYOUT.allergiesDirectory,
  assessmentLedgerRoot: VAULT_LAYOUT.assessmentLedgerDirectory,
  automationsRoot: VAULT_LAYOUT.automationsDirectory,
  conditionsRoot: VAULT_LAYOUT.conditionsDirectory,
  coreDocument: VAULT_LAYOUT.coreDocument,
  eventsRoot: VAULT_LAYOUT.eventLedgerDirectory,
  experimentsRoot: VAULT_LAYOUT.experimentsDirectory,
  exportsRoot: VAULT_LAYOUT.exportsDirectory,
  familyRoot: VAULT_LAYOUT.familyDirectory,
  foodsRoot: VAULT_LAYOUT.foodsDirectory,
  geneticsRoot: VAULT_LAYOUT.geneticsDirectory,
  goalsRoot: VAULT_LAYOUT.goalsDirectory,
  inboxCaptureLedgerRoot: VAULT_LAYOUT.inboxCaptureLedgerDirectory,
  journalRoot: VAULT_LAYOUT.journalDirectory,
  memoryDocument: VAULT_LAYOUT.memoryDocument,
  protocolsRoot: VAULT_LAYOUT.protocolsDirectory,
  providersRoot: VAULT_LAYOUT.providersDirectory,
  rawAssessmentsRoot: VAULT_LAYOUT.rawAssessmentsDirectory,
  rawDocumentsRoot: VAULT_LAYOUT.rawDocumentsDirectory,
  rawInboxRoot: VAULT_LAYOUT.rawInboxDirectory,
  rawIntegrationsRoot: VAULT_LAYOUT.rawIntegrationsDirectory,
  rawMeasurementsRoot: VAULT_LAYOUT.rawMeasurementsDirectory,
  rawMealsRoot: VAULT_LAYOUT.rawMealsDirectory,
  rawRoot: VAULT_LAYOUT.rawDirectory,
  rawSamplesRoot: VAULT_LAYOUT.rawSamplesDirectory,
  rawWorkoutsRoot: VAULT_LAYOUT.rawWorkoutsDirectory,
  recipesRoot: VAULT_LAYOUT.recipesDirectory,
  samplesRoot: VAULT_LAYOUT.sampleLedgerDirectory,
  workoutFormatsRoot: VAULT_LAYOUT.workoutFormatsDirectory,
  auditRoot: VAULT_LAYOUT.auditDirectory,
});

export const VAULT_SHARDS = CONTRACT_VAULT_SHARDS;

export const REQUIRED_DIRECTORIES = CONTRACT_REQUIRED_VAULT_DIRECTORIES;

export const BASELINE_EVENT_KINDS = CONTRACT_EVENT_KINDS;

export const EVENT_SOURCES = CONTRACT_EVENT_SOURCES;

export const BASELINE_SAMPLE_STREAMS = CONTRACT_SAMPLE_STREAMS;

export const SAMPLE_SOURCES = CONTRACT_SAMPLE_SOURCES;

export const SAMPLE_QUALITIES = CONTRACT_SAMPLE_QUALITIES;

export const EXPERIMENT_STATUSES = CONTRACT_EXPERIMENT_STATUSES;

export const AUDIT_ACTORS = CONTRACT_AUDIT_ACTORS;
export const AUDIT_STATUSES = CONTRACT_AUDIT_STATUSES;

export const FILE_CHANGE_OPERATIONS = CONTRACT_FILE_CHANGE_OPERATIONS;
