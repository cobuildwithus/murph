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
import {
  jsonError,
  logHostedOnboardingRouteFailure,
} from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ referralCode: string }> },
): Promise<Response> {
  let referralCode: string;
  try {
    referralCode = await resolveDecodedRouteParam(
      context.params,
      "referralCode",
    );
    assertHostedOnboardingMutationOrigin(request);
  } catch (error) {
    return jsonError(error);
  }

  try {
    const response = NextResponse.redirect(
      (await claimHostedSignupReferralLink({ referralCode })).signupUrl,
      303,
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (!isHostedOnboardingError(error)) {
      logHostedOnboardingRouteFailure({
        error,
        operationName: "signup-referral.claim",
        requestMethod: request.method,
      });
      return redirectToHostedSignupReferralLanding({
        referralCode,
        request,
        status: "busy",
      });
    }

    const status = (
      error.code === "HOSTED_SIGNUP_REFERRAL_CLAIM_LIMIT_REACHED"
      || error.code === "HOSTED_SIGNUP_REFERRAL_CLAIM_BUSY"
    )
      ? "busy"
      : "unavailable";
    return redirectToHostedSignupReferralLanding({
      referralCode,
      request,
      status,
    });
  }
}

function redirectToHostedSignupReferralLanding(input: {
  referralCode: string;
  request: Request;
  status: "busy" | "unavailable";
}): Response {
  const landingUrl = new URL(
    `/r/${encodeURIComponent(input.referralCode)}`,
    input.request.url,
  );
  landingUrl.searchParams.set("status", input.status);
  const response = NextResponse.redirect(landingUrl, 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
