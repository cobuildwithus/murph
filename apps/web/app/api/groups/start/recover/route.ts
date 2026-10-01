import { isUniqueViolation } from "@/src/lib/device-sync/prisma-store/prisma-errors";
import {
  prepareHostedDomainRootForWeb,
  revalidatePreparedHostedDomainRootForWebTx,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  runWithHostedDomainRootProviderCallsDisabled,
  runWithHostedDomainRootUnwrapCache,
} from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  assertHostedMemberLinqEmailHandleOwnerTx,
  bindHostedMemberLinqEmailHandleTx,
} from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import {
  readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { openHostedLinqGroupEmailRecoveryToken } from "@/src/lib/hosted-onboarding/linq-group-setup";
import { acquireHostedLinqParticipantContactLockTx } from "@/src/lib/hosted-onboarding/linq-participant-contact";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import { acquireHostedLinqChatOwnershipLockTx } from "@/src/lib/hosted-routing/linq-chat-ownership-lock";
import { readHostedThreadRouteByThreadIdentity } from "@/src/lib/hosted-routing/thread-route-store";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 8_192;

export const POST = withJsonError(async (request: Request) => runWithHostedDomainRootUnwrapCache(async () => {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(session.member);

  const body = await readOptionalJsonObject(request, {
    limitBytes: BODY_LIMIT_BYTES,
  });
  const token = readRecoveryToken(body.token);
  const recovery = openHostedLinqGroupEmailRecoveryToken({ token });
  if (!recovery) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID",
      httpStatus: 410,
      message: "That Messages recovery link is invalid or expired.",
      retryable: false,
    });
  }

  const prisma = getPrisma();
  const preparedControlRoot = await prepareHostedDomainRootForWeb({
    domain: "control",
    prisma,
    reason: "hosted-group.email-recovery",
    userId: session.member.id,
  });
  // Warm existing private routing reads before taking any transaction locks.
  await readHostedMemberRoutingState({ memberId: session.member.id, prisma });
  const status = await runWithHostedDomainRootProviderCallsDisabled(() => prisma.$transaction(async (tx) => {
    await acquireHostedLinqParticipantContactLockTx({
      contact: recovery.participantContact,
      tx,
    });
    await acquireHostedLinqChatOwnershipLockTx({
      chatId: recovery.chatId,
      tx,
    });
    const route = await readHostedThreadRouteByThreadIdentity({
      channel: "linq",
      prisma: tx,
      threadId: recovery.chatId,
    });
    if (route) {
      return "already_connected" as const;
    }

    await assertHostedMemberLinqEmailHandleOwnerTx({
      emailAddress: recovery.participantContact.value,
      memberId: session.member.id,
      prisma: tx,
    });
    const verifiedEmail = await lookupHostedMemberByVerifiedEmailAddress({
      address: recovery.participantContact.value,
      prisma: tx,
      projection: "core",
    });
    if (verifiedEmail) {
      if (verifiedEmail.core.id !== session.member.id) {
        throwRecoveryConflict();
      }
      return "linked" as const;
    }

    await revalidatePreparedHostedDomainRootForWebTx({
      prepared: preparedControlRoot,
      tx,
    });
    await lockHostedMemberRow(tx, session.member.id);
    const routing = await readHostedMemberRoutingState({
      memberId: session.member.id,
      prisma: tx,
    });
    const pendingChatId = routing?.pendingLinqChatId ?? null;
    const pendingContact = routing?.pendingLinqParticipantContact ?? null;
    const pendingRecipientPhone =
      routing?.pendingLinqRecipientPhone ?? null;
    const hasPendingBinding = Boolean(
      pendingChatId || pendingContact || pendingRecipientPhone,
    );
    const exactPendingBinding =
      pendingChatId === recovery.chatId
      && pendingContact?.lookupKey === recovery.participantContact.lookupKey
      && pendingRecipientPhone === recovery.recipientPhone;
    if (hasPendingBinding && !exactPendingBinding) {
      throwRecoveryConflict();
    }

    try {
      await bindHostedMemberLinqEmailHandleTx({
        emailAddress: recovery.participantContact.value,
        lookupKey: recovery.participantContact.lookupKey,
        memberId: session.member.id,
        prisma: tx,
      });
      await upsertHostedMemberPendingLinqBindingTx({
        homeLineAssignedAt: null,
        linqChatId: recovery.chatId,
        memberId: session.member.id,
        participantContact: recovery.participantContact,
        participantContactObservedAt: recovery.observedAt,
        prisma: tx,
        recipientPhone: recovery.recipientPhone,
      });
    } catch (error) {
      // The routing store signals "this contact already belongs to another
      // member" as a unique-violation. The checks above only see the session
      // member's own bindings, so this is the same conflict arriving from the
      // one place that can see every member's — report it as one.
      if (isUniqueViolation(error)) {
        throwRecoveryConflict();
      }
      throw error;
    }
    return "linked" as const;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS));

  return jsonOk({
    ok: true,
    status,
  });
}));

function throwRecoveryConflict(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT",
    httpStatus: 409,
    message:
      "That Messages address is already linked to another Murph setup.",
    retryable: false,
  });
}

function readRecoveryToken(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 6_000
    || value !== value.trim()
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID",
      httpStatus: 400,
      message: "A valid Messages recovery link is required.",
      retryable: false,
    });
  }
  return value;
}
