import { normalizeNullableString } from './shared.js'

const ASSISTANT_OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,191}$/u

export function isValidAssistantOpaqueId(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeNullableString(value)
  return normalized !== null && ASSISTANT_OPAQUE_ID_PATTERN.test(normalized)
}
