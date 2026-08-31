import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { runHostedControlPlaneRetentionCleanup } from "@/src/lib/hosted-retention/cleanup";

export const maxDuration = 300;

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const cleanup = await runHostedControlPlaneRetentionCleanup();

  return jsonOk({ cleanup });
});
