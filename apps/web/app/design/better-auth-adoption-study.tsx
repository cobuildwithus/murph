"use client";

import { JoinInviteMessagingSetupView } from "@/src/components/hosted-onboarding/join-invite-islands";
import { HostedFirstPartyAuthPanel } from "@/src/components/hosted-onboarding/hosted-first-party-auth-panel";
import { HostedLoginMethodSettingsView } from "@/src/components/settings/hosted-login-method-settings";
import { HostedSignupReferralLinkButtonView } from "@/src/components/settings/hosted-signup-referral-link-button";
import { HostedApprovalRecoverySettings } from "@/src/components/settings/hosted-approval-recovery-settings";
import { InitialPasskeySetupView } from "@/src/components/settings/hosted-passkey-settings";
import { HostedVerificationCodeStep } from "@/src/components/hosted-onboarding/hosted-verification-code-step";
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
        telegram: { telegramUserId: "735001", username: "synthetic_member" }, referralIdentityKey: "synthetic-design-referral",
      }} />
    </div>
    <div className="rounded-2xl border border-border bg-background p-5" data-auth-study="unconnected">
      <h3 className="mb-4 font-serif text-xl">Connected accounts</h3>
      <HostedLoginMethodSettingsView onSelect={() => undefined}
        referralAction={<HostedSignupReferralLinkButtonView status="ready" onAction={() => undefined} />}
        account={{ email: { address: null, verifiedAt: null }, phone: { number: null, verifiedAt: null }, telegram: { telegramUserId: null } }} />
    </div>
    <div className="rounded-2xl border border-border bg-background p-5" data-auth-study="compact-code">
      <h3 className="mb-4 font-serif text-xl">Verify your phone</h3>
      <div className="space-y-3"><HostedVerificationCodeStep size="compact" autoFocus={false} code="" description="We texted the latest code to •••• 0152."
        disabled={false} pendingAction={null} primaryActionLabel="Verify phone" primaryActionPendingLabel="Finishing..."
        onCodeChange={() => undefined} onResendCode={() => undefined} onSubmit={() => undefined} /></div>
    </div>
    <div className="rounded-2xl border border-border bg-background p-5" data-auth-study="initial-passkey">
      <h3 className="mb-4 font-serif text-xl">Security</h3>
      <InitialPasskeySetupView enrollmentEnabled pending={false} registered={false} error={null} onEnroll={() => undefined} />
    </div>
    <div className="rounded-2xl border border-border bg-background p-5" data-auth-study="messaging">
      <h3 className="mb-4 font-serif text-xl">How should Murph reach you?</h3>
      <JoinInviteMessagingSetupView onSelect={() => undefined} />
    </div>
    <div className="rounded-2xl border border-border bg-background p-5" data-auth-study="recovery">
      <h3 className="mb-4 font-serif text-xl">Security</h3>
      <ApprovalPasskeyStatus />
      <HostedApprovalRecoverySettings enabled />
    </div>
  </div>;
}
