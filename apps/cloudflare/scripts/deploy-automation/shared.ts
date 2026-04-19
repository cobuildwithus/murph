export function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

const BOOLEAN_ENV_TRUE_VALUES = new Set(["1", "true", "yes"]);
const BOOLEAN_ENV_FALSE_VALUES = new Set(["0", "false", "no"]);

export function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return fallback;
  }

  if (BOOLEAN_ENV_TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (BOOLEAN_ENV_FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error("Boolean env values must be one of: 1, 0, true, false, yes, no.");
}

export function requireConfiguredString(value: string | undefined, label: string): string {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    throw new Error(`${label} must be configured.`);
  }

  return normalized;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonValue<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseOptionalStrictInteger(
  value: string | undefined,
  errorMessage: string,
): number | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  if (!/^-?\d+$/u.test(normalized)) {
    throw new Error(errorMessage);
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(errorMessage);
  }

  return parsed;
}
