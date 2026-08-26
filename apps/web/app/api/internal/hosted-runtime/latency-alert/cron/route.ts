import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { runHostedAiUsageOvershootAlertMonitor } from "@/src/lib/hosted-execution/usage-overshoot-alert-monitor";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { runHostedRuntimeLatencyAlertMonitor } from "@/src/lib/hosted-runtime-latency/alert-monitor";
import { runHostedRuntimeProgressAlertMonitor } from "@/src/lib/hosted-runtime-progress/alert-monitor";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const [latencyResult, progressResult, usageOvershootResult] = await Promise.allSettled([
    runHostedRuntimeLatencyAlertMonitor({
      signal: request.signal,
    }),
    runHostedRuntimeProgressAlertMonitor({
      signal: request.signal,
    }),
    runHostedAiUsageOvershootAlertMonitor({
      signal: request.signal,
    }),
  ]);

  if (latencyResult.status === "rejected") {
    throw latencyResult.reason;
  }
  if (progressResult.status === "rejected") {
    throw progressResult.reason;
  }
  if (usageOvershootResult.status === "rejected") {
    throw usageOvershootResult.reason;
  }

  return jsonOk({
    runtimeLatencyAlert: latencyResult.value,
    runtimeProgressAlert: progressResult.value,
    usageOvershootAlert: usageOvershootResult.value,
  });
});
