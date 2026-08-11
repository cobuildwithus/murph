import {
  JoinInviteCheckoutPanel,
  JoinInviteFamilyBillingManagementPanel,
  JoinInviteFamilyBillingSyncPanel,
  JoinInviteFamilyCheckoutContinuationPanel,
} from "@/src/components/hosted-onboarding/join-invite-stage-server";
import { listHostedBillingPlanPresentations } from "@/src/lib/hosted-onboarding/billing-plans";

export function JoinFamilyBillingRecoveryStudy() {
  const billingPlans = listHostedBillingPlanPresentations();

  return (
    <div
      data-design-section="join-family-billing-recovery"
      id="join-family-billing-recovery-section"
      className="grid gap-8"
      inert
    >
      <div className="space-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Terminal Family recovery
          </p>
          <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
            Family and individual choices
          </h3>
        </div>
        <JoinInviteCheckoutPanel
          billingReady
          billingPlans={billingPlans}
          familyBillingRecovery="available"
          inviteCode="design-family-recovery"
        />
      </div>

      <div
        className="max-w-xl space-y-4"
        data-design-state="family-billing-management"
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Payment issue
          </p>
          <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
            Family billing management
          </h3>
        </div>
        <JoinInviteFamilyBillingManagementPanel />
      </div>

      <div className="max-w-xl space-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Checkout canceled or resumed
          </p>
          <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
            Existing Family checkout
          </h3>
        </div>
        <JoinInviteFamilyCheckoutContinuationPanel />
      </div>

      <div className="max-w-3xl space-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Checkout submitted
          </p>
          <h3 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-foreground">
            Persistent Family confirmation
          </h3>
        </div>
        <JoinInviteFamilyBillingSyncPanel />
      </div>
    </div>
  );
}
