import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { clearHostedSessionCookie, revokeHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export async function POST(request: Request) {
  try {
    assertHostedOnboardingMutationOrigin(request);
    await revokeHostedSessionFromRequest(request);
    const response = jsonOk({ ok: true });
    clearHostedSessionCookie(response);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
