import { FamilySetupAuthRequiredView } from "@/src/components/family/family-setup-auth-required";
import { SettingsAuthRequiredView } from "../(dashboard)/settings/settings-auth-required";

export function SettingsAuthRequiredStudy() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div
        className="overflow-hidden rounded-2xl border border-border bg-background"
        data-design-section="settings-auth-required-payment-return"
        id="settings-auth-required-payment-return-section"
        // Renders the presentational view, not the live screen, whose effect
        // would open the app-wide auth dialog over the catalog itself.
        inert
      >
        <p className="border-b border-border px-5 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Returning from Stripe without a session
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
    </div>
  );
}
