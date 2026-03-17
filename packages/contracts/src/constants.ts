export const CONTRACT_SCHEMA_VERSION = Object.freeze({
  assessmentResponse: "hb.assessment-response.v1",
  audit: "hb.audit.v1",
  event: "hb.event.v1",
  allergyFrontmatter: "hb.frontmatter.allergy.v1",
  conditionFrontmatter: "hb.frontmatter.condition.v1",
  experimentFrontmatter: "hb.frontmatter.experiment.v1",
  familyMemberFrontmatter: "hb.frontmatter.family-member.v1",
  geneticVariantFrontmatter: "hb.frontmatter.genetic-variant.v1",
  goalFrontmatter: "hb.frontmatter.goal.v1",
  journalDayFrontmatter: "hb.frontmatter.journal-day.v1",
  coreFrontmatter: "hb.frontmatter.core.v1",
  profileCurrentFrontmatter: "hb.frontmatter.profile-current.v1",
  profileSnapshot: "hb.profile-snapshot.v1",
  providerFrontmatter: "hb.frontmatter.provider.v1",
  rawImportManifest: "hb.raw-import-manifest.v1",
  regimenFrontmatter: "hb.frontmatter.regimen.v1",
  sample: "hb.sample.v1",
  vault: "hb.vault.v1",
} as const);

export const CONTRACT_ID_FORMAT = "prefix_ulid" as const;

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
} as const);

export const EVENT_KINDS = Object.freeze([
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
] as const);

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
  "meal",
  "sample_batch",
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

export const REGIMEN_KINDS = Object.freeze(["medication", "supplement", "therapy", "habit"] as const);

export const REGIMEN_STATUSES = Object.freeze(["active", "paused", "completed", "stopped"] as const);

export const TEST_RESULT_STATUSES = Object.freeze(["pending", "normal", "abnormal", "mixed", "unknown"] as const);

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
  "document_import",
  "device_import",
  "experiment_create",
  "journal_ensure",
  "list",
  "meal_add",
  "export_pack",
  "profile_current_rebuild",
  "profile_snapshot_add",
  "regimen_stop",
  "regimen_upsert",
  "samples_import_csv",
  "show",
  "validate",
] as const);

export const AUDIT_ACTORS = Object.freeze(["cli", "core", "importer", "query"] as const);

export const AUDIT_STATUSES = Object.freeze(["success", "failure"] as const);

export const FILE_CHANGE_OPERATIONS = Object.freeze(["create", "append", "update", "copy"] as const);

export const FRONTMATTER_DOC_TYPES = Object.freeze({
  allergy: "allergy",
  core: "core",
  condition: "condition",
  experiment: "experiment",
  familyMember: "family_member",
  geneticVariant: "genetic_variant",
  goal: "goal",
  journalDay: "journal_day",
  profileCurrent: "profile_current",
  provider: "provider",
  regimen: "regimen",
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
    code: "HB_CONTRACT_INVALID",
    retryable: false,
    summary: "A payload failed the frozen contract shape.",
  },
  {
    code: "HB_ID_INVALID",
    retryable: false,
    summary: "An identifier did not match the frozen prefix plus ULID policy.",
  },
  {
    code: "HB_PATH_INVALID",
    retryable: false,
    summary: "A stored path was absolute, escaped the vault root, or missed its path family.",
  },
  {
    code: "HB_VAULT_INVALID",
    retryable: false,
    summary: "The vault metadata contract failed validation.",
  },
  {
    code: "HB_EVENT_INVALID",
    retryable: false,
    summary: "An event record failed validation.",
  },
  {
    code: "HB_SAMPLE_INVALID",
    retryable: false,
    summary: "A sample record failed validation.",
  },
  {
    code: "HB_AUDIT_INVALID",
    retryable: false,
    summary: "An audit record failed validation.",
  },
  {
    code: "HB_FRONTMATTER_INVALID",
    retryable: false,
    summary: "A Markdown frontmatter block failed validation.",
  },
  {
    code: "HB_ENUM_UNSUPPORTED",
    retryable: false,
    summary: "A value was outside the frozen baseline enums.",
  },
  {
    code: "HB_SHARD_KEY_INVALID",
    retryable: false,
    summary: "A monthly shard key or day key failed the required format.",
  },
  {
    code: "HB_SCHEMA_ARTIFACT_STALE",
    retryable: false,
    summary: "Generated JSON Schema artifacts are missing or do not match source contracts.",
  },
] as const);

export const ERROR_CODE_VALUES = Object.freeze(
  ERROR_CODES.map((entry) => entry.code),
) as readonly (typeof ERROR_CODES)[number]["code"][];
