import { runHostedRetentionCleanup } from "@/src/lib/hosted-retention/cleanup";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const cleanup = await runHostedRetentionCleanup();

  return jsonOk({
    cleanup,
  });
});
