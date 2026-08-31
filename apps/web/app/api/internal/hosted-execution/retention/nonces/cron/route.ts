import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { runHostedNonceRetentionCleanup } from "@/src/lib/hosted-retention/nonce-cleanup";

export const maxDuration = 800;

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const cleanup = await runHostedNonceRetentionCleanup();

  return jsonOk({ cleanup });
});
