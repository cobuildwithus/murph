import {
  HostedSignupReferralLanding,
  type HostedSignupReferralLandingState,
} from "@/src/components/hosted-onboarding/hosted-signup-referral-landing";
import {
  readHostedSignupReferralLink,
} from "@/src/lib/hosted-growth/signup-referral";
import {
  isHostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  logHostedOnboardingRouteFailure,
} from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export { generateMetadata } from "./page-metadata";

export const dynamic = "force-dynamic";

export default async function HostedSignupReferralPage(props: {
  params: Promise<{ referralCode: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const referralCode = await resolveDecodedRouteParam(
    props.params,
    "referralCode",
  );
  let state = readHostedSignupReferralLandingState(
    (await props.searchParams)?.status,
  );

  try {
    await readHostedSignupReferralLink({ referralCode });
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && (
        error.code === "HOSTED_SIGNUP_REFERRAL_LINK_EXPIRED"
        || error.code === "HOSTED_SIGNUP_REFERRAL_LINK_NOT_FOUND"
        || error.code === "HOSTED_SIGNUP_REFERRER_NOT_FOUND"
        || error.code === "HOSTED_MEMBER_SUSPENDED"
      )
    ) {
      state = "unavailable";
    } else {
      logHostedOnboardingRouteFailure({
        error,
        operationName: "signup-referral.read",
        requestMethod: "GET",
      });
      state = "busy";
    }
  }

  return (
    <HostedSignupReferralLanding
      referralCode={referralCode}
      state={state}
    />
  );
}

function readHostedSignupReferralLandingState(
  value: string | string[] | undefined,
): HostedSignupReferralLandingState {
  const status = Array.isArray(value) ? value[0] : value;
  return status === "busy" || status === "unavailable"
    ? status
    : "available";
}
