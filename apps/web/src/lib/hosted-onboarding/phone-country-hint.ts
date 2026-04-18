export const HOSTED_PHONE_COUNTRY_CODE_COOKIE_NAME = "murph-phone-country-hint";
export const HOSTED_PHONE_COUNTRY_CODE_REQUEST_HEADER = "x-murph-phone-country-hint";
export const HOSTED_PHONE_COUNTRY_CODE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface HostedVercelGeoSnapshot {
  city: string | null;
  countryCode: string | null;
  countryRegion: string | null;
}

export interface HostedPhoneCountryCodeCookieStore {
  get(name: string): { value?: string } | undefined;
}

export function normalizeHostedPhoneCountryCode(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/u.test(normalized) ? normalized : null;
}

export function resolveHostedVercelGeoSnapshot(
  requestHeaders: Headers,
): HostedVercelGeoSnapshot {
  return {
    city: normalizeHostedGeoCity(requestHeaders.get("x-vercel-ip-city")),
    countryCode: normalizeHostedPhoneCountryCode(
      requestHeaders.get("x-vercel-ip-country"),
    ),
    countryRegion: normalizeHostedCountryRegion(
      requestHeaders.get("x-vercel-ip-country-region"),
    ),
  };
}

export function resolveHostedPhoneCountryCodeFromVercelHeaders(
  requestHeaders: Headers,
): string | null {
  return resolveHostedVercelGeoSnapshot(requestHeaders).countryCode;
}

export function readHostedPhoneCountryCodeFromCookieStore(
  cookieStore: HostedPhoneCountryCodeCookieStore,
): string | null {
  return normalizeHostedPhoneCountryCode(
    cookieStore.get(HOSTED_PHONE_COUNTRY_CODE_COOKIE_NAME)?.value,
  );
}

function normalizeHostedGeoCity(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizeHostedCountryRegion(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,3}$/u.test(normalized) ? normalized : null;
}
