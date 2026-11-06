"use client";


import { HostedLoginMethodSettingsView } from "@/src/components/settings/hosted-login-method-settings";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";

const account: HostedAccountSettingsSnapshot = {
  email: {
    address: "previous@example.test",
    murphEmailAddress: "murph+preview@example.test",
    verifiedAt: "2026-01-01T00:00:00.000Z",
  },
  phone: { number: "+12025550123", verifiedAt: "2026-01-01T00:00:00.000Z" },
  telegram: { telegramUserId: null },

};
const noAction = () => undefined;

export function ChannelConnectionStudy() {
  return (
    <div className="grid gap-8" id="channel-connection" data-design-section="channel-connection">
      <section className="rounded-2xl border border-border bg-background p-5 sm:p-7" data-channel-state="settings" inert>
        <h3 className="mb-5 font-serif text-xl">Connected sign-in methods</h3>
        <HostedLoginMethodSettingsView
          account={account}
          murphPhoneNumber="+12025550124"
          onSelect={noAction}
          referralAction={null}
        />
      </section>
    </div>
  );
}
