import { describe, expect, it } from "vitest";

import { readHostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64url");
const REMOVED_LINQ_TOKEN_ALIAS = ["HEALTHY", "BOB", "LINQ", "API", "TOKEN"].join("_");
const REMOVED_LINQ_BASE_URL_ALIAS = ["HEALTHY", "BOB", "LINQ", "API", "BASE", "URL"].join("_");

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
    expect(environment.revnetChainId).toBeNull();
    expect(environment.revnetStripeCurrency).toBeNull();
    expect(environment.sessionCookieName).toBe("hb_hosted_session");
    expect(environment.stripeBillingMode).toBe("payment");
    expect(environment.inviteTtlHours).toBe(24 * 7);
  });

  it("reads explicit Linq config and Stripe subscription mode", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      LINQ_API_TOKEN: "linq-token",
      LINQ_API_BASE_URL: "https://linq.example.test/api",
      HOSTED_ONBOARDING_STRIPE_BILLING_MODE: "subscription",
      NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
    }));

    expect(environment.linqApiToken).toBe("linq-token");
    expect(environment.linqApiBaseUrl).toBe("https://linq.example.test/api");
    expect(environment.privyAppId).toBe("cm_app_123");
    expect(environment.stripeBillingMode).toBe("subscription");
  });

  it("reads hosted RevNet config when the full subscription configuration is present", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      HOSTED_ONBOARDING_REVNET_CHAIN_ID: "8453",
      HOSTED_ONBOARDING_REVNET_PROJECT_ID: "1",
      HOSTED_ONBOARDING_REVNET_RPC_URL: "https://rpc.example.test/base",
      HOSTED_ONBOARDING_REVNET_STRIPE_CURRENCY: "USD",
      HOSTED_ONBOARDING_REVNET_TERMINAL_ADDRESS: "0x0000000000000000000000000000000000000001",
      HOSTED_ONBOARDING_REVNET_TREASURY_PRIVATE_KEY: `0x${"11".repeat(32)}`,
      HOSTED_ONBOARDING_REVNET_WAIT_CONFIRMATIONS: "0",
      HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT: "2000000000000",
      HOSTED_ONBOARDING_STRIPE_BILLING_MODE: "subscription",
    }));

    expect(environment.revnetChainId).toBe(8453);
    expect(environment.revnetProjectId).toBe("1");
    expect(environment.revnetRpcUrl).toBe("https://rpc.example.test/base");
    expect(environment.revnetStripeCurrency).toBe("usd");
    expect(environment.revnetTerminalAddress).toBe("0x0000000000000000000000000000000000000001");
    expect(environment.revnetWaitConfirmations).toBe(0);
    expect(environment.revnetWeiPerStripeMinorUnit).toBe("2000000000000");
  });

  it("rejects partial hosted RevNet configuration", () => {
    expect(() =>
      readHostedOnboardingEnvironment(createProcessEnv({
        DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
        HOSTED_ONBOARDING_REVNET_CHAIN_ID: "8453",
        HOSTED_ONBOARDING_STRIPE_BILLING_MODE: "subscription",
      })),
    ).toThrow(/Hosted RevNet issuance is partially configured/u);
  });

  it("requires subscription billing mode when hosted RevNet issuance is configured", () => {
    expect(() =>
      readHostedOnboardingEnvironment(createProcessEnv({
        DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
        HOSTED_ONBOARDING_REVNET_CHAIN_ID: "8453",
        HOSTED_ONBOARDING_REVNET_PROJECT_ID: "1",
        HOSTED_ONBOARDING_REVNET_RPC_URL: "https://rpc.example.test/base",
        HOSTED_ONBOARDING_REVNET_STRIPE_CURRENCY: "usd",
        HOSTED_ONBOARDING_REVNET_TERMINAL_ADDRESS: "0x0000000000000000000000000000000000000001",
        HOSTED_ONBOARDING_REVNET_TREASURY_PRIVATE_KEY: `0x${"11".repeat(32)}`,
        HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT: "2000000000000",
        HOSTED_ONBOARDING_STRIPE_BILLING_MODE: "payment",
      })),
    ).toThrow(/requires HOSTED_ONBOARDING_STRIPE_BILLING_MODE=subscription/u);
  });

  it("rejects a non-numeric RevNet wei pricing multiplier", () => {
    expect(() =>
      readHostedOnboardingEnvironment(createProcessEnv({
        DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
        HOSTED_ONBOARDING_REVNET_CHAIN_ID: "8453",
        HOSTED_ONBOARDING_REVNET_PROJECT_ID: "1",
        HOSTED_ONBOARDING_REVNET_RPC_URL: "https://rpc.example.test/base",
        HOSTED_ONBOARDING_REVNET_STRIPE_CURRENCY: "usd",
        HOSTED_ONBOARDING_REVNET_TERMINAL_ADDRESS: "0x0000000000000000000000000000000000000001",
        HOSTED_ONBOARDING_REVNET_TREASURY_PRIVATE_KEY: `0x${"11".repeat(32)}`,
        HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT: "not-a-number",
        HOSTED_ONBOARDING_STRIPE_BILLING_MODE: "subscription",
      })),
    ).toThrow(/HOSTED_ONBOARDING_REVNET_WEI_PER_STRIPE_MINOR_UNIT must be an unsigned integer string/u);
  });

  it("ignores removed branded Linq aliases", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      DEVICE_SYNC_ENCRYPTION_KEY: TEST_KEY,
      [REMOVED_LINQ_TOKEN_ALIAS]: "linq-token",
      [REMOVED_LINQ_BASE_URL_ALIAS]: "https://linq.example.test/api",
    }));

    expect(environment.linqApiToken).toBeNull();
    expect(environment.linqApiBaseUrl).toBe("https://api.linqapp.com/api/partner/v3");
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
