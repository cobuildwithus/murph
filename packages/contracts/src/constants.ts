export const CONTRACT_SCHEMA_VERSION = Object.freeze({
  assessmentResponse: "murph.assessment-response.v1",
  audit: "murph.audit.v1",
  automationFrontmatter: "murph.frontmatter.automation.v1",
  event: "murph.event.v1",
  inboxCapture: "murph.inbox-capture.v1",
  allergyFrontmatter: "murph.frontmatter.allergy.v1",
  conditionFrontmatter: "murph.frontmatter.condition.v1",
  experimentFrontmatter: "murph.frontmatter.experiment.v1",
  foodFrontmatter: "murph.frontmatter.food.v1",
  familyMemberFrontmatter: "murph.frontmatter.family-member.v1",
  geneticVariantFrontmatter: "murph.frontmatter.genetic-variant.v1",
  goalFrontmatter: "murph.frontmatter.goal.v1",
  journalDayFrontmatter: "murph.frontmatter.journal-day.v1",
  memoryFrontmatter: "murph.frontmatter.memory.v1",
  coreFrontmatter: "murph.frontmatter.core.v1",
  profileCurrentFrontmatter: "murph.frontmatter.profile-current.v1",
  profileSnapshot: "murph.profile-snapshot.v1",
  providerFrontmatter: "murph.frontmatter.provider.v1",
  recipeFrontmatter: "murph.frontmatter.recipe.v1",
  workoutFormatFrontmatter: "murph.frontmatter.workout-format.v1",
  rawImportManifest: "murph.raw-import-manifest.v1",
  protocolFrontmatter: "murph.frontmatter.protocol.v1",
  sample: "murph.sample.v1",
  sharePack: "murph.share-pack.v1",
  vault: "murph.vault.v1",
} as const);

export const CONTRACT_ID_FORMAT = "prefix_ulid" as const;

export const ID_PREFIXES = Object.freeze({
  allergy: "alg",
  assessment: "asmt",
  audit: "aud",
  automation: "automation",
  condition: "cond",
  document: "doc",
  event: "evt",
  experiment: "exp",
  family: "fam",
  food: "food",
  goal: "goal",
  meal: "meal",
  memory: "mem",
  pack: "pack",
  profileSnapshot: "psnap",
  provider: "prov",
  recipe: "rcp",
  protocol: "prot",
  sample: "smp",
  transform: "xfm",
  variant: "var",
  vault: "vault",
  workoutFormat: "wfmt",
} as const);

export const EVENT_KINDS = Object.freeze([
  "adverse_effect",
  "body_measurement",
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
  "intervention_session",
] as const);

export const HEALTH_HISTORY_EVENT_KINDS = Object.freeze([
  "encounter",
  "procedure",
  "test",
  "adverse_effect",
  "exposure",
] as const);

export type HealthHistoryEventKind = (typeof HEALTH_HISTORY_EVENT_KINDS)[number];

export const EVENT_SOURCES = Object.freeze(["manual", "import", "device", "derived"] as const);

export const EXPERIMENT_PHASES = Object.freeze(["start", "checkpoint", "stop"] as const);

export const SAMPLE_STREAMS = Object.freeze([
  "heart_rate",
  "hrv",
  "steps",
  "sleep_stage",
  "respiratory_rate",
  "temperature",
  "glucose",
] as const);

export const SAMPLE_SOURCES = Object.freeze(["device", "import", "manual", "derived"] as const);

export const SAMPLE_QUALITIES = Object.freeze(["raw", "normalized", "derived"] as const);

export const SLEEP_STAGES = Object.freeze(["awake", "light", "deep", "rem"] as const);

export const ASSESSMENT_SOURCES = Object.freeze(["import", "manual", "derived"] as const);

export const RAW_IMPORT_KINDS = Object.freeze([
  "assessment",
  "device_batch",
  "document",
  "measurement_batch",
  "meal",
  "sample_batch",
  "workout_batch",
] as const);

export const PROFILE_SNAPSHOT_SOURCES = Object.freeze(["assessment_projection", "manual", "derived"] as const);

export const GOAL_STATUSES = Object.freeze(["active", "paused", "completed", "abandoned"] as const);

export const GOAL_HORIZONS = Object.freeze(["short_term", "medium_term", "long_term", "ongoing"] as const);

export const CONDITION_CLINICAL_STATUSES = Object.freeze(["active", "inactive", "resolved"] as const);

export const CONDITION_VERIFICATION_STATUSES = Object.freeze(
  ["unconfirmed", "provisional", "confirmed", "refuted"] as const,
);

export const CONDITION_SEVERITIES = Object.freeze(["mild", "moderate", "severe"] as const);

export const ALLERGY_STATUSES = Object.freeze(["active", "inactive", "resolved"] as const);

export const ALLERGY_CRITICALITIES = Object.freeze(["low", "high", "unable_to_assess"] as const);

export const PROTOCOL_KINDS = Object.freeze(["medication", "supplement", "therapy", "habit"] as const);

export const PROTOCOL_STATUSES = Object.freeze(["active", "paused", "completed", "stopped"] as const);

export const FOOD_STATUSES = Object.freeze(["active", "archived"] as const);
export const WORKOUT_FORMAT_STATUSES = Object.freeze(["active", "archived"] as const);

export const RECIPE_STATUSES = Object.freeze(["draft", "saved", "archived"] as const);

export const TEST_RESULT_STATUSES = Object.freeze(["pending", "normal", "abnormal", "mixed", "unknown"] as const);
export const BLOOD_TEST_CATEGORY = "blood" as const;
export const BLOOD_TEST_FASTING_STATUSES = Object.freeze(["fasting", "non_fasting", "unknown"] as const);
export const BLOOD_TEST_RESULT_FLAGS = Object.freeze(["low", "normal", "high", "abnormal", "critical", "unknown"] as const);
export const BLOOD_TEST_SPECIMEN_TYPES = Object.freeze(["blood", "whole_blood", "serum", "plasma", "dried_blood_spot"] as const);

export const ADVERSE_EFFECT_SEVERITIES = Object.freeze(["mild", "moderate", "severe"] as const);

export const VARIANT_ZYGOSITIES = Object.freeze(
  ["heterozygous", "homozygous", "compound_heterozygous", "unknown"] as const,
);

export const VARIANT_SIGNIFICANCES = Object.freeze(
  ["pathogenic", "likely_pathogenic", "risk_factor", "vus", "benign", "unknown"] as const,
);

export const AUDIT_ACTIONS = Object.freeze([
  "allergy_upsert",
  "condition_upsert",
  "family_upsert",
  "genetics_upsert",
  "goal_upsert",
  "history_add",
  "intake_import",
  "intake_project",
  "vault_init",
  "vault_repair",
  "document_import",
  "device_import",
  "experiment_create",
  "journal_ensure",
  "list",
  "meal_add",
  "export_pack",
  "food_upsert",
  "provider_upsert",
  "profile_current_rebuild",
  "profile_snapshot_add",
  "recipe_upsert",
  "protocol_stop",
  "protocol_upsert",
  "samples_import_csv",
  "show",
  "validate",
  "workout_format_save",
  "workout_import_csv",
] as const);

export const AUDIT_ACTORS = Object.freeze(["cli", "core", "importer", "query"] as const);

export const AUDIT_STATUSES = Object.freeze(["success", "failure"] as const);

export const FILE_CHANGE_OPERATIONS = Object.freeze(["create", "append", "update", "copy"] as const);

export const FRONTMATTER_DOC_TYPES = Object.freeze({
  allergy: "allergy",
  automation: "automation",
  core: "core",
  condition: "condition",
  experiment: "experiment",
  food: "food",
  familyMember: "family_member",
  geneticVariant: "genetic_variant",
  goal: "goal",
  journalDay: "journal_day",
  memory: "memory",
  profileCurrent: "profile_current",
  provider: "provider",
  recipe: "recipe",
  protocol: "protocol",
  workoutFormat: "workout_format",
} as const);

export const EXPERIMENT_STATUSES = Object.freeze([
  "planned",
  "active",
  "paused",
  "completed",
  "abandoned",
] as const);

export const ERROR_CODES = Object.freeze([
  {
    code: "CONTRACT_INVALID",
    retryable: false,
    summary: "A payload failed the frozen contract shape.",
  },
  {
    code: "ID_INVALID",
    retryable: false,
    summary: "An identifier did not match the frozen prefix plus ULID policy.",
  },
  {
    code: "PATH_INVALID",
    retryable: false,
    summary: "A stored path was absolute, escaped the vault root, or missed its path family.",
  },
  {
    code: "VAULT_INVALID",
    retryable: false,
    summary: "The vault metadata contract failed validation.",
  },
  {
    code: "EVENT_INVALID",
    retryable: false,
    summary: "An event record failed validation.",
  },
  {
    code: "SAMPLE_INVALID",
    retryable: false,
    summary: "A sample record failed validation.",
  },
  {
    code: "AUDIT_INVALID",
    retryable: false,
    summary: "An audit record failed validation.",
  },
  {
    code: "FRONTMATTER_INVALID",
    retryable: false,
    summary: "A Markdown frontmatter block failed validation.",
  },
  {
    code: "ENUM_UNSUPPORTED",
    retryable: false,
    summary: "A value was outside the frozen baseline enums.",
  },
  {
    code: "SHARD_KEY_INVALID",
    retryable: false,
    summary: "A monthly shard key or day key failed the required format.",
  },
  {
    code: "SCHEMA_ARTIFACT_STALE",
    retryable: false,
    summary: "Generated JSON Schema artifacts are missing or do not match source contracts.",
  },
] as const);

export const ERROR_CODE_VALUES = Object.freeze(
  ERROR_CODES.map((entry) => entry.code),
) as readonly (typeof ERROR_CODES)[number]["code"][];
