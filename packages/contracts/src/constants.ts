export const CONTRACT_SCHEMA_VERSION = Object.freeze({
  assessmentResponse: "murph.assessment-response.v1",
  audit: "murph.audit.v1",
  automationFrontmatter: "murph.frontmatter.automation.v1",
  scheduledLogFrontmatter: "murph.frontmatter.scheduled-log.v1",
  event: "murph.event.v1",
  inboxCapture: "murph.inbox-capture.v2",
  inboxAttachmentRetention: "murph.inbox-attachment-retention.v1",
  allergyFrontmatter: "murph.frontmatter.allergy.v1",
  conditionFrontmatter: "murph.frontmatter.condition.v1",
  experimentFrontmatter: "murph.frontmatter.experiment.v1",
  foodFrontmatter: "murph.frontmatter.food.v1",
  familyMemberFrontmatter: "murph.frontmatter.family-member.v1",
  geneticVariantFrontmatter: "murph.frontmatter.genetic-variant.v1",
  goalFrontmatter: "murph.frontmatter.goal.v1",
  habitatFrontmatter: "murph.frontmatter.habitat.v1",
  journalDayFrontmatter: "murph.frontmatter.journal-day.v1",
  memoryFrontmatter: "murph.frontmatter.memory.v1",
  coreFrontmatter: "murph.frontmatter.core.v1",
  providerFrontmatter: "murph.frontmatter.provider.v1",
  recipeFrontmatter: "murph.frontmatter.recipe.v1",
  workoutFormatFrontmatter: "murph.frontmatter.workout-format.v1",
  rawImportManifest: "murph.raw-import-manifest.v1",
  integrationIngest: "murph.integration-ingest.v1",
  regimenFrontmatter: "murph.frontmatter.regimen.v1",
  protocolFrontmatter: "murph.frontmatter.protocol.v1",
  metricSample: "murph.metric-sample.v1",
  sample: "murph.sample.v1",
  vault: "murph.vault.v1",
} as const);

export const LEGACY_INBOX_CAPTURE_SCHEMA_VERSION = "murph.inbox-capture.v1" as const;

export const LEGACY_VAULT_FORMAT_VERSION = 1 as const;
export const CURRENT_VAULT_FORMAT_VERSION = 2 as const;

/**
 * Canonical production web origin for user-facing app links. Runtime env
 * overrides (hosted public base URLs, local dev origins) take precedence;
 * this is the fallback so production runners never emit link-less output.
 */
export const MURPH_PRODUCT_ORIGIN = "https://www.withmurph.ai" as const;

export const CONTRACT_ID_FORMAT = "prefix_ulid" as const;

export const ID_PREFIXES = Object.freeze({
  allergy: "alg",
  assessment: "asmt",
  audit: "aud",
  automation: "automation",
  scheduledLog: "slog",
  condition: "cond",
  document: "doc",
  event: "evt",
  experiment: "exp",
  family: "fam",
  food: "food",
  goal: "goal",
  habitat: "hab",
  meal: "meal",
  memory: "mem",
  pack: "pack",
  provider: "prov",
  regimen: "reg",
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
  "clinical_assertion",
  "document",
  "encounter",
  "exposure",
  "meal",
  "measurement",
  "symptom",
  "note",
  "observation",
  "experiment_event",
  "experiment_context",
  "immunization",
  "medication_intake",
  "procedure",
  "supplement_intake",
  "test",
  "activity_session",
  "sleep_session",
  "intervention_session",
] as const);

export const PUBLIC_EVENT_WRITE_KINDS = Object.freeze([
  "symptom",
  "note",
  "observation",
  "clinical_assertion",
  "exposure",
  "measurement",
  "test",
  "medication_intake",
  "supplement_intake",
  "activity_session",
  "body_measurement",
  "sleep_session",
  "intervention_session",
  "experiment_context",
] as const);

export const HEALTH_HISTORY_EVENT_KINDS = Object.freeze([
  "encounter",
  "immunization",
  "procedure",
  "test",
  "adverse_effect",
  "exposure",
  "clinical_assertion",
] as const);

export type HealthHistoryEventKind = (typeof HEALTH_HISTORY_EVENT_KINDS)[number];

export const EVENT_SOURCES = Object.freeze(["manual", "import", "device", "derived"] as const);

export const OBSERVATION_GRAINS = Object.freeze(["sample", "summary", "derived_fact"] as const);

export const HOSTED_MAILBOX_CAUSAL_SEQ_QUALIFIER = "hosted-mailbox-causal-seq";

export const EXPERIMENT_PHASES = Object.freeze(["start", "checkpoint", "stop"] as const);

export const SAMPLE_STREAMS = Object.freeze([
  "heart_rate",
  "spo2",
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
  "capture",
  "device_batch",
  "document",
  "measurement_batch",
  "meal",
  "sample_batch",
  "workout_batch",
] as const);

export const RAW_ASSET_OWNER_KINDS = Object.freeze([
  "assessment",
  "capture",
  "device_batch",
  "document",
  "meal",
  "measurement",
  "sample_batch",
  "workout",
  "workout_batch",
] as const);

export const GOAL_STATUSES = Object.freeze(["active", "paused", "completed", "abandoned"] as const);

export const GOAL_HORIZONS = Object.freeze(["short_term", "medium_term", "long_term", "ongoing"] as const);

export const CONDITION_CLINICAL_STATUSES = Object.freeze(["active", "inactive", "resolved"] as const);

export const CONDITION_VERIFICATION_STATUSES = Object.freeze(
  ["unconfirmed", "provisional", "confirmed", "refuted"] as const,
);

export const CONDITION_SEVERITIES = Object.freeze(["mild", "moderate", "severe"] as const);

export const ALLERGY_STATUSES = Object.freeze(["active", "inactive", "resolved"] as const);

export const ALLERGY_CRITICALITIES = Object.freeze(["low", "high", "unable_to_assess"] as const);

export const CLINICAL_ASSERTION_TYPES = Object.freeze([
  "absence_asserted",
  "denial_asserted",
  "negative_screening",
  "normality_asserted",
  "not_applicable",
  "not_pregnant",
  "no_known_conditions",
  "no_known_allergies",
  "no_known_drug_allergies",
  "no_known_food_allergies",
  "no_known_medications",
  "no_known_family_history",
] as const);

export const CLINICAL_ASSERTION_DOMAINS = Object.freeze([
  "allergy",
  "condition",
  "family",
  "medication",
  "pregnancy",
  "screening",
  "social",
  "symptom",
  "test",
  "exam",
  "other",
] as const);

export const CLINICAL_ASSERTION_POLARITIES = Object.freeze([
  "absent",
  "denied",
  "normal",
  "negative",
  "not_applicable",
] as const);

export const SOCIAL_HISTORY_CATEGORIES = Object.freeze([
  "tobacco",
  "alcohol",
  "recreational_substance",
  "occupation",
  "environmental_exposure",
  "living_situation",
  "diet",
  "exercise",
  "sexual_history",
  "safety",
  "other",
] as const);

export const SOCIAL_HISTORY_STATUSES = Object.freeze([
  "current",
  "former",
  "never",
  "denied",
  "unknown",
  "not_applicable",
] as const);

export const REGIMEN_KINDS = Object.freeze(["medication", "supplement", "therapy", "habit"] as const);

export const REGIMEN_STATUSES = Object.freeze(["active", "paused", "completed", "stopped"] as const);
export const SUPPLEMENT_INGREDIENTS_MAX_ITEMS = 64;

export const PROTOCOL_STATUSES = Object.freeze(["available", "archived"] as const);

export const FOOD_STATUSES = Object.freeze(["active", "archived"] as const);
export const WORKOUT_FORMAT_STATUSES = Object.freeze(["active", "archived"] as const);

export const RECIPE_STATUSES = Object.freeze(["draft", "saved", "archived"] as const);
export const NUTRITION_PROVENANCE_SOURCES = Object.freeze(
  ["user", "label", "database", "inherited", "estimated"] as const,
);
export const NUTRITION_CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"] as const);

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
  "automation_upsert",
  "scheduled_log_upsert",
  "condition_upsert",
  "family_upsert",
  "genetics_upsert",
  "goal_upsert",
  "habitat_upsert",
  "food_delete",
  "food_upsert",
  "history_add",
  "inbox_capture_canonical_evidence",
  "inbox_capture_persist",
  "inbox_promote_experiment_note",
  "inbox_promote_journal",
  "intake_import",
  "intake_project",
  "jsonl_append",
  "journal_append",
  "journal_ensure",
  "journal_link",
  "journal_unlink",
  "knowledge_write",
  "memory_forget",
  "memory_upsert",
  "document_import",
  "device_import",
  "experiment_create",
  "experiment_lifecycle",
  "experiment_update",
  "event_delete",
  "event_upsert",
  "list",
  "meal_add",
  "export_pack",
  "preferences_update",
  "profile_update",
  "provider_delete",
  "provider_upsert",
  "raw_copy",
  "recipe_delete",
  "recipe_upsert",
  "research_note_write",
  "regimen_stop",
  "regimen_upsert",
  "protocol_upsert",
  "samples_import_csv",
  "show",
  "validate",
  "vault_init",
  "vault_repair",
  "vault_summary_update",
  "workout_format_save",
  "workout_import_csv",
] as const);

export const AUDIT_ACTORS = Object.freeze(["cli", "core", "importer", "query"] as const);

export const AUDIT_STATUSES = Object.freeze(["success", "failure"] as const);

export const FILE_CHANGE_OPERATIONS = Object.freeze(["create", "append", "update", "copy", "delete"] as const);

export const FRONTMATTER_DOC_TYPES = Object.freeze({
  allergy: "allergy",
  automation: "automation",
  scheduledLog: "scheduled_log",
  core: "core",
  condition: "condition",
  experiment: "experiment",
  food: "food",
  familyMember: "family_member",
  geneticVariant: "genetic_variant",
  goal: "goal",
  habitat: "habitat",
  journalDay: "journal_day",
  memory: "memory",
  provider: "provider",
  regimen: "regimen",
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
