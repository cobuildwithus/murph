import {
  jsonOk,
  readHostedOnboardingRawBodyText,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { assertHostedTelegramWebhookSecret } from "@/src/lib/hosted-onboarding/telegram";
import { handleHostedOnboardingTelegramWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

const HOSTED_TELEGRAM_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const secretToken = request.headers.get("x-telegram-bot-api-secret-token");
  assertHostedTelegramWebhookSecret(secretToken);
  const rawBody = await readHostedOnboardingRawBodyText(request, {
    limitBytes: HOSTED_TELEGRAM_WEBHOOK_MAX_BODY_BYTES,
    tooLargeErrorCode: "TELEGRAM_WEBHOOK_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Telegram webhook body is too large.",
  });

  return jsonOk(
    await handleHostedOnboardingTelegramWebhook({
      rawBody,
      secretToken,
      signal: request.signal,
    }),
    202,
  );
});
