"use client";

import { CreditCard } from "lucide-react";

import {
  HostedAuthRequiredScreen,
  HostedAuthRequiredScreenView,
} from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

const SETTINGS_AUTH_REQUIRED_PROPS = {
  description: "Sign in to verify and finish your Pulse update.",
  eyebrow: "Subscription",
  eyebrowIcon: CreditCard,
  footer: "We will check this link against your account after you sign in.",
  title: "One more step",
};

// The payment link Murph sends over text can open in a browser that has never
// held a Murph session, so this screen is a normal return state, not an error.
//
// The copy stays neutral because nothing is verified yet: the signature is
// bound to a member id absent from the URL, so anyone could put these
// parameters in a link. Murph must not vouch for an unchecked payment.
export function SettingsAuthRequired() {
  return <HostedAuthRequiredScreen {...SETTINGS_AUTH_REQUIRED_PROPS} />;
}

// One source of copy for the live screen and its design study, so the catalog
// cannot drift from what a member returning from Stripe actually reads.
export function SettingsAuthRequiredView() {
  return <HostedAuthRequiredScreenView {...SETTINGS_AUTH_REQUIRED_PROPS} />;
}
