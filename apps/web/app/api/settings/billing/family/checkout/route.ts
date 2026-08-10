import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx,
} from "@/src/lib/hosted-onboarding/family-plan";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
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
  const body = await readOptionalJsonObject(request, {
    limitBytes: 1_024,
  });

  const group = await prisma.$transaction((tx) =>
    ensureHostedAccountGroupForOwnerTx({
      ownerMemberId: auth.member.id,
      tx,
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  const checkout = await createHostedFamilyBillingCheckout({
    confirmedTrialConversion: body.confirmedTrialConversion,
    groupId: group.id,
    ownerMemberId: auth.member.id,
    prisma,
    seatCount: body.seatCount,
  });

  return jsonOk(checkout);
});
