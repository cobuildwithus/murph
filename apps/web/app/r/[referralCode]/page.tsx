import type { Metadata } from "next";
import { notFound } from "next/navigation";

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

export default async function HostedSignupReferralPage(props: {
  params: Promise<{ referralCode: string }>;
}) {
  const referralCode = await resolveDecodedRouteParam(
    props.params,
    "referralCode",
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
      notFound();
    }
    throw error;
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
            className={buttonVariants({ size: "lg" })}
            type="submit"
          >
            Join Murph
          </button>
        </form>

        <p className="max-w-sm text-xs leading-5 text-muted-foreground">
          Continuing creates your own private Murph setup. The person who
          shared this link cannot see your conversations or health information.
        </p>
      </div>
    </JoinInviteCenteredShell>
  );
}
