import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { runHostedRuntimeLatencyAlertMonitor } from "@/src/lib/hosted-runtime-latency/alert-monitor";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const result = await runHostedRuntimeLatencyAlertMonitor({
    signal: request.signal,
  });

  return jsonOk({
    runtimeLatencyAlert: result,
  });
});
