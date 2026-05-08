import {
  jsonOk,
  readHostedOnboardingRawBodyText,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { handleHostedStripeWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

const HOSTED_STRIPE_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const rawBody = await readHostedOnboardingRawBodyText(request, {
    limitBytes: HOSTED_STRIPE_WEBHOOK_MAX_BODY_BYTES,
    tooLargeErrorCode: "STRIPE_WEBHOOK_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Stripe webhook body is too large.",
  });

  return jsonOk(
    await handleHostedStripeWebhook({
      rawBody,
      signature: request.headers.get("stripe-signature"),
    }),
  );
});
