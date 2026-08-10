import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import type { HostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";
import {
  requireHostedStripeCheckoutConfig,
  requireHostedStripeBillingPlanConfig,
  requireHostedStripeFamilyPlanConfig,
  requireHostedStripeUsageCreditCheckoutConfig,
  requireValidatedHostedStripeBillingPlanConfig,
  isHostedBillingPlanSelectionAvailable,
} from "@/src/lib/hosted-onboarding/runtime";

const globalForHostedOnboarding = globalThis as typeof globalThis & {
  __murphHostedOnboardingEnv?: HostedOnboardingEnvironment;
  __murphHostedOnboardingStripe?: unknown;
};
const originalVercelEnvironment = process.env.VERCEL_ENV;

type StripePriceRetrieveMock = (
  ...args: Parameters<Stripe["prices"]["retrieve"]>
) => Promise<Record<string, unknown>>;

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
    linqInstantStartPhonePrefixes: ["+1"],
    linqMaxActiveMembersPerConversationPhone: 1000,
    linqWebhookSecret: null,
    linqWebhookTimestampToleranceMs: 5 * 60_000,
    privyAppId: null,
    privyAppSecret: null,
    privyVerificationKey: null,
    publicBaseUrl: "https://join.example.test",
    stripeFamilyPriceIdsByPlan: {
      edge: "price_family_edge_123",
      max: "price_family_max_123",
      pulse: "price_family_pulse_123",
    },
    stripePriceIdsByPlan: {
      launch_edge_monthly: "price_edge_monthly_123",
      launch_group_monthly: "price_group_monthly_123",
      launch_max_monthly: "price_max_monthly_123",
      launch_monthly: "price_monthly_123",
    },
    stripeUsageCreditPriceIdsByOffer: {
      usage_5_usd: "price_usage_5_123",
      usage_10_usd: "price_usage_10_123",
      usage_20_usd: "price_usage_20_123",
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

describe("requireHostedStripeCheckoutConfig", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete globalForHostedOnboarding.__murphHostedOnboardingEnv;
    delete globalForHostedOnboarding.__murphHostedOnboardingStripe;
    if (originalVercelEnvironment === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnvironment;
    }
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

  it("accepts a distinct active monthly Group Price with the catalog amount", async () => {
    const retrieve = vi.fn<StripePriceRetrieveMock>().mockResolvedValue(
      buildRecurringStripePrice(),
    );
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment();
    globalForHostedOnboarding.__murphHostedOnboardingStripe = {
      prices: { retrieve },
    };

    await expect(requireValidatedHostedStripeBillingPlanConfig({
      billingPlanCode: "launch_group_monthly",
    })).resolves.toMatchObject({
      billingPlanCode: "launch_group_monthly",
      priceId: "price_group_monthly_123",
    });
    expect(retrieve).toHaveBeenCalledWith("price_group_monthly_123", {
      expand: ["currency_options"],
    });
  });

  it("keeps only frozen request correlation when a Price read fails", async () => {
    const providerError = Object.assign(
      new Error("Stripe echoed private request content"),
      {
        requestId: "req_price_failure",
        statusCode: 503,
        type: "StripeAPIError",
      },
    );
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment();
    globalForHostedOnboarding.__murphHostedOnboardingStripe = {
      prices: { retrieve: vi.fn().mockRejectedValue(providerError) },
    };

    let checkoutError: unknown;
    try {
      await requireValidatedHostedStripeBillingPlanConfig({
        billingPlanCode: "launch_group_monthly",
      });
    } catch (error) {
      checkoutError = error;
    }

    expect(checkoutError).toMatchObject({
      code: "HOSTED_BILLING_PRICE_UNAVAILABLE",
      httpStatus: 502,
    });
    expect(checkoutError).toBeInstanceOf(Error);
    if (!(checkoutError instanceof Error)) {
      throw new TypeError("Expected a hosted billing error.");
    }
    expect(checkoutError.cause).toEqual({
      kind: "hosted_stripe_alert_correlation",
      requestId: "req_price_failure",
    });
    expect(Object.isFrozen(checkoutError.cause)).toBe(true);
    expect(JSON.stringify(checkoutError)).not.toContain("req_price_failure");
    expect(JSON.stringify(checkoutError)).not.toContain("private request content");
  });

  it("bounds display-only Group Price validation and fails closed", async () => {
    vi.useFakeTimers();
    const retrieve = vi.fn<StripePriceRetrieveMock>(
      (
        _priceId: string,
        _params?: Stripe.PriceRetrieveParams,
        requestOptions?: Stripe.RequestOptions,
      ) =>
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("Stripe display read timed out.")),
            requestOptions?.timeout ?? 0,
          );
        }),
    );
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment();
    globalForHostedOnboarding.__murphHostedOnboardingStripe = {
      prices: { retrieve },
    };

    const availability = isHostedBillingPlanSelectionAvailable({
      billingPlanCode: "launch_group_monthly",
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(availability).resolves.toBe(false);
    expect(retrieve).toHaveBeenCalledWith(
      "price_group_monthly_123",
      {
        expand: ["currency_options"],
      },
      {
        maxNetworkRetries: 0,
        timeout: 5_000,
      },
    );
  });

  it("rejects a Group Price id reused by another direct plan", () => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment({
        stripePriceIdsByPlan: {
          launch_edge_monthly: "price_edge_monthly_123",
          launch_group_monthly: "price_monthly_123",
          launch_max_monthly: "price_max_monthly_123",
          launch_monthly: "price_monthly_123",
        },
      });

    expect(() => requireHostedStripeBillingPlanConfig({
      billingPlanCode: "launch_group_monthly",
    })).toThrowError(expect.objectContaining({
      code: "HOSTED_BILLING_PRICE_CONFIGURATION_INVALID",
      details: {
        reason: "price_identity_not_distinct",
      },
    }));
  });

  it("does not let an invalid Group identity disable established direct plans", () => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment({
        stripePriceIdsByPlan: {
          launch_edge_monthly: "price_edge_monthly_123",
          launch_group_monthly: "price_monthly_123",
          launch_max_monthly: "price_max_monthly_123",
          launch_monthly: "price_monthly_123",
        },
      });

    expect(requireHostedStripeBillingPlanConfig({
      billingPlanCode: "launch_monthly",
    })).toMatchObject({
      billingPlanCode: "launch_monthly",
      priceId: "price_monthly_123",
    });
  });

  it.each([
    {
      name: "wrong amount",
      override: { unit_amount: 351 },
      reason: "price_amount_mismatch",
    },
    {
      name: "wrong currency",
      override: { currency: "eur" },
      reason: "price_currency_mismatch",
    },
    {
      name: "inactive",
      override: { active: false },
      reason: "price_inactive",
    },
    {
      name: "wrong interval",
      override: {
        recurring: {
          interval: "year",
          interval_count: 1,
          usage_type: "licensed",
        },
      },
      reason: "price_recurrence_mismatch",
    },
    {
      name: "wrong Stripe mode",
      override: { livemode: true },
      reason: "price_mode_mismatch",
    },
  ])("rejects a $name Group Price", async ({ override, reason }) => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment();
    globalForHostedOnboarding.__murphHostedOnboardingStripe = {
      prices: {
        retrieve: vi.fn<StripePriceRetrieveMock>().mockResolvedValue(
          buildRecurringStripePrice(override),
        ),
      },
    };

    await expect(requireValidatedHostedStripeBillingPlanConfig({
      billingPlanCode: "launch_group_monthly",
    })).rejects.toMatchObject({
      code: "HOSTED_BILLING_PRICE_CONFIGURATION_INVALID",
      details: { reason },
    });
  });

  it("rejects missing Group Price configuration before Stripe access", () => {
    globalForHostedOnboarding.__murphHostedOnboardingEnv =
      createHostedOnboardingEnvironment({
        stripePriceIdsByPlan: {
          launch_edge_monthly: "price_edge_monthly_123",
          launch_group_monthly: null,
          launch_max_monthly: "price_max_monthly_123",
          launch_monthly: "price_monthly_123",
        },
      });

    expect(() => requireHostedStripeBillingPlanConfig({
      billingPlanCode: "launch_group_monthly",
    })).toThrowError(expect.objectContaining({
      code: "STRIPE_PRICE_ID_REQUIRED",
    }));
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
          usage_20_usd: "price_usage_20_123",
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

function buildRecurringStripePrice(
  override: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    active: true,
    billing_scheme: "per_unit",
    currency: "usd",
    currency_options: null,
    custom_unit_amount: null,
    id: "price_group_monthly_123",
    livemode: false,
    object: "price",
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
    },
    tiers_mode: null,
    transform_quantity: null,
    type: "recurring",
    unit_amount: 350,
    ...override,
  };
}
