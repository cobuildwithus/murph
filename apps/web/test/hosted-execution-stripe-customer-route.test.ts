import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedMemberStripeCustomerId: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeCustomerId: mocks.readHostedMemberStripeCustomerId,
}));

type HostedExecutionStripeCustomerRouteModule = typeof import(
  "../app/api/internal/hosted-execution/billing/stripe/customer/resolve/route"
);

let hostedExecutionStripeCustomerRoute: HostedExecutionStripeCustomerRouteModule;
const originalHostedAiUsageBillingMode = process.env.HOSTED_AI_USAGE_BILLING_MODE;

describe("hosted execution Stripe customer route", () => {
  beforeAll(async () => {
    hostedExecutionStripeCustomerRoute = await import(
      "../app/api/internal/hosted-execution/billing/stripe/customer/resolve/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_AI_USAGE_BILLING_MODE = "stripe_meter";
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.readHostedMemberStripeCustomerId.mockResolvedValue("cus_123");
  });

  afterEach(() => {
    if (originalHostedAiUsageBillingMode === undefined) {
      delete process.env.HOSTED_AI_USAGE_BILLING_MODE;
    } else {
      process.env.HOSTED_AI_USAGE_BILLING_MODE = originalHostedAiUsageBillingMode;
    }
  });

  it("returns the bound member's Stripe customer id", async () => {
    const prisma = { prisma: true };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await hostedExecutionStripeCustomerRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/billing/stripe/customer/resolve", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.readHostedMemberStripeCustomerId).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    await expect(response.json()).resolves.toEqual({
      stripeCustomerId: "cus_123",
    });
  });

  it("returns null when the bound member has no stored Stripe customer id", async () => {
    mocks.readHostedMemberStripeCustomerId.mockResolvedValue(null);

    const response = await hostedExecutionStripeCustomerRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/billing/stripe/customer/resolve", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      stripeCustomerId: null,
    });
  });

  it("returns null without reading Stripe customer state while usage billing is disabled", async () => {
    process.env.HOSTED_AI_USAGE_BILLING_MODE = "disabled";

    const response = await hostedExecutionStripeCustomerRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/billing/stripe/customer/resolve", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.readHostedMemberStripeCustomerId).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      stripeCustomerId: null,
    });
  });

  it("returns null without reading Stripe customer state for unsupported billing modes", async () => {
    process.env.HOSTED_AI_USAGE_BILLING_MODE = "usage_allowance";

    const response = await hostedExecutionStripeCustomerRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-execution/billing/stripe/customer/resolve", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.readHostedMemberStripeCustomerId).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      stripeCustomerId: null,
    });
  });
});
