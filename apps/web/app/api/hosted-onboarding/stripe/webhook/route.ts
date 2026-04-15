import { after } from "next/server";

import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { handleHostedStripeWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

export const POST = withJsonError(async (request: Request) => {
    const rawBody = await request.text();
    return jsonOk(
      await handleHostedStripeWebhook({
        defer: (drain) => {
          after(async () => {
            try {
              await drain();
            } catch (error) {
              console.error(
                "Hosted Stripe webhook deferred continuation failed.",
                error instanceof Error ? error.message : String(error),
              );
            }
          });
        },
        rawBody,
        signature: request.headers.get("stripe-signature"),
      }),
    );
});
