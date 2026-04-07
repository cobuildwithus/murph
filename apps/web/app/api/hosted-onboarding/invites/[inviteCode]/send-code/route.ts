import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { prepareHostedInvitePhoneCode } from "@/src/lib/hosted-onboarding/invite-service";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const inviteCode = await resolveDecodedRouteParam(context.params, "inviteCode");
  return jsonOk(await prepareHostedInvitePhoneCode({ inviteCode }));
});
