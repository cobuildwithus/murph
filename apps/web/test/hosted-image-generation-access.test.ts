import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gate: vi.fn(), billing: vi.fn(), cards: vi.fn() }));
vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({ readHostedAiUsageGate: mocks.gate }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({ readHostedMemberStripeBillingRef: mocks.billing }));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({ requireHostedStripeApiMode: () => ({ stripeLiveMode: false, stripe: { paymentMethods: { list: mocks.cards } } }) }));
import { readHostedImageGenerationAccess } from "@/src/lib/hosted-onboarding/image-generation-access";

const read = () => readHostedImageGenerationAccess({ memberId: "member_synthetic", prisma: {} as never });
describe("Starter image card authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.gate.mockResolvedValue({ allowed: true, allowanceSource: "direct_starter" });
    mocks.billing.mockResolvedValue({ stripeCustomerId: "cus_synthetic" });
    mocks.cards.mockResolvedValue({ data: [{ type: "card", customer: "cus_synthetic", livemode: false }] });
  });
  it("requires a card when Starter has no Stripe customer", async () => {
    mocks.billing.mockResolvedValue(null);
    await expect(read()).resolves.toEqual({ allowed: false, reason: "card_required" });
    expect(mocks.cards).not.toHaveBeenCalled();
  });
  it("allows a currently attached card without requiring a subscription", async () => {
    await expect(read()).resolves.toEqual({ allowed: true, reason: "allowed" });
    expect(mocks.cards).toHaveBeenCalledWith({ customer: "cus_synthetic", limit: 1, type: "card" }, expect.any(Object));
  });
  it.each([
    [], [{ type: "card", customer: null, livemode: false }],
    [{ type: "card", customer: "cus_other", livemode: false }],
    [{ type: "card", customer: "cus_synthetic", livemode: true }],
  ].map((data) => ({ data })))("rejects missing, detached, foreign, or wrong-mode cards", async ({ data }) => {
    mocks.cards.mockResolvedValue({ data });
    await expect(read()).resolves.toEqual({ allowed: false, reason: "card_required" });
  });
  it("rejects a changed billing owner after Stripe responds", async () => {
    mocks.billing.mockResolvedValueOnce({ stripeCustomerId: "cus_synthetic" }).mockResolvedValueOnce(null);
    await expect(read()).resolves.toMatchObject({ allowed: false });
  });
  it.each(["direct_paid_member_plan", "family_sponsored_plan", "thread_container"])("preserves %s image access", async (allowanceSource) => {
    mocks.gate.mockResolvedValue({ allowed: true, allowanceSource });
    await expect(read()).resolves.toMatchObject({ allowed: true });
    expect(mocks.cards).not.toHaveBeenCalled();
  });
  it("preserves suspension and allowance denials", async () => {
    mocks.gate.mockResolvedValue({ allowed: false, allowanceSource: "direct_starter" });
    await expect(read()).resolves.toEqual({ allowed: false, reason: "usage_unavailable" });
    expect(mocks.cards).not.toHaveBeenCalled();
  });
  it("does not grant access during Stripe failure", async () => {
    mocks.cards.mockRejectedValue(new Error("unavailable"));
    await expect(read()).rejects.toThrow("unavailable");
  });
});
