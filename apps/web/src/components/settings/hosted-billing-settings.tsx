import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { HostedBillingSettingsAction } from "./hosted-billing-settings-action";

export function HostedBillingSettings(props: {
  authenticated: boolean;
  currentBillingPlanCode?: string | null;
}) {
  if (!props.authenticated) {
    return (
      <HostedSettingsSessionState
        authenticated={props.authenticated}
        signedOutDescription="Sign in to manage your subscription."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Manage your plan and payment details.
      </p>
      <HostedBillingSettingsAction
        showUpgrade={props.currentBillingPlanCode === "launch_monthly"}
      />
    </div>
  );
}
