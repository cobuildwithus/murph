import { createHash, randomBytes } from "node:crypto";

const HOSTED_RUNTIME_ERROR_CODE_MAX_LENGTH = 128;
const HOSTED_RUNTIME_ERROR_TEXT_MAX_LENGTH = 512;
const HOSTED_RUNTIME_ERROR_CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]+/gu;
const HOSTED_RUNTIME_ERROR_WHITESPACE_PATTERN = /\s+/gu;
const HOSTED_RUNTIME_ERROR_INLINE_BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu;
const HOSTED_RUNTIME_ERROR_JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/gu;
const HOSTED_RUNTIME_ERROR_QUERY_SECRET_PATTERN =
  /([?&](?:access_token|refresh_token|id_token|token|apikey|api_key|client_secret|session|session_token|code|state)=)[^&#\s]+/giu;
const HOSTED_RUNTIME_ERROR_NAMED_SECRET_PATTERN =
  /\b(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|session(?:[_-]?(?:token|id))?|cookie|set-cookie|password)\b(\s*[:=]\s*)((?:Bearer\s+)?[^\s,;]+)/giu;

export function toIsoTimestamp(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new TypeError(`Invalid timestamp: ${String(value)}`);
  }

  return date.toISOString();
}

export function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function sanitizeHostedRuntimeErrorString(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  let sanitized = normalized
    .replace(HOSTED_RUNTIME_ERROR_CONTROL_CHAR_PATTERN, " ")
    .replace(HOSTED_RUNTIME_ERROR_QUERY_SECRET_PATTERN, "$1[redacted]")
    .replace(HOSTED_RUNTIME_ERROR_NAMED_SECRET_PATTERN, "$1$2[redacted]")
    .replace(HOSTED_RUNTIME_ERROR_JWT_PATTERN, "[redacted.jwt]")
    .replace(HOSTED_RUNTIME_ERROR_INLINE_BEARER_PATTERN, "Bearer [redacted]")
    .replace(HOSTED_RUNTIME_ERROR_WHITESPACE_PATTERN, " ")
    .trim();

  if (!sanitized) {
    sanitized = "[redacted]";
  }

  return sanitized.length <= maxLength
    ? sanitized
    : `${sanitized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function sanitizeHostedRuntimeErrorCode(value: string | null | undefined): string | null {
  return sanitizeHostedRuntimeErrorString(value, HOSTED_RUNTIME_ERROR_CODE_MAX_LENGTH);
}

export function sanitizeHostedRuntimeErrorText(value: string | null | undefined): string | null {
  return sanitizeHostedRuntimeErrorString(value, HOSTED_RUNTIME_ERROR_TEXT_MAX_LENGTH);
}

// Keep durable hosted SQL free of provider-sourced free-form text.
// Runtime-only operational paths may still carry human-readable messages.
export function sanitizeHostedSqlErrorText(_value: string | null | undefined): string | null {
  void _value;
  return null;
}

export function parseCommaSeparatedList(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return [...new Set(value.split(/[\n,]/u).map((entry) => entry.trim()).filter(Boolean))];
}
export function maybeDate(value: string | null | undefined): Date | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function maybeIsoTimestamp(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function generateHostedRandomPrefixedId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

// Keep this hosted-local on purpose. Importing the daemon helper would widen
// the device-sync ingress surface just to reuse a trivial primitive.
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Keep this hosted-local on purpose for the same reason as `sha256Hex`.
export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function toJsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(asRecord(value))) as Record<string, unknown>;
}

export function parseInteger(value: string | null | undefined): number | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
