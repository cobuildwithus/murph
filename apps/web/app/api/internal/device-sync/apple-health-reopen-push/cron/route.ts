import { sendDueAppleHealthReopenPushes } from "@/src/lib/device-sync/apple-health-reopen-push";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const maxDuration = 60;

// The wall clock for phones that went quiet. Counts only: no member or device detail leaves this route.
export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  return jsonOk({ reopenPushes: await sendDueAppleHealthReopenPushes({ signal: request.signal }) });
});
