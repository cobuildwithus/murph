import { describe, expect, it } from "vitest";

import {
  createHostedLinqChatLookupKey,
  createHostedPrivyUserLookupKey,
  createHostedStripeBillingEventLookupKey,
  createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey,
  createHostedStripeSubscriptionLookupKey,
  createHostedWalletAddressLookupKey,
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
});
