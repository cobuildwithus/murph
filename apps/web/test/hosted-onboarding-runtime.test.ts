import { afterEach, describe, expect, it } from "vitest";

import type { HostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";
import {
  requireHostedStripeCheckoutConfig,
} from "@/src/lib/hosted-onboarding/runtime";

const globalForHostedOnboarding = globalThis as typeof globalThis & {
  __murphHostedOnboardingEnv?: HostedOnboardingEnvironment;
};

function createHostedOnboardingEnvironment(
  overrides: Partial<HostedOnboardingEnvironment> = {},
): HostedOnboardingEnvironment {
  return {
    aiUsageBillingMode: "disabled",
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
    linqIngressTypingDiagnosticEnabled: false,
    linqIngressTypingDiagnosticTimeoutMs: 750,
    linqMaxActiveMembersPerConversationPhone: 1000,
    linqWebhookSecret: null,
    linqWebhookTimestampToleranceMs: 5 * 60_000,
    privyAppId: null,
    privyAppSecret: null,
    privyVerificationKey: null,
    publicBaseUrl: "https://join.example.test",
    stripePriceIdsByPlan: {
      launch_annual: "price_annual_123",
      launch_monthly: "price_monthly_123",
    },
    stripeSecretKey: "sk_test_123",
    stripeUsageMeterEventName: null,
    stripeUsagePriceIdsByPlan: {
      launch_annual: null,
      launch_monthly: null,
    },
    stripeWebhookSecret: null,
    telegramBotUsername: null,
    telegramWebhookSecret: null,
    ...overrides,
  };
}

describe("requireHostedStripeCheckoutConfig", () => {
  afterEach(() => {
    delete globalForHostedOnboarding.__murphHostedOnboardingEnv;
  });

  it("allows base-only checkout config while AI usage billing is disabled", () => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment();

    const config = requireHostedStripeCheckoutConfig({
      billingPlanCode: "launch_monthly",
    });

    expect(config.billingPlanCode).toBe("launch_monthly");
    expect(config.priceId).toBe("price_monthly_123");
    expect(config.usagePriceId).toBeNull();
    expect(config.stripe).toBeTruthy();
  });

  it("requires the usage meter event and usage price only when Stripe metering is enabled", () => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment({
        aiUsageBillingMode: "stripe_meter",
        stripeUsageMeterEventName: null,
        stripeUsagePriceIdsByPlan: {
          launch_annual: "price_usage_annual_123",
          launch_monthly: "price_usage_monthly_123",
        },
      });

    let meterEventError: unknown;
    try {
      requireHostedStripeCheckoutConfig({
        billingPlanCode: "launch_monthly",
      });
    } catch (error) {
      meterEventError = error;
    }
    expect(meterEventError).toMatchObject({
      code: "STRIPE_USAGE_METER_EVENT_NAME_REQUIRED",
      httpStatus: 500,
    });

    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment({
        aiUsageBillingMode: "stripe_meter",
        stripeUsageMeterEventName: "ai_total_tokens",
        stripeUsagePriceIdsByPlan: {
          launch_annual: "price_usage_annual_123",
          launch_monthly: null,
        },
      });

    let usagePriceError: unknown;
    try {
      requireHostedStripeCheckoutConfig({
        billingPlanCode: "launch_monthly",
      });
    } catch (error) {
      usagePriceError = error;
    }
    expect(usagePriceError).toMatchObject({
      code: "STRIPE_USAGE_PRICE_ID_REQUIRED",
      httpStatus: 500,
    });
  });
});
