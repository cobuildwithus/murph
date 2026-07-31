import { runHostedProductFeedbackDigest } from "@/src/lib/hosted-execution/product-feedback-digest";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const result = await runHostedProductFeedbackDigest({
    signal: request.signal,
  });

  return jsonOk({
    productFeedbackDigest: result,
  });
});
