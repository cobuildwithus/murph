import type Stripe from "stripe";

import type {
  HostedStripePortalConfigurationKind,
} from "./stripe-portal-config";

export function readHostedStripePortalConfigurationIssues(input: {
  configuration: Stripe.BillingPortal.Configuration;
  expectedConfigurationId: string;
  expectedLiveMode?: boolean;
  kind: HostedStripePortalConfigurationKind;
}): string[] {
  const issues: string[] = [];
  const label = formatHostedStripePortalKind(input.kind);
  const features = input.configuration.features;

  if (input.configuration.id !== input.expectedConfigurationId) {
    issues.push(`${label} configuration response did not match the requested ID`);
  }
  if (input.configuration.active !== true) {
    issues.push(`${label} configuration is inactive`);
  }
  if (input.configuration.is_default === true) {
    issues.push(
      `${label} configuration must be dedicated rather than Stripe's default`,
    );
  }
  if (
    input.expectedLiveMode !== undefined
    && input.configuration.livemode !== input.expectedLiveMode
  ) {
    issues.push(`${label} configuration does not match the Stripe key mode`);
  }
  if (features.invoice_history.enabled !== true) {
    issues.push(`${label} configuration must expose invoice history`);
  }
  if (features.payment_method_update.enabled !== true) {
    issues.push(`${label} configuration must allow payment-method recovery`);
  }
  if (
    features.subscription_update.enabled === true
    || features.subscription_update.default_allowed_updates.length > 0
  ) {
    issues.push(`${label} configuration must disable plan and quantity updates`);
  }
  if (isHostedStripePortalSubscriptionPauseEnabled(features)) {
    issues.push(`${label} configuration must disable subscription pauses`);
  }

  const cancellation = features.subscription_cancel;
  if (input.kind === "payment_recovery") {
    if (cancellation.enabled === true) {
      issues.push("payment-recovery configuration must disable cancellation");
    }
  } else if (
    cancellation.enabled !== true
    || cancellation.mode !== "at_period_end"
    || cancellation.proration_behavior !== "none"
  ) {
    issues.push(
      `${label} configuration must cancel only at period end without proration`,
    );
  }

  return issues;
}

function isHostedStripePortalSubscriptionPauseEnabled(
  features: Stripe.BillingPortal.Configuration["features"],
): boolean {
  const subscriptionPause = Reflect.get(features, "subscription_pause");
  return Boolean(
    subscriptionPause
    && typeof subscriptionPause === "object"
    && Reflect.get(subscriptionPause, "enabled") === true,
  );
}

function formatHostedStripePortalKind(
  kind: HostedStripePortalConfigurationKind,
): string {
  return kind === "payment_recovery" ? "payment-recovery" : kind;
}
