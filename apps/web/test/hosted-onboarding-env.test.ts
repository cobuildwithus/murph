import { describe, expect, it } from "vitest";

import { readHostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64url");
const REMOVED_LINQ_TOKEN_ALIAS = ["HEALTHY", "BOB", "LINQ", "API", "TOKEN"].join("_");
const REMOVED_LINQ_BASE_URL_ALIAS = ["HEALTHY", "BOB", "LINQ", "API", "BASE", "URL"].join("_");

describe("readHostedOnboardingEnvironment", () => {
  it("reads hosted onboarding defaults and surfaces Privy config", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID: "price_123",
      NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
      PRIVY_VERIFICATION_KEY: "privy-verification-key",
      STRIPE_SECRET_KEY: "sk_test_123",
    }));

    expect(environment.publicBaseUrl).toBe("https://join.example.test");
    expect(environment.privyAppId).toBe("cm_app_123");
    expect(environment.privyVerificationKey).toBe("privy-verification-key");
    expect(environment.inviteTtlHours).toBe(24 * 7);
  });

  it("reads explicit Linq config", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      LINQ_API_TOKEN: "linq-token",
      LINQ_API_BASE_URL: "https://linq.example.test/api",
      NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
      TELEGRAM_BOT_USERNAME: "murph_bot",
      TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
    }));

    expect(environment.linqApiToken).toBe("linq-token");
    expect(environment.linqApiBaseUrl).toBe("https://linq.example.test/api");
    expect(environment.privyAppId).toBe("cm_app_123");
    expect(environment.telegramBotUsername).toBe("murph_bot");
    expect(environment.telegramWebhookSecret).toBe("telegram-secret");
  });

  it("falls back to the Vercel production domain for the public base URL", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    }));

    expect(environment.publicBaseUrl).toBe("https://www.withmurph.ai");
  });

  it("ignores removed branded Linq aliases", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      [REMOVED_LINQ_TOKEN_ALIAS]: "linq-token",
      [REMOVED_LINQ_BASE_URL_ALIAS]: "https://linq.example.test/api",
    }));

    expect(environment.linqApiToken).toBeNull();
    expect(environment.linqApiBaseUrl).toBe("https://api.linqapp.com/api/partner/v3");
  });

  it("requires HOSTED_CONTACT_PRIVACY_KEYS", () => {
    expect(() =>
      readHostedOnboardingEnvironment({
        NODE_ENV: "test",
      }),
    ).toThrow(/HOSTED_CONTACT_PRIVACY_KEYS/u);
  });

  it("rejects non-localhost HTTP public base URLs", () => {
    expect(() =>
      readHostedOnboardingEnvironment(createProcessEnv({
        HOSTED_ONBOARDING_PUBLIC_BASE_URL: "http://join.example.test",
      })),
    ).toThrow(/Hosted execution base URLs must use HTTPS/u);
  });

  it("rejects embedded credentials in the public base URL", () => {
    expect(() =>
      readHostedOnboardingEnvironment(createProcessEnv({
        HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://user:pass@join.example.test",
      })),
    ).toThrow(/must not include embedded credentials/u);
  });
});

function createProcessEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return {
    HOSTED_CONTACT_PRIVACY_KEYS: `v1:${TEST_KEY}`,
    NODE_ENV: "test",
    ...values,
  };
}
