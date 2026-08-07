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
  } catch (error) {
    return jsonError(error);
  }

  try {
    assertHostedOnboardingMutationOrigin(request);
  } catch (error) {
    if (isHostedSignupReferralOriginRejection(error)) {
      return jsonError(error);
    }
    logHostedOnboardingRouteFailure({
      error,
      operationName: "signup-referral.origin",
      requestMethod: request.method,
    });
    return redirectToHostedSignupReferralLanding({
      referralCode,
      request,
      status: "busy",
    });
  }

  try {
    const response = NextResponse.redirect(
      (await claimHostedSignupReferralLink({ referralCode })).signupUrl,
      303,
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const isPermanentFailure =
      isPermanentHostedSignupReferralClaimError(error);
    if (
      !isPermanentFailure
      && !isExpectedHostedSignupReferralClaimRetry(error)
    ) {
      logHostedOnboardingRouteFailure({
        error,
        operationName: "signup-referral.claim",
        requestMethod: request.method,
      });
    }
    return redirectToHostedSignupReferralLanding({
      referralCode,
      request,
      status: isPermanentFailure ? "unavailable" : "busy",
    });
  }
}

function isHostedSignupReferralOriginRejection(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && (
      error.code === "HOSTED_ONBOARDING_ORIGIN_MISMATCH"
      || error.code === "HOSTED_ONBOARDING_ORIGIN_REQUIRED"
    );
}

function isExpectedHostedSignupReferralClaimRetry(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && (
      error.code === "HOSTED_SIGNUP_REFERRAL_CLAIM_BUSY"
      || error.code === "HOSTED_SIGNUP_REFERRAL_CLAIM_LIMIT_REACHED"
    );
}

function isPermanentHostedSignupReferralClaimError(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && (
      error.code === "HOSTED_MEMBER_SUSPENDED"
      || error.code === "HOSTED_SIGNUP_REFERRAL_LINK_EXPIRED"
      || error.code === "HOSTED_SIGNUP_REFERRAL_LINK_NOT_FOUND"
      || error.code === "HOSTED_SIGNUP_REFERRER_NOT_FOUND"
    );
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
