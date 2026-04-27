import { getPrisma } from "@/src/lib/prisma";
import { nudgeHostedRunnerBestEffort } from "@/src/lib/hosted-runner/control";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  assertHostedMemberNotSuspended,
  hasHostedMemberActiveAccess,
} from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { upsertHostedMemberTelegramRoutingBindingTx } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import {
  enqueueHostedMemberChannelsUpdatedTx,
  resolveHostedMemberEmailLinked,
} from "@/src/lib/hosted-onboarding/member-channel-sync";
import { resolveHostedPrivyTelegramAccountSelection } from "@/src/lib/hosted-onboarding/privy-shared";
import { requirePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { buildHostedTelegramBotLink } from "@/src/lib/hosted-onboarding/telegram";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requirePrivyMemberAuth(request);
  assertHostedMemberNotSuspended(auth.member);
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

  const prisma = getPrisma();
  const shouldDispatchChannelsUpdate = hasHostedMemberActiveAccess(auth.member);
  const now = new Date();
  const emailLinked = shouldDispatchChannelsUpdate
    ? await resolveHostedMemberEmailLinked({
      linkedAccounts: auth.linkedAccounts,
      memberId: auth.member.id,
    })
    : false;
  const channelSyncDispatch = await prisma.$transaction(async (tx) => {
    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: auth.member.id,
      prisma: tx,
      telegramUserId: telegramAccount.telegramUserId,
    });

    if (!shouldDispatchChannelsUpdate) {
      return null;
    }

    return enqueueHostedMemberChannelsUpdatedTx({
      emailLinked,
      memberId: auth.member.id,
      occurredAt: now.toISOString(),
      prisma: tx,
      sourceType: "settings.telegram.sync",
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (channelSyncDispatch) {
    await nudgeHostedRunnerBestEffort({
      context: "settings.telegram.sync",
      userId: auth.member.id,
    });
  }

  return jsonOk({
    botLink: buildHostedTelegramBotLink("connect"),
    ok: true,
    runTriggered: channelSyncDispatch !== null,
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
