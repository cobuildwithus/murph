import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { requireHostedPrivyCompletionRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedPrivyCompletionRequestAuthContext(request);
  const body = await readOptionalJsonObject(request);
  const result = await completeHostedPrivyVerification({
    identity: auth.identity,
    inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
  });

  return jsonOk({
    inviteCode: result.inviteCode,
    joinUrl: result.joinUrl,
    ok: true,
    stage: result.stage,
  });
});
