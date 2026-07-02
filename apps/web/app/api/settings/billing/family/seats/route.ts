import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  readHostedFamilyOwnerSnapshotForMember,
  updateHostedFamilySeatCount,
  waitForHostedFamilyBilledSeatCount,
} from "@/src/lib/hosted-onboarding/family-plan";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { getPrisma } from "@/src/lib/prisma";

export const PATCH = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const body = await readOptionalJsonObject(request, {
    limitBytes: 1_024,
  });

  const group = await prisma.hostedAccountGroup.findUnique({
    select: {
      id: true,
    },
    where: {
      ownerMemberId: auth.member.id,
    },
  });
  if (!group) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_GROUP_NOT_FOUND",
      httpStatus: 404,
      message: "Family plan not found.",
    });
  }

  const snapshot = await updateHostedFamilySeatCount({
    groupId: group.id,
    ownerMemberId: auth.member.id,
    prisma,
    targetSeatCount: body.seatCount,
  });

  // Wait for the webhook to reconcile the new count so the owner sees the real
  // number right away instead of the pre-change value; fall back to the initial
  // snapshot if confirmation is slow.
  const confirmed = await waitForHostedFamilyBilledSeatCount({
    groupId: group.id,
    prisma,
    targetSeatCount: Number(body.seatCount),
  })
    ? await readHostedFamilyOwnerSnapshotForMember({ memberId: auth.member.id, prisma })
    : null;

  return jsonOk({
    seats: (confirmed ?? snapshot).seats,
  });
});
