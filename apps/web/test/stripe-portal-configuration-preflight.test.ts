import { readFile } from "node:fs/promises";

import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { runStripePortalConfigurationPreflight } from "../scripts/check-stripe-portal-configurations";

const PORTAL_CONFIGURATION_IDS = {
  family: "bpc_family",
  member: "bpc_member",
  payment_recovery: "bpc_paymentrecovery",
} as const;

describe("Stripe Billing Portal configuration preflight", () => {
  it("skips provider reads only for local and test environments", async () => {
    const retrieve = vi.fn();
    const log = vi.fn();

    await runStripePortalConfigurationPreflight(
      {},
      {
        log,
        stripe: makeStripePortalReader(retrieve),
      },
    );

    expect(retrieve).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Stripe Billing Portal preflight skipped: local or test environment.",
    );
  });

  it.each(["preview", "production"])(
    "requires every explicit configuration in Vercel %s",
    async (vercelEnvironment) => {
      await expect(runStripePortalConfigurationPreflight(
        makeEnvironment({
          HOSTED_ONBOARDING_STRIPE_MEMBER_PORTAL_CONFIGURATION_ID: undefined,
          VERCEL_ENV: vercelEnvironment,
        }),
        {
          stripe: makeStripePortalReader(vi.fn()),
        },
      )).rejects.toMatchObject({
        code: "HOSTED_BILLING_STRIPE_PORTAL_CONFIGURATIONS_REQUIRED",
        details: {
          envKeys: [
            "HOSTED_ONBOARDING_STRIPE_MEMBER_PORTAL_CONFIGURATION_ID",
          ],
        },
      });
    },
  );

  it.each([
    {
      livemode: false,
      secretKey: "sk_test_portal",
      vercelEnvironment: "preview",
    },
    {
      livemode: true,
      secretKey: "sk_live_portal",
      vercelEnvironment: "production",
    },
  ])(
    "verifies all dedicated configurations in Vercel $vercelEnvironment",
    async ({ livemode, secretKey, vercelEnvironment }) => {
      const retrieve = vi.fn(
        async (configurationId: string) =>
          makePortalConfiguration({
            configurationId,
            kind: readKindForConfigurationId(configurationId),
            livemode,
          }),
      );
      const log = vi.fn();

      await runStripePortalConfigurationPreflight(
        makeEnvironment({
          STRIPE_SECRET_KEY: secretKey,
          VERCEL_ENV: vercelEnvironment,
        }),
        {
          log,
          stripe: makeStripePortalReader(retrieve),
        },
      );

      expect(retrieve.mock.calls.map(([configurationId]) => configurationId)).toEqual([
        PORTAL_CONFIGURATION_IDS.member,
        PORTAL_CONFIGURATION_IDS.family,
        PORTAL_CONFIGURATION_IDS.payment_recovery,
      ]);
      expect(log).toHaveBeenCalledWith(
        "Stripe Billing Portal configuration preflight passed.",
      );
    },
  );

  it.each([
    {
      configure: (configuration: Stripe.BillingPortal.Configuration) => {
        configuration.active = false;
      },
      expectedIssue: "member configuration is inactive",
      label: "inactive configuration",
    },
    {
      configure: (configuration: Stripe.BillingPortal.Configuration) => {
        configuration.is_default = true;
      },
      expectedIssue:
        "member configuration must be dedicated rather than Stripe's default",
      label: "mutable Stripe default",
    },
    {
      configure: (configuration: Stripe.BillingPortal.Configuration) => {
        configuration.livemode = true;
      },
      expectedIssue: "member configuration does not match the Stripe key mode",
      label: "wrong Stripe mode",
    },
    {
      configure: (configuration: Stripe.BillingPortal.Configuration) => {
        configuration.features.payment_method_update.enabled = false;
      },
      expectedIssue:
        "member configuration must allow payment-method recovery",
      label: "disabled payment-method recovery",
    },
    {
      configure: (configuration: Stripe.BillingPortal.Configuration) => {
        configuration.features.subscription_update.enabled = true;
        configuration.features.subscription_update.default_allowed_updates = [
          "quantity",
        ];
      },
      expectedIssue:
        "member configuration must disable plan and quantity updates",
      label: "portal-side subscription updates",
    },
    {
      configure: (configuration: Stripe.BillingPortal.Configuration) => {
        configuration.features.subscription_cancel.mode = "immediately";
      },
      expectedIssue:
        "member configuration must cancel only at period end without proration",
      label: "immediate member cancellation",
    },
    {
      configure: (configuration: Stripe.BillingPortal.Configuration) => {
        configuration.features.subscription_cancel.enabled = true;
      },
      expectedIssue:
        "payment-recovery configuration must disable cancellation",
      kind: "payment_recovery" as const,
      label: "recovery cancellation",
    },
    {
      configure: (configuration: Stripe.BillingPortal.Configuration) => {
        Reflect.set(configuration.features, "subscription_pause", {
          enabled: true,
        });
      },
      expectedIssue: "member configuration must disable subscription pauses",
      label: "subscription pause",
    },
  ])("rejects $label", async ({
    configure,
    expectedIssue,
    kind = "member",
  }) => {
    const retrieve = vi.fn(async (configurationId: string) => {
      const configurationKind = readKindForConfigurationId(configurationId);
      const configuration = makePortalConfiguration({
        configurationId,
        kind: configurationKind,
        livemode: false,
      });
      if (configurationKind === kind) {
        configure(configuration);
      }
      return configuration;
    });

    await expect(runStripePortalConfigurationPreflight(
      makeEnvironment(),
      {
        stripe: makeStripePortalReader(retrieve),
      },
    )).rejects.toThrow(expectedIssue);
  });

  it("rejects shared IDs before calling Stripe", async () => {
    const retrieve = vi.fn();

    await expect(runStripePortalConfigurationPreflight(
      makeEnvironment({
        HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID:
          PORTAL_CONFIGURATION_IDS.member,
      }),
      {
        stripe: makeStripePortalReader(retrieve),
      },
    )).rejects.toThrow(
      "Member, Family, and payment-recovery Stripe Billing Portal configurations must use distinct IDs.",
    );

    expect(retrieve).not.toHaveBeenCalled();
  });

  it("does not expose Stripe provider error details", async () => {
    const privateProviderMessage = "private provider response";
    const error = await runStripePortalConfigurationPreflight(
      makeEnvironment(),
      {
        stripe: makeStripePortalReader(
          vi.fn().mockRejectedValue(new Error(privateProviderMessage)),
        ),
      },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Unable to inspect the member Stripe Billing Portal configuration.",
    );
    expect((error as Error).message).not.toContain(privateProviderMessage);
  });

  it("runs the Portal gate in the production build preflight", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["stripe-portal:config-check"]).toContain(
      "check-stripe-portal-configurations.ts",
    );
    expect(packageJson.scripts?.build).toContain(
      "pnpm stripe-portal:config-check &&",
    );
  });
});

function makeEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID:
      PORTAL_CONFIGURATION_IDS.family,
    HOSTED_ONBOARDING_STRIPE_MEMBER_PORTAL_CONFIGURATION_ID:
      PORTAL_CONFIGURATION_IDS.member,
    HOSTED_ONBOARDING_STRIPE_PAYMENT_RECOVERY_PORTAL_CONFIGURATION_ID:
      PORTAL_CONFIGURATION_IDS.payment_recovery,
    NODE_ENV: "production",
    STRIPE_SECRET_KEY: "sk_test_portal",
    VERCEL_ENV: "preview",
    ...overrides,
  };
}

function makeStripePortalReader(
  retrieve: (
    configurationId: string,
  ) => Promise<Stripe.BillingPortal.Configuration>,
): {
  billingPortal: {
    configurations: {
      retrieve: typeof retrieve;
    };
  };
} {
  return {
    billingPortal: {
      configurations: {
        retrieve,
      },
    },
  };
}

function readKindForConfigurationId(
  configurationId: string,
): keyof typeof PORTAL_CONFIGURATION_IDS {
  const entry = Object.entries(PORTAL_CONFIGURATION_IDS).find(
    ([, candidateId]) => candidateId === configurationId,
  );
  if (!entry) {
    throw new Error("Unexpected test configuration ID.");
  }
  return entry[0] as keyof typeof PORTAL_CONFIGURATION_IDS;
}

function makePortalConfiguration(input: {
  configurationId: string;
  kind: keyof typeof PORTAL_CONFIGURATION_IDS;
  livemode: boolean;
}): Stripe.BillingPortal.Configuration {
  const cancellationEnabled = input.kind !== "payment_recovery";

  return {
    active: true,
    application: null,
    business_profile: {
      headline: null,
      privacy_policy_url: null,
      terms_of_service_url: null,
    },
    created: 1_777_000_000,
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
        enabled: cancellationEnabled,
        mode: "at_period_end",
        proration_behavior: "none",
      },
      subscription_update: {
        billing_cycle_anchor: null,
        default_allowed_updates: [],
        enabled: false,
        products: null,
        proration_behavior: "none",
        schedule_at_period_end: {
          conditions: [],
        },
        trial_update_behavior: "end_trial",
      },
    },
    id: input.configurationId,
    is_default: false,
    livemode: input.livemode,
    login_page: {
      enabled: false,
      url: null,
    },
    metadata: {},
    name: null,
    object: "billing_portal.configuration",
    updated: 1_777_000_000,
  };
}
