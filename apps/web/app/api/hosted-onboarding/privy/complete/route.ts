import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { requireHostedPrivyCompletionIdentityFromCookies } from "@/src/lib/hosted-onboarding/privy";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { applyHostedSessionCookie } from "@/src/lib/hosted-onboarding/session";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const identity = await requireHostedPrivyCompletionIdentityFromCookies();
  const body = await readOptionalJsonObject(request);
  const result = await completeHostedPrivyVerification({
    identity,
    inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
  });
  const response = jsonOk({
    inviteCode: result.inviteCode,
    joinUrl: result.joinUrl,
    ok: true,
    stage: result.stage,
  });

  applyHostedSessionCookie(response, result.token, result.expiresAt);

  return response;
});
