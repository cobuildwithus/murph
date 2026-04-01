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

export function normalizePhoneNumberForCountry(
  value: string | null | undefined,
  countryDialCode: string,
): string | null {
  const normalized = normalizeNullablePhoneString(value);

  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("+") || normalized.startsWith("00")) {
    return normalizePhoneNumber(normalized);
  }

  const normalizedDialCode = normalizeCountryDialCode(countryDialCode);

  if (!normalizedDialCode) {
    return normalizePhoneNumber(normalized);
  }

  const digits = normalized.replace(/[^\d]+/gu, "");

  if (!digits) {
    return null;
  }

  const explicitCountryNumber = normalizePhoneNumber(`+${digits}`);

  if (explicitCountryNumber && explicitCountryNumber.startsWith(normalizedDialCode)) {
    return explicitCountryNumber;
  }

  const nationalDigits =
    normalizedDialCode === "+1" && digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.replace(/^0+/u, "");

  if (!nationalDigits) {
    return null;
  }

  return normalizePhoneNumber(`${normalizedDialCode}${nationalDigits}`);
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

function normalizeCountryDialCode(value: string | null | undefined): string | null {
  const normalized = normalizeNullablePhoneString(value);

  if (!normalized) {
    return null;
  }

  const compact = normalized.replace(/[\s()-]+/gu, "");
  return /^\+[1-9]\d{0,3}$/u.test(compact) ? compact : null;
}
