"use client";

import { CreditCard, Gauge } from "lucide-react";

import {
  HostedAuthRequiredScreen,
  HostedAuthRequiredScreenView,
} from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

const SETTINGS_AUTH_REQUIRED_PROPS = {
  description: "Sign in to verify and finish your billing update.",
  eyebrow: "Subscription",
  eyebrowIcon: CreditCard,
  footer: "We will check this link against your account after you sign in.",
  title: "One more step",
};

const USAGE_RECOVERY_AUTH_REQUIRED_PROPS = {
  description: "Sign in to review the recovery options available for your account.",
  eyebrow: "AI usage",
  eyebrowIcon: Gauge,
  footer: "Settings will resolve plan eligibility and Family access after you sign in.",
  title: "Continue in Settings",
};

// The payment link Murph sends over text can open in a browser that has never
// held a Murph session, so this screen is a normal return state, not an error.
//
// The copy stays neutral because nothing is verified yet: the signature is
// bound to a member id absent from the URL, so anyone could put these
// parameters in a link. Murph must not vouch for an unchecked payment.
export function SettingsAuthRequired(props: { usageRecovery?: boolean }) {
  return (
    <HostedAuthRequiredScreen
      {...(props.usageRecovery
        ? USAGE_RECOVERY_AUTH_REQUIRED_PROPS
        : SETTINGS_AUTH_REQUIRED_PROPS)}
    />
  );
}

// One source of copy for the live screen and its design study, so the catalog
// cannot drift from what a member returning from Stripe actually reads.
export function SettingsAuthRequiredView() {
  return <HostedAuthRequiredScreenView {...SETTINGS_AUTH_REQUIRED_PROPS} />;
}
