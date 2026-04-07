import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { abortHostedInvitePhoneCode } from "@/src/lib/hosted-onboarding/invite-service";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const inviteCode = await resolveDecodedRouteParam(context.params, "inviteCode");
  const body = await readJsonObject(request);
  const sendAttemptId = typeof body.sendAttemptId === "string" ? body.sendAttemptId.trim() : "";

  return jsonOk(await abortHostedInvitePhoneCode({
    inviteCode,
    sendAttemptId,
  }));
});
