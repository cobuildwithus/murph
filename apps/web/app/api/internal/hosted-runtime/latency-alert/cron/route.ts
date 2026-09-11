import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { runHostedAiUsageOvershootAlertMonitor } from "@/src/lib/hosted-execution/usage-overshoot-alert-monitor";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { runHostedRuntimeLatencyAlertMonitor } from "@/src/lib/hosted-runtime-latency/alert-monitor";
import { runHostedRuntimeTypingAlertMonitor } from "@/src/lib/hosted-runtime-latency/typing-alert-monitor";
import { runHostedRuntimeProgressAlertMonitor } from "@/src/lib/hosted-runtime-progress/alert-monitor";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const [typingResult, latencyResult, progressResult, usageOvershootResult] = await Promise.allSettled([
    runHostedRuntimeTypingAlertMonitor(),
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

  if (typingResult.status === "rejected") {
    throw typingResult.reason;
  }
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
    runtimeTypingAlert: typingResult.value,
    runtimeProgressAlert: progressResult.value,
    usageOvershootAlert: usageOvershootResult.value,
  });
});
