import { HostedExistingAccountSignInDialog } from "@/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog";
import { HostedPhoneAuth } from "@/src/components/hosted-onboarding/hosted-phone-auth";

import { HomepageTelegramAuthButton } from "./homepage-telegram-auth-button";

const SETTINGS_HREF = "/settings";
const TERMS_HREF = "/legal/terms.pdf";
const PRIVACY_HREF = "/legal/privacy.pdf";

export function HomepageAuthPanel({
  authenticated,
}: {
  authenticated: boolean;
}) {
  if (authenticated) {
    return (
      <section className="rounded-lg bg-olive p-7 text-white md:p-9">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          You&apos;re already signed in.
        </h2>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/80">
          Open your account settings to manage billing, connected channels, and
          wearable sources.
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
      className="rounded-lg bg-olive p-5 text-white md:p-9"
    >
      <h2
        id="signup-title"
        className="text-2xl font-bold tracking-tight md:text-3xl"
      >
        Signup
      </h2>

      <div className="mt-5 rounded bg-white p-4 text-stone-900">
        <div className="space-y-4">
          <HostedPhoneAuth />
          <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-400">
            <span className="h-px flex-1 bg-stone-200" />
            More options
            <span className="h-px flex-1 bg-stone-200" />
          </div>
          <HomepageTelegramAuthButton />
        </div>
      </div>
      <div className="mt-4">
        <HostedExistingAccountSignInDialog />
      </div>
      <p className="mt-4 text-xs leading-relaxed text-white/70">
        By signing up, you agree to our{" "}
        <a
          href={TERMS_HREF}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-white underline decoration-white/40 underline-offset-2 transition-colors hover:text-cream"
        >
          Terms
        </a>{" "}
        and{" "}
        <a
          href={PRIVACY_HREF}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-white underline decoration-white/40 underline-offset-2 transition-colors hover:text-cream"
        >
          Privacy Policy
        </a>
        .
      </p>
    </section>
  );
}
