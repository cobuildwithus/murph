import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { resolveHostedAiUsageGate } from "@/src/lib/hosted-execution/usage-allowance";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: 512,
  });
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
        ...(decision.userNotice
          ? {
              noticeCode: decision.userNotice.code,
              userNotice: decision.userNotice.message,
            }
          : {}),
        reason: decision.reason,
        retryAfter: decision.retryAfter.toISOString(),
      };
}
