import { isHostedRunnerSecretKeyAllowed } from "./hosted-env-policy.ts";

// This payload is the runner-secret subset of per-user configuration. Product
// facts must not be stored through this Cloudflare-owned seam.
const HOSTED_RUNNER_SECRETS_SCHEMA = "murph.hosted-runner-secrets.v1";

interface HostedRunnerSecretsConfig {
  env: Record<string, string>;
  schema: typeof HOSTED_RUNNER_SECRETS_SCHEMA;
  updatedAt: string;
}

const utf8Decoder = new TextDecoder();

export function decodeHostedRunnerSecretsPayload(
  payload: Uint8Array | ArrayBuffer | null,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  return payload
    ? parseHostedRunnerSecretsConfig(utf8Decoder.decode(payload), source).env
    : {};
}

function normalizeHostedRunnerSecrets(
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

  return applyHostedRunnerSecretsReplace(validatedEnv, source);
}

function applyHostedRunnerSecretsReplace(
  env: Record<string, string>,
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const nextEnv: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(env)) {
    const normalizedKey = normalizeHostedRunnerSecretsKey(key);

    if (!isHostedRunnerSecretKeyAllowed(normalizedKey, source)) {
      throw new TypeError(`Hosted runner secret key is not allowed: ${key}`);
    }

    const normalizedValue = normalizeHostedRunnerSecretsValue(rawValue, normalizedKey);

    if (normalizedValue !== null) {
      nextEnv[normalizedKey] = normalizedValue;
    }
  }

  return sortHostedRunnerSecrets(nextEnv);
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
