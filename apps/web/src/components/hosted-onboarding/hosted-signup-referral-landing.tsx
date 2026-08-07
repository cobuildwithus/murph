import type { ReactNode } from "react";

import { buttonVariants } from "@/src/components/ui/button";

import { JoinInviteCenteredShell } from "./join-invite-shell";

export type HostedSignupReferralLandingState =
  | "available"
  | "busy"
  | "unavailable";

export function HostedSignupReferralLanding(props: {
  referralCode: string;
  state: HostedSignupReferralLandingState;
}) {
  if (props.state === "unavailable") {
    return (
      <HostedSignupReferralMessage
        eyebrow="Referral link"
        message="Ask the person who shared it to send their current Murph link."
        title="This link isn’t available"
      />
    );
  }

  if (props.state === "busy") {
    return (
      <HostedSignupReferralMessage
        action={(
          <form action={buildClaimPath(props.referralCode)} method="post">
            <button
              className={buttonVariants({ size: "lg" })}
              type="submit"
            >
              Try again
            </button>
          </form>
        )}
        eyebrow="Referral link"
        message="Murph couldn’t open setup just now. Wait a moment, then try this link again."
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

        <form action={buildClaimPath(props.referralCode)} method="post">
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
  action?: ReactNode;
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
        {props.action ? <div className="pt-3">{props.action}</div> : null}
      </div>
    </JoinInviteCenteredShell>
  );
}

function buildClaimPath(referralCode: string): string {
  return `/r/${encodeURIComponent(referralCode)}/claim`;
}
