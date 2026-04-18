const HOSTED_PHONE_COUNTRY_CODE_HEADER = "x-vercel-ip-country";

export function normalizeHostedPhoneCountryCode(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/u.test(normalized) ? normalized : null;
}

export function readHostedPhoneCountryCodeFromHeaders(
  requestHeaders: Headers,
): string | null {
  return normalizeHostedPhoneCountryCode(
    requestHeaders.get(HOSTED_PHONE_COUNTRY_CODE_HEADER),
  );
}
