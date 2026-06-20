import {
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS,
  HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
} from "../hosted-env-categories.ts";

export const HOSTED_RUNTIME_FORWARDED_ENV_CATEGORY_KEYS =
  HOSTED_SHARED_FORWARDED_ENV_CATEGORY_KEYS;

export const HOSTED_RUNTIME_USER_ENV_CATEGORY_KEYS = {
  modelCredentialConfigured: HOSTED_SHARED_MODEL_CREDENTIAL_ENV_NAMES,
} as const satisfies Record<string, readonly string[]>;

export function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}

export function classifyHostedRuntimeEnvCategories<T extends Record<string, readonly string[]>>(
  source: Readonly<Record<string, string>>,
  categories: T,
): { [K in keyof T]: boolean } {
  return Object.fromEntries(
    Object.entries(categories).map(([category, keys]) => [
      category,
      hasAnyHostedRuntimeConfigKey(source, keys),
    ]),
  ) as { [K in keyof T]: boolean };
}

export function hasAnyHostedRuntimeConfigKey(
  source: Readonly<Record<string, string>>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => typeof source[key] === "string" && source[key].length > 0);
}

export function computeHostedRuntimeElapsedMs(
  run: { startedAt?: string | null } | null | undefined,
): number | null {
  if (!run?.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, Date.now() - startedAtMs);
}
