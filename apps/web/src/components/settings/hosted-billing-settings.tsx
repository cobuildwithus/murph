import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { HostedBillingSettingsAction } from "./hosted-billing-settings-action";

export function HostedBillingSettings(props: { authenticated: boolean }) {
  if (!props.authenticated) {
    return (
      <HostedSettingsSessionState
        authenticated={props.authenticated}
        signedOutDescription="Sign in to manage your subscription."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-stone-500">
        Manage your plan and payment details.
      </p>
      <HostedBillingSettingsAction />
    </div>
  );
}
