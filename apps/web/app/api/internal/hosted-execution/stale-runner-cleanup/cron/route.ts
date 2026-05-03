import { runHostedStaleRunnerCleanup } from "@/src/lib/hosted-execution/stale-runner-cleanup";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const cleanup = await runHostedStaleRunnerCleanup({
    prisma: getPrisma(),
  });

  return jsonOk({
    cleanup,
  });
});
