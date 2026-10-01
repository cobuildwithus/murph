import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { runHostedExternalRetentionCleanup } from "@/src/lib/hosted-retention/external-cleanup";

export const maxDuration = 300;

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const cleanup = await runHostedExternalRetentionCleanup();

  return jsonOk({ cleanup });
});
