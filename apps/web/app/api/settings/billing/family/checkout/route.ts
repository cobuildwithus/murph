import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  abandonHostedFamilyDraftForOwner,
  createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx,
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
  const familyInviteReturnPath = body.familyInviteReturnPath == null
    ? null
    : parseHostedFamilyInviteReturnPath(body.familyInviteReturnPath);
  if (body.familyInviteReturnPath != null && !familyInviteReturnPath) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_RETURN_INVALID",
      httpStatus: 400,
      message: "Family invite return path is invalid.",
    });
  }
  if (body.abandonForInvite === true && !familyInviteReturnPath) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_RETURN_REQUIRED",
      httpStatus: 400,
      message: "Family invite return path is required for invite recovery.",
    });
  }

  const group = await prisma.$transaction((tx) =>
    ensureHostedAccountGroupForOwnerTx({
      ownerMemberId: auth.member.id,
      tx,
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  const checkout = await createHostedFamilyBillingCheckout({
    confirmedTrialConversion: body.confirmedTrialConversion,
    familyInviteReturnPath,
    groupId: group.id,
    ownerMemberId: auth.member.id,
    prisma,
    seatCount: body.seatCount,
  });
  if (body.abandonForInvite === true) {
    if (checkout.alreadyActive || !checkout.url) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_DRAFT_BILLING_SYNCING",
        httpStatus: 409,
        message: "Family billing changed while restoring the invite. Try again shortly.",
        retryable: true,
      });
    }
    const abandonment = await abandonHostedFamilyDraftForOwner({
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
