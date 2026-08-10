import { FamilySetupAuthRequiredView } from "@/src/components/family/family-setup-auth-required";
import { BillingPortalButton } from "@/src/components/settings/billing-portal-button";
import { SettingsAuthRequiredView } from "../(dashboard)/settings/settings-auth-required";

export function SettingsAuthRequiredStudy() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div
        className="overflow-hidden rounded-2xl border border-border bg-background"
        data-design-section="settings-auth-required-payment-return"
        data-design-state="settings-usage-return-auth-required"
        id="settings-auth-required-payment-return-section"
        // Renders the presentational view, not the live screen, whose effect
        // would open the app-wide auth dialog over the catalog itself.
        inert
      >
        <p className="border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Usage-credit return after sign-out
        </p>
        <SettingsAuthRequiredView />
      </div>

      <div
        className="overflow-hidden rounded-2xl border border-border bg-background"
        data-design-section="family-setup-auth-required"
        id="family-setup-auth-required-section"
        inert
      >
        <p className="border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Opening Family setup without a session
        </p>
        <FamilySetupAuthRequiredView />
      </div>

      <div
        className="overflow-hidden rounded-2xl border border-border bg-background p-5"
        data-design-state="billing-portal-confirmation-error"
      >
        <p className="mb-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Confirmed Portal action with visible failure
        </p>
        <BillingPortalButton
          billingScope="family"
          block
          confirmation={{
            confirmLabel: "Open Family billing",
            description:
              "Stripe will open in a new page so you can review or resolve Family billing.",
            title: "Open Family billing?",
          }}
          label="Open Family billing"
          variant="secondary"
        />
      </div>
    </div>
  );
}
