import {
  issueHostedSignupReferralLink,
} from "@/src/lib/hosted-growth/signup-referral";
import {
  requireHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import {
  assertHostedMemberNotSuspended,
} from "@/src/lib/hosted-onboarding/entitlement";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const referral = await issueHostedSignupReferralLink({
    referrerMemberId: auth.member.id,
  });
  return jsonOk({
    expiresAt: referral.expiresAt.toISOString(),
    signupUrl: referral.signupUrl,
  });
});
