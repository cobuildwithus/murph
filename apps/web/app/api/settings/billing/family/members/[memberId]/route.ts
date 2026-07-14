import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  removeHostedFamilyMemberTx,
  updateHostedFamilyMemberPlan,
} from "@/src/lib/hosted-onboarding/family-plan";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const PATCH = withJsonError(async (
  request: Request,
  context: { params: Promise<{ memberId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const memberId = await resolveDecodedRouteParam(context.params, "memberId");
  const body = await readOptionalJsonObject(request, { limitBytes: 1_024 });
  const group = await prisma.hostedAccountGroup.findUnique({
    select: { id: true },
    where: { ownerMemberId: auth.member.id },
  });
  if (!group) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_OWNER_REQUIRED",
      httpStatus: 403,
      message: "Only the Family plan owner can change member tiers.",
    });
  }
  const snapshot = await updateHostedFamilyMemberPlan({
    groupId: group.id,
    memberId,
    ownerMemberId: auth.member.id,
    planCode: body.planCode,
    prisma,
  });
  return jsonOk({
    members: snapshot.members,
    plans: snapshot.plans,
    seats: snapshot.seats,
  });
});

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
