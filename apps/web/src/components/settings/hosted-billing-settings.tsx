import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { HostedBillingSettingsAction } from "./hosted-billing-settings-action";

export function HostedBillingSettings(props: { authenticated: boolean }) {
  return (
    <Card className="border-stone-200/80 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg font-semibold tracking-tight text-stone-900">Subscription</CardTitle>
        <CardDescription className="leading-relaxed text-stone-500">
          View or update your plan and payment details.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!props.authenticated ? (
          <HostedSettingsSessionState
            authenticated={props.authenticated}
            signedOutDescription="Sign in to manage your subscription."
          />
        ) : (
          <>
            <p className="text-sm leading-relaxed text-stone-500">
              Change your plan, update payment methods, or cancel.
            </p>
            <HostedBillingSettingsAction />
          </>
        )}
      </CardContent>
    </Card>
  );
}
