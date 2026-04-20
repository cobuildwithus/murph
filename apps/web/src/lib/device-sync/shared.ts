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

// Keep durable hosted SQL free of provider-sourced free-form text.
// Runtime-only operational paths may still carry human-readable messages.
export function omitHostedSqlErrorText(_value: string | null | undefined): null {
  void _value;
  return null;
}
