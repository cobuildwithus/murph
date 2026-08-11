import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { captureHostedGrowthDailySnapshot } from "@/src/lib/hosted-ops/growth-metrics";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  const prisma = getPrisma();
  const capture = await captureHostedGrowthDailySnapshot(new Date(), prisma);
  if (!capture.activityAvailable) {
    throw hostedOnboardingError({
      code: "HOSTED_GROWTH_ACTIVITY_UNAVAILABLE",
      httpStatus: 503,
      message: "Hosted growth activity capture is temporarily unavailable.",
    });
  }

  return jsonOk({ snapshot: capture.snapshot });
});
