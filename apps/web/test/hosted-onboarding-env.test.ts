import { describe, expect, it } from "vitest";

import { readHostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64url");

describe("readHostedOnboardingEnvironment", () => {
  it("reads hosted onboarding defaults and surfaces Privy config", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID: "price_123",
      NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
      PRIVY_APP_SECRET: "privy-secret",
      STRIPE_SECRET_KEY: "sk_test_123",
    }));

    expect(environment.publicBaseUrl).toBe("https://join.example.test");
    expect(environment.privyAppId).toBe("cm_app_123");
    expect(environment.privyAppSecret).toBe("privy-secret");
    expect(environment.sessionCookieName).toBe("hb_hosted_session");
    expect(environment.stripeBillingMode).toBe("payment");
    expect(environment.inviteTtlHours).toBe(24 * 7);
  });

  it("accepts explicit Linq aliases and Stripe subscription mode", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      HEALTHYBOB_LINQ_API_TOKEN: "linq-token",
      HEALTHYBOB_LINQ_API_BASE_URL: "https://linq.example.test/api",
      HOSTED_ONBOARDING_STRIPE_BILLING_MODE: "subscription",
      NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
    }));

    expect(environment.linqApiToken).toBe("linq-token");
    expect(environment.linqApiBaseUrl).toBe("https://linq.example.test/api");
    expect(environment.privyAppId).toBe("cm_app_123");
    expect(environment.stripeBillingMode).toBe("subscription");
  });

  it("requires DEVICE_SYNC_ENCRYPTION_KEY", () => {
    expect(() => readHostedOnboardingEnvironment(createProcessEnv({}))).toThrow(/DEVICE_SYNC_ENCRYPTION_KEY/u);
  });
});

function createProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...values,
  };
}
