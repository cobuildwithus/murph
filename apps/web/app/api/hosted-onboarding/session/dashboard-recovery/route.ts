import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { issueHostedInvite } from "@/src/lib/hosted-onboarding/invite-service";
import { deriveHostedPostVerificationStage } from "@/src/lib/hosted-onboarding/lifecycle";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);

  const { member } = await requireHostedAppSessionFromRequest(request);

  if (
    deriveHostedPostVerificationStage({
      billingStatus: member.billingStatus,
      suspendedAt: member.suspendedAt,
    }) !== "checkout"
  ) {
    return jsonOk({
      redirectPath: null,
    });
  }

  const invite = await issueHostedInvite({
    channel: "web",
    memberId: member.id,
  });

  return jsonOk({
    redirectPath: `/join/${encodeURIComponent(invite.inviteCode)}`,
  });
});
