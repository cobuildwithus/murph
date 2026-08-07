import type { ReactNode } from "react";

import { ArrowRightIcon } from "lucide-react";

import { buttonVariants } from "@/src/components/ui/button";

import { JOIN_INVITE_ACTIVE_FEATURE_CARDS } from "./join-invite-active-feature-cards";
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
      <div className="space-y-7">
        <div className="space-y-3">
          <p className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-olive-light" />
            You&apos;re invited
          </p>
          <h1 className="font-serif text-5xl font-semibold tracking-tight text-balance text-foreground sm:text-6xl">
            Meet Murph
          </h1>
          <p className="max-w-md text-lg leading-8 text-pretty text-muted-foreground">
            A private health assistant that gets more useful as it learns what
            matters to you.
          </p>
        </div>

        <form action={buildClaimPath(props.referralCode)} method="post">
          <button
            aria-describedby="referral-attribution-note"
            className={buttonVariants({ size: "xl" })}
            type="submit"
          >
            Join Murph
            <ArrowRightIcon className="transition-transform duration-200 group-hover/button:translate-x-0.5" />
          </button>
        </form>

        <div className="border-t border-border/50 pt-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            What Murph can help with
          </p>
          <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {JOIN_INVITE_ACTIVE_FEATURE_CARDS.map((item) => (
              <div className="flex gap-3" key={item.title}>
                <item.icon className="mt-0.5 size-4 shrink-0 text-olive-light" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-pretty text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p
          className="text-xs leading-5 text-pretty text-muted-foreground"
          id="referral-attribution-note"
        >
          Murph credits whoever shared this link. They cannot see your
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
