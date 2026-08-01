import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
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
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { acquireHostedLinqChatOwnershipLockTx } from "@/src/lib/hosted-routing/linq-chat-ownership-lock";
import { readHostedThreadRouteByThreadIdentity } from "@/src/lib/hosted-routing/thread-route-store";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 8_192;

export const POST = withJsonError(async (request: Request) => {
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
  const status = await prisma.$transaction(async (tx) => {
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

    const verifiedEmail = await lookupHostedMemberByVerifiedEmailAddress({
      address: recovery.participantContact.value,
      prisma: tx,
    });
    if (verifiedEmail) {
      if (verifiedEmail.core.id !== session.member.id) {
        throwRecoveryConflict();
      }
      return "linked" as const;
    }

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

    await upsertHostedMemberPendingLinqBindingTx({
      homeLineAssignedAt: null,
      linqChatId: recovery.chatId,
      memberId: session.member.id,
      participantContact: recovery.participantContact,
      participantContactObservedAt: recovery.observedAt,
      prisma: tx,
      recipientPhone: recovery.recipientPhone,
    });
    return "linked" as const;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return jsonOk({
    ok: true,
    status,
  });
});

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
