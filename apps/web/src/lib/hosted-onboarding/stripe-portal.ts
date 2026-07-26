import type Stripe from "stripe";

import { hostedOnboardingError } from "./errors";
import { resolveHostedStripePortalConfigurationId } from "./runtime";
import type {
  HostedStripePortalConfigurationKind,
} from "./stripe-portal-config";
import {
  readHostedStripePortalConfigurationIssues,
} from "./stripe-portal-policy";

export interface HostedStripePortalClient {
  billingPortal: {
    configurations: {
      retrieve: (
        configurationId: string,
      ) => PromiseLike<Stripe.BillingPortal.Configuration>;
    };
    sessions: {
      create: (
        params: Stripe.BillingPortal.SessionCreateParams,
      ) => PromiseLike<Stripe.BillingPortal.Session>;
    };
  };
}

export async function createHostedStripePortalSession(input: {
  kind: HostedStripePortalConfigurationKind;
  params: Omit<Stripe.BillingPortal.SessionCreateParams, "configuration">;
  stripe: HostedStripePortalClient;
}): Promise<Stripe.BillingPortal.Session> {
  const configurationId = resolveHostedStripePortalConfigurationId(input.kind);

  if (configurationId) {
    const configuration = await input.stripe.billingPortal.configurations.retrieve(
      configurationId,
    );
    const issues = readHostedStripePortalConfigurationIssues({
      configuration,
      expectedConfigurationId: configurationId,
      kind: input.kind,
    });

    if (issues.length > 0) {
      throw hostedOnboardingError({
        code: "HOSTED_BILLING_STRIPE_PORTAL_CONFIGURATION_UNSAFE",
        details: {
          code: "unsafe_configuration",
          configurationKind: input.kind,
        },
        httpStatus: 500,
        message:
          "Stripe Billing Portal settings changed and must be reviewed before opening billing.",
        retryable: false,
      });
    }
  }

  return input.stripe.billingPortal.sessions.create({
    ...(configurationId ? { configuration: configurationId } : {}),
    ...input.params,
  });
}
