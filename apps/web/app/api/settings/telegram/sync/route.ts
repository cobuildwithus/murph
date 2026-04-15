import { getPrisma } from "@/src/lib/prisma";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { syncHostedMemberTelegramRoutingBinding } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { resolveHostedPrivyTelegramAccountSelection } from "@/src/lib/hosted-onboarding/privy-shared";
import { requirePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { buildHostedTelegramBotLink } from "@/src/lib/hosted-onboarding/telegram";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requirePrivyMemberAuth(request);
  const body = await readOptionalJsonObject(request);
  const expectedTelegramUserId = normalizeComparableTelegramUserId(
    typeof body?.expectedTelegramUserId === "string" ? body.expectedTelegramUserId : null,
  );

  if (!expectedTelegramUserId) {
    throw hostedOnboardingError({
      code: "TELEGRAM_USER_ID_REQUIRED",
      message: "Refresh Privy and confirm the Telegram account you want to sync before continuing.",
      httpStatus: 400,
    });
  }

  const telegramSelection = resolveHostedPrivyTelegramAccountSelection(auth.verifiedPrivyUser);

  if (telegramSelection.ambiguous) {
    throw hostedOnboardingError({
      code: "PRIVY_TELEGRAM_AMBIGUOUS",
      message:
        "The current Privy session has conflicting Telegram accounts. Reconnect Telegram in Privy and try again.",
      httpStatus: 409,
    });
  }

  const telegramAccount = telegramSelection.account;

  if (!telegramAccount || telegramAccount.telegramUserId !== expectedTelegramUserId) {
    throw hostedOnboardingError({
      code: "PRIVY_TELEGRAM_NOT_READY",
      message: "Your linked Telegram account has not reached the server-side Privy session yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }

  await syncHostedMemberTelegramRoutingBinding({
    memberId: auth.member.id,
    prisma: getPrisma(),
    telegramUserId: telegramAccount.telegramUserId,
  });

  return jsonOk({
    botLink: buildHostedTelegramBotLink("connect"),
    ok: true,
    runTriggered: false,
    telegramUserId: telegramAccount.telegramUserId,
    telegramUsername: telegramAccount.username,
  });
});

function normalizeComparableTelegramUserId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}
