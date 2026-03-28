import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { handleHostedOnboardingTelegramWebhook } from "@/src/lib/hosted-onboarding/service";

export async function GET() {
  return jsonOk({
    ok: true,
    provider: "telegram",
  });
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    return jsonOk(
      await handleHostedOnboardingTelegramWebhook({
        rawBody,
        secretToken: request.headers.get("x-telegram-bot-api-secret-token"),
      }),
      202,
    );
  } catch (error) {
    return jsonError(error);
  }
}
