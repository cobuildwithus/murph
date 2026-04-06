import { Prisma } from "@prisma/client";

import { getPrisma } from "@/src/lib/prisma";
import { createHostedTelegramUserLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { upsertHostedMemberTelegramRoutingBinding } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { resolveHostedPrivyTelegramAccountSelection } from "@/src/lib/hosted-onboarding/privy-shared";
import { requireHostedPrivyActiveRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";
import { buildHostedTelegramBotLink } from "@/src/lib/hosted-onboarding/telegram";

export const POST = withJsonError(async (request: Request) => {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requireHostedPrivyActiveRequestAuthContext(request);
    const body = await readOptionalJsonObject(request);
    const expectedTelegramUserId = normalizeComparableTelegramUserId(
      typeof body.expectedTelegramUserId === "string" ? body.expectedTelegramUserId : null,
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
    const telegramLookupKey = createHostedTelegramUserLookupKey(
      telegramAccount?.telegramUserId,
    );

    if (
      !telegramAccount
      || telegramAccount.telegramUserId !== expectedTelegramUserId
      || !telegramLookupKey
    ) {
      throw hostedOnboardingError({
        code: "PRIVY_TELEGRAM_NOT_READY",
        message: "Your linked Telegram account has not reached the server-side Privy session yet. Wait a moment and try again.",
        httpStatus: 409,
        retryable: true,
      });
    }

    try {
      await upsertHostedMemberTelegramRoutingBinding({
        memberId: auth.member.id,
        prisma: getPrisma(),
        telegramUserLookupKey: telegramLookupKey,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw hostedOnboardingError({
          code: "TELEGRAM_IDENTITY_CONFLICT",
          message: "That Telegram account is already linked to a different Murph account. Contact support so we can merge it safely.",
          httpStatus: 409,
        });
      }

      throw error;
    }

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
