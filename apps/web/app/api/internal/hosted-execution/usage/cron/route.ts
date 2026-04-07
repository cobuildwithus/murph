import {
  drainHostedPendingAiUsageImports,
} from "@/src/lib/hosted-execution/usage";
import { drainHostedAiUsageStripeMetering } from "@/src/lib/hosted-execution/stripe-metering";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  let imported: Awaited<ReturnType<typeof drainHostedPendingAiUsageImports>> | null = null;
  let importError: string | null = null;

  try {
    imported = await drainHostedPendingAiUsageImports();
  } catch (error) {
    importError = error instanceof Error ? error.message : String(error);
    console.error("Hosted pending AI usage import failed.", importError);
  }

  const metered = await drainHostedAiUsageStripeMetering();

  return jsonOk({
    imported,
    ...(importError ? { importError } : {}),
    metered,
  });
});
