"use client";

import { usePrivy } from "@privy-io/react-auth";

import { HostedExistingAccountSignInDialog } from "@/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog";
import { HostedPhoneAuth } from "@/src/components/hosted-onboarding/hosted-phone-auth";

const SETTINGS_HREF = "/settings";

export function HomepageAuthPanel() {
  const { authenticated, ready } = usePrivy();

  if (!ready) {
    return (
      <section className="rounded-lg bg-olive p-7 text-white md:p-9">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Checking your session.
        </h2>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/80">
          If you already signed in here, we&apos;ll keep the homepage out of your way.
        </p>
      </section>
    );
  }

  if (authenticated) {
    return (
      <section className="rounded-lg bg-olive p-7 text-white md:p-9">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          You&apos;re already signed in.
        </h2>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/80">
          Open your account settings to manage billing, connected channels, and wearable sources.
        </p>
        <div className="mt-6">
          <a
            href={SETTINGS_HREF}
            className="inline-flex rounded bg-white px-7 py-3.5 font-bold text-olive transition-colors hover:bg-cream-dark"
          >
            Open settings
          </a>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="signup-title"
      className="rounded-lg bg-olive p-7 text-white md:p-9"
    >
      <h2
        id="signup-title"
        className="text-2xl font-bold tracking-tight md:text-3xl"
      >
        Sign up with your phone.
      </h2>

      <div className="mt-5 rounded bg-white p-4 text-stone-900">
        <HostedPhoneAuth mode="public" />
      </div>
      <div className="mt-4">
        <HostedExistingAccountSignInDialog />
      </div>
    </section>
  );
}
