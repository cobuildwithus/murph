import { normalizeIanaTimeZone } from "@murphai/contracts";

const VERCEL_IP_TIME_ZONE_HEADER = "x-vercel-ip-timezone";

export function normalizeHostedSignupTimeZone(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return normalizeIanaTimeZone(value);
}

export function readHostedSignupTimeZoneFromHeaders(headers: Headers): string | null {
  return normalizeHostedSignupTimeZone(headers.get(VERCEL_IP_TIME_ZONE_HEADER));
}

export function resolveHostedSignupTimeZone(input: {
  clientTimeZone: unknown;
  headers: Headers;
}): string | null {
  return (
    normalizeHostedSignupTimeZone(input.clientTimeZone)
    ?? readHostedSignupTimeZoneFromHeaders(input.headers)
  );
}
