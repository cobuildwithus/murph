import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import {
  backfillHostedBillingSnapshots,
} from "@/src/lib/hosted-onboarding/stripe-billing-snapshot-backfill";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const summary = await backfillHostedBillingSnapshots({
    apply: false,
    limit: parseHostedBillingSnapshotBackfillLimitFromUrl(request.url),
  });

  return jsonOk({
    backfill: summary,
  });
});

export const POST = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

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
