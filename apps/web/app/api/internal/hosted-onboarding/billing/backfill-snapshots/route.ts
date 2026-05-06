import { timingSafeEqual } from "node:crypto";

import {
  backfillHostedBillingSnapshots,
} from "@/src/lib/hosted-onboarding/stripe-billing-snapshot-backfill";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireHostedBillingBackfillRequest(request);

  const summary = await backfillHostedBillingSnapshots({
    apply: false,
    limit: parseHostedBillingSnapshotBackfillLimitFromUrl(request.url),
  });

  return jsonOk({
    backfill: summary,
  });
});

export const POST = withJsonError(async (request: Request) => {
  requireHostedBillingBackfillRequest(request);

  const body = await readOptionalJsonObject(request, {
    limitBytes: 2_048,
  });

  const summary = await backfillHostedBillingSnapshots({
    apply: body.apply === true,
    limit: parseHostedBillingSnapshotBackfillLimit(body.limit),
  });

  return jsonOk({
    backfill: summary,
  });
});

function parseHostedBillingSnapshotBackfillLimitFromUrl(url: string): number | undefined {
  const value = new URL(url).searchParams.get("limit");
  return parseHostedBillingSnapshotBackfillLimit(value);
}

function parseHostedBillingSnapshotBackfillLimit(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new TypeError("limit must be an integer between 1 and 1000.");
  }

  return parsed;
}

function requireHostedBillingBackfillRequest(request: Request): void {
  const configuredSecret = normalizeOptionalString(process.env.HOSTED_BILLING_BACKFILL_SECRET);

  if (!configuredSecret) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_BACKFILL_SECRET_REQUIRED",
      message: "HOSTED_BILLING_BACKFILL_SECRET must be configured for billing backfill routes.",
      httpStatus: 500,
    });
  }

  const providedSecret = readBearerAuthorizationToken(request.headers.get("authorization"));

  if (!providedSecret || !timingSafeEquals(configuredSecret, providedSecret)) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_BACKFILL_UNAUTHORIZED",
      message: "Unauthorized hosted billing backfill request.",
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

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
