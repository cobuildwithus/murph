import { describe, expect, it } from "vitest";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  createHostedPrivyUserLookupKey,
  createHostedStripeBillingEventLookupKey,
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
  createHostedWalletAddressLookupKey,
  hostedPhoneLookupKeyMatchesValue,
  parseHostedBlindIndex,
  readHostedContactPrivacyCurrentVersion,
} from "../src/lib/hosted-onboarding/contact-privacy";

describe("hosted member lookup keys", () => {
  it("creates blind lookup keys that do not expose raw identifiers", () => {
    const privy = createHostedPrivyUserLookupKey("did:privy:abc123");
    const linq = createHostedLinqChatLookupKey("chat_123");
    const customer = createHostedStripeCustomerLookupKey("cus_123");
    const subscription = createHostedStripeSubscriptionLookupKey("sub_123");
    const checkout = createHostedStripeCheckoutSessionLookupKey("cs_123");
    const event = createHostedStripeBillingEventLookupKey("evt_123");

    expect(privy).toMatch(/^hbidx:privy-user:v1:/u);
    expect(linq).toMatch(/^hbidx:linq-chat:v1:/u);
    expect(customer).toMatch(/^hbidx:stripe-customer:v1:/u);
    expect(subscription).toMatch(/^hbidx:stripe-subscription:v1:/u);
    expect(checkout).toMatch(/^hbidx:stripe-checkout-session:v1:/u);
    expect(event).toMatch(/^hbidx:stripe-billing-event:v1:/u);

    expect(privy).not.toContain("did:privy:abc123");
    expect(linq).not.toContain("chat_123");
    expect(customer).not.toContain("cus_123");
    expect(subscription).not.toContain("sub_123");
    expect(checkout).not.toContain("cs_123");
    expect(event).not.toContain("evt_123");
  });

  it("normalizes wallet addresses before hashing", () => {
    expect(createHostedWalletAddressLookupKey(" 0xABc ")).toBe(
      createHostedWalletAddressLookupKey("0xabc"),
    );
  });

  it("returns null for empty values", () => {
    expect(createHostedPrivyUserLookupKey("   ")).toBeNull();
    expect(createHostedWalletAddressLookupKey(null)).toBeNull();
    expect(createHostedLinqChatLookupKey(undefined)).toBeNull();
  });

  it("supports ordered read candidates from the configured keyring", () => {
    const restore = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: {
        v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
      },
    });

    try {
      const candidates = createHostedPhoneLookupKeyReadCandidates("+15551234567");

      expect(readHostedContactPrivacyCurrentVersion()).toBe("v2");
      expect(candidates).toHaveLength(2);
      expect(parseHostedBlindIndex(candidates[0])?.version).toBe("v2");
      expect(parseHostedBlindIndex(candidates[1])?.version).toBe("v1");
    } finally {
      restore();
    }
  });

  it("matches a stored legacy phone lookup key against the same raw phone value", () => {
    const restore = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: {
        v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
      },
    });

    try {
      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
      clearHostedOnboardingEnvCache();
      const legacyLookupKey = createHostedPhoneLookupKey("+15551234567");

      process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
      clearHostedOnboardingEnvCache();

      expect(
        hostedPhoneLookupKeyMatchesValue("+15551234567", legacyLookupKey),
      ).toBe(true);
      expect(
        hostedPhoneLookupKeyMatchesValue("+15557654321", legacyLookupKey),
      ).toBe(false);
    } finally {
      restore();
    }
  });
});

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousCurrentVersion);
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
