import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { clearHostedSessionCookie, revokeHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export const POST = withJsonError(async (request: Request) => {
    assertHostedOnboardingMutationOrigin(request);
    await revokeHostedSessionFromRequest(request);
    const response = jsonOk({ ok: true });
    clearHostedSessionCookie(response);
    return response;
});
