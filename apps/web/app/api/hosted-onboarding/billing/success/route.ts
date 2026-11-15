import { RequestInputError } from "@murphai/hosted-execution/request-input";

import { reconcileHostedBillingCheckoutSuccess } from "@/src/lib/hosted-onboarding/billing-success-service";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const body = await readJsonObject(request);
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;

  if (!inviteCode) {
    throw new RequestInputError("inviteCode is required.");
  }

  if (!sessionId || /[\uD800-\uDFFF]/u.test(sessionId)) {
    throw new RequestInputError("sessionId is required.");
  }

  return jsonOk(await reconcileHostedBillingCheckoutSuccess({
    inviteCode,
    member: auth.member,
    sessionId,
  }));
});
