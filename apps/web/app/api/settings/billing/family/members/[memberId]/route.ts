import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { removeHostedFamilyMemberTx } from "@/src/lib/hosted-onboarding/family-plan";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const DELETE = withJsonError(async (
  request: Request,
  context: { params: Promise<{ memberId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const memberId = await resolveDecodedRouteParam(context.params, "memberId");

  const removed = await prisma.$transaction(async (tx) => {
    const group = await tx.hostedAccountGroup.findUnique({
      select: { id: true },
      where: { ownerMemberId: auth.member.id },
    });
    if (!group) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_OWNER_REQUIRED",
        httpStatus: 403,
        message: "Only the family plan owner can remove family members.",
      });
    }
    return removeHostedFamilyMemberTx({
      groupId: group.id,
      memberId,
      ownerMemberId: auth.member.id,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (!removed) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "That person is not an active member of your family plan.",
    });
  }

  return jsonOk({ removed: true });
});
