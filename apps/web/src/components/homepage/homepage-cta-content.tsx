"use client";

import { usePrivy } from "@privy-io/react-auth";

const SETTINGS_HREF = "/settings";

export function HomepageCtaContent() {
  const { authenticated, ready } = usePrivy();

  if (!ready) {
    return (
      <>
        <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
          Checking your session.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-white/60">
          If you already signed in here, we&apos;ll use that session instead of asking you to start over.
        </p>
      </>
    );
  }

  if (authenticated) {
    return (
      <>
        <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
          You&apos;re already in.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-white/60">
          Open settings to manage your subscription, connected channels, and wearable sources.
        </p>
        <div className="mt-8">
          <a
            href={SETTINGS_HREF}
            className="inline-flex rounded bg-white px-7 py-3.5 font-bold text-olive transition-colors hover:bg-cream-dark"
          >
            Open settings
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
        Start using Murph today.
      </h2>
      <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-white/60">
        Sign up with your phone number. No app to download, no account to
        configure. Just text and go.
      </p>
      <div className="mt-8">
        <a
          href="#signup-title"
          className="inline-flex rounded bg-white px-7 py-3.5 font-bold text-olive transition-colors hover:bg-cream-dark"
        >
          Get started free
        </a>
      </div>
    </>
  );
}
