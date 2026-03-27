export const HOSTED_USER_ENV_SCHEMA = "murph.hosted-user-env.v1";
const LEGACY_HOSTED_USER_ENV_SCHEMA = "healthybob.hosted-user-env.v1";

const DEFAULT_ALLOWED_USER_ENV_KEYS = [
  "AGENTMAIL_API_KEY",
  "AGENTMAIL_BASE_URL",
  "ANTHROPIC_API_KEY",
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "DEVICE_SYNC_SECRET",
  "FFMPEG_COMMAND",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "LINQ_API_BASE_URL",
  "LINQ_API_TOKEN",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "PADDLEOCR_COMMAND",
  "PDFTOTEXT_COMMAND",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_FILE_BASE_URL",
  "TELEGRAM_WEBHOOK_SECRET",
  "TOGETHER_API_KEY",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "XAI_API_KEY",
] as const;

const DEFAULT_ALLOWED_USER_ENV_PREFIXES = [
  "AGENTMAIL_",
  "ANTHROPIC_",
  "DEVICE_SYNC_",
  "FFMPEG_",
  "GOOGLE_",
  "GOOGLE_GENERATIVE_AI_",
  "GROQ_",
  "HOSTED_USER_",
  "LINQ_",
  "MISTRAL_",
  "OPENAI_",
  "OPENROUTER_",
  "OURA_",
  "PADDLEOCR_",
  "PDFTOTEXT_",
  "TELEGRAM_",
  "TOGETHER_",
  "WHISPER_",
  "WHOOP_",
  "XAI_",
] as const;

const DISALLOWED_USER_ENV_KEYS = new Set([
  "HOME",
  "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
  "HOSTED_EXECUTION_SIGNING_SECRET",
  "NODE_ENV",
  "PATH",
  "PORT",
  "PWD",
  "VAULT",
]);

const DISALLOWED_USER_ENV_PREFIXES = [
  "CF_",
  "HOSTED_EMAIL_",
  "HOSTED_EXECUTION_",
  "WRANGLER_",
];

export interface HostedUserEnvConfig {
  env: Record<string, string>;
  schema: typeof HOSTED_USER_ENV_SCHEMA;
  updatedAt: string;
}

export interface HostedUserEnvUpdate {
  env: Record<string, string | null>;
  mode: "merge" | "replace";
}

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();
const HOSTED_USER_ENV_ALIASES = {
  AGENTMAIL_API_BASE_URL: "AGENTMAIL_BASE_URL",
  PARSER_FFMPEG_PATH: "FFMPEG_COMMAND",
} as const;

export function decodeHostedUserEnvPayload(
  payload: Uint8Array | ArrayBuffer | null,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  return payload
    ? parseHostedUserEnvConfig(utf8Decoder.decode(payload), source).env
    : {};
}

export function encodeHostedUserEnvPayload(input: {
  env: Record<string, string>;
  now?: string;
}): Uint8Array | null {
  if (Object.keys(input.env).length === 0) {
    return null;
  }

  return utf8Encoder.encode(
    `${JSON.stringify(createHostedUserEnvConfig(input.env, input.now), null, 2)}\n`,
  );
}

export function applyHostedUserEnvUpdate(input: {
  current: Record<string, string>;
  source?: Readonly<Record<string, string | undefined>>;
  update: HostedUserEnvUpdate;
}): Record<string, string> {
  const base = input.update.mode === "replace"
    ? {}
    : { ...input.current };

  for (const [key, rawValue] of Object.entries(input.update.env)) {
    const normalizedKey = normalizeHostedUserEnvKey(key);

    if (!isHostedUserEnvKeyAllowed(normalizedKey, input.source)) {
      throw new Error(`Hosted user env key is not allowed: ${key}`);
    }

    if (rawValue === null) {
      delete base[normalizedKey];
      continue;
    }

    const normalizedValue = normalizeHostedUserEnvValue(rawValue, normalizedKey);

    if (normalizedValue === null) {
      delete base[normalizedKey];
      continue;
    }

    base[normalizedKey] = normalizedValue;
  }

  return sortHostedUserEnv(base);
}

export function listHostedUserEnvKeys(env: Record<string, string>): string[] {
  return Object.keys(env).sort((left, right) => left.localeCompare(right));
}

export function normalizeHostedUserEnv(
  env: Record<string, string>,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const normalized: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      throw new TypeError(`Hosted user env value for ${key} must be a string.`);
    }

    normalized[key] = value;
  }

  return applyHostedUserEnvUpdate({
    current: {},
    source,
    update: {
      env: normalized,
      mode: "replace",
    },
  });
}

export function parseHostedUserEnvUpdate(value: unknown): HostedUserEnvUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted user env request body must be a JSON object.");
  }

  const payload = value as {
    env?: unknown;
    mode?: unknown;
  } & Record<string, unknown>;
  const rawEnv = payload.env && typeof payload.env === "object" && !Array.isArray(payload.env)
    ? payload.env as Record<string, unknown>
    : payload as Record<string, unknown>;
  const mode = payload.mode === "replace" ? "replace" : "merge";
  const env: Record<string, string | null> = {};

  for (const [key, rawValue] of Object.entries(rawEnv)) {
    if (key === "env" || key === "mode") {
      continue;
    }

    if (rawValue === null) {
      env[key] = null;
      continue;
    }

    if (typeof rawValue !== "string") {
      throw new TypeError(`Hosted user env value for ${key} must be a string or null.`);
    }

    env[key] = rawValue;
  }

  return {
    env,
    mode,
  };
}

export function createHostedUserEnvConfig(
  env: Record<string, string>,
  now = new Date().toISOString(),
): HostedUserEnvConfig {
  return {
    env: sortHostedUserEnv(env),
    schema: HOSTED_USER_ENV_SCHEMA,
    updatedAt: now,
  };
}

function parseHostedUserEnvConfig(
  text: string,
  source: Readonly<Record<string, string | undefined>> = process.env,
): HostedUserEnvConfig {
  const parsed = JSON.parse(text) as Partial<HostedUserEnvConfig>;

  if (
    (parsed.schema !== HOSTED_USER_ENV_SCHEMA && parsed.schema !== LEGACY_HOSTED_USER_ENV_SCHEMA)
    || !parsed.env
    || typeof parsed.env !== "object"
  ) {
    throw new Error("Hosted user env config is invalid.");
  }

  const env = normalizeHostedUserEnv(
    Object.fromEntries(Object.entries(parsed.env).map(([key, value]) => {
      if (typeof value !== "string") {
        throw new TypeError(`Hosted user env value for ${key} must be a string.`);
      }

      return [key, value] as const;
    })),
    source,
  );

  return {
    env,
    schema: HOSTED_USER_ENV_SCHEMA,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
  };
}

function normalizeHostedUserEnvKey(key: string): string {
  const normalized = key.trim().toUpperCase();

  if (!normalized || !/^[A-Z0-9_]+$/u.test(normalized)) {
    throw new Error(`Hosted user env key is invalid: ${key}`);
  }

  return HOSTED_USER_ENV_ALIASES[normalized as keyof typeof HOSTED_USER_ENV_ALIASES] ?? normalized;
}

function normalizeHostedUserEnvValue(value: string, key: string): string | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("\u0000")) {
    throw new Error(`Hosted user env value for ${key} contains invalid null bytes.`);
  }

  return normalized;
}

function isHostedUserEnvKeyAllowed(
  key: string,
  source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (DISALLOWED_USER_ENV_KEYS.has(key)) {
    return false;
  }

  if (DISALLOWED_USER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return false;
  }

  const allowedKeys = new Set([
    ...DEFAULT_ALLOWED_USER_ENV_KEYS,
    ...parseCsvList(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS),
  ]);
  if (allowedKeys.has(key)) {
    return true;
  }

  const allowedPrefixes = [
    ...DEFAULT_ALLOWED_USER_ENV_PREFIXES,
    ...parseCsvList(source.HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES),
  ];

  return allowedPrefixes.some((prefix) => key.startsWith(prefix));
}

function sortHostedUserEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function parseCsvList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.toUpperCase());
}
