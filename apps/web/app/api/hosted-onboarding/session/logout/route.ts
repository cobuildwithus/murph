import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { revokeHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const clearCookies = await revokeHostedAppSessionFromRequest({
    reason: "logout",
    request,
  });
  const response = jsonOk({ ok: true });
  for (const cookie of clearCookies) response.headers.append("Set-Cookie", cookie);
  return response;
});
