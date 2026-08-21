import { normalizeHostedSignupTimeZone } from "./time-zone-hint";

const HOSTED_SIGNUP_NOTIFICATION_CONTEXT_SCHEMA =
  "murph.hosted-signup-notification-context.v1";
const HOSTED_SIGNUP_CITY_HEADER = "x-vercel-ip-city";
const HOSTED_SIGNUP_COUNTRY_HEADER = "x-vercel-ip-country";
const HOSTED_SIGNUP_COUNTRY_REGION_HEADER = "x-vercel-ip-country-region";
const HOSTED_SIGNUP_CITY_MAX_LENGTH = 100;

export type HostedSignupSurface =
  | "imessage"
  | "mobile_app"
  | "telegram"
  | "website";

export type HostedSignupNotificationContextV1 = {
  schema: typeof HOSTED_SIGNUP_NOTIFICATION_CONTEXT_SCHEMA;
  occurredAt: string;
  surface: HostedSignupSurface;
  timeZone?: string;
  location?: {
    city?: string;
    country?: string;
    countryRegion?: string;
  };
};

export function buildHostedSignupNotificationContext(input: {
  headers: Headers;
  occurredAt: Date;
  surface: HostedSignupSurface;
  timeZone?: string | null;
}): HostedSignupNotificationContextV1 {
  const city = normalizeHostedSignupCityHeader(
    input.headers.get(HOSTED_SIGNUP_CITY_HEADER),
  );
  const country = normalizeHostedSignupCountry(
    input.headers.get(HOSTED_SIGNUP_COUNTRY_HEADER),
  );
  const countryRegion = normalizeHostedSignupCountryRegion(
    input.headers.get(HOSTED_SIGNUP_COUNTRY_REGION_HEADER),
  );
  const timeZone = normalizeHostedSignupTimeZone(input.timeZone);
  const hasLocation = Boolean(city || country || countryRegion);

  return {
    schema: HOSTED_SIGNUP_NOTIFICATION_CONTEXT_SCHEMA,
    occurredAt: input.occurredAt.toISOString(),
    surface: input.surface,
    ...(timeZone ? { timeZone } : {}),
    ...(hasLocation
      ? {
          location: {
            ...(city ? { city } : {}),
            ...(country ? { country } : {}),
            ...(countryRegion ? { countryRegion } : {}),
          },
        }
      : {}),
  };
}

export function encodeHostedSignupNotificationContext(
  context: HostedSignupNotificationContextV1,
): string {
  return JSON.stringify(parseHostedSignupNotificationContext(context));
}

export function parseHostedSignupNotificationContext(
  value: unknown,
): HostedSignupNotificationContextV1 {
  const candidate = typeof value === "string" ? parseJson(value) : value;
  if (!isRecord(candidate) || !hasOnlyKeys(candidate, [
    "location",
    "occurredAt",
    "schema",
    "surface",
    "timeZone",
  ])) {
    throw new TypeError("Hosted signup notification context is invalid.");
  }
  if (candidate.schema !== HOSTED_SIGNUP_NOTIFICATION_CONTEXT_SCHEMA) {
    throw new TypeError("Hosted signup notification context schema is invalid.");
  }
  if (!isHostedSignupSurface(candidate.surface)) {
    throw new TypeError("Hosted signup notification surface is invalid.");
  }
  const occurredAt = normalizeIsoInstant(candidate.occurredAt);
  const timeZone = candidate.timeZone === undefined
    ? null
    : normalizeHostedSignupTimeZone(candidate.timeZone);
  if (candidate.timeZone !== undefined && !timeZone) {
    throw new TypeError("Hosted signup notification time zone is invalid.");
  }
  const location = parseHostedSignupLocation(candidate.location);

  return {
    schema: HOSTED_SIGNUP_NOTIFICATION_CONTEXT_SCHEMA,
    occurredAt,
    surface: candidate.surface,
    ...(timeZone ? { timeZone } : {}),
    ...(location ? { location } : {}),
  };
}

export function formatHostedSignupSurface(surface: HostedSignupSurface): string {
  switch (surface) {
    case "imessage":
      return "iMessage";
    case "mobile_app":
      return "Mobile app";
    case "telegram":
      return "Telegram";
    case "website":
      return "Website";
  }
}

export function formatHostedSignupLocation(
  location: HostedSignupNotificationContextV1["location"],
): string | null {
  if (!location) {
    return null;
  }

  const parts = [location.city, location.countryRegion, location.country]
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

function parseHostedSignupLocation(
  value: unknown,
): HostedSignupNotificationContextV1["location"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "city",
    "country",
    "countryRegion",
  ])) {
    throw new TypeError("Hosted signup notification location is invalid.");
  }

  const city = value.city === undefined ? null : normalizeHostedSignupCity(value.city);
  const country = value.country === undefined
    ? null
    : normalizeHostedSignupCountry(value.country);
  const countryRegion = value.countryRegion === undefined
    ? null
    : normalizeHostedSignupCountryRegion(value.countryRegion);
  if (
    (value.city !== undefined && !city)
    || (value.country !== undefined && !country)
    || (value.countryRegion !== undefined && !countryRegion)
  ) {
    throw new TypeError("Hosted signup notification location is invalid.");
  }
  if (!city && !country && !countryRegion) {
    throw new TypeError("Hosted signup notification location is empty.");
  }

  return {
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
    ...(countryRegion ? { countryRegion } : {}),
  };
}

function normalizeHostedSignupCity(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const city = value.trim();
  if (
    city.length === 0
    || city.length > HOSTED_SIGNUP_CITY_MAX_LENGTH
    || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(city)
  ) {
    return null;
  }
  return city;
}

function normalizeHostedSignupCityHeader(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return normalizeHostedSignupCity(decodeURIComponent(value));
  } catch {
    return null;
  }
}

function normalizeHostedSignupCountry(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const country = value.trim().toUpperCase();
  return /^[A-Z]{2}$/u.test(country) ? country : null;
}

function normalizeHostedSignupCountryRegion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const countryRegion = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,3}$/u.test(countryRegion) ? countryRegion : null;
}

function normalizeIsoInstant(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Hosted signup notification timestamp is invalid.");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError("Hosted signup notification timestamp is invalid.");
  }
  return value;
}

function isHostedSignupSurface(value: unknown): value is HostedSignupSurface {
  return value === "imessage"
    || value === "mobile_app"
    || value === "telegram"
    || value === "website";
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new TypeError("Hosted signup notification context JSON is invalid.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}
