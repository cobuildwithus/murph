import { drainHostedAiUsageStripeMetering } from "@/src/lib/hosted-execution/stripe-metering";
import { requireHostedExecutionSchedulerToken } from "@/src/lib/hosted-execution/internal";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
    requireHostedExecutionSchedulerToken(request);
    const result = await drainHostedAiUsageStripeMetering();

    return jsonOk(result);
});
