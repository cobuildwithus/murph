import { getPrisma } from "@/src/lib/prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { upsertHostedMemberTelegramRoutingBindingTx } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import {
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
} from "@/src/lib/hosted-onboarding/member-channel-sync";
import { resolveHostedPrivyTelegramAccountSelection } from "@/src/lib/hosted-onboarding/privy-shared";
import { requireFreshPrivyMemberAuthForHostedAppSession } from "@/src/lib/hosted-onboarding/request-auth";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import { buildHostedTelegramBotLink } from "@/src/lib/hosted-onboarding/telegram";
import {
  rearmHostedPhoneCallResultNotificationRecovery,
} from "@/src/lib/phone-calls/reconciliation-workflow-start";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const { freshPrivy: auth } = await requireFreshPrivyMemberAuthForHostedAppSession(request);
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
  const now = new Date();
  const channelSyncDispatch = await prisma.$transaction(async (tx) => {
    await upsertHostedMemberTelegramRoutingBindingTx({
      memberId: auth.member.id,
      prisma: tx,
      telegramUserId: telegramAccount.telegramUserId,
    });

    return enqueueHostedMemberChannelsUpdatedForActiveMemberTx({
      linkedAccounts: auth.linkedAccounts,
      memberId: auth.member.id,
      occurredAt: now.toISOString(),
      prisma: tx,
      sourceType: "settings.telegram.sync",
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  await rearmHostedPhoneCallResultNotificationRecovery({
    memberId: auth.member.id,
    prisma,
    signal: request.signal,
  });

  if (channelSyncDispatch) {
    await signalHostedMailboxAppendBestEffort({
      expectedUserId: auth.member.id,
      mailboxItemId: channelSyncDispatch.mailboxItemId,
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

async function signalHostedMailboxAppendBestEffort(input: {
  expectedUserId: string;
  mailboxItemId: string;
}): Promise<void> {
  try {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: input.expectedUserId,
      mailboxItemId: input.mailboxItemId,
    });
  } catch {
    // Settings sync should not fail if the best-effort runtime wake is unavailable.
  }
}
