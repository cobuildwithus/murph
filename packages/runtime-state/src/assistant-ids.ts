const ASSISTANT_OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,191}$/u;

export function normalizeAssistantOpaqueId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 && ASSISTANT_OPAQUE_ID_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function isValidAssistantOpaqueId(
  value: string | null | undefined,
): boolean {
  return normalizeAssistantOpaqueId(value) !== null;
}
