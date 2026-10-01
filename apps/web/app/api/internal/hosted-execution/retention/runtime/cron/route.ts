import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { runHostedRuntimeMaintenanceCleanup } from "@/src/lib/hosted-retention/runtime-maintenance-cleanup";

export const maxDuration = 300;

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const cleanup = await runHostedRuntimeMaintenanceCleanup();

  return jsonOk({ cleanup });
});
