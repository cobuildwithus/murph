import {
  parseHostedExecutionUserEnvUpdate,
  type HostedExecutionUserEnvUpdate,
} from "@murphai/hosted-execution";

import { isHostedUserEnvKeyAllowed } from "./hosted-env-policy.ts";

export const HOSTED_USER_ENV_SCHEMA = "murph.hosted-user-env.v1";

export interface HostedUserEnvConfig {
  env: Record<string, string>;
  schema: typeof HOSTED_USER_ENV_SCHEMA;
  updatedAt: string;
}

export type HostedUserEnvUpdate = HostedExecutionUserEnvUpdate;

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

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
  const nextEnv = input.update.mode === "replace"
    ? {}
    : { ...input.current };

  for (const [key, rawValue] of Object.entries(input.update.env)) {
    const normalizedKey = normalizeHostedUserEnvKey(key);

    if (!isHostedUserEnvKeyAllowed(normalizedKey, input.source)) {
      throw new TypeError(`Hosted user env key is not allowed: ${key}`);
    }

    if (rawValue === null) {
      delete nextEnv[normalizedKey];
      continue;
    }

    const normalizedValue = normalizeHostedUserEnvValue(rawValue, normalizedKey);

    if (normalizedValue === null) {
      delete nextEnv[normalizedKey];
      continue;
    }

    nextEnv[normalizedKey] = normalizedValue;
  }

  return sortHostedUserEnv(nextEnv);
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
  const payload = requireHostedUserEnvObject(
    value,
    "Hosted user env request body must be a JSON object.",
  );

  return parseHostedExecutionUserEnvUpdate({
    env: requireHostedUserEnvObject(
      payload.env,
      "Hosted user env request body field `env` must be a JSON object.",
    ),
    mode: payload.mode,
  });
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

  if (parsed.schema !== HOSTED_USER_ENV_SCHEMA || !isHostedUserEnvObject(parsed.env)) {
    throw new Error("Hosted user env config is invalid.");
  }

  const env = normalizeHostedUserEnv(readHostedUserEnvStringRecord(parsed.env), source);

  return {
    env,
    schema: HOSTED_USER_ENV_SCHEMA,
    updatedAt: requireHostedUserEnvString(parsed.updatedAt, "Hosted user env config updatedAt"),
  };
}

function normalizeHostedUserEnvKey(key: string): string {
  const normalized = key.trim().toUpperCase();

  if (!normalized || !/^[A-Z0-9_]+$/u.test(normalized)) {
    throw new TypeError(`Hosted user env key is invalid: ${key}`);
  }

  return normalized;
}

function normalizeHostedUserEnvValue(value: string, key: string): string | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("\u0000")) {
    throw new TypeError(`Hosted user env value for ${key} contains invalid null bytes.`);
  }

  return normalized;
}

function requireHostedUserEnvObject(value: unknown, message: string): Record<string, unknown> {
  if (!isHostedUserEnvObject(value)) {
    throw new TypeError(message);
  }

  return value;
}

function requireHostedUserEnvString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readHostedUserEnvStringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, rawValue]) => {
    if (typeof rawValue !== "string") {
      throw new TypeError(`Hosted user env value for ${key} must be a string.`);
    }

    return [key, rawValue] as const;
  }));
}

function isHostedUserEnvObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortHostedUserEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
