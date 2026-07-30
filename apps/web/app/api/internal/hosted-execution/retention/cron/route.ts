import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  runHostedRetentionCleanupWithRuntimeLogDatabase,
} from "@/src/lib/hosted-retention/runtime-log-database-cleanup";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const cleanup = await runHostedRetentionCleanupWithRuntimeLogDatabase();

  return jsonOk({
    cleanup,
  });
});
