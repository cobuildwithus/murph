import { getPrisma } from "@/src/lib/prisma";
import { drainHostedExecutionOutboxBestEffort } from "@/src/lib/hosted-execution/outbox";
import { readHostedPhoneHint } from "@/src/lib/hosted-onboarding/contact-privacy";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hasHostedMemberActiveAccess } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  enqueueHostedMemberChannelsUpdatedTx,
  resolveHostedMemberEmailLinked,
} from "@/src/lib/hosted-onboarding/member-channel-sync";
import { reconcileHostedPrivyIdentityOnMemberTx } from "@/src/lib/hosted-onboarding/member-identity-service";
import { requirePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requirePrivyMemberAuth(request);
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
  const shouldDispatchChannelsUpdate = hasHostedMemberActiveAccess(auth.member);
  const now = new Date();
  const emailLinked = shouldDispatchChannelsUpdate
    ? await resolveHostedMemberEmailLinked({
      linkedAccounts: auth.linkedAccounts,
      memberId: auth.member.id,
    })
    : false;
  const channelSyncDispatch = await prisma.$transaction(async (tx) => {
    await reconcileHostedPrivyIdentityOnMemberTx({
      identity: auth.identity,
      member: auth.member,
      now,
      prisma: tx,
    });

    if (!shouldDispatchChannelsUpdate) {
      return null;
    }

    return enqueueHostedMemberChannelsUpdatedTx({
      emailLinked,
      memberId: auth.member.id,
      occurredAt: now.toISOString(),
      prisma: tx,
      sourceType: "settings.phone.sync",
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (channelSyncDispatch) {
    await drainHostedExecutionOutboxBestEffort({
      eventIds: [channelSyncDispatch.eventId],
    });
  }

  return jsonOk({
    ok: true,
    phoneNumber,
    phoneNumberHint: readHostedPhoneHint(phoneNumber),
    runTriggered: channelSyncDispatch !== null,
  });
});
