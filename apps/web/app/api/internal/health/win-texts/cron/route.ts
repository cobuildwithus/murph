import { drainHealthWinTexts } from "@/src/lib/health-wins/nudge-job";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const maxDuration = 300;

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  const summary = await drainHealthWinTexts({ signal: request.signal });
  if (summary.claimed || summary.errors) console.info("Health win text sweep finished.", summary);
  return jsonOk(summary);
});
