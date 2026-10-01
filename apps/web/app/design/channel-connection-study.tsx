"use client";

import { useRef } from "react";

import { SettingsStatusLine } from "@/src/components/settings/connected-account-card";
import { HostedAccountSettingsCards } from "@/src/components/settings/hosted-account-settings-cards";
import { HostedEmailSettingsContent } from "@/src/components/settings/hosted-email-settings-sections";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";

const account: HostedAccountSettingsSnapshot = {
  email: {
    address: "previous@example.test",
    murphEmailAddress: "murph+preview@example.test",
    verifiedAt: "2026-01-01T00:00:00.000Z",
  },
  phone: { number: "+12025550123", verifiedAt: "2026-01-01T00:00:00.000Z" },
  telegram: { telegramUserId: null },
  privySignInStates: {
    email: { removable: false, status: "mismatched" },
    phone: { removable: false, status: "matched" },
    telegram: { removable: false, status: "absent" },
  },
};
const noAction = () => undefined;
const noAsyncAction = async () => undefined;

export function ChannelConnectionStudy() {
  return (
    <div className="grid gap-8" id="channel-connection" data-design-section="channel-connection">
      <section className="rounded-2xl border border-border bg-background p-5 sm:p-7" data-channel-state="settings" inert>
        <h3 className="mb-5 font-serif text-xl">Connected channels and email recovery</h3>
        <HostedAccountSettingsCards
          account={account}
          murphPhoneNumber="+12025550124"
          signupReferralUrl="https://example.test/r/preview"
        />
      </section>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <EmailSyncState saving={false} />
        <EmailSyncState saving />
      </div>
    </div>
  );
}

function EmailSyncState({ saving }: { saving: boolean }) {
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const currentEmail = { address: "previous@example.test", verifiedAt: 1767225600 };
  return (
    <section
      className="space-y-5 rounded-2xl border border-border bg-popover p-6 text-popover-foreground md:p-7"
      data-channel-state={saving ? "saving" : "retry"}
      inert
    >
      <h3 className="font-serif text-2xl">Change email</h3>
      <HostedEmailSettingsContent
        authSatisfied
        canSendEmailUpdateCode
        changeFlow
        code=""
        currentEmail={currentEmail}
        currentVerifiedEmail={currentEmail}
        emailAddress="connected@example.test"
        emailInputRef={emailInputRef}
        hasPendingEmailSync
        isBusy={saving}
        isSendingCode={false}
        isSubmittingCode={false}
        isSyncingEmailRoute={saving}
        onAuthRequired={noAction}
        onChangeCode={noAction}
        onChangeEmailAddress={noAction}
        onResendCode={noAsyncAction}
        onRetryEmailSync={noAsyncAction}
        onSendCode={noAsyncAction}
        onSyncVerifiedEmail={noAsyncAction}
        onUseAnotherEmail={noAction}
        onVerifyCode={noAsyncAction}
        pendingEmailAddress={null}
      />
      <SettingsStatusLine
        message={saving ? "Saving your email…" : "Your email is verified, but we couldn't finish connecting it to Murph. Try saving again."}
        tone={saving ? "neutral" : "destructive"}
      />
    </section>
  );
}
