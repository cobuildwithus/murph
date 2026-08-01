import { after } from "next/server";

import {
  jsonOk,
  readHostedOnboardingRawBodyText,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { assertHostedTelegramWebhookSecret } from "@/src/lib/hosted-onboarding/telegram";
import {
  handleHostedTelegramGroupReactionWebhook,
} from "@/src/lib/hosted-onboarding/telegram-group-reactions";
import { handleHostedOnboardingTelegramWebhookWithVisibleAccess } from "@/src/lib/hosted-onboarding/visible-access-webhooks";
import { withHostedVisibleSecondaryTelegramOutcomes } from "@/src/lib/hosted-onboarding/visible-secondary-webhooks";

const HOSTED_TELEGRAM_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
const handleHostedOnboardingTelegramWebhookWithVisibleOutcomes =
  withHostedVisibleSecondaryTelegramOutcomes(
    handleHostedOnboardingTelegramWebhookWithVisibleAccess,
  );

export const POST = withJsonError(async (request: Request) => {
  const secretToken = request.headers.get("x-telegram-bot-api-secret-token");
  assertHostedTelegramWebhookSecret(secretToken);
  const rawBody = await readHostedOnboardingRawBodyText(request, {
    limitBytes: HOSTED_TELEGRAM_WEBHOOK_MAX_BODY_BYTES,
    tooLargeErrorCode: "TELEGRAM_WEBHOOK_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Telegram webhook body is too large.",
  });
  const reactionResponse = await handleHostedTelegramGroupReactionWebhook({
    rawBody,
    scheduleAfterResponse: scheduleAfterResponseOrFireAndForget,
    signal: request.signal,
  });

  return jsonOk(
    reactionResponse ?? await handleHostedOnboardingTelegramWebhookWithVisibleOutcomes({
      rawBody,
      scheduleAfterResponse: scheduleAfterResponseOrFireAndForget,
      secretToken,
      signal: request.signal,
    }),
    202,
  );
});

function scheduleAfterResponseOrFireAndForget(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}
