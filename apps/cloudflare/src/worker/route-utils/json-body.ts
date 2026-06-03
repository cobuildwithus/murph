export const INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES = 4 * 1024;
export const DIRECT_R2_PRESIGNED_PUT_TEST_BODY_LIMIT_BYTES = 16 * 1024;
export const DEPLOY_CONTAINER_SMOKE_BODY_LIMIT_BYTES = 4 * 1024;

export function parseJsonValue(value: string): unknown {
  return JSON.parse(value);
}

export function requireJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export function normalizeNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

export function isRequestBodyTooLargeError(error: unknown): error is RangeError {
  return error instanceof RangeError && error.message.startsWith("Request body exceeded ");
}
