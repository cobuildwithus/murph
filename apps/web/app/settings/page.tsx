import type { Metadata } from "next";
import { cookies } from "next/headers";

import { HostedEmailSettings } from "@/src/components/settings/hosted-email-settings";
import { resolveHostedPrivyClientAppId } from "@/src/lib/hosted-onboarding/landing";
import { resolveHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";
import { maskPhoneNumber } from "@/src/lib/hosted-onboarding/shared";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Murph account settings",
  description: "Add or update the verified email linked to your Murph account.",
};

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const sessionRecord = await resolveHostedSessionFromCookieStore(cookieStore);
  const privyAppId = resolveHostedPrivyClientAppId();

  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-3">
          <span className="inline-block rounded bg-olive/10 px-3.5 py-1.5 text-sm font-semibold text-olive">
            Account settings
          </span>
          <h1 className="text-4xl font-bold leading-none tracking-tight text-stone-900 md:text-5xl">
            Verify your email
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-stone-500">
            Add or update the email attached to your Murph account. We&apos;ll send a one-time code through Privy
            and only save the email after the code is confirmed.
          </p>
        </header>

        {!sessionRecord ? (
          <section className="space-y-4 rounded-lg bg-white p-6 shadow-sm md:p-8">
            <h2 className="text-2xl font-bold tracking-tight text-stone-900">Sign in to manage settings</h2>
            <p className="text-base leading-relaxed text-stone-500">
              Open your latest Murph invite or account link in this browser first. The settings page only works
              for an active hosted session.
            </p>
            <a
              href="/"
              className="inline-flex rounded border border-stone-200 bg-white px-5 py-3 font-semibold text-stone-700 transition-colors hover:bg-stone-50"
            >
              Return home
            </a>
          </section>
        ) : (
          <>
            <section className="grid gap-4 rounded-lg bg-white p-6 shadow-sm md:grid-cols-2 md:p-8">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold uppercase tracking-[0.15em] text-olive">Hosted member</p>
                <p className="text-lg font-semibold text-stone-900">
                  {maskPhoneNumber(sessionRecord.member.normalizedPhoneNumber)}
                </p>
                <p className="text-sm leading-relaxed text-stone-500">
                  This browser already has an active Murph hosted session.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold uppercase tracking-[0.15em] text-olive">Privy account</p>
                <p className="break-all text-sm font-medium text-stone-900">
                  {summarizePrivyUserId(sessionRecord.member.privyUserId)}
                </p>
                <p className="text-sm leading-relaxed text-stone-500">
                  The email flow is pinned to this Privy identity so a different logged-in browser user cannot update
                  the wrong account.
                </p>
              </div>
            </section>

            {!sessionRecord.member.privyUserId ? (
              <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm leading-relaxed text-amber-800">
                This hosted member is missing a Privy user id. Reopen your invite link and complete phone verification
                again before trying to add an email address.
              </section>
            ) : !privyAppId ? (
              <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm leading-relaxed text-amber-800">
                Privy client auth is not configured for this environment yet. Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code>
                and make sure email login and linking are enabled in the Privy dashboard before using this page.
              </section>
            ) : (
              <section className="rounded-lg bg-white p-6 shadow-sm md:p-8">
                <HostedEmailSettings
                  expectedPrivyUserId={sessionRecord.member.privyUserId}
                  privyAppId={privyAppId}
                />
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function summarizePrivyUserId(value: string | null | undefined): string {
  if (!value) {
    return "Missing Privy user id";
  }

  if (value.length <= 26) {
    return value;
  }

  return `${value.slice(0, 18)}...${value.slice(-6)}`;
}
