export const CONTRACT_SCHEMA_VERSION = Object.freeze({
  audit: "hb.audit.v1",
  event: "hb.event.v1",
  experimentFrontmatter: "hb.frontmatter.experiment.v1",
  journalDayFrontmatter: "hb.frontmatter.journal-day.v1",
  coreFrontmatter: "hb.frontmatter.core.v1",
  sample: "hb.sample.v1",
  vault: "hb.vault.v1",
} as const);

export const CONTRACT_ID_FORMAT = "prefix_ulid" as const;

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
} as const);

export const EVENT_KINDS = Object.freeze([
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

export const AUDIT_ACTIONS = Object.freeze([
  "vault_init",
  "document_import",
  "meal_add",
  "samples_import_csv",
  "experiment_create",
  "journal_ensure",
  "validate",
  "show",
  "list",
  "export_pack",
] as const);

export const AUDIT_ACTORS = Object.freeze(["cli", "core", "importer", "query"] as const);

export const AUDIT_STATUSES = Object.freeze(["success", "failure"] as const);

export const FILE_CHANGE_OPERATIONS = Object.freeze(["create", "append", "update", "copy"] as const);

export const FRONTMATTER_DOC_TYPES = Object.freeze({
  core: "core",
  experiment: "experiment",
  journalDay: "journal_day",
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
