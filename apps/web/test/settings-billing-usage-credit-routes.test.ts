import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import {
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
  HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
} from "../src/lib/hosted-onboarding/usage-credit-capacity-conflict";
import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedFamilyMemberUsageCreditCheckout: vi.fn(),
  createHostedGroupUsageCreditCheckout: vi.fn(),
  createHostedUsageCreditCheckout: vi.fn(),
  expireHostedUsageCreditCheckout: vi.fn(),
  getPrisma: vi.fn(),
  readHostedUsageCreditPurchaseStatus: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-service", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../src/lib/hosted-onboarding/usage-credit-purchase-service")
  >();
  return {
    ...original,
    createHostedFamilyMemberUsageCreditCheckout:
      mocks.createHostedFamilyMemberUsageCreditCheckout,
    createHostedGroupUsageCreditCheckout:
      mocks.createHostedGroupUsageCreditCheckout,
    createHostedUsageCreditCheckout: mocks.createHostedUsageCreditCheckout,
    expireHostedUsageCreditCheckout: mocks.expireHostedUsageCreditCheckout,
    readHostedUsageCreditPurchaseStatus: mocks.readHostedUsageCreditPurchaseStatus,
  };
});

type CheckoutRoute = typeof import(
  "../app/api/settings/billing/usage-credit/checkout/route"
);
type GroupCheckoutRoute = typeof import(
  "../app/api/groups/fund/[joinCode]/usage-credit/checkout/route"
);
type FamilyCheckoutRoute = typeof import(
  "../app/api/settings/billing/family/members/[memberId]/usage-credit/checkout/route"
);
type StatusRoute = typeof import(
  "../app/api/settings/billing/usage-credit/purchases/[purchaseId]/route"
);
type ExpireRoute = typeof import(
  "../app/api/settings/billing/usage-credit/purchases/[purchaseId]/expire/route"
);

let checkoutRoute: CheckoutRoute;
let expireRoute: ExpireRoute;
let familyCheckoutRoute: FamilyCheckoutRoute;
let groupCheckoutRoute: GroupCheckoutRoute;
let statusRoute: StatusRoute;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.getPrisma.mockReturnValue({ label: "test-prisma" });
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      billingStatus: "active",
      id: "hbm_member123",
      suspendedAt: null,
    },
  });
  mocks.createHostedUsageCreditCheckout.mockResolvedValue({
    purchaseId: "hucp_abcdefghijklmnop",
    status: "checkout_open",
    url: "https://checkout.stripe.test/session",
  });
  mocks.createHostedGroupUsageCreditCheckout.mockResolvedValue({
    purchaseId: "hucp_abcdefghijklmnop",
    status: "checkout_open",
    url: "https://checkout.stripe.test/group-session",
  });
  mocks.createHostedFamilyMemberUsageCreditCheckout.mockResolvedValue({
    purchaseId: "hucp_abcdefghijklmnop",
    status: "checkout_open",
    url: "https://checkout.stripe.test/family-session",
  });
  mocks.expireHostedUsageCreditCheckout.mockResolvedValue({
    checkoutExpiresAt: "2026-07-16T18:30:00.000Z",
    purchaseId: "hucp_abcdefghijklmnop",
    status: "expired",
    updatedAt: "2026-07-16T17:06:00.000Z",
  });
  mocks.readHostedUsageCreditPurchaseStatus.mockResolvedValue({
    checkoutExpiresAt: "2026-07-16T18:30:00.000Z",
    purchaseId: "hucp_abcdefghijklmnop",
    status: "payment_pending",
    updatedAt: "2026-07-16T17:05:00.000Z",
  });

  checkoutRoute = await import(
    "../app/api/settings/billing/usage-credit/checkout/route"
  );
  expireRoute = await import(
    "../app/api/settings/billing/usage-credit/purchases/[purchaseId]/expire/route"
  );
  familyCheckoutRoute = await import(
    "../app/api/settings/billing/family/members/[memberId]/usage-credit/checkout/route"
  );
  groupCheckoutRoute = await import(
    "../app/api/groups/fund/[joinCode]/usage-credit/checkout/route"
  );
  statusRoute = await import(
    "../app/api/settings/billing/usage-credit/purchases/[purchaseId]/route"
  );
});

describe("usage-credit checkout route", () => {
  it("takes the Family beneficiary only from the route and the payer from session", async () => {
    const request = createCheckoutRequest({
      clientRequestKey: "request_key_123456",
      offerCode: "usage_25_usd",
      recoveryOnly: true,
    }, "https://join.example.test/api/settings/billing/family/members/hbm_familymember1/usage-credit/checkout");
    const response = await familyCheckoutRoute.POST(
      request,
      createRouteContext({ memberId: "hbm_familymember1" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "checkout_open",
      url: "https://checkout.stripe.test/family-session",
    });
    expect(mocks.createHostedFamilyMemberUsageCreditCheckout).toHaveBeenCalledWith({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: "request_key_123456",
      offerCode: "usage_25_usd",
      payerMemberId: "hbm_member123",
      prisma: { label: "test-prisma" },
      recoveryOnly: true,
    });
  });

  it("resolves the group and payer only on the server", async () => {
    const request = createCheckoutRequest({
      clientRequestKey: "request_key_123456",
      offerCode: "usage_20_usd",
      recoveryOnly: true,
      sponsorship: {
        publicAlias: "The Group Historian",
        runningBitRequest: "Treat me like Murph’s exhausted CFO.",
        sponsorMessage: "For whatever adventure comes next.",
      },
    }, "https://join.example.test/api/groups/fund/group_join_code_1234/usage-credit/checkout");
    const response = await groupCheckoutRoute.POST(
      request,
      createRouteContext({ joinCode: "group_join_code_1234" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "checkout_open",
      url: "https://checkout.stripe.test/group-session",
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.createHostedGroupUsageCreditCheckout).toHaveBeenCalledWith({
      clientRequestKey: "request_key_123456",
      joinCode: "group_join_code_1234",
      monthlyCapMinor: undefined,
      offerCode: "usage_20_usd",
      payerMemberId: "hbm_member123",
      prisma: { label: "test-prisma" },
      recoveryOnly: true,
      sponsorshipKind: "one_time",
      sponsorship: {
        publicAlias: "The Group Historian",
        runningBitRequest: "Treat me like Murph’s exhausted CFO.",
        sponsorMessage: "For whatever adventure comes next.",
      },
    });
  });

  it("creates an exact server-authorized checkout for the signed-in member", async () => {
    const request = createCheckoutRequest({
      clientRequestKey: "request_key_123456",
      offerCode: "usage_10_usd",
    });
    const response = await checkoutRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      purchaseId: "hucp_abcdefghijklmnop",
      status: "checkout_open",
      url: "https://checkout.stripe.test/session",
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.createHostedUsageCreditCheckout).toHaveBeenCalledWith({
      clientRequestKey: "request_key_123456",
      memberId: "hbm_member123",
      offerCode: "usage_10_usd",
      prisma: { label: "test-prisma" },
    });
  });

  it("returns the payer-scoped active-purchase recovery marker unchanged", async () => {
    mocks.createHostedUsageCreditCheckout.mockResolvedValueOnce({
      purchaseId: "hucp_abcdefghijklmnop",
      recovered: true,
      status: "checkout_open",
      url: "https://checkout.stripe.test/existing-session",
    });
    const request = createCheckoutRequest({
      clientRequestKey: "fresh_request_123456",
      offerCode: "usage_5_usd",
    });

    const response = await checkoutRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      purchaseId: "hucp_abcdefghijklmnop",
      recovered: true,
      status: "checkout_open",
      url: "https://checkout.stripe.test/existing-session",
    });
    expect(mocks.createHostedUsageCreditCheckout).toHaveBeenCalledWith({
      clientRequestKey: "fresh_request_123456",
      memberId: "hbm_member123",
      offerCode: "usage_5_usd",
      prisma: { label: "test-prisma" },
    });
  });

  it("returns the same structured capacity conflict for personal, Family, and group checkouts", async () => {
    const capacityConflict = () =>
      hostedOnboardingError({
        code: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
        httpStatus: 409,
        message: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
      });

    mocks.createHostedUsageCreditCheckout.mockRejectedValueOnce(
      capacityConflict(),
    );
    const personalResponse = await checkoutRoute.POST(
      createCheckoutRequest({
        clientRequestKey: "capacity_personal_1234",
        offerCode: "usage_10_usd",
      }),
    );

    mocks.createHostedFamilyMemberUsageCreditCheckout.mockRejectedValueOnce(
      capacityConflict(),
    );
    const familyResponse = await familyCheckoutRoute.POST(
      createCheckoutRequest(
        {
          clientRequestKey: "capacity_family_123456",
          offerCode: "usage_10_usd",
        },
        "https://join.example.test/api/settings/billing/family/members/hbm_familymember1/usage-credit/checkout",
      ),
      createRouteContext({ memberId: "hbm_familymember1" }),
    );

    mocks.createHostedGroupUsageCreditCheckout.mockRejectedValueOnce(
      capacityConflict(),
    );
    const groupResponse = await groupCheckoutRoute.POST(
      createCheckoutRequest(
        {
          clientRequestKey: "capacity_group_123456",
          offerCode: "usage_20_usd",
        },
        "https://join.example.test/api/groups/fund/group_join_code_1234/usage-credit/checkout",
      ),
      createRouteContext({ joinCode: "group_join_code_1234" }),
    );

    for (const response of [personalResponse, familyResponse, groupResponse]) {
      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: {
          code: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_CODE,
          message: HOSTED_USAGE_CREDIT_CAPACITY_CONFLICT_MESSAGE,
          retryable: false,
        },
      });
    }
  });

  it("propagates a typed recovery miss without enabling purchase creation", async () => {
    mocks.createHostedUsageCreditCheckout.mockResolvedValueOnce({
      recoveryMiss: true,
    });
    const request = createCheckoutRequest({
      clientRequestKey: "recovery_key_123456",
      offerCode: "usage_5_usd",
      recoveryOnly: true,
    });

    const response = await checkoutRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ recoveryMiss: true });
    expect(mocks.createHostedUsageCreditCheckout).toHaveBeenCalledWith({
      clientRequestKey: "recovery_key_123456",
      memberId: "hbm_member123",
      offerCode: "usage_5_usd",
      prisma: { label: "test-prisma" },
      recoveryOnly: true,
    });
  });

  it.each([
    [{ clientRequestKey: "request_key_123456", offerCode: "usage_10_usd", amount: 10 }],
    [{ clientRequestKey: "short", offerCode: "usage_10_usd" }],
    [{ clientRequestKey: "request_key_123456", offerCode: "usage_100_usd" }],
    [{
      clientRequestKey: "request_key_123456",
      offerCode: "usage_10_usd",
      recoveryOnly: false,
    }],
  ])("rejects browser authority or malformed checkout input", async (body) => {
    const response = await checkoutRoute.POST(createCheckoutRequest(body));

    expect(response.status).toBe(400);
    expect(mocks.createHostedUsageCreditCheckout).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies with the route-specific error", async () => {
    const response = await checkoutRoute.POST(createCheckoutRequest({
      clientRequestKey: "request_key_123456",
      offerCode: "usage_10_usd",
      padding: "x".repeat(1_024),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_USAGE_CREDIT_CHECKOUT_BODY_TOO_LARGE" },
    });
    expect(mocks.createHostedUsageCreditCheckout).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before authentication", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
        httpStatus: 403,
        message: "Invalid request origin.",
      });
    });

    const response = await checkoutRoute.POST(createCheckoutRequest({
      clientRequestKey: "request_key_123456",
      offerCode: "usage_10_usd",
    }));

    expect(response.status).toBe(403);
    expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.createHostedUsageCreditCheckout).not.toHaveBeenCalled();
  });

  it("rejects suspended members before creating checkout", async () => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: {
        billingStatus: "active",
        id: "hbm_member123",
        suspendedAt: new Date("2026-07-16T16:00:00.000Z"),
      },
    });

    const response = await checkoutRoute.POST(createCheckoutRequest({
      clientRequestKey: "request_key_123456",
      offerCode: "usage_10_usd",
    }));

    expect(response.status).toBe(403);
    expect(mocks.createHostedUsageCreditCheckout).not.toHaveBeenCalled();
  });
});

describe("usage-credit purchase status route", () => {
  it("returns only the authenticated payer's durable status", async () => {
    const request = new Request(
      "https://join.example.test/api/settings/billing/usage-credit/purchases/hucp_abcdefghijklmnop",
    );
    const response = await statusRoute.GET(
      request,
      createRouteContext({ purchaseId: "hucp_abcdefghijklmnop" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.assertHostedOnboardingMutationOrigin).not.toHaveBeenCalled();
    expect(mocks.readHostedUsageCreditPurchaseStatus).toHaveBeenCalledWith({
      payerMemberId: "hbm_member123",
      prisma: { label: "test-prisma" },
      purchaseId: "hucp_abcdefghijklmnop",
    });
  });

  it("allows a suspended payer to inspect an existing payment", async () => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: {
        billingStatus: "canceled",
        id: "hbm_member123",
        suspendedAt: new Date("2026-07-16T16:00:00.000Z"),
      },
    });

    const response = await statusRoute.GET(
      new Request("https://join.example.test/api/settings/billing/usage-credit/purchases/id"),
      createRouteContext({ purchaseId: "hucp_abcdefghijklmnop" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.readHostedUsageCreditPurchaseStatus).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated status reads before querying a purchase", async () => {
    mocks.requireHostedAppSessionFromRequest.mockRejectedValueOnce(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Sign in to continue.",
    }));

    const response = await statusRoute.GET(
      new Request("https://join.example.test/api/settings/billing/usage-credit/purchases/id"),
      createRouteContext({ purchaseId: "hucp_abcdefghijklmnop" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.readHostedUsageCreditPurchaseStatus).not.toHaveBeenCalled();
  });
});

describe("usage-credit purchase expiration route", () => {
  it("asks Stripe to expire only the authenticated payer's purchase", async () => {
    const request = createExpireRequest("hucp_abcdefghijklmnop");
    const response = await expireRoute.POST(
      request,
      createRouteContext({ purchaseId: "hucp_abcdefghijklmnop" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      purchaseId: "hucp_abcdefghijklmnop",
      status: "expired",
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.expireHostedUsageCreditCheckout).toHaveBeenCalledWith({
      payerMemberId: "hbm_member123",
      prisma: { label: "test-prisma" },
      purchaseId: "hucp_abcdefghijklmnop",
    });
  });

  it("rejects cross-origin expiration before authentication", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
        httpStatus: 403,
        message: "Invalid request origin.",
      });
    });

    const response = await expireRoute.POST(
      createExpireRequest("hucp_abcdefghijklmnop"),
      createRouteContext({ purchaseId: "hucp_abcdefghijklmnop" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.expireHostedUsageCreditCheckout).not.toHaveBeenCalled();
  });

  it("lets a suspended payer close an existing unpaid Checkout", async () => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: {
        billingStatus: "canceled",
        id: "hbm_member123",
        suspendedAt: new Date("2026-07-16T16:00:00.000Z"),
      },
    });

    const response = await expireRoute.POST(
      createExpireRequest("hucp_abcdefghijklmnop"),
      createRouteContext({ purchaseId: "hucp_abcdefghijklmnop" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.expireHostedUsageCreditCheckout).toHaveBeenCalledTimes(1);
  });
});

function createCheckoutRequest(
  body: Record<string, unknown>,
  url = "https://join.example.test/api/settings/billing/usage-credit/checkout",
): Request {
  return new Request(
    url,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    },
  );
}

function createExpireRequest(purchaseId: string): Request {
  return new Request(
    `https://join.example.test/api/settings/billing/usage-credit/purchases/${purchaseId}/expire`,
    {
      headers: { origin: "https://join.example.test" },
      method: "POST",
    },
  );
}
