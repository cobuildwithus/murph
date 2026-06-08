import { getPrisma } from "@/src/lib/prisma";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { readHostedPhoneHint } from "@/src/lib/hosted-onboarding/contact-privacy";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  assertHostedMemberNotSuspended,
} from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
} from "@/src/lib/hosted-onboarding/member-channel-sync";
import { reconcileHostedPrivyIdentityOnMemberTx } from "@/src/lib/hosted-onboarding/member-identity-service";
import { requireFreshPrivyMemberAuthForHostedAppSession } from "@/src/lib/hosted-onboarding/request-auth";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const { freshPrivy: auth } = await requireFreshPrivyMemberAuthForHostedAppSession(request);
  assertHostedMemberNotSuspended(auth.member);
  const phoneNumber = auth.identity.phone?.number ?? null;

  if (!phoneNumber) {
    throw hostedOnboardingError({
      code: "PRIVY_PHONE_NOT_READY",
      message: "Your verified phone number has not reached the server-side Privy session yet. Wait a moment and try again.",
      httpStatus: 409,
      retryable: true,
    });
  }

  const prisma = getPrisma();
  const now = new Date();
  const channelSyncDispatch = await prisma.$transaction(async (tx) => {
    await reconcileHostedPrivyIdentityOnMemberTx({
      identity: auth.identity,
      member: auth.member,
      now,
      prisma: tx,
    });

    return enqueueHostedMemberChannelsUpdatedForActiveMemberTx({
      linkedAccounts: auth.linkedAccounts,
      memberId: auth.member.id,
      occurredAt: now.toISOString(),
      prisma: tx,
      sourceType: "settings.phone.sync",
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (channelSyncDispatch) {
    await signalHostedMailboxAppendBestEffort({
      expectedUserId: auth.member.id,
      mailboxItemId: channelSyncDispatch.mailboxItemId,
      source: "settings.phone.sync",
    });
  }

  return jsonOk({
    ok: true,
    phoneNumber,
    phoneNumberHint: readHostedPhoneHint(phoneNumber),
    runTriggered: channelSyncDispatch !== null,
  });
});

async function signalHostedMailboxAppendBestEffort(input: {
  expectedUserId: string;
  mailboxItemId: string;
  source: string;
}): Promise<void> {
  try {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: input.expectedUserId,
      mailboxItemId: input.mailboxItemId,
      source: input.source,
    });
  } catch {
    // Settings sync should not fail if the best-effort runtime wake is unavailable.
  }
}
