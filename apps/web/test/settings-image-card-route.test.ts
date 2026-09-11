import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), customer: vi.fn(), create: vi.fn(), billing: vi.fn(), member: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({ requireHostedAppSessionFromRequest: mocks.auth }));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({ assertHostedOnboardingMutationOrigin: mocks.origin }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-stripe-customer", () => ({ ensureHostedMemberStripeCustomer: mocks.customer }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({ readHostedMemberStripeBillingRef: mocks.billing }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ hostedMember: { findUnique: mocks.member } }) }));
vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({ requireHostedOnboardingPublicBaseUrl: () => "https://www.withmurph.ai", requireHostedStripeApiMode: () => ({ stripeLiveMode: false, stripe: { checkout: { sessions: { create: mocks.create } } } }) }));
import { POST } from "@/app/api/settings/billing/image-card/route";
const request = () => new Request("https://www.withmurph.ai/api/settings/billing/image-card", { method: "POST", body: JSON.stringify({ memberId: "member_other", customer: "cus_other" }) });
describe("image card setup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ member: { id: "member_owner" } });
    mocks.customer.mockResolvedValue("cus_owner");
    mocks.billing.mockResolvedValue({ stripeCustomerId: "cus_owner" });
    mocks.member.mockResolvedValue({ suspendedAt: null });
    mocks.create.mockResolvedValue({ customer: "cus_owner", mode: "setup", livemode: false, url: "https://checkout.stripe.com/c/setup_synthetic" });
  });
  it("saves a card for the authenticated owner without a charge or subscription", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.customer).toHaveBeenCalledWith(expect.objectContaining({ memberId: "member_owner" }));
    expect(mocks.create).toHaveBeenCalledWith({
      cancel_url: "https://www.withmurph.ai/settings#subscription", success_url: "https://www.withmurph.ai/settings#subscription",
      client_reference_id: "member_owner", customer: "cus_owner", mode: "setup", payment_method_types: ["card"],
    }, expect.objectContaining({ idempotencyKey: expect.stringMatching(/^image-card:/) }));
  });
  it.each(["auth", "origin"] as const)("requires %s before Stripe entry", async (guard) => {
    mocks[guard].mockImplementation(() => { throw hostedOnboardingError({ code: "AUTH_REQUIRED", message: "Sign in required", httpStatus: 401 }); });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not disclose a session after the customer binding changes", async () => {
    mocks.billing.mockResolvedValue({ stripeCustomerId: "cus_other" });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("checkout.stripe.com");
  });
});
