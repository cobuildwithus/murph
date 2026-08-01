import {
  parseHostedRuntimeProductFeedbackRecordRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  isHostedProductSupportEscalationSummary,
  recordHostedProductFeedback,
} from "@/src/lib/hosted-execution/product-feedback";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 16_384;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(
    request,
    {
      maxBodyBytes: BODY_LIMIT_BYTES,
    },
  );
  const body = parseHostedRuntimeProductFeedbackRecordRequest(payload);

  return jsonOk(await recordHostedProductFeedback({
    feedback: body.feedback,
    ...(isHostedProductSupportEscalationSummary(body.feedback.summary)
      ? { memberId: userId }
      : {}),
  }));
});
