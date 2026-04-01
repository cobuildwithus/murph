import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import { HostedEmailSettings } from "@/src/components/settings/hosted-email-settings";
import { HostedTelegramSettings } from "@/src/components/settings/hosted-telegram-settings";
import {
  resolveHostedPrivyClientAppId,
  resolveHostedPrivyClientId,
} from "@/src/lib/hosted-onboarding/landing";
import { readHostedPhoneHint } from "@/src/lib/hosted-onboarding/contact-privacy";
import { resolveHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";

export const metadata: Metadata = {
  title: "Murph account settings",
  description: "Manage the verified email and Telegram account linked to your Murph account.",
};

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const sessionRecord = await resolveHostedSessionFromCookieStore(cookieStore);
  const privyAppId = resolveHostedPrivyClientAppId();
  const privyClientId = resolveHostedPrivyClientId();

  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-3">
          <Badge variant="secondary">Account settings</Badge>
          <h1 className="text-4xl font-bold leading-none tracking-tight text-stone-900 md:text-5xl">
            Manage connected accounts
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-stone-500">
            Add or update the verified email and Telegram account attached to your Murph account. We only save each
            connection after Privy confirms it.
          </p>
        </header>

        {!sessionRecord ? (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-2xl font-bold tracking-tight text-stone-900">
                Sign in to manage settings
              </CardTitle>
              <CardDescription className="text-base leading-relaxed text-stone-500">
                Open your latest Murph invite or account link in this browser first. The settings page only works
                for an active hosted session.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button render={<Link href="/" />} nativeButton={false} variant="outline" size="lg">
                Return home
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="shadow-sm">
              <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold uppercase tracking-[0.15em] text-olive">Hosted member</p>
                  <p className="text-lg font-semibold text-stone-900">
                    {readHostedPhoneHint(sessionRecord.member.maskedPhoneNumberHint)}
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
                    Email and Telegram settings are pinned to this Privy identity so a different logged-in browser
                    user cannot update the wrong account.
                  </p>
                </div>
              </CardContent>
            </Card>

            {!sessionRecord.member.privyUserId ? (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                <AlertTitle>Missing Privy user id</AlertTitle>
                <AlertDescription>
                  This hosted member is missing a Privy user id. Reopen your invite link and complete phone verification
                  again before trying to manage email or Telegram settings.
                </AlertDescription>
              </Alert>
            ) : !privyAppId ? (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                <AlertTitle>Privy client auth is not configured</AlertTitle>
                <AlertDescription>
                  Privy client auth is not configured for this environment yet. Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code>
                  and make sure email and Telegram login and linking are enabled in the Privy dashboard before using this page.
                </AlertDescription>
              </Alert>
            ) : (
              <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
                <div className="grid gap-6 xl:grid-cols-2">
                  <Card className="shadow-sm">
                    <CardContent className="pt-4 md:pt-6">
                      <HostedEmailSettings expectedPrivyUserId={sessionRecord.member.privyUserId} />
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm">
                    <CardContent className="pt-4 md:pt-6">
                      <HostedTelegramSettings expectedPrivyUserId={sessionRecord.member.privyUserId} />
                    </CardContent>
                  </Card>
                </div>
              </HostedPrivyProvider>
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
