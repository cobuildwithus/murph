import { timingSafeEqual } from "node:crypto";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function requireVercelCronRequest(request: Request): void {
  const configuredSecret = normalizeOptionalString(process.env.CRON_SECRET);

  if (!configuredSecret) {
    throw hostedOnboardingError({
      code: "CRON_SECRET_REQUIRED",
      message: "CRON_SECRET must be configured for hosted cron routes.",
      httpStatus: 500,
    });
  }

  const providedSecret = readBearerAuthorizationToken(request.headers.get("authorization"));

  if (!providedSecret || !timingSafeEquals(configuredSecret, providedSecret)) {
    throw hostedOnboardingError({
      code: "VERCEL_CRON_UNAUTHORIZED",
      message: "Unauthorized Vercel cron request.",
      httpStatus: 401,
    });
  }
}

function readBearerAuthorizationToken(value: string | null): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized || !normalized.startsWith("Bearer ")) {
    return null;
  }

  const token = normalized.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
