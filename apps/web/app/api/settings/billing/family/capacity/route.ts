import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedFamilyOwnerSnapshotForMember,
  updateHostedFamilyPlanCapacities,
  waitForHostedFamilyPlanCapacities,
} from "@/src/lib/hosted-onboarding/family-plan";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { parseHostedFamilyPlanCapacities } from "@/src/lib/hosted-onboarding/family-plan-capacity";

export const PATCH = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const body = await readOptionalJsonObject(request, { limitBytes: 1_024 });
  const targetCapacities = parseHostedFamilyPlanCapacities(body.capacities);
  if (!targetCapacities) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_CAPACITY_INVALID",
      httpStatus: 400,
      message: "Family capacity must contain 2 to 6 total Pulse and Edge seats.",
    });
  }
  const group = await prisma.hostedAccountGroup.findUnique({
    select: { id: true },
    where: { ownerMemberId: auth.member.id },
  });
  if (!group) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_GROUP_NOT_FOUND",
      httpStatus: 404,
      message: "Family plan not found.",
    });
  }
  const snapshot = await updateHostedFamilyPlanCapacities({
    groupId: group.id,
    ownerMemberId: auth.member.id,
    prisma,
    targetCapacities,
  });
  const confirmed = await waitForHostedFamilyPlanCapacities({
    groupId: group.id,
    prisma,
    targetCapacities,
  })
    ? await readHostedFamilyOwnerSnapshotForMember({ memberId: auth.member.id, prisma })
    : null;
  const current = confirmed ?? snapshot;
  return jsonOk({
    plans: current.plans,
    seats: current.seats,
    syncing: confirmed === null,
  });
});
