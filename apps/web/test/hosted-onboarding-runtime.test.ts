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
    stripePriceIdsByPlan: {
      launch_edge_monthly: "price_edge_monthly_123",
      launch_monthly: "price_monthly_123",
    },
    stripeSecretKey: "sk_test_123",
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
});
