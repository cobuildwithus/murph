import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createHostedAssistantInputLookupKey,
  createHostedAssistantInputLookupKeyReadCandidates,
  createHostedGroupDisclosurePermissionLookupKey,
  createHostedGroupDisclosurePermissionLookupKeyReadCandidates,
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  createHostedPrivyUserLookupKey,
  createHostedStripeBillingEventLookupKey,
  createHostedStripeBillingEventLookupKeyReadCandidates,
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripePriceLookupKey,
  createHostedStripeSubscriptionLookupKey,
  createHostedStripeSubscriptionScheduleLookupKey,
  createHostedTelegramUsernameLookupKeyReadCandidates,
  createHostedWalletAddressLookupKey,
  hostedPhoneLookupKeyMatchesValue,
  parseHostedBlindIndex,
  readHostedContactPrivacyCurrentVersion,
} from "../src/lib/hosted-onboarding/contact-privacy";

const TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
} as const;

describe("hosted member lookup keys", () => {
  let restoreKeyring: (() => void) | null = null;

  beforeEach(() => {
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { v1: TEST_KEYRING_ENTRIES.v1 },
    });
  });

  afterEach(() => {
    restoreKeyring?.();
    restoreKeyring = null;
  });

  it("creates blind lookup keys that do not expose raw identifiers", () => {
    const privy = createHostedPrivyUserLookupKey("did:privy:abc123");
    const assistantInput = createHostedAssistantInputLookupKey(
      "ain_0123456789abcdef0123456789abcdef",
    );
    const linq = createHostedLinqChatLookupKey("chat_123");
    const groupDisclosurePermission =
      createHostedGroupDisclosurePermissionLookupKey(
        "Recent sleep timing and duration",
      );
    const customer = createHostedStripeCustomerLookupKey("cus_123");
    const price = createHostedStripePriceLookupKey("price_123");
    const subscription = createHostedStripeSubscriptionLookupKey("sub_123");
    const subscriptionSchedule = createHostedStripeSubscriptionScheduleLookupKey("sched_123");
    const checkout = createHostedStripeCheckoutSessionLookupKey("cs_123");
    const event = createHostedStripeBillingEventLookupKey("evt_123");

    expect(privy).toMatch(/^hbidx:privy-user:v1:/u);
    expect(assistantInput).toMatch(/^hbidx:assistant-input:v1:/u);
    expect(linq).toMatch(/^hbidx:linq-chat:v1:/u);
    expect(groupDisclosurePermission).toMatch(
      /^hbidx:group-disclosure-permission:v1:/u,
    );
    expect(customer).toMatch(/^hbidx:stripe-customer:v1:/u);
    expect(price).toMatch(/^hbidx:stripe-price:v1:/u);
    expect(subscription).toMatch(/^hbidx:stripe-subscription:v1:/u);
    expect(subscriptionSchedule).toMatch(/^hbidx:stripe-subscription-schedule:v1:/u);
    expect(checkout).toMatch(/^hbidx:stripe-checkout-session:v1:/u);
    expect(event).toMatch(/^hbidx:stripe-billing-event:v1:/u);

    expect(privy).not.toContain("did:privy:abc123");
    expect(assistantInput).not.toContain(
      "ain_0123456789abcdef0123456789abcdef",
    );
    expect(linq).not.toContain("chat_123");
    expect(groupDisclosurePermission).not.toContain(
      "Recent sleep timing and duration",
    );
    expect(customer).not.toContain("cus_123");
    expect(price).not.toContain("price_123");
    expect(subscription).not.toContain("sub_123");
    expect(subscriptionSchedule).not.toContain("sched_123");
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
      entries: { ...TEST_KEYRING_ENTRIES },
    });

    try {
      const candidates = createHostedPhoneLookupKeyReadCandidates("+15551234567");
      const assistantInputCandidates =
        createHostedAssistantInputLookupKeyReadCandidates(
          "ain_0123456789abcdef0123456789abcdef",
        );
      const groupDisclosurePermissionCandidates =
        createHostedGroupDisclosurePermissionLookupKeyReadCandidates(
          "Recent sleep timing and duration",
        );
      const billingEventCandidates =
        createHostedStripeBillingEventLookupKeyReadCandidates("evt_123");

      expect(readHostedContactPrivacyCurrentVersion()).toBe("v2");
      expect(candidates).toHaveLength(2);
      expect(assistantInputCandidates).toHaveLength(2);
      expect(groupDisclosurePermissionCandidates).toHaveLength(2);
      expect(parseHostedBlindIndex(assistantInputCandidates[0])?.version).toBe("v2");
      expect(parseHostedBlindIndex(assistantInputCandidates[1])?.version).toBe("v1");
      expect(
        parseHostedBlindIndex(groupDisclosurePermissionCandidates[0])?.version,
      ).toBe("v2");
      expect(
        parseHostedBlindIndex(groupDisclosurePermissionCandidates[1])?.version,
      ).toBe("v1");
      expect(billingEventCandidates).toHaveLength(2);
      expect(parseHostedBlindIndex(billingEventCandidates[0])?.version).toBe("v2");
      expect(parseHostedBlindIndex(billingEventCandidates[1])?.version).toBe("v1");
      expect(parseHostedBlindIndex(candidates[0])?.version).toBe("v2");
      expect(parseHostedBlindIndex(candidates[1])?.version).toBe("v1");
    } finally {
      restore();
    }
  });

  it("does not require unrelated hosted onboarding env to read lookup candidates", () => {
    const previousAllowedOrigins = process.env.HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS;
    process.env.HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS =
      "https://local.withmurph.ai:3443/not-an-origin";

    try {
      const candidates = createHostedTelegramUsernameLookupKeyReadCandidates("@Riderway");

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatch(/^hbidx:telegram-username:v1:/u);
    } finally {
      restoreEnvValue(
        "HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS",
        previousAllowedOrigins,
      );
    }
  });

  it("matches a stored legacy phone lookup key against the same raw phone value", () => {
    const restoreV1 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { v1: TEST_KEYRING_ENTRIES.v1 },
    });
    const legacyLookupKey = createHostedPhoneLookupKey("+15551234567");
    restoreV1();

    const restoreV2 = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: { ...TEST_KEYRING_ENTRIES },
    });

    try {
      expect(
        hostedPhoneLookupKeyMatchesValue("+15551234567", legacyLookupKey),
      ).toBe(true);
      expect(
        hostedPhoneLookupKeyMatchesValue("+15557654321", legacyLookupKey),
      ).toBe(false);
    } finally {
      restoreV2();
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
