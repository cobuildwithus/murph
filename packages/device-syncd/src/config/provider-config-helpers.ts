import { assertListenerPort } from "@murphai/runtime-state/loopback-control-plane";

import type { DeviceSyncEnvSource } from "./provider-types.ts";

export function requireEnv(env: DeviceSyncEnvSource, keys: readonly string[]): string {
  const value = optionalEnv(env, keys);

  if (!value) {
    throw new TypeError(`Missing required environment variable. Set one of: ${keys.join(", ")}`);
  }

  return value;
}

export function optionalEnv(env: DeviceSyncEnvSource, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeString(env[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

export function parseIntegerEnv(env: DeviceSyncEnvSource, keys: readonly string[]): number | undefined {
  const value = optionalEnv(env, keys);

  if (!value) {
    return undefined;
  }

  return parseDecimalInteger(value, keys[0]);
}

export function parsePortEnv(env: DeviceSyncEnvSource, keys: readonly string[]): number | undefined {
  const parsed = parseIntegerEnv(env, keys);

  if (parsed === undefined) {
    return undefined;
  }

  assertListenerPort(
    parsed,
    `Environment variable ${keys[0]} must be an integer between 0 and 65535.`,
    { allowZero: true },
  );

  return parsed;
}

/**
 * Reads an explicit on/off switch. Absent or anything other than "1"/"true" is
 * off, so a capability has to be turned on deliberately rather than by a typo.
 */
export function parseBooleanEnv(
  env: DeviceSyncEnvSource,
  keys: readonly string[],
): boolean | undefined {
  const raw = optionalEnv(env, keys);

  if (raw === undefined) {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function parseCsvEnv(env: DeviceSyncEnvSource, keys: readonly string[]): string[] | undefined {
  const value = optionalEnv(env, keys);

  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readOptionalCredentialPair(
  env: DeviceSyncEnvSource,
  clientIdKeys: readonly string[],
  clientSecretKeys: readonly string[],
  providerLabel: string,
): { clientId: string; clientSecret: string } | null {
  const clientId = optionalEnv(env, clientIdKeys);
  const clientSecret = optionalEnv(env, clientSecretKeys);

  if (!clientId && !clientSecret) {
    return null;
  }

  if (!clientId || !clientSecret) {
    throw new TypeError(
      `${providerLabel} configuration is incomplete. Set ${clientIdKeys[0]} and ${clientSecretKeys[0]} together.`,
    );
  }

  return { clientId, clientSecret };
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseDecimalInteger(value: string, key: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new TypeError(`Environment variable ${key} must be an integer.`);
  }

  return Number.parseInt(value, 10);
}
