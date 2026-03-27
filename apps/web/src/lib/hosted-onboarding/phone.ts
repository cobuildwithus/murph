export function normalizePhoneNumber(value: string | null | undefined): string | null {
  const normalized = normalizeNullablePhoneString(value);

  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[\s().-]+/gu, "");
  const prefixed = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;

  if (/^\+[1-9]\d{6,14}$/u.test(prefixed)) {
    return prefixed;
  }

  if (/^[1-9]\d{6,14}$/u.test(prefixed)) {
    return `+${prefixed}`;
  }

  return null;
}

export function maskPhoneNumber(value: string | null | undefined): string {
  const normalized = normalizePhoneNumber(value);

  if (!normalized) {
    return "your number";
  }

  return `*** ${normalized.slice(-4)}`;
}

function normalizeNullablePhoneString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
