import type Stripe from "stripe";

import type { HostedStripePortalConfigurationKind } from "@/src/lib/hosted-onboarding/stripe-portal-config";

export function makeSafeStripePortalConfiguration(input: {
  configurationId: string;
  kind?: HostedStripePortalConfigurationKind;
  livemode?: boolean;
}): Stripe.BillingPortal.Configuration {
  const kind = input.kind ?? "member";

  return {
    active: true,
    application: null,
    business_profile: {
      headline: null,
      privacy_policy_url: null,
      terms_of_service_url: null,
    },
    created: 1_775_606_400,
    default_return_url: null,
    features: {
      customer_update: {
        allowed_updates: [],
        enabled: false,
      },
      invoice_history: {
        enabled: true,
      },
      payment_method_update: {
        enabled: true,
        payment_method_configuration: null,
      },
      subscription_cancel: {
        cancellation_reason: {
          enabled: false,
          options: [],
        },
        enabled: kind !== "payment_recovery",
        mode: "at_period_end",
        proration_behavior: "none",
      },
      subscription_update: {
        billing_cycle_anchor: null,
        default_allowed_updates: [],
        enabled: false,
        products: [],
        proration_behavior: "none",
        schedule_at_period_end: {
          conditions: [],
        },
        trial_update_behavior: "end_trial",
      },
    },
    id: input.configurationId,
    is_default: false,
    livemode: input.livemode ?? false,
    login_page: {
      enabled: false,
      url: null,
    },
    metadata: null,
    name: null,
    object: "billing_portal.configuration",
    updated: 1_775_606_400,
  };
}
