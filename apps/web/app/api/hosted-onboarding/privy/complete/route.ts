import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { requireHostedPrivyCompletionIdentityFromRequest } from "@/src/lib/hosted-onboarding/privy";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const identity = await requireHostedPrivyCompletionIdentityFromRequest(request);
  const body = await readOptionalJsonObject(request);
  const result = await completeHostedPrivyVerification({
    identity,
    inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
  });

  return jsonOk({
    inviteCode: result.inviteCode,
    joinUrl: result.joinUrl,
    ok: true,
    stage: result.stage,
  });
});
