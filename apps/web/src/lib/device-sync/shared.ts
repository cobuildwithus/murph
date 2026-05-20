import { sanitizeHostedRuntimeDiagnosticText } from "@murphai/device-syncd/hosted-runtime";

export {
  asRecord,
  generateHostedRandomPrefixedId,
  isRecord,
  maybeDate,
  maybeIsoTimestamp,
  normalizeNullableString,
  parseCommaSeparatedList,
  parseInteger,
  sha256Hex,
  toIsoTimestamp,
  toJsonRecord,
} from "../primitives";

const HOSTED_CONNECTION_ERROR_REDACTION_TOKEN_PATTERN = /(?:<redacted-[a-z-]+>|\[redacted[.\w-]*\])/iu;
const HOSTED_CONNECTION_ERROR_URL_LIKE_PATTERN =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:\/[^\s]*)?/iu;
const HOSTED_CONNECTION_ERROR_IDENTIFIER_PHRASE_PATTERN =
  /\b(?:account|external|member|owner|provider\s+account|subject|user)(?:\s+(?:id|identifier))?\s+(?=[A-Za-z0-9._:-]{6,}\b)(?=[A-Za-z0-9._:-]*[0-9._:-])[A-Za-z0-9._:-]+\b/iu;
const HOSTED_CONNECTION_ERROR_STRUCTURED_FIELD_PATTERN =
  /(?:^|[\s&?])[A-Za-z][A-Za-z0-9_-]{1,40}=\S{3,}/u;
const HOSTED_CONNECTION_ERROR_SECRET_PHRASE_PATTERN =
  /\bBearer\b|\b(?:access|id|refresh|session)\s+token\s+(?=[A-Za-z0-9._~+/=-]{8,}\b)(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]+\b/iu;
const HOSTED_CONNECTION_ERROR_LONG_TOKEN_PATTERN =
  /\b(?=[A-Za-z0-9._~+/=-]{24,}\b)(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]+\b/u;

// Durable connection rows may carry a short operator-facing failure reason.
// Keep this stricter than hosted_runtime_log: logs can hold rich redacted
// diagnostics, while device_connection.last_error_message is product state.
export function sanitizeHostedConnectionLastErrorMessage(value: string | null | undefined): string | null {
  const sanitized = sanitizeHostedRuntimeDiagnosticText(value ?? null);
  if (!sanitized) {
    return null;
  }

  if (
    HOSTED_CONNECTION_ERROR_REDACTION_TOKEN_PATTERN.test(sanitized)
    || HOSTED_CONNECTION_ERROR_URL_LIKE_PATTERN.test(sanitized)
    || HOSTED_CONNECTION_ERROR_IDENTIFIER_PHRASE_PATTERN.test(sanitized)
    || HOSTED_CONNECTION_ERROR_STRUCTURED_FIELD_PATTERN.test(sanitized)
    || HOSTED_CONNECTION_ERROR_SECRET_PHRASE_PATTERN.test(sanitized)
    || HOSTED_CONNECTION_ERROR_LONG_TOKEN_PATTERN.test(sanitized)
  ) {
    return null;
  }

  return sanitized;
}

// Keep durable hosted SQL free of provider-sourced free-form text.
// Runtime-only operational paths may still carry human-readable messages.
export function omitHostedSqlErrorText(_value: string | null | undefined): null {
  void _value;
  return null;
}
