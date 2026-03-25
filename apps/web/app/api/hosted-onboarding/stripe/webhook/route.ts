import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { handleHostedStripeWebhook } from "@/src/lib/hosted-onboarding/service";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    return jsonOk(
      await handleHostedStripeWebhook({
        rawBody,
        signature: request.headers.get("stripe-signature"),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
