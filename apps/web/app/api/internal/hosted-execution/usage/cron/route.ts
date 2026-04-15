import { drainHostedAiUsageStripeMetering } from "@/src/lib/hosted-execution/stripe-metering";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const metered = await drainHostedAiUsageStripeMetering();

  return jsonOk({
    metered,
  });
});
