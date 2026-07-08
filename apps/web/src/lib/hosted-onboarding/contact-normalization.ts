export function normalizeHostedOpaqueInput(
  value: string | number | null | undefined | unknown,
): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeHostedEmailAddress(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
    ? normalized
    : null;
}

export function normalizeHostedTelegramUsernameForLookup(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedOpaqueInput(value);

  if (!normalized) {
    return null;
  }

  const username = normalized.startsWith("@") ? normalized.slice(1) : normalized;

  return /^[A-Za-z0-9_]{5,32}$/u.test(username) ? username.toLowerCase() : null;
}
