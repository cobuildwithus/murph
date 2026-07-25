"use client";

import { CreditCard } from "lucide-react";

import {
  HostedAuthRequiredScreen,
  HostedAuthRequiredScreenView,
} from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

// One source of copy for the live screen and its design study, so the catalog
// cannot drift from what a member returning from Stripe actually reads.
function settingsAuthRequiredProps(resumingPayment: boolean) {
  // A payment link Murph sends over text usually opens in a browser that has
  // never held a Murph session, so this screen is the normal landing for
  // someone returning from Stripe rather than an error state.
  return resumingPayment
    ? {
      description: "Your card is saved. Sign in to finish switching to Pulse.",
      eyebrow: "Subscription",
      eyebrowIcon: CreditCard,
      footer: "You will land back here and we will pick up where you left off.",
      title: "One more step",
    }
    : {
      description:
        "Sign in to manage your plan, model, connected accounts, and data privacy.",
      eyebrow: "Account",
      eyebrowIcon: CreditCard,
      title: "Sign in to open settings",
    };
}

export function SettingsAuthRequired({
  resumingPayment = false,
}: {
  resumingPayment?: boolean;
}) {
  return <HostedAuthRequiredScreen {...settingsAuthRequiredProps(resumingPayment)} />;
}

export function SettingsAuthRequiredView({
  resumingPayment = false,
}: {
  resumingPayment?: boolean;
}) {
  return <HostedAuthRequiredScreenView {...settingsAuthRequiredProps(resumingPayment)} />;
}
