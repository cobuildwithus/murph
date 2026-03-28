import { drainHostedAiUsageStripeMetering } from "@/src/lib/hosted-execution/stripe-metering";
import { requireHostedExecutionSchedulerToken } from "@/src/lib/hosted-execution/internal";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";

export async function GET(request: Request) {
  try {
    requireHostedExecutionSchedulerToken(request);
    const result = await drainHostedAiUsageStripeMetering();

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
