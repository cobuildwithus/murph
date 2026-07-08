import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { captureHostedGrowthDailySnapshot } from "@/src/lib/hosted-ops/growth-metrics";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  const prisma = getPrisma();
  const snapshot = await captureHostedGrowthDailySnapshot(new Date(), prisma);
  return jsonOk({ snapshot });
});
