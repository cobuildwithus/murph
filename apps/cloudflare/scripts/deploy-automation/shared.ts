export function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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
