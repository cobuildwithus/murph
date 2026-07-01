import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { readHostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";
import {
  buildHostedFamilyInviteAcceptUrl,
  buildHostedFamilyTelegramInviteUrl,
  ensureHostedAccountGroupForOwnerTx,
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
  // When it does need a seat, add one, wait for Stripe's webhook to confirm the
  // new count, then issue once. If the webhook has not landed yet the retry
  // surfaces the seat-limit error (the owner just retries) rather than buying a
  // second seat.
  let invite;
  try {
    invite = await issueInvite();
  } catch (error) {
    if (
      body.addSeatIfNeeded !== true ||
      !isHostedOnboardingError(error) ||
      error.code !== "HOSTED_FAMILY_SEAT_LIMIT_REACHED"
    ) {
      throw error;
    }
    const seatResult = await addHostedFamilySeatForOwner(prisma, auth.member.id);
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
    invite = await issueInvite();
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

async function addHostedFamilySeatForOwner(
  prisma: ReturnType<typeof getPrisma>,
  ownerMemberId: string,
): Promise<"confirmed" | "syncing" | "unavailable"> {
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
  // Only report the seat ready once the webhook reconciled the new count, so the
  // follow-up invite sees the open seat. If it is still syncing the caller tells
  // the owner to retry rather than failing with a bare seat-limit error.
  const confirmed = await waitForHostedFamilyBilledSeatCount({
    groupId: snapshot.groupId,
    prisma,
    targetSeatCount,
  });
  return confirmed ? "confirmed" : "syncing";
}
