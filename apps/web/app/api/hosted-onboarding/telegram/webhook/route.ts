import { after } from "next/server";

import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { handleHostedOnboardingTelegramWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

export async function GET() {
  return jsonOk({
    ok: true,
    provider: "telegram",
  });
}

export const POST = withJsonError(async (request: Request) => {
  const rawBody = await request.text();

  return jsonOk(
    await handleHostedOnboardingTelegramWebhook({
      defer: (drain) => {
        after(async () => {
          try {
            await drain();
          } catch (error) {
            console.error(
              "Hosted Telegram webhook deferred continuation failed.",
              error instanceof Error ? error.message : String(error),
            );
          }
        });
      },
      rawBody,
      secretToken: request.headers.get("x-telegram-bot-api-secret-token"),
      signal: request.signal,
    }),
    202,
  );
});
