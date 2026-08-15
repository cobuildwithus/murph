"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import {
  HostedAuthRequiredScreenView,
} from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

const DATA_PRIVACY_HANDOFF_COPY = {
  description:
    "You can request deletion on the web even if you no longer have the Murph Android app.",
  detailsCompact: true,
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

      <div className="mt-4 border-t border-border pt-4">
        <p className="font-medium text-foreground">What deletion covers</p>
        <p className="mt-1">
          Murph deletes hosted account/profile data, health and user-submitted
          content, derived health context, connected credentials, local billing
          references, and subscription access. Copies delivered to external
          carrier, Telegram, Linq, or email systems cannot be recalled.
        </p>

        <p className="mt-3 font-medium text-foreground">
          Timing and limited retention
        </p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            Health content, memories, and assistant history: active hosted
            systems within 30 days; backups within 90 days.
          </li>
          <li>
            Account/profile, wearable sync, webhook, and routing records: up
            to 90 days; credentials: normally 7–30 days.
          </li>
          <li>
            Support: up to 3 years; security logs: 90–365 days; billing or tax
            records: as legally required.
          </li>
        </ul>
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
  loginLabel: "Log in",
  title: "Sign in to manage your data",
} as const;

export function SettingsDataPrivacyAuthRequired() {
  const { openAuthDialog, openDataPrivacyAuthDialog } = useAuth();

  return (
    <HostedAuthRequiredScreenView
      {...DATA_PRIVACY_HANDOFF_COPY}
      onLogin={openDataPrivacyAuthDialog ?? openAuthDialog}
    />
  );
}

export function SettingsDataPrivacyAuthRequiredView() {
  return <HostedAuthRequiredScreenView {...DATA_PRIVACY_HANDOFF_COPY} />;
}
