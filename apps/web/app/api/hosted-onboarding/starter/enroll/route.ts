import { ensureHostedStarterUsageEnrollment } from "@/src/lib/hosted-onboarding/starter-usage-enrollment-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  const { inviteCode } = await requireHostedInviteCodeFromRequest(request);
  return jsonOk(await ensureHostedStarterUsageEnrollment({
    inviteCode,
    member: {
      id: auth.member.id,
      suspendedAt: auth.member.suspendedAt,
    },
    source: "web_onboarding",
  }));
});
