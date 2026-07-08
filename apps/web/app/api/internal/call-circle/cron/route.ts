import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  runCallCircleScheduler,
} from "@/src/lib/call-circle/scheduler";

const HOSTED_CALL_CIRCLE_CRON_ENABLED_ENV = "HOSTED_CALL_CIRCLE_CRON_ENABLED";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  if (!isHostedCallCircleCronEnabled()) {
    return jsonOk({
      result: {
        reason: "cron_disabled",
        status: "skipped",
      },
    }, 200);
  }

  const result = await runCallCircleScheduler();
  return jsonOk({
    result: {
      scheduler: result,
      status: "ran",
    },
  }, 200);
});

export function isHostedCallCircleCronEnabled(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  return source[HOSTED_CALL_CIRCLE_CRON_ENABLED_ENV]?.trim() === "1";
}
