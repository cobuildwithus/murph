import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { resolveHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const decision = await resolveHostedAiUsageGate({
    memberId: userId,
  });

  return jsonOk(formatHostedAiUsageGateDecision(decision));
});

function formatHostedAiUsageGateDecision(
  decision: Awaited<ReturnType<typeof resolveHostedAiUsageGate>>,
) {
  return decision.allowed
    ? {
        allowed: true,
      }
    : {
        allowed: false,
        reason: decision.reason,
        retryAfter: decision.retryAfter.toISOString(),
      };
}
