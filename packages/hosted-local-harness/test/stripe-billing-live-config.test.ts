import { describe, expect, it } from "vitest";

import {
  HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV,
  HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV,
  HOSTED_STRIPE_BILLING_LIVE_SCENARIO,
  HOSTED_STRIPE_BILLING_SECRET_KEY_ENV,
  HostedStripeBillingLiveConfigError,
  partitionHostedStripeBillingLiveEnvironment,
  removeHostedStripeBillingLiveEnvironment,
  resolveHostedStripeBillingLiveConfig,
} from "../src/stripe-billing-live-config.ts";

const configuredEnvironment: NodeJS.ProcessEnv = {
  [HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV]: "1",
  [HOSTED_STRIPE_BILLING_SECRET_KEY_ENV]: "sk_test_dedicated_authority",
  [HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV]: "acct_sandbox123",
  NEXT_PUBLIC_PRIVY_APP_ID: "privytestbillingbrowser01",
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_pulse",
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_edge",
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: "price_familypulse",
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY: "price_familyedge",
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY: "price_familymax",
  HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY:
    "bpc_edge",
  MURPH_HOSTED_STRIPE_BILLING_RUN_ID: "run_ci_12345678",
};

const sharedCatalogEnvironment: NodeJS.ProcessEnv = {
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_pulse",
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_edge",
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: "price_familypulse",
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY: "price_familyedge",
  HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY: "price_familymax",
  HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY:
    "bpc_edge",
};

describe("resolveHostedStripeBillingLiveConfig", () => {
  it("keeps the live lane disabled when no dedicated sandbox contract is configured", () => {
    expect(resolveHostedStripeBillingLiveConfig({})).toEqual({
      configured: false,
      reason: "not_enabled",
    });
  });

  it("does not treat shared checkout catalog values as dedicated live authority", () => {
    expect(resolveHostedStripeBillingLiveConfig(sharedCatalogEnvironment)).toEqual({
      configured: false,
      reason: "not_enabled",
    });
  });

  it.each([
    [HOSTED_STRIPE_BILLING_SECRET_KEY_ENV, "sk_test_never_echo_this_value"],
    [HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV, "acct_partial"],
    ["MURPH_HOSTED_STRIPE_BILLING_RUN_ID", "run_partial_12345678"],
  ])("rejects dedicated %s authority without explicit activation", (key, value) => {
    expect(() => resolveHostedStripeBillingLiveConfig({
      [key]: value,
    })).toThrowError(HostedStripeBillingLiveConfigError);
  });

  it("rejects partially configured authority without echoing a secret", () => {
    const secret = "sk_test_never_echo_this_value";
    expect(() => resolveHostedStripeBillingLiveConfig({
      [HOSTED_STRIPE_BILLING_SECRET_KEY_ENV]: secret,
    })).toThrowError(HostedStripeBillingLiveConfigError);
    try {
      resolveHostedStripeBillingLiveConfig({
        [HOSTED_STRIPE_BILLING_SECRET_KEY_ENV]: secret,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain(HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV);
    }
  });

  it("requires an explicit opaque run id for recoverable cleanup", () => {
    const environment = { ...configuredEnvironment };
    delete environment.MURPH_HOSTED_STRIPE_BILLING_RUN_ID;
    expect(() => resolveHostedStripeBillingLiveConfig(environment))
      .toThrow(/run_id/iu);
  });

  it("requires the complete shared catalog after explicit live activation", () => {
    expect(() => resolveHostedStripeBillingLiveConfig({
      [HOSTED_STRIPE_BILLING_LIVE_ENABLED_ENV]: "1",
      [HOSTED_STRIPE_BILLING_SECRET_KEY_ENV]: "sk_test_dedicated_authority",
      [HOSTED_STRIPE_BILLING_ACCOUNT_ID_ENV]: "acct_sandbox123",
      MURPH_HOSTED_STRIPE_BILLING_RUN_ID: "run_ci_12345678",
      NEXT_PUBLIC_PRIVY_APP_ID: "privytestbillingbrowser01",
    })).toThrow(/price_id_launch_monthly/iu);
  });

  it("rejects live-mode authority and malformed catalog ids", () => {
    expect(() => resolveHostedStripeBillingLiveConfig({
      ...configuredEnvironment,
      [HOSTED_STRIPE_BILLING_SECRET_KEY_ENV]: "sk_live_forbidden",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "prod_123",
    })).toThrow(/malformed fields/u);
  });

  it("returns only a validated dedicated test-mode contract", () => {
    const resolved = resolveHostedStripeBillingLiveConfig(configuredEnvironment);
    expect(resolved.configured).toBe(true);
    if (!resolved.configured) {
      throw new Error("Expected configured live Stripe contract.");
    }
    expect(resolved.config.accountId).toBe("acct_sandbox123");
    expect(resolved.config.privyAppId).toBe("privytestbillingbrowser01");
    expect(resolved.config.priceIds).toEqual({
      edge: "price_edge",
      familyEdge: "price_familyedge",
      familyMax: "price_familymax",
      familyPulse: "price_familypulse",
      pulse: "price_pulse",
    });
    expect(resolved.config.portalConfigurationId).toBe("bpc_edge");
  });
});

describe("removeHostedStripeBillingLiveEnvironment", () => {
  it("strips every live-lane value before setup children are started", () => {
    const environment = {
      ...configuredEnvironment,
      SAFE_GENERIC: "kept",
    };
    removeHostedStripeBillingLiveEnvironment(environment);
    expect(environment).toEqual({
      NEXT_PUBLIC_PRIVY_APP_ID: "privytestbillingbrowser01",
      SAFE_GENERIC: "kept",
    });
  });
});

describe("partitionHostedStripeBillingLiveEnvironment", () => {
  it("leaves shared catalog values available to an unrelated generic scenario", () => {
    expect(partitionHostedStripeBillingLiveEnvironment({
      environment: sharedCatalogEnvironment,
      selectedScenarioNames: ["checkpoint-baseline"],
    })).toEqual({
      genericEnvironment: sharedCatalogEnvironment,
      scenarioEnvironment: { NODE_ENV: undefined },
    });
  });

  it("moves writable Stripe authority into the sole live Vitest process", () => {
    const partitioned = partitionHostedStripeBillingLiveEnvironment({
      environment: {
        ...configuredEnvironment,
        SAFE_GENERIC: "kept",
      },
      selectedScenarioNames: [HOSTED_STRIPE_BILLING_LIVE_SCENARIO],
    });

    expect(partitioned.genericEnvironment).toEqual({
      NEXT_PUBLIC_PRIVY_APP_ID: "privytestbillingbrowser01",
      SAFE_GENERIC: "kept",
    });
    const scenarioEnvironment = { ...configuredEnvironment };
    delete scenarioEnvironment.NEXT_PUBLIC_PRIVY_APP_ID;
    expect(partitioned.scenarioEnvironment).toEqual({
      NODE_ENV: undefined,
      ...scenarioEnvironment,
    });
  });

  it("rejects combining the writable lane with another scenario", () => {
    expect(() => partitionHostedStripeBillingLiveEnvironment({
      environment: configuredEnvironment,
      selectedScenarioNames: [HOSTED_STRIPE_BILLING_LIVE_SCENARIO, "checkpoint-baseline"],
    })).toThrow(/by itself/u);
  });
});
