import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { readHostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";
import {
  buildHostedFamilyInviteAcceptUrl,
  buildHostedFamilyTelegramInviteUrl,
  ensureHostedAccountGroupForOwnerTx,
  hostedFamilyInviteHasReusableTarget,
  issueHostedFamilyInviteTx,
  readHostedFamilyOwnerSnapshotForMember,
  updateHostedFamilySeatCount,
  waitForHostedFamilyBilledSeatCount,
} from "@/src/lib/hosted-onboarding/family-plan";
import { hostedOnboardingError, isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const body = await readOptionalJsonObject(request, { limitBytes: 2_048 });
  const targetLabel = typeof body.targetLabel === "string" ? body.targetLabel : null;
  const targetEmail = typeof body.targetEmail === "string" ? body.targetEmail : null;
  const targetPhoneNumber =
    typeof body.targetPhoneNumber === "string" ? body.targetPhoneNumber : null;
  const targetTelegramUsername =
    typeof body.targetTelegramUsername === "string" ? body.targetTelegramUsername : null;

  if (!targetPhoneNumber && !targetTelegramUsername && !targetEmail && !targetLabel) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_TARGET_REQUIRED",
      httpStatus: 400,
      message: "Add a phone number, email, Telegram username, or name for the person you are inviting.",
    });
  }

  // Auto-adding a seat only happens for invites the issuer can dedup on retry
  // (a normalized phone/email/Telegram). Label-only or invalid-contact invites
  // have no reuse key, so a lost-response retry could otherwise buy a second seat.
  const canAutoAddSeat =
    body.addSeatIfNeeded === true &&
    hostedFamilyInviteHasReusableTarget({ targetEmail, targetPhoneNumber, targetTelegramUsername });

  const issueInvite = () =>
    prisma.$transaction(async (tx) => {
      const group = await ensureHostedAccountGroupForOwnerTx({
        ownerMemberId: auth.member.id,
        tx,
      });
      return issueHostedFamilyInviteTx({
        groupId: group.id,
        invitedByMemberId: auth.member.id,
        targetEmail,
        targetLabel,
        targetPhoneNumber,
        targetTelegramUsername,
        tx,
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  // Only grow the plan when the invite genuinely needs a seat. Reused invites
  // return before the seat check, so a duplicate/retried invite never buys one.
  let invite;
  try {
    invite = await issueInvite();
  } catch (error) {
    if (!canAutoAddSeat || !isSeatLimitError(error)) {
      throw error;
    }
    const seatResult = await addSeatThenInvite(prisma, auth.member.id, issueInvite);
    if (seatResult === "unavailable") {
      throw error;
    }
    if (seatResult === "syncing") {
      // The seat was added and charged, but Stripe has not reconciled the count
      // yet. Tell the owner it is finishing rather than failing the invite.
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_SEAT_ADDED_SYNCING",
        httpStatus: 409,
        message: "Added a paid seat — finishing with Stripe. Send the invite again in a moment.",
      });
    }
    invite = seatResult.invite;
  }

  const { publicBaseUrl, telegramBotUsername } = readHostedOnboardingEnvironment();

  return jsonOk({
    invite: {
      acceptUrl: buildHostedFamilyInviteAcceptUrl({
        inviteCode: invite.inviteCode,
        publicBaseUrl,
      }),
      channel: invite.channel,
      expiresAt: invite.expiresAt.toISOString(),
      id: invite.id,
      status: invite.status,
      targetLabel: invite.targetLabel,
      targetPhoneHint: invite.targetPhoneHint,
      telegramInviteUrl: telegramBotUsername
        ? buildHostedFamilyTelegramInviteUrl({
            botUsername: telegramBotUsername,
            inviteCode: invite.inviteCode,
          })
        : null,
    },
  });
});

function isSeatLimitError(error: unknown): boolean {
  return isHostedOnboardingError(error) && error.code === "HOSTED_FAMILY_SEAT_LIMIT_REACHED";
}

async function addSeatThenInvite<T>(
  prisma: ReturnType<typeof getPrisma>,
  ownerMemberId: string,
  issueInvite: () => Promise<T>,
): Promise<{ invite: T } | "syncing" | "unavailable"> {
  // Re-check before buying: a concurrent invite for the same target may have just
  // created the reusable invite or freed a seat, in which case this issue reuses
  // it (or takes the open seat) and no purchase is needed.
  try {
    return { invite: await issueInvite() };
  } catch (error) {
    if (!isSeatLimitError(error)) {
      throw error;
    }
  }

  const snapshot = await readHostedFamilyOwnerSnapshotForMember({
    memberId: ownerMemberId,
    prisma,
  });
  if (!snapshot?.billingActive || snapshot.seats.billed >= snapshot.seats.max) {
    return "unavailable";
  }
  const targetSeatCount = snapshot.seats.billed + 1;
  await updateHostedFamilySeatCount({
    groupId: snapshot.groupId,
    ownerMemberId,
    prisma,
    targetSeatCount,
  });
  // Only issue once the webhook reconciled the new count, so the follow-up invite
  // sees the open seat. If it is still syncing, the caller tells the owner to
  // retry rather than failing with a bare seat-limit error.
  const confirmed = await waitForHostedFamilyBilledSeatCount({
    groupId: snapshot.groupId,
    prisma,
    targetSeatCount,
  });
  if (!confirmed) {
    return "syncing";
  }
  return { invite: await issueInvite() };
}
