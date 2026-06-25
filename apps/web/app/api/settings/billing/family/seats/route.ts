import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  ensureHostedAccountGroupForOwnerTx,
  updateHostedFamilySeatCount,
} from "@/src/lib/hosted-onboarding/family-plan";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const PATCH = withJsonError(async (request: Request) => {
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

  const snapshot = await updateHostedFamilySeatCount({
    groupId: group.id,
    ownerMemberId: auth.member.id,
    prisma,
    targetSeatCount: body.seatCount,
  });

  return jsonOk({
    seats: snapshot.seats,
  });
});
