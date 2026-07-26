import { afterEach, describe, expect, it } from "vitest";

import type { HostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";
import {
  assertHostedStripePortalConfigurationsForDeployment,
} from "@/src/lib/hosted-onboarding/stripe-portal-config";
import {
  requireHostedStripeCheckoutConfig,
  requireHostedStripeFamilyPlanConfig,
  requireHostedStripeUsageCreditCheckoutConfig,
  resolveHostedStripePortalConfigurationId,
} from "@/src/lib/hosted-onboarding/runtime";

const globalForHostedOnboarding = globalThis as typeof globalThis & {
  __murphHostedOnboardingEnv?: HostedOnboardingEnvironment;
  __murphHostedOnboardingStripe?: unknown;
};
const originalVercelEnvironment = process.env.VERCEL_ENV;
const PORTAL_CONFIGURATION_IDS = {
  family: "bpc_family",
  member: "bpc_member",
  payment_recovery: "bpc_paymentrecovery",
} as const;

function createHostedOnboardingEnvironment(
  overrides: Partial<HostedOnboardingEnvironment> = {},
): HostedOnboardingEnvironment {
  return {
    contactPrivacyKeyring: {
      currentVersion: "v1",
      keysByVersion: {
        v1: Buffer.alloc(32, 7),
      },
      readVersions: ["v1"],
    },
    inviteTtlHours: 24 * 7,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: null,
    linqConversationPhoneNumbers: [],
    linqFirstContactAdmissionMode: "off",
    linqFirstContactAdmissionModel: "gpt-5.4-nano",
    linqFirstContactAdmissionOpenAiApiKey: null,
    linqMaxActiveMembersPerConversationPhone: 1000,
    linqWebhookSecret: null,
    linqWebhookTimestampToleranceMs: 5 * 60_000,
    privyAppId: null,
    privyAppSecret: null,
    privyVerificationKey: null,
    publicBaseUrl: "https://join.example.test",
    stripeFamilyPriceIdsByPlan: {
      edge: "price_family_edge_123",
      pulse: "price_family_pulse_123",
    },
    stripePortalConfigurationIds: PORTAL_CONFIGURATION_IDS,
    stripePriceIdsByPlan: {
      launch_edge_monthly: "price_edge_monthly_123",
      launch_monthly: "price_monthly_123",
    },
    stripeUsageCreditPriceIdsByOffer: {
      usage_5_usd: "price_usage_5_123",
      usage_10_usd: "price_usage_10_123",
      usage_25_usd: "price_usage_25_123",
    },
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: null,
    telegramBotUsername: null,
    telegramBotToken: null,
    telegramWebhookSecret: null,
    ...overrides,
  };
}

afterEach(() => {
  delete globalForHostedOnboarding.__murphHostedOnboardingEnv;
  delete globalForHostedOnboarding.__murphHostedOnboardingStripe;
  if (originalVercelEnvironment === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnvironment;
  }
});

describe("requireHostedStripeCheckoutConfig", () => {
  it("allows checkout config with the hosted recurring price", () => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment();

    const config = requireHostedStripeCheckoutConfig({
      billingPlanCode: "launch_monthly",
    });

    expect(config.billingPlanCode).toBe("launch_monthly");
    expect(config.priceId).toBe("price_monthly_123");
    expect(config.stripe).toBeTruthy();
  });

  it("resolves the configured Family price for each member tier", () => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment();

    expect(requireHostedStripeFamilyPlanConfig({ planCode: "pulse" })).toMatchObject({
      planCode: "pulse",
      priceId: "price_family_pulse_123",
    });
    expect(requireHostedStripeFamilyPlanConfig({ planCode: "edge" })).toMatchObject({
      planCode: "edge",
      priceId: "price_family_edge_123",
    });
  });

  it("resolves the selected reusable usage-credit price and Stripe mode", () => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment();

    expect(requireHostedStripeUsageCreditCheckoutConfig({
      offerCode: "usage_10_usd",
    })).toMatchObject({
      offerCode: "usage_10_usd",
      priceId: "price_usage_10_123",
      stripeLiveMode: false,
    });
  });

  it("rejects test-mode usage-credit Stripe configuration in production", () => {
    delete process.env.VERCEL_ENV;
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment({ isProduction: true });

    expect(() => requireHostedStripeUsageCreditCheckoutConfig({
      offerCode: "usage_10_usd",
    })).toThrowError(expect.objectContaining({
      code: "HOSTED_USAGE_CREDIT_LIVE_STRIPE_REQUIRED",
      httpStatus: 500,
    }));
  });

  it("allows test-mode usage-credit Stripe configuration in a Vercel preview", () => {
    process.env.VERCEL_ENV = "preview";
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment({ isProduction: true });

    expect(requireHostedStripeUsageCreditCheckoutConfig({
      offerCode: "usage_10_usd",
    })).toMatchObject({
      stripeLiveMode: false,
    });
  });

  it("fails closed when the selected usage-credit price is missing", () => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment({
        stripeUsageCreditPriceIdsByOffer: {
          usage_5_usd: "price_usage_5_123",
          usage_10_usd: null,
          usage_25_usd: "price_usage_25_123",
        },
      });

    expect(() => requireHostedStripeUsageCreditCheckoutConfig({
      offerCode: "usage_10_usd",
    })).toThrowError(expect.objectContaining({
      code: "STRIPE_PRICE_ID_REQUIRED",
      httpStatus: 500,
    }));
  });
});

describe("Stripe Billing Portal runtime configuration", () => {
  it("resolves the dedicated configuration for each portal purpose", () => {
    for (const kind of ["family", "member", "payment_recovery"] as const) {
      expect(resolveHostedStripePortalConfigurationId(kind, {
        environment: {
          isProduction: true,
          stripePortalConfigurationIds: PORTAL_CONFIGURATION_IDS,
        },
      })).toBe(PORTAL_CONFIGURATION_IDS[kind]);
    }
  });

  it("allows the mutable Stripe default only in a local or test runtime", () => {
    delete process.env.VERCEL_ENV;
    expect(resolveHostedStripePortalConfigurationId("member", {
      environment: {
        isProduction: false,
        stripePortalConfigurationIds: {
          ...PORTAL_CONFIGURATION_IDS,
          member: null,
        },
      },
    })).toBeUndefined();
  });

  it.each(["preview", "production"])(
    "requires explicit configurations in the ambient Vercel %s runtime",
    (vercelEnvironment) => {
      process.env.VERCEL_ENV = vercelEnvironment;

      expect(() =>
        resolveHostedStripePortalConfigurationId("member", {
          environment: {
            isProduction: false,
            stripePortalConfigurationIds: {
              ...PORTAL_CONFIGURATION_IDS,
              member: null,
            },
          },
        })
      ).toThrowError(
        expect.objectContaining({
          code: "HOSTED_BILLING_STRIPE_PORTAL_CONFIGURATION_REQUIRED",
          details: {
            configurationKind: "member",
            envKey:
              "HOSTED_ONBOARDING_STRIPE_MEMBER_PORTAL_CONFIGURATION_ID",
            reason: "missing",
          },
          retryable: false,
        }),
      );
    },
  );

  it("fails closed when a production portal purpose has no configuration", () => {
    expect(() =>
      resolveHostedStripePortalConfigurationId("payment_recovery", {
        environment: {
          isProduction: true,
          stripePortalConfigurationIds: {
            ...PORTAL_CONFIGURATION_IDS,
            payment_recovery: null,
          },
        },
      })
    ).toThrowError(
      expect.objectContaining({
        code: "HOSTED_BILLING_STRIPE_PORTAL_CONFIGURATION_REQUIRED",
        details: {
          configurationKind: "payment_recovery",
          envKey:
            "HOSTED_ONBOARDING_STRIPE_PAYMENT_RECOVERY_PORTAL_CONFIGURATION_ID",
          reason: "missing",
        },
        httpStatus: 500,
        retryable: false,
      }),
    );
  });

  it("rejects a configured non-Stripe portal id before provider entry", () => {
    expect(() =>
      resolveHostedStripePortalConfigurationId("member", {
        environment: {
          isProduction: false,
          stripePortalConfigurationIds: {
            ...PORTAL_CONFIGURATION_IDS,
            member: "portal_member",
          },
        },
      })
    ).toThrowError(
      expect.objectContaining({
        code: "HOSTED_BILLING_STRIPE_PORTAL_CONFIGURATION_REQUIRED",
        details: {
          configurationKind: "member",
          envKey: "HOSTED_ONBOARDING_STRIPE_MEMBER_PORTAL_CONFIGURATION_ID",
          reason: "invalid",
        },
        httpStatus: 500,
        retryable: false,
      }),
    );
  });

  it("exposes a secret-safe all-config assertion for runtime health checks", () => {
    expect(() =>
      assertHostedStripePortalConfigurationsForDeployment({
        configurationIds: {
          family: null,
          member: "portal_member",
          payment_recovery: "bpc_paymentrecovery",
        },
        isDeployedRuntime: true,
      })
    ).toThrowError(
      expect.objectContaining({
        code: "HOSTED_BILLING_STRIPE_PORTAL_CONFIGURATIONS_REQUIRED",
        details: {
          envKeys: [
            "HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID",
            "HOSTED_ONBOARDING_STRIPE_MEMBER_PORTAL_CONFIGURATION_ID",
          ],
        },
        httpStatus: 500,
        retryable: false,
      }),
    );
  });
});
