import { NextResponse } from "next/server";

import {
  claimHostedSignupReferralLink,
} from "@/src/lib/hosted-growth/signup-referral";
import {
  assertHostedOnboardingMutationOrigin,
} from "@/src/lib/hosted-onboarding/csrf";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ referralCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const referralCode = await resolveDecodedRouteParam(
    context.params,
    "referralCode",
  );
  const response = NextResponse.redirect(
    (await claimHostedSignupReferralLink({ referralCode })).signupUrl,
    303,
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
