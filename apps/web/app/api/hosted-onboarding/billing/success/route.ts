import { reconcileHostedBillingCheckoutSuccess } from "@/src/lib/hosted-onboarding/billing-success-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { requirePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requirePrivyMemberAuth(request);
  const body = await readJsonObject(request);
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;

  if (!inviteCode) {
    throw new TypeError("inviteCode is required.");
  }

  if (!sessionId) {
    throw new TypeError("sessionId is required.");
  }

  await completeHostedPrivyVerification({
    identity: auth.identity,
    inviteCode,
    verifiedPrivyUser: auth.verifiedPrivyUser,
  });

  return jsonOk(await reconcileHostedBillingCheckoutSuccess({
    inviteCode,
    linkedAccounts: auth.linkedAccounts,
    member: auth.member,
    sessionId,
  }));
});
