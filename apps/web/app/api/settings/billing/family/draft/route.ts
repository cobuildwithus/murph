import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { abandonHostedFamilyDraftForOwner } from "@/src/lib/hosted-onboarding/family-plan";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const DELETE = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const body = await readOptionalJsonObject(request, { limitBytes: 1_024 });
  const groupId = typeof body.groupId === "string" && body.groupId.length > 0
    ? body.groupId
    : null;
  const checkoutAttemptId = body.checkoutAttemptId === null
    ? null
    : typeof body.checkoutAttemptId === "string"
        && body.checkoutAttemptId.length > 0
      ? body.checkoutAttemptId
      : undefined;
  if (!groupId || checkoutAttemptId === undefined) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_DRAFT_CLAIM_REQUIRED",
      httpStatus: 400,
      message: "The exact rendered Family draft is required for abandonment.",
    });
  }

  const result = await abandonHostedFamilyDraftForOwner({
    expectedDraftClaim: { checkoutAttemptId, groupId },
    ownerMemberId: auth.member.id,
    prisma: getPrisma(),
  });
  return jsonOk(result);
});
