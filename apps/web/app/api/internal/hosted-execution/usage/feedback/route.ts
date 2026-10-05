import { parseHostedRuntimeProductFeedbackRecordRequest } from "@murphai/hosted-execution/parsers";
import { isHostedUsageOptimizationAuditFeedback } from "@murphai/hosted-execution/runtime-control";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { recordHostedProductFeedback } from "@/src/lib/hosted-execution/product-feedback";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

// Separate consumer path is the privacy rollout fence. Older Web versions
// return 404; producers must never fall back to the ordinary linked route.
export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 16_384 });
  const { feedback } = parseHostedRuntimeProductFeedbackRecordRequest(payload);
  if (!isHostedUsageOptimizationAuditFeedback(feedback)) {
    throw hostedOnboardingError({ code: "HOSTED_USAGE_FEEDBACK_REJECTED", httpStatus: 400,
      message: "Usage feedback accepts only a bounded anonymous usage audit." });
  }
  return jsonOk(await recordHostedProductFeedback({ feedback, memberId: userId }));
});
