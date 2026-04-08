import type { Metadata } from "next";

import { Card, CardContent } from "@/components/ui/card";
import { HostedBillingSettings } from "@/src/components/settings/hosted-billing-settings";
import { HostedDeviceSyncSettings } from "@/src/components/settings/hosted-device-sync-settings";
import { HostedEmailSettings } from "@/src/components/settings/hosted-email-settings";
import { HostedTelegramSettings } from "@/src/components/settings/hosted-telegram-settings";

export const metadata: Metadata = {
  title: "Settings — Murph",
  description: "Manage your Murph account settings.",
};

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-cream">
      {/* Header panel */}
      <div className="border-b border-stone-200/80 bg-cream-dark/50">
        <div className="mx-auto max-w-3xl px-5 pb-10 pt-14 md:px-8">
          <div className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-widest text-olive/70">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-olive" />
            Settings
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900 md:text-4xl">
            Your account
          </h1>
          <p className="mt-2 max-w-md text-stone-500">
            Subscription, connected accounts, and wearables.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-5 py-10 md:px-8">
        <div className="space-y-8">
          <section className="animate-fade-up">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-olive/60">
              <span className="inline-block h-1 w-1 rounded-full bg-olive/50" />
              Billing
            </div>
            <HostedBillingSettings />
          </section>

          <section className="animate-fade-up" style={{ animationDelay: "80ms" }}>
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-olive/60">
              <span className="inline-block h-1 w-1 rounded-full bg-olive/50" />
              Messaging
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <Card className="border-stone-200/80 shadow-sm transition-shadow hover:shadow-md">
                <CardContent>
                  <HostedEmailSettings />
                </CardContent>
              </Card>
              <Card className="border-stone-200/80 shadow-sm transition-shadow hover:shadow-md">
                <CardContent>
                  <HostedTelegramSettings />
                </CardContent>
              </Card>
            </div>
          </section>

          <section className="animate-fade-up" style={{ animationDelay: "160ms" }}>
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-olive/60">
              <span className="inline-block h-1 w-1 rounded-full bg-olive/50" />
              Wearables
            </div>
            <Card className="border-stone-200/80 shadow-sm transition-shadow hover:shadow-md">
              <CardContent className="pt-4 md:pt-6">
                <HostedDeviceSyncSettings />
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </main>
  );
}
