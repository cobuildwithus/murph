import type { Metadata } from "next";

import {
  JoinInviteCenteredShell,
} from "@/src/components/hosted-onboarding/join-invite-shell";
import { buttonVariants } from "@/src/components/ui/button";
import {
  readHostedSignupReferralLink,
} from "@/src/lib/hosted-growth/signup-referral";
import {
  isHostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Join Murph, your private health assistant.",
  title: "Join Murph",
};

type HostedSignupReferralLandingState =
  | "available"
  | "busy"
  | "unavailable";

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
      throw error;
    }
  }

  if (state === "unavailable") {
    return (
      <HostedSignupReferralMessage
        eyebrow="Referral link"
        message="Ask the person who shared it to send their current Murph link."
        title="This link isn’t available"
      />
    );
  }

  if (state === "busy") {
    return (
      <HostedSignupReferralMessage
        eyebrow="Referral link"
        message="A lot of people have used this link recently. Wait a little while, then open the same link again."
        title="Try again soon"
      />
    );
  }

  return (
    <JoinInviteCenteredShell>
      <div className="space-y-8">
        <div className="space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            You&apos;re invited
          </p>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Meet Murph
          </h1>
          <p className="max-w-md text-base leading-7 text-muted-foreground">
            A private health assistant that gets more useful as it learns what
            matters to you.
          </p>
        </div>

        <form
          action={`/r/${encodeURIComponent(referralCode)}/claim`}
          method="post"
        >
          <button
            aria-describedby="referral-attribution-note"
            className={buttonVariants({ size: "lg" })}
            type="submit"
          >
            Join Murph
          </button>
        </form>

        <p
          className="max-w-sm text-xs leading-5 text-muted-foreground"
          id="referral-attribution-note"
        >
          Continuing creates your own private Murph setup. Murph records who
          shared this link only for referral attribution; they cannot see your
          conversations or health information.
        </p>
      </div>
    </JoinInviteCenteredShell>
  );
}

function HostedSignupReferralMessage(props: {
  eyebrow: string;
  message: string;
  title: string;
}) {
  return (
    <JoinInviteCenteredShell>
      <div className="space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {props.eyebrow}
        </p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          {props.title}
        </h1>
        <p className="max-w-md text-base leading-7 text-muted-foreground">
          {props.message}
        </p>
      </div>
    </JoinInviteCenteredShell>
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
