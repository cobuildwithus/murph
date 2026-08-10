import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { readHostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";
import {
  buildHostedFamilyInviteAcceptUrl,
  ensureHostedAccountGroupForOwnerTx,
  hostedFamilyInviteHasReusableTarget,
  issueHostedFamilyInviteTx,
  readHostedFamilyOwnerSnapshotForMember,
  resolveHostedFamilyTelegramInviteUrl,
  updateHostedFamilyPlanCapacities,
  waitForHostedFamilyPlanCapacities,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  parseHostedPlanCode,
  type HostedPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
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
  const planCode = parseHostedPlanCode(body.planCode ?? "pulse");
  if (!planCode) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_PLAN_CODE_INVALID",
      httpStatus: 400,
      message: "Choose Pulse or Edge for this Family member.",
    });
  }

  if (!targetPhoneNumber && !targetTelegramUsername && !targetEmail && !targetLabel) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_TARGET_REQUIRED",
      httpStatus: 400,
      message: "Add a phone number, email, Telegram username, or name for the person you are inviting.",
    });
  }

  // Auto-adding a seat requires a contact channel that can be compared with an
  // already-active member's verified identity before purchase. Telegram
  // usernames dedup invites, but members are bound by Telegram user id, so a
  // username cannot prove the target is not already in this Family.
  const canAutoAddSeat =
    body.addSeatIfNeeded === true &&
    Boolean(targetPhoneNumber || targetEmail) &&
    hostedFamilyInviteHasReusableTarget({ targetEmail, targetPhoneNumber });

  const issueInvite = () =>
    prisma.$transaction(async (tx) => {
      const group = await ensureHostedAccountGroupForOwnerTx({
        ownerMemberId: auth.member.id,
        tx,
      });
      return issueHostedFamilyInviteTx({
        groupId: group.id,
        invitedByMemberId: auth.member.id,
        planCode,
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
    const seatResult = await addSeatThenInvite(prisma, auth.member.id, planCode, issueInvite);
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
      planCode: invite.planCode,
      status: invite.status,
      targetLabel: invite.targetLabel,
      targetPhoneHint: invite.targetPhoneHint,
      telegramInviteUrl: resolveHostedFamilyTelegramInviteUrl({
        inviteCode: invite.inviteCode,
        isTelegramBound: invite.targetTelegramUsername !== null,
        telegramBotUsername,
      }),
    },
  });
});

function isSeatLimitError(error: unknown): boolean {
  return isHostedOnboardingError(error) && error.code === "HOSTED_FAMILY_SEAT_LIMIT_REACHED";
}

async function addSeatThenInvite<T>(
  prisma: ReturnType<typeof getPrisma>,
  ownerMemberId: string,
  planCode: HostedPlanCode,
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
  if (!snapshot?.billingActive) {
    return "unavailable";
  }
  // A seat may have freed (invite expired/canceled, member removed) since the
  // re-check; take it instead of buying another.
  if (snapshot.plans[planCode].remaining > 0) {
    try {
      return { invite: await issueInvite() };
    } catch (error) {
      if (!isSeatLimitError(error)) {
        throw error;
      }
    }
  }
  if (snapshot.seats.billed >= snapshot.seats.max) {
    return "unavailable";
  }
  const targetCapacities = {
    edge: snapshot.plans.edge.billed,
    pulse: snapshot.plans.pulse.billed,
    [planCode]: snapshot.plans[planCode].billed + 1,
  };
  await updateHostedFamilyPlanCapacities({
    groupId: snapshot.groupId,
    ownerMemberId,
    prisma,
    targetCapacities,
  });
  // Give the webhook a moment to reconcile the new count, then let the invite
  // itself be the test: if any seat is now open (even if a concurrent change
  // pushed the count past our target) it lands; only a still-full plan reports
  // syncing so the owner retries instead of seeing a bare seat-limit error.
  await waitForHostedFamilyPlanCapacities({
    groupId: snapshot.groupId,
    prisma,
    targetCapacities,
  });
  try {
    return { invite: await issueInvite() };
  } catch (error) {
    if (isSeatLimitError(error)) {
      return "syncing";
    }
    throw error;
  }
}
