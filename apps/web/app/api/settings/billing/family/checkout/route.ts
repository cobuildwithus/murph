import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  abandonHostedFamilyDraftForOwner,
  createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx,
  readHostedFamilyDraftRecoveryStateForOwner,
} from "@/src/lib/hosted-onboarding/family-plan";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { parseHostedFamilyInviteReturnPath } from "@/src/lib/hosted-onboarding/app-routes";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const body = await readOptionalJsonObject(request, {
    limitBytes: 1_024,
  });
  const abandonForInvite = body.abandonForInvite === true;
  const familyInviteReturnPath = abandonForInvite
    ? parseHostedFamilyInviteReturnPath(body.familyInviteReturnPath)
    : null;
  if (!abandonForInvite && body.familyInviteReturnPath != null) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_RETURN_UNEXPECTED",
      httpStatus: 400,
      message: "Family invite return is only allowed during invite recovery.",
    });
  }
  if (abandonForInvite && !familyInviteReturnPath) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_RETURN_REQUIRED",
      httpStatus: 400,
      message: "Family invite return path is required for invite recovery.",
    });
  }
  let inviteRecovery: {
    checkoutAttemptId: string;
    groupId: string;
  } | null = null;
  if (abandonForInvite) {
    const recovery = await readHostedFamilyDraftRecoveryStateForOwner({
      ownerMemberId: auth.member.id,
      prisma,
    });
    if (recovery === null) {
      return jsonOk({
        alreadyActive: false,
        url: familyInviteReturnPath,
      });
    }
    if (recovery.state !== "checkout_starting") {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_DRAFT_CHANGED",
        httpStatus: 409,
        message: "Family setup changed before invite recovery started. Refresh and try again.",
        retryable: true,
      });
    }
    inviteRecovery = recovery;
  }

  const group = abandonForInvite
    ? await prisma.hostedAccountGroup.findUnique({
        select: { id: true },
        where: { ownerMemberId: auth.member.id },
      })
    : await prisma.$transaction((tx) =>
        ensureHostedAccountGroupForOwnerTx({
          ownerMemberId: auth.member.id,
          tx,
        }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (!group) {
    if (abandonForInvite) {
      return jsonOk({
        alreadyActive: false,
        url: familyInviteReturnPath,
      });
    }
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_DRAFT_CHANGED",
      httpStatus: 409,
      message: "Family setup changed before invite recovery started. Refresh and try again.",
      retryable: true,
    });
  }
  if (inviteRecovery && group.id !== inviteRecovery.groupId) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_DRAFT_CHANGED",
      httpStatus: 409,
      message: "Family setup changed before invite recovery started. Refresh and try again.",
      retryable: true,
    });
  }

  const checkout = await createHostedFamilyBillingCheckout({
    allowDirectPaidUpgrade: !abandonForInvite,
    confirmedTrialConversion: abandonForInvite
      ? undefined
      : body.confirmedTrialConversion,
    groupId: group.id,
    ownerMemberId: auth.member.id,
    prisma,
    requiredCheckoutAttemptId: inviteRecovery?.checkoutAttemptId,
    seatCount: abandonForInvite ? undefined : body.seatCount,
  });
  if (abandonForInvite) {
    if (!inviteRecovery) {
      throw new TypeError("Family invite recovery claim was not resolved.");
    }
    if (checkout.alreadyActive || !checkout.url) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_DRAFT_BILLING_SYNCING",
        httpStatus: 409,
        message: "Family billing changed while restoring the invite. Try again shortly.",
        retryable: true,
      });
    }
    const abandonment = await abandonHostedFamilyDraftForOwner({
      expectedDraftClaim: {
        checkoutAttemptId: inviteRecovery.checkoutAttemptId,
        groupId: inviteRecovery.groupId,
      },
      ownerMemberId: auth.member.id,
      prisma,
    });
    if (!abandonment.abandoned) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_DRAFT_CHANGED",
        httpStatus: 409,
        message: "Family setup changed before invite recovery completed. Try again.",
        retryable: true,
      });
    }
    return jsonOk({
      alreadyActive: false,
      url: familyInviteReturnPath,
    });
  }

  return jsonOk(checkout);
});
