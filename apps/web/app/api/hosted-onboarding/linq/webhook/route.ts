import { after } from "next/server";

import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

export async function GET() {
  return jsonOk({
    ok: true,
    provider: "linq",
  });
}

export const POST = withJsonError(async (request: Request) => {
  const rawBody = await request.text();
  return jsonOk(
    await handleHostedOnboardingLinqWebhook({
      defer: (drain) => {
        after(async () => {
          try {
            await drain();
          } catch (error) {
            console.error(
              "Hosted Linq webhook deferred continuation failed.",
              error instanceof Error ? error.message : String(error),
            );
          }
        });
      },
      rawBody,
      signature: request.headers.get("x-webhook-signature"),
      signal: request.signal,
      timestamp: request.headers.get("x-webhook-timestamp"),
    }),
    202,
  );
});
