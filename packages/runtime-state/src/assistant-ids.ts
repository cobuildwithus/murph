const ASSISTANT_OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,191}$/u;

export function isValidAssistantOpaqueId(
  value: string | null | undefined,
): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  return normalized.length > 0 && ASSISTANT_OPAQUE_ID_PATTERN.test(normalized);
}
