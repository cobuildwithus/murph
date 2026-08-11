"use client";

import Link from "next/link";

import { LandingAuthDialogButton } from "@/app/auth-controls";
import { ReferralLinkAction } from "@/src/components/referrals/referral-link-action";

const PRIMARY_ACTION_CLASSES =
  "group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#f5f0e8] px-5 py-3.5 text-[0.9375rem] font-semibold text-[#2d3436] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a]";

export function ReferralShareAction({
  authenticated,
  identityKey,
  signupUrl,
}: {
  authenticated: boolean;
  identityKey: string | null;
  signupUrl?: string;
}) {
  if (authenticated && identityKey) {
    return (
      <ReferralLinkAction
        appearance="marketing"
        identityKey={identityKey}
        signupUrl={signupUrl}
      />
    );
  }

  if (authenticated) {
    return (
      <Link className={PRIMARY_ACTION_CLASSES} href="/home" prefetch={false}>
        Open Murph
        <span
          aria-hidden="true"
          className="transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </Link>
    );
  }

  return (
    <LandingAuthDialogButton
      buttonClassName={PRIMARY_ACTION_CLASSES}
      buttonLabel="Join Murph to start referring"
      requireLaunchConsentOnCompletion
      showArrow
    />
  );
}
