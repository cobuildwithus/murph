import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { handleHostedStripeWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

export const POST = withJsonError(async (request: Request) => {
    const rawBody = await request.text();
    return jsonOk(
      await handleHostedStripeWebhook({
        rawBody,
        signature: request.headers.get("stripe-signature"),
      }),
    );
});
