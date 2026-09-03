import { getPrisma } from "@/src/lib/prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  removeHostedMemberLinkedAccountProjectionTx,
} from "@/src/lib/hosted-onboarding/linked-account-removal";
import {
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
} from "@/src/lib/hosted-onboarding/member-channel-sync";
import { readHostedPrivyUserById } from "@/src/lib/hosted-onboarding/privy";
import {
  extractHostedPrivyEmailAccount,
  extractHostedPrivyPhoneAccount,
  extractHostedPrivyVerifiedEmailAccount,
  resolveHostedPrivyLinkedAccounts,
  resolveHostedPrivyTelegramAccountSelection,
  type HostedPrivyLinkedAccountContainer,
  type PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";
import {
  requireFreshPrivyMemberAuthForHostedAppSession,
} from "@/src/lib/hosted-onboarding/request-auth";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import {
  isHostedPrivyAuthMethod,
  type HostedPrivyAuthMethod,
} from "@/src/lib/hosted-onboarding/types";

export const DELETE = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const { appSession, freshPrivy: auth } =
    await requireFreshPrivyMemberAuthForHostedAppSession(request);
  const body = await readOptionalJsonObject(request, { limitBytes: 1_024 });
  const method = body.method;
  const expectedIdentity = normalizeExpectedIdentity(body.expectedIdentity);

  if (!isHostedPrivyAuthMethod(method) || !expectedIdentity) {
    throw hostedOnboardingError({
      code: "LINKED_ACCOUNT_REMOVE_REQUEST_INVALID",
      message: "The linked-account removal request was invalid. Refresh Settings and try again.",
      httpStatus: 400,
    });
  }

  // The provider is the login-method authority. Resolve it before BEGIN so the
  // database transaction contains only the bounded canonical revocation.
  const providerUser = await readHostedPrivyUserById(appSession.privyUserId, {
      maxRetries: 0,
      signal: request.signal,
      timeout: 5_000,
    });
  const providerLinkedAccounts = resolveHostedPrivyLinkedAccounts(providerUser);
  assertProviderAccountRemoved({
    method,
    providerLinkedAccounts,
    providerUser,
  });

  if (!hasSupportedProviderSignIn(providerUser, providerLinkedAccounts)) {
    throw hostedOnboardingError({
      code: "LINKED_ACCOUNT_LAST_SIGN_IN",
      message: "Add another email, phone, or Telegram sign-in before removing this one.",
      httpStatus: 409,
    });
  }

  const prisma = getPrisma();
  const occurredAt = new Date().toISOString();
  const result = await prisma.$transaction(async (tx) => {
    const changed = await removeHostedMemberLinkedAccountProjectionTx({
      expectedIdentity,
      memberId: auth.member.id,
      method,
      prisma: tx,
    });
    const channelSyncDispatch = changed
      ? await enqueueHostedMemberChannelsUpdatedForActiveMemberTx({
          linkedAccounts: providerLinkedAccounts,
          memberId: auth.member.id,
          occurredAt,
          prisma: tx,
          sourceType: "settings.linked-account.remove",
        })
      : null;

    return {
      changed,
      channelSyncDispatch,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (result.channelSyncDispatch) {
    await signalHostedMailboxAppendBestEffort({
      expectedUserId: auth.member.id,
      mailboxItemId: result.channelSyncDispatch.mailboxItemId,
    });
  }

  return jsonOk({
    changed: result.changed,
    method,
    ok: true,
    runTriggered: result.channelSyncDispatch !== null,
  });
});

function assertProviderAccountRemoved(input: {
  method: HostedPrivyAuthMethod;
  providerLinkedAccounts: PrivyLinkedAccountLike[];
  providerUser: HostedPrivyLinkedAccountContainer;
}): void {
  const telegramSelection = input.method === "telegram"
    ? resolveHostedPrivyTelegramAccountSelection(input.providerUser)
    : null;
  const accountStillLinked = input.method === "phone"
    ? extractHostedPrivyPhoneAccount(input.providerLinkedAccounts) !== null
    : input.method === "email"
      ? extractHostedPrivyEmailAccount(input.providerLinkedAccounts) !== null
      : Boolean(telegramSelection?.ambiguous || telegramSelection?.account);

  if (accountStillLinked) {
    throw hostedOnboardingError({
      code: "PRIVY_ACCOUNT_UNLINK_NOT_READY",
      message: "The removed sign-in has not reached Privy yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }
}

function hasSupportedProviderSignIn(
  providerUser: HostedPrivyLinkedAccountContainer,
  linkedAccounts: PrivyLinkedAccountLike[],
): boolean {
  const telegramSelection = resolveHostedPrivyTelegramAccountSelection(providerUser);

  return Boolean(
    extractHostedPrivyPhoneAccount(linkedAccounts)
    || extractHostedPrivyVerifiedEmailAccount(linkedAccounts)
    || (!telegramSelection.ambiguous && telegramSelection.account),
  );
}

function normalizeExpectedIdentity(value: unknown): string | null {
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
    // The revocation is already durable; the next runtime reconciliation is
    // the fail-closed backstop when this latency-only wake is unavailable.
  }
}
