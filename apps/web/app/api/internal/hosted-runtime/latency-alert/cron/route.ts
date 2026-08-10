import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { runHostedRuntimeLatencyAlertMonitor } from "@/src/lib/hosted-runtime-latency/alert-monitor";
import { runHostedRuntimeProgressAlertMonitor } from "@/src/lib/hosted-runtime-progress/alert-monitor";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const [latencyResult, progressResult] = await Promise.all([
    runHostedRuntimeLatencyAlertMonitor({
      signal: request.signal,
    }),
    runHostedRuntimeProgressAlertMonitor({
      signal: request.signal,
    }),
  ]);

  return jsonOk({
    runtimeLatencyAlert: latencyResult,
    runtimeProgressAlert: progressResult,
  });
});
