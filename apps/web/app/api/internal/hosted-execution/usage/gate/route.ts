import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedRuntimeAiAccessDecision,
} from "@/src/lib/hosted-onboarding/member-access";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: 512,
  });
  const decision = await readHostedRuntimeAiAccessDecision({
    memberId: userId,
  });

  return jsonOk(formatHostedRuntimeAiAccessDecision(decision));
});

function formatHostedRuntimeAiAccessDecision(
  decision: Awaited<ReturnType<typeof readHostedRuntimeAiAccessDecision>>,
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
        retryAfter: requireHostedAiUsageGateRetryAfter(decision.retryAfter).toISOString(),
      };
}

function requireHostedAiUsageGateRetryAfter(value: Date | null): Date {
  if (!value) {
    throw new TypeError("Hosted AI usage gate response requires a retry timestamp.");
  }
  return value;
}
