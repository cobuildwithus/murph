"use client";

import { HostedFirstPartyAuthPanel } from "@/src/components/hosted-onboarding/hosted-first-party-auth-panel";
import { HostedLoginMethodSettingsView } from "@/src/components/settings/hosted-login-method-settings";
import { HostedSignupReferralLinkButtonView } from "@/src/components/settings/hosted-signup-referral-link-button";
import { HostedApprovalRecoverySettings } from "@/src/components/settings/hosted-approval-recovery-settings";
import { ApprovalPasskeyStatus } from "@/src/components/settings/approval-passkey-status";

const verifiedAt = "2026-09-09T12:00:00Z";

export function BetterAuthAdoptionStudy() {
  return <div id="better-auth-adoption" data-design-component="better-auth-adoption" className="grid items-start gap-6 lg:grid-cols-2" inert>
    <div className="rounded-2xl border border-border bg-background p-5" data-auth-study="phone">
      <h3 className="mb-4 font-serif text-xl">Log in or sign up</h3>
      <HostedFirstPartyAuthPanel methods={["phone", "email", "telegram"]} showPassiveLegalNotice />
    </div>
    <div className="rounded-2xl border border-border bg-background p-5" data-auth-study="email">
      <h3 className="mb-4 font-serif text-xl">Log in or sign up</h3>
      <HostedFirstPartyAuthPanel methods={["email", "phone", "telegram"]} showPassiveLegalNotice />
    </div>
    <div className="rounded-2xl border border-border bg-background p-5" data-auth-study="connections">
      <h3 className="mb-4 font-serif text-xl">Connected accounts</h3>
      <HostedLoginMethodSettingsView onSelect={() => undefined}
        referralAction={<HostedSignupReferralLinkButtonView status="ready" onAction={() => undefined} />}
        account={{
        email: { address: "member@example.test", verifiedAt },
        phone: { number: "+12025550152", verifiedAt },
        telegram: { telegramUserId: "735001" }, referralIdentityKey: "synthetic-design-referral",
      }} />
    </div>
    <div className="rounded-2xl border border-border bg-background p-5" data-auth-study="recovery">
      <h3 className="mb-4 font-serif text-xl">Security</h3>
      <ApprovalPasskeyStatus />
      <HostedApprovalRecoverySettings enabled />
    </div>
  </div>;
}
