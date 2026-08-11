import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
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

  return jsonOk(checkout);
});
