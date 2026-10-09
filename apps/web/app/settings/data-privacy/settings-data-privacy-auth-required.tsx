"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import {
  HostedAuthRequiredScreenView,
} from "@/src/components/hosted-onboarding/hosted-auth-required-screen";

const DELETION_STEPS = [
  "Log in with the email or phone number on your account.",
  "Open Settings → Data & privacy.",
  "Choose Delete account and confirm.",
] as const;

// Google Play links here as Murph's account deletion page, so it must show the
// steps, what is deleted and how long anything is kept, even without the app.
const DATA_PRIVACY_HANDOFF_COPY = {
  description: "Log in to delete your account or download your data. You don’t need the app.",
  details: (
    <div className="space-y-6">
      <ol className="space-y-3 rounded-2xl border border-border bg-card p-5">
        {DELETION_STEPS.map((step, index) => (
          <li className="flex gap-3" key={step}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {index + 1}
            </span>
            <span className="text-foreground">{step}</span>
          </li>
        ))}
      </ol>

      <section className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">What’s deleted</h2>
        <p>
          Your account and profile, health data, anything you’ve sent Murph,
          what Murph learned about you, connected apps and devices, and your
          subscription. Messages already delivered by text, Telegram or email
          can’t be recalled.
        </p>
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">How long it takes</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Health data, memories and chats: within 30 days, backups within 90</li>
          <li>Account, device sync and messaging records: within 90 days</li>
          <li>Support records up to 3 years, security logs up to 1 year, billing records as the law requires</li>
        </ul>
      </section>
    </div>
  ),
  eyebrow: "Account privacy",
  eyebrowIcon: Trash2,
  footer: (
    <>
      Want only some data deleted? Email{" "}
      <a
        className="underline underline-offset-4"
        href="mailto:legal@justco.build"
      >
        legal@justco.build
      </a>
      {" · "}
      <Link className="underline underline-offset-4" href="/legal/privacy">
        Retention policy
      </Link>
    </>
  ),
  loginLabel: "Log in",
  title: "Delete your Murph account",
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
