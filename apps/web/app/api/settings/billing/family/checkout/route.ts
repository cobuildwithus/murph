import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx,
  hasActiveHostedFamilyAccess,
} from "@/src/lib/hosted-onboarding/family-plan";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  if (await hasActiveHostedFamilyAccess({
    memberId: auth.member.id,
    prisma,
  })) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
      httpStatus: 409,
      message: "You already have sponsored Family access. Leave that Family plan before starting your own.",
    });
  }

  const group = await prisma.$transaction((tx) =>
    ensureHostedAccountGroupForOwnerTx({
      ownerMemberId: auth.member.id,
      tx,
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  const checkout = await createHostedFamilyBillingCheckout({
    groupId: group.id,
    ownerMemberId: auth.member.id,
    prisma,
  });

  return jsonOk(checkout);
});
