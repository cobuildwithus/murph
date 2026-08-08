import { describe, expect, it } from "vitest";

import { readHostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64url");

describe("readHostedOnboardingEnvironment", () => {
  it("reads hosted onboarding defaults and surfaces Privy config", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: "https://join.example.test",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_edge_monthly_123",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_GROUP_MONTHLY: "price_group_monthly_123",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_monthly_123",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_5_USD: "price_usage_5_123",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_10_USD: "price_usage_10_123",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_20_USD: "price_usage_20_123",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_25_USD: "price_usage_25_123",
      NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
      PRIVY_VERIFICATION_KEY: "privy-verification-key",
      STRIPE_SECRET_KEY: "sk_test_123",
    }));

    expect(environment.allowedMutationOrigins).toEqual([]);
    expect(environment.publicBaseUrl).toBe("https://join.example.test");
    expect(environment.privyAppId).toBe("cm_app_123");
    expect(environment.privyVerificationKey).toBe("privy-verification-key");
    expect(environment.inviteTtlHours).toBe(24 * 7);
    expect(environment.linqMaxActiveMembersPerConversationPhone).toBe(1000);
    expect(environment.linqFirstContactAdmissionMode).toBe("off");
    expect(environment.linqFirstContactAdmissionModel).toBe("gpt-5.6-luna");
    expect(environment.linqFirstContactAdmissionOpenAiApiKey).toBeNull();
    expect(environment.linqInstantStartPhonePrefixes).toEqual([
      "+351",
      "+352",
      "+353",
      "+354",
      "+356",
      "+357",
      "+358",
      "+359",
      "+370",
      "+371",
      "+372",
      "+376",
      "+377",
      "+378",
      "+385",
      "+386",
      "+420",
      "+421",
      "+423",
      "+598",
      "+673",
      "+852",
      "+853",
      "+886",
      "+965",
      "+966",
      "+968",
      "+971",
      "+972",
      "+973",
      "+974",
      "+30",
      "+31",
      "+32",
      "+33",
      "+34",
      "+36",
      "+39",
      "+40",
      "+41",
      "+43",
      "+44",
      "+45",
      "+46",
      "+47",
      "+48",
      "+49",
      "+56",
      "+61",
      "+64",
      "+65",
      "+81",
      "+82",
      "+1",
    ]);
    expect(environment.stripePriceIdsByPlan).toEqual({
      launch_edge_monthly: "price_edge_monthly_123",
      launch_group_monthly: "price_group_monthly_123",
      launch_max_monthly: null,
      launch_monthly: "price_monthly_123",
    });
    expect(environment.stripeUsageCreditPriceIdsByOffer).toEqual({
      usage_5_usd: "price_usage_5_123",
      usage_10_usd: "price_usage_10_123",
      usage_20_usd: "price_usage_20_123",
      usage_25_usd: "price_usage_25_123",
    });
  });

  it("reads explicit Linq config", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      LINQ_API_TOKEN: "linq-token",
      LINQ_API_BASE_URL: "https://linq.example.test/api",
      HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS: "+15550000001, +1 (555) 000-0002",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        "+1 (555) 000-0003, +15550000003",
      HOSTED_ONBOARDING_LINQ_MAX_ACTIVE_MEMBERS_PER_PHONE_NUMBER: "250",
      HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_MODE: "enforce",
      HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_MODEL: "gpt-5.4-mini",
      HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_OPENAI_API_KEY: "first-contact-openai-key",
      HOSTED_ONBOARDING_LINQ_INSTANT_START_PHONE_PREFIXES: "+1, +44,+1",
      NEXT_PUBLIC_PRIVY_APP_ID: "cm_app_123",
      TELEGRAM_BOT_USERNAME: "murph_bot",
      TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
    }));

    expect(environment.linqApiToken).toBe("linq-token");
    expect(environment.linqApiBaseUrl).toBe("https://linq.example.test/api");
    expect(environment.linqConversationPhoneNumbers).toEqual([
      "+15550000001",
      "+15550000002",
    ]);
    expect(environment.linqLocalAllowedInboundPhoneNumbers).toEqual([
      "+15550000003",
    ]);
    expect(environment.linqMaxActiveMembersPerConversationPhone).toBe(250);
    expect(environment.linqFirstContactAdmissionMode).toBe("enforce");
    expect(environment.linqFirstContactAdmissionModel).toBe("gpt-5.4-mini");
    expect(environment.linqFirstContactAdmissionOpenAiApiKey).toBe("first-contact-openai-key");
    expect(environment.linqInstantStartPhonePrefixes).toEqual(["+44", "+1"]);
    expect(environment.privyAppId).toBe("cm_app_123");
    expect(environment.telegramBotUsername).toBe("murph_bot");
    expect(environment.telegramWebhookSecret).toBe("telegram-secret");
  });

  it("prefers the Murph Telegram username override for user-facing bot links", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      MURPH_TELEGRAM_USERNAME_OVERRIDE: "@murphdevelopment_bot",
      TELEGRAM_BOT_USERNAME: "murph_bot",
    }));

    expect(environment.telegramBotUsername).toBe("murphdevelopment_bot");
  });

  it("falls back to the legacy Telegram bot username when the override is invalid", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      MURPH_TELEGRAM_USERNAME_OVERRIDE: "not valid",
      TELEGRAM_BOT_USERNAME: "murph_bot",
    }));

    expect(environment.telegramBotUsername).toBe("murph_bot");
  });

  it("falls back to the Vercel production domain for the public base URL", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      VERCEL_PROJECT_PRODUCTION_URL: "www.withmurph.ai",
    }));

    expect(environment.publicBaseUrl).toBe("https://www.withmurph.ai");
  });

  it("reads explicit hosted onboarding browser mutation origins", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS:
        "http://localhost:3000, http://127.0.0.2:3000, https://preview.example.test",
    }));

    expect(environment.allowedMutationOrigins).toEqual([
      "http://localhost:3000",
      "http://127.0.0.2:3000",
      "https://preview.example.test",
    ]);
  });

  it.each(["http://localhost:3000", "https://localhost:3000", "https://127.0.0.2:3000"])(
    "rejects loopback mutation origin %s in production",
    (origin) => {
      expect(() =>
        readHostedOnboardingEnvironment(createProcessEnv({
          HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS: origin,
          NODE_ENV: "production",
        })),
      ).toThrow(/must not include loopback origins in production/u);
    },
  );

  it("rejects the local Linq inbound allowlist in production", () => {
    expect(() =>
      readHostedOnboardingEnvironment(createProcessEnv({
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: "+15550000003",
        NODE_ENV: "production",
      })),
    ).toThrow(/local-development only/u);
  });

  it("rejects invalid Linq first-contact admission modes", () => {
    expect(() =>
      readHostedOnboardingEnvironment(createProcessEnv({
        HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_MODE: "shadow",
      })),
    ).toThrow(/FIRST_CONTACT_ADMISSION_MODE/u);
  });

  it("rejects malformed Linq instant-start phone prefixes", () => {
    expect(() =>
      readHostedOnboardingEnvironment(createProcessEnv({
        HOSTED_ONBOARDING_LINQ_INSTANT_START_PHONE_PREFIXES: "US,+44",
      })),
    ).toThrow(/LINQ_INSTANT_START_PHONE_PREFIXES/u);
  });

  it("falls back to OPENAI_API_KEY for Linq first-contact admission", () => {
    const environment = readHostedOnboardingEnvironment(createProcessEnv({
      OPENAI_API_KEY: "shared-openai-key",
    }));

    expect(environment.linqFirstContactAdmissionOpenAiApiKey).toBe("shared-openai-key");
  });

  it("requires contact privacy keys even outside production", () => {
    expect(() =>
      readHostedOnboardingEnvironment({
        NODE_ENV: "development",
      }),
    ).toThrow(/HOSTED_CONTACT_PRIVACY_KEYS/u);
  });

  it("reads an explicit contact privacy keyring", () => {
    const environment = readHostedOnboardingEnvironment({
      NODE_ENV: "development",
      HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION: "v1",
      HOSTED_CONTACT_PRIVACY_KEYS: `v1:${TEST_KEY}`,
    });

    expect(environment.contactPrivacyKeyring.currentVersion).toBe("v1");
    expect(environment.contactPrivacyKeyring.readVersions).toEqual(["v1"]);
    expect(environment.contactPrivacyKeyring.keysByVersion.v1).toBeInstanceOf(Buffer);
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
