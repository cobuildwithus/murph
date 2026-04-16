import { isHostedRunnerSecretKeyAllowed } from "./hosted-env-policy.ts";

// This payload is the runner-secret subset of per-user configuration. Product
// facts must not be stored through this Cloudflare-owned seam.
export const HOSTED_RUNNER_SECRETS_SCHEMA = "murph.hosted-runner-secrets.v1";

export interface HostedRunnerSecretsConfig {
  env: Record<string, string>;
  schema: typeof HOSTED_RUNNER_SECRETS_SCHEMA;
  updatedAt: string;
}

export interface HostedRunnerSecretsStatus {
  configuredRunnerSecretKeys: string[];
  userId: string;
}

export interface HostedRunnerSecretsUpdate {
  env: Record<string, string | null>;
  mode: "merge" | "replace";
}

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

export function decodeHostedRunnerSecretsPayload(
  payload: Uint8Array | ArrayBuffer | null,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  return payload
    ? parseHostedRunnerSecretsConfig(utf8Decoder.decode(payload), source).env
    : {};
}

export function encodeHostedRunnerSecretsPayload(input: {
  env: Record<string, string>;
  now?: string;
}): Uint8Array | null {
  if (Object.keys(input.env).length === 0) {
    return null;
  }

  return utf8Encoder.encode(
    `${JSON.stringify(createHostedRunnerSecretsConfig(input.env, input.now), null, 2)}\n`,
  );
}

export function applyHostedRunnerSecretsUpdate(input: {
  current: Record<string, string>;
  source?: Readonly<Record<string, string | undefined>>;
  update: HostedRunnerSecretsUpdate;
}): Record<string, string> {
  const nextEnv = input.update.mode === "replace"
    ? {}
    : { ...input.current };

  for (const [key, rawValue] of Object.entries(input.update.env)) {
    const normalizedKey = normalizeHostedRunnerSecretsKey(key);

    if (!isHostedRunnerSecretKeyAllowed(normalizedKey, input.source)) {
      throw new TypeError(`Hosted runner secret key is not allowed: ${key}`);
    }

    if (rawValue === null) {
      delete nextEnv[normalizedKey];
      continue;
    }

    const normalizedValue = normalizeHostedRunnerSecretsValue(rawValue, normalizedKey);

    if (normalizedValue === null) {
      delete nextEnv[normalizedKey];
      continue;
    }

    nextEnv[normalizedKey] = normalizedValue;
  }

  return sortHostedRunnerSecrets(nextEnv);
}

export function listHostedRunnerSecretKeys(env: Record<string, string>): string[] {
  return Object.keys(env).sort((left, right) => left.localeCompare(right));
}

export function normalizeHostedRunnerSecrets(
  env: Record<string, string>,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const validatedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      throw new TypeError(`Hosted runner secret value for ${key} must be a string.`);
    }

    validatedEnv[key] = value;
  }

  return applyHostedRunnerSecretsUpdate({
    current: {},
    source,
    update: {
      env: validatedEnv,
      mode: "replace",
    },
  });
}

export function parseHostedRunnerSecretsUpdate(value: unknown): HostedRunnerSecretsUpdate {
  const payload = requireHostedRunnerSecretsObject(
    value,
    "Hosted runner secrets request body must be a JSON object.",
  );

  const mode = payload.mode;

  if (mode !== "merge" && mode !== "replace") {
    throw new TypeError("Hosted runner secrets request body field `mode` is invalid.");
  }

  const env = requireHostedRunnerSecretsObject(
    payload.env,
    "Hosted runner secrets request body field `env` must be a JSON object.",
  );

  return {
    env: Object.fromEntries(Object.entries(env).map(([key, entry]) => {
      if (entry !== null && typeof entry !== "string") {
        throw new TypeError(
          `Hosted runner secrets request body field \`env.${key}\` must be a string or null.`,
        );
      }

      return [key, entry] as const;
    })),
    mode,
  };
}

export function createHostedRunnerSecretsConfig(
  env: Record<string, string>,
  now = new Date().toISOString(),
): HostedRunnerSecretsConfig {
  return {
    env: sortHostedRunnerSecrets(env),
    schema: HOSTED_RUNNER_SECRETS_SCHEMA,
    updatedAt: now,
  };
}

function parseHostedRunnerSecretsConfig(
  text: string,
  source: Readonly<Record<string, string | undefined>> = process.env,
): HostedRunnerSecretsConfig {
  const parsed = JSON.parse(text) as Partial<HostedRunnerSecretsConfig>;

  if (parsed.schema !== HOSTED_RUNNER_SECRETS_SCHEMA || !isHostedRunnerSecretsObject(parsed.env)) {
    throw new Error("Hosted runner secrets config is invalid.");
  }

  const env = normalizeHostedRunnerSecrets(requireHostedRunnerSecretsStringRecord(parsed.env), source);

  return {
    env,
    schema: HOSTED_RUNNER_SECRETS_SCHEMA,
    updatedAt: requireHostedRunnerSecretsString(parsed.updatedAt, "Hosted runner secrets config updatedAt"),
  };
}

function normalizeHostedRunnerSecretsKey(key: string): string {
  const normalized = key.trim().toUpperCase();

  if (!normalized || !/^[A-Z0-9_]+$/u.test(normalized)) {
    throw new TypeError(`Hosted runner secret key is invalid: ${key}`);
  }

  return normalized;
}

function normalizeHostedRunnerSecretsValue(value: string, key: string): string | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("\u0000")) {
    throw new TypeError(`Hosted runner secret value for ${key} contains invalid null bytes.`);
  }

  return normalized;
}

function requireHostedRunnerSecretsObject(value: unknown, message: string): Record<string, unknown> {
  if (!isHostedRunnerSecretsObject(value)) {
    throw new TypeError(message);
  }

  return value;
}

function requireHostedRunnerSecretsString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireHostedRunnerSecretsStringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, rawValue]) => {
    if (typeof rawValue !== "string") {
      throw new TypeError(`Hosted runner secret value for ${key} must be a string.`);
    }

    return [key, rawValue] as const;
  }));
}

function isHostedRunnerSecretsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortHostedRunnerSecrets(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
