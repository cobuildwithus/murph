"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";

import {
  HostedAuthRequiredScreen,
  HostedAuthRequiredScreenView,
} from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

const DATA_PRIVACY_HANDOFF_COPY = {
  description:
    "You can request deletion on the web even if you no longer have the Murph Android app.",
  details: (
    <>
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-foreground">
        Delete your Murph account
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5">
        <li>Log in with the email address or phone number on your account.</li>
        <li>This page opens Data &amp; privacy in Settings.</li>
        <li>Choose Delete account, review the details, and confirm.</li>
      </ol>

      <div className="mt-5 border-t border-border pt-5">
        <p className="font-medium text-foreground">What deletion covers</p>
        <p className="mt-1">
          The request covers your Murph account, login, subscription, health
          and user-submitted content, derived health context,
          connected-service credentials, and other account-associated hosted
          data.
        </p>

        <p className="mt-4 font-medium text-foreground">
          Timing and limited retention
        </p>
        <p className="mt-1">
          Active hosted systems target removal within 30 days and backups
          within 90 days. Limited billing, tax, security, fraud-prevention,
          dispute, or legally required records may be kept longer.
        </p>
      </div>
    </>
  ),
  eyebrow: "Account privacy",
  eyebrowIcon: Trash2,
  footer: (
    <>
      Need help or want only certain data deleted? Email{" "}
      <a
        className="underline underline-offset-4"
        href="mailto:legal@justco.build"
      >
        legal@justco.build
      </a>
      . See the full{" "}
      <Link className="underline underline-offset-4" href="/legal/privacy">
        retention policy
      </Link>
      .
    </>
  ),
  title: "Sign in to manage your data",
} as const;

export function SettingsDataPrivacyAuthRequired() {
  return <HostedAuthRequiredScreen {...DATA_PRIVACY_HANDOFF_COPY} />;
}

export function SettingsDataPrivacyAuthRequiredView() {
  return <HostedAuthRequiredScreenView {...DATA_PRIVACY_HANDOFF_COPY} />;
}
