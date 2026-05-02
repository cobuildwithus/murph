import { reconcileHostedBillingCheckoutSuccess } from "@/src/lib/hosted-onboarding/billing-success-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request);
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;

  if (!inviteCode) {
    throw new TypeError("inviteCode is required.");
  }

  if (!sessionId) {
    throw new TypeError("sessionId is required.");
  }

  return jsonOk(await reconcileHostedBillingCheckoutSuccess({
    inviteCode,
    member: auth.member,
    sessionId,
  }));
});
