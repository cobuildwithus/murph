import { NextResponse } from "next/server";

import {
  claimHostedSignupReferralLink,
} from "@/src/lib/hosted-growth/signup-referral";
import {
  assertHostedOnboardingMutationOrigin,
} from "@/src/lib/hosted-onboarding/csrf";
import {
  isHostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ referralCode: string }> },
) => {
  const referralCode = await resolveDecodedRouteParam(
    context.params,
    "referralCode",
  );
  assertHostedOnboardingMutationOrigin(request);

  try {
    const response = NextResponse.redirect(
      (await claimHostedSignupReferralLink({ referralCode })).signupUrl,
      303,
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (!isHostedOnboardingError(error)) {
      throw error;
    }

    const status = (
      error.code === "HOSTED_SIGNUP_REFERRAL_CLAIM_LIMIT_REACHED"
      || error.code === "HOSTED_SIGNUP_REFERRAL_CLAIM_BUSY"
    )
      ? "busy"
      : "unavailable";
    const landingUrl = new URL(
      `/r/${encodeURIComponent(referralCode)}`,
      request.url,
    );
    landingUrl.searchParams.set("status", status);
    const response = NextResponse.redirect(landingUrl, 303);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
});
