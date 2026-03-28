import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";

import { getPrisma } from "@/src/lib/prisma";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import {
  readHostedPrivyIdentityTokenFromCookieStore,
  verifyHostedPrivyIdentityToken,
} from "@/src/lib/hosted-onboarding/privy";
import { extractHostedPrivyTelegramAccount } from "@/src/lib/hosted-onboarding/privy-shared";
import { resolveHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";
import { buildHostedTelegramBotLink } from "@/src/lib/hosted-onboarding/telegram";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const hostedSession = await resolveHostedSessionFromCookieStore(cookieStore);

    if (!hostedSession) {
      throw hostedOnboardingError({
        code: "AUTH_REQUIRED",
        message: "Sign in again before you sync Telegram.",
        httpStatus: 401,
      });
    }

    const identityToken = readHostedPrivyIdentityTokenFromCookieStore(cookieStore);

    if (!identityToken) {
      throw hostedOnboardingError({
        code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
        message: "Refresh the page and relink Telegram before we sync it.",
        httpStatus: 401,
      });
    }

    const verifiedPrivyUser = await verifyHostedPrivyIdentityToken(identityToken);

    if (verifiedPrivyUser.id !== hostedSession.member.privyUserId) {
      throw hostedOnboardingError({
        code: "PRIVY_SESSION_MISMATCH",
        message: "This Privy session does not match the current hosted account. Reopen the latest invite and try again.",
        httpStatus: 403,
      });
    }

    const telegramAccount = extractHostedPrivyTelegramAccount(verifiedPrivyUser);

    if (!telegramAccount) {
      throw hostedOnboardingError({
        code: "PRIVY_TELEGRAM_NOT_READY",
        message: "Your linked Telegram account has not reached the server-side Privy session yet. Wait a moment and try again.",
        httpStatus: 409,
        retryable: true,
      });
    }

    try {
      await getPrisma().hostedMember.update({
        where: {
          id: hostedSession.member.id,
        },
        data: {
          telegramUserId: telegramAccount.telegramUserId,
          telegramUsername: telegramAccount.username,
        },
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
  } catch (error) {
    return jsonError(error);
  }
}
