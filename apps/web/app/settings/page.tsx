import type { Metadata } from "next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import { HostedDeviceSyncSettings } from "@/src/components/settings/hosted-device-sync-settings";
import { HostedEmailSettings } from "@/src/components/settings/hosted-email-settings";
import { HostedTelegramSettings } from "@/src/components/settings/hosted-telegram-settings";
import {
  resolveHostedPrivyClientAppId,
  resolveHostedPrivyClientId,
} from "@/src/lib/hosted-onboarding/landing";

export const metadata: Metadata = {
  title: "Murph account settings",
  description: "Manage the verified email, Telegram account, and wearable sources linked to your Murph account.",
};

export default function SettingsPage() {
  const privyAppId = resolveHostedPrivyClientAppId();
  const privyClientId = resolveHostedPrivyClientId();

  return (
    <main className="min-h-screen px-5 py-12 md:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-3">
          <Badge variant="secondary">Account settings</Badge>
          <h1 className="text-4xl font-bold leading-none tracking-tight text-stone-900 md:text-5xl">
            Manage connected channels and sources
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-stone-500">
            Add or update the verified email, Telegram account, and wearable sources attached to your Murph account.
            We only save account changes after Privy confirms them, and wearable sources stay easy to reconnect or
            disconnect without drama.
          </p>
        </header>

        {!privyAppId ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTitle>Privy client auth is not configured</AlertTitle>
            <AlertDescription>
              Privy client auth is not configured for this environment yet. Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code>
              and make sure email and Telegram login and linking are enabled in the Privy dashboard before using this page.
            </AlertDescription>
          </Alert>
        ) : (
          <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
            <Card className="shadow-sm">
              <CardContent className="pt-4 text-sm leading-relaxed text-stone-500 md:pt-6">
                Sign in with the same phone-backed Privy account you use for Murph. We sync verified email and Telegram
                directly against that Privy identity.
              </CardContent>
            </Card>
            <div className="grid gap-6 xl:grid-cols-2">
              <Card className="shadow-sm">
                <CardContent className="pt-4 md:pt-6">
                  <HostedEmailSettings />
                </CardContent>
              </Card>
              <Card className="shadow-sm">
                <CardContent className="pt-4 md:pt-6">
                  <HostedTelegramSettings />
                </CardContent>
              </Card>
            </div>
            <Card className="shadow-sm">
              <CardContent className="pt-4 md:pt-6">
                <HostedDeviceSyncSettings />
              </CardContent>
            </Card>
          </HostedPrivyProvider>
        )}
      </div>
    </main>
  );
}
