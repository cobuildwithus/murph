"use client";

import {
  HostedSignupReferralLanding,
  type HostedSignupReferralLandingState,
} from "@/src/components/hosted-onboarding/hosted-signup-referral-landing";
import { JoinInviteSignedInMismatchView } from "@/src/components/hosted-onboarding/join-invite-signed-in-mismatch-view";
import { HostedAccountSettingsCards } from "@/src/components/settings/hosted-account-settings-cards";
import {
  HostedSignupReferralLinkButtonView,
  type HostedSignupReferralLinkButtonState,
} from "@/src/components/settings/hosted-signup-referral-link-button";
import { Button } from "@/src/components/ui/button";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";

const DESIGN_REFERRAL_URL = "https://example.com/r/design-referral";
const DESIGN_ACCOUNT: HostedAccountSettingsSnapshot = {
  email: {
    address: "member@example.test",
    murphEmailAddress: "murph+preview@example.test",
    verifiedAt: "2026-08-01T00:00:00.000Z",
  },
  phone: {
    number: "+15555550100",
    verifiedAt: "2026-08-01T00:00:00.000Z",
  },
  referralIdentityKey: "design-referral-member",
  telegram: {
    telegramUserId: "design-telegram-user",
    username: "preview_member",
  },
};

const BUTTON_STATES: Array<{
  label: string;
  state: HostedSignupReferralLinkButtonState;
}> = [
  { label: "Initial load", state: "loading" },
  { label: "Ready to copy", state: "ready" },
  { label: "Copy in progress", state: "copying" },
  { label: "Copy complete", state: "copied" },
  { label: "Link load failed", state: "load_error" },
  { label: "Clipboard write failed", state: "copy_error" },
];

const LANDING_STATES: Array<{
  label: string;
  state: HostedSignupReferralLandingState;
}> = [
  { label: "Available link", state: "available" },
  { label: "Claim allowance exhausted", state: "busy" },
  { label: "Unavailable link", state: "unavailable" },
];

export function SignupReferralComponentStudy() {
  return (
    <div
      className="grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3"
      data-design-component="signup-referral-link-states"
      inert
    >
      {BUTTON_STATES.map(({ label, state }) => (
        <article
          className="flex min-h-28 flex-col justify-between rounded-xl border border-border bg-card p-5"
          data-design-state={state}
          key={state}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <div className="mt-5">
            <HostedSignupReferralLinkButtonView
              onAction={() => undefined}
              signupUrl={state === "copy_error" ? DESIGN_REFERRAL_URL : null}
              status={state}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

export function SignupReferralFlowStudy() {
  return (
    <div
      className="flex flex-col gap-10"
      data-design-contract="origin-only-referral-claim"
      data-design-section="signup-referral-flow"
      id="signup-referral-flow"
    >
      <section className="rounded-3xl border border-border bg-background p-5 sm:p-8">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Settings · Messaging
        </p>
        <div inert>
          <HostedAccountSettingsCards
            account={DESIGN_ACCOUNT}
            murphPhoneNumber="+15555550101"
            privySessionMatchesAppSession
            signupReferralUrl={DESIGN_REFERRAL_URL}
          />
        </div>
      </section>

      <section className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Copy action and recovery states
        </p>
        <SignupReferralComponentStudy />
      </section>

      <section className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Recipient landing states
        </p>
        <div className="grid gap-5">
          {LANDING_STATES.map(({ label, state }) => (
            <article
              className="overflow-hidden rounded-3xl border border-border bg-background"
              data-design-state={state}
              inert
              key={state}
            >
              <p className="border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {label}
              </p>
              <HostedSignupReferralLanding
                referralCode="design-referral"
                state={state}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Signed-in invite recovery
        </p>
        <div
          className="overflow-hidden rounded-3xl border border-border bg-background"
          data-design-section="signup-referral-signed-in-recovery"
          data-design-state="signed-in-account-mismatch"
          id="signup-referral-signed-in-recovery"
          inert
        >
          <JoinInviteSignedInMismatchView
            signOutAction={
              <Button size="lg" type="button" variant="outline">
                Sign out and use invite
              </Button>
            }
          />
        </div>
      </section>
    </div>
  );
}
