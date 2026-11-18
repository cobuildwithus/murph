import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { revokeHostedFamilyInvite } from "@/src/lib/hosted-onboarding/family-plan";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

export const DELETE = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  const inviteId = await resolveDecodedRouteParam(context.params, "inviteId");

  const revoked = await revokeHostedFamilyInvite({ inviteId, ownerMemberId: auth.member.id });

  if (!revoked) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_NOT_FOUND",
      httpStatus: 404,
      message: "That family invite is no longer pending.",
    });
  }

  return jsonOk({ revoked: true });
});
