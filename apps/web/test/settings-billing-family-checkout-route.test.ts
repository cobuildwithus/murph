import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  abandonHostedFamilyDraftForOwner: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedFamilyBillingCheckout: vi.fn(),
  ensureHostedAccountGroupForOwnerTx: vi.fn(),
  getPrisma: vi.fn(),
  readHostedFamilyDraftRecoveryStateForOwner: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  abandonHostedFamilyDraftForOwner: mocks.abandonHostedFamilyDraftForOwner,
  createHostedFamilyBillingCheckout: mocks.createHostedFamilyBillingCheckout,
  ensureHostedAccountGroupForOwnerTx: mocks.ensureHostedAccountGroupForOwnerTx,
  readHostedFamilyDraftRecoveryStateForOwner:
    mocks.readHostedFamilyDraftRecoveryStateForOwner,
}));

type BillingFamilyCheckoutRouteModule =
  typeof import("../app/api/settings/billing/family/checkout/route");

let billingFamilyCheckoutRoute: BillingFamilyCheckoutRouteModule;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.getPrisma.mockReturnValue({
    $transaction: vi.fn((callback) => callback({ label: "tx" })),
    hostedAccountGroup: {
      findUnique: vi.fn().mockResolvedValue({ id: "hbag_family" }),
    },
  });
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      billingStatus: "active",
      id: "member_owner",
      suspendedAt: null,
    },
  });
  mocks.ensureHostedAccountGroupForOwnerTx.mockResolvedValue({
    id: "hbag_family",
    ownerMemberId: "member_owner",
  });
  mocks.readHostedFamilyDraftRecoveryStateForOwner.mockResolvedValue(
    "checkout_starting",
  );
  mocks.createHostedFamilyBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://checkout.stripe.test/family",
  });
  mocks.abandonHostedFamilyDraftForOwner.mockResolvedValue({ abandoned: true });

  billingFamilyCheckoutRoute = await import("../app/api/settings/billing/family/checkout/route");
});

test("starts Family checkout for the authenticated hosted owner", async () => {
  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    alreadyActive: false,
    url: "https://checkout.stripe.test/family",
  });
  expect(mocks.ensureHostedAccountGroupForOwnerTx).toHaveBeenCalledWith({
    ownerMemberId: "member_owner",
    tx: {
      label: "tx",
    },
  });
  expect(mocks.createHostedFamilyBillingCheckout).toHaveBeenCalledWith({
    allowDirectPaidUpgrade: true,
    confirmedTrialConversion: undefined,
    groupId: "hbag_family",
    ownerMemberId: "member_owner",
    prisma: expect.any(Object),
    requireExistingCheckoutAttempt: false,
    seatCount: undefined,
  });
});

test("forwards an explicit seat count and trial-conversion confirmation", async () => {
  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      body: JSON.stringify({ confirmedTrialConversion: true, seatCount: 3 }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.createHostedFamilyBillingCheckout).toHaveBeenCalledWith({
    allowDirectPaidUpgrade: true,
    confirmedTrialConversion: true,
    groupId: "hbag_family",
    ownerMemberId: "member_owner",
    prisma: expect.any(Object),
    requireExistingCheckoutAttempt: false,
    seatCount: 3,
  });
});

test("rejects an invite return outside explicit invite recovery", async () => {
  const familyInviteReturnPath = "/family/accept/invite_return_target";
  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      body: JSON.stringify({ familyInviteReturnPath }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
  expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
});

test("resolves a starting Checkout and abandons it before returning to the invite", async () => {
  const familyInviteReturnPath = "/family/accept/invite_return_target";
  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      body: JSON.stringify({
        abandonForInvite: true,
        familyInviteReturnPath,
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    alreadyActive: false,
    url: familyInviteReturnPath,
  });
  expect(mocks.createHostedFamilyBillingCheckout).toHaveBeenCalledWith(
    expect.objectContaining({
      allowDirectPaidUpgrade: false,
      confirmedTrialConversion: undefined,
      requireExistingCheckoutAttempt: true,
      seatCount: undefined,
    }),
  );
  expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
  expect(
    mocks.createHostedFamilyBillingCheckout.mock.calls[0]?.[0],
  ).not.toHaveProperty("familyInviteReturnPath");
  expect(mocks.readHostedFamilyDraftRecoveryStateForOwner).toHaveBeenCalledWith({
    ownerMemberId: "member_owner",
    prisma: expect.any(Object),
  });
  expect(mocks.abandonHostedFamilyDraftForOwner).toHaveBeenCalledWith({
    ownerMemberId: "member_owner",
    prisma: expect.any(Object),
  });
  expect(
    mocks.createHostedFamilyBillingCheckout.mock.invocationCallOrder[0],
  ).toBeLessThan(
    mocks.abandonHostedFamilyDraftForOwner.mock.invocationCallOrder[0] ?? 0,
  );
});

test("requires an exact invite return before resolving a starting Checkout", async () => {
  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      body: JSON.stringify({ abandonForInvite: true }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
  expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
  expect(mocks.abandonHostedFamilyDraftForOwner).not.toHaveBeenCalled();
});

test("does not abandon when Checkout becomes active during invite recovery", async () => {
  mocks.createHostedFamilyBillingCheckout.mockResolvedValueOnce({
    alreadyActive: false,
    url: null,
  });
  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      body: JSON.stringify({
        abandonForInvite: true,
        familyInviteReturnPath: "/family/accept/invite_return_target",
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(409);
  expect(mocks.abandonHostedFamilyDraftForOwner).not.toHaveBeenCalled();
});

test("does not create Checkout when the invite recovery state changed", async () => {
  mocks.readHostedFamilyDraftRecoveryStateForOwner.mockResolvedValueOnce(
    "not_abandonable",
  );
  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      body: JSON.stringify({
        abandonForInvite: true,
        familyInviteReturnPath: "/family/accept/invite_return_target",
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(409);
  expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
  expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
  expect(mocks.abandonHostedFamilyDraftForOwner).not.toHaveBeenCalled();
});

test("does not recreate a draft when the starting Checkout disappears", async () => {
  const transaction = vi.fn((callback) => callback({ label: "tx" }));
  mocks.getPrisma.mockReturnValueOnce({
    $transaction: transaction,
    hostedAccountGroup: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  });
  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      body: JSON.stringify({
        abandonForInvite: true,
        familyInviteReturnPath: "/family/accept/invite_return_target",
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(409);
  expect(transaction).not.toHaveBeenCalled();
  expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
  expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
  expect(mocks.abandonHostedFamilyDraftForOwner).not.toHaveBeenCalled();
});

test.each([
  "https://example.test/family/accept/invite_return_target",
  "/family/accept/invite return target",
])("rejects a non-canonical Family invite return %s", async (familyInviteReturnPath) => {
  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      body: JSON.stringify({
        abandonForInvite: true,
        familyInviteReturnPath,
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.ensureHostedAccountGroupForOwnerTx).not.toHaveBeenCalled();
  expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
});

test("rejects cross-origin Family checkout before reading the session", async () => {
  mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
      httpStatus: 403,
      message: "Invalid request origin.",
    });
  });

  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      headers: {
        origin: "https://evil.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
  expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
});

test("delegates sponsored-member rejection to the owner group service", async () => {
  mocks.ensureHostedAccountGroupForOwnerTx.mockRejectedValueOnce(
    hostedOnboardingError({
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
      httpStatus: 409,
      message: "This member is already in another active family plan.",
    }),
  );

  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_FAMILY_MEMBER_ALREADY_SPONSORED",
    },
  });
  expect(mocks.ensureHostedAccountGroupForOwnerTx).toHaveBeenCalledWith({
    ownerMemberId: "member_owner",
    tx: {
      label: "tx",
    },
  });
  expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
});

test("rejects suspended Family checkout owners", async () => {
  mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
    member: {
      billingStatus: "active",
      id: "member_owner",
      suspendedAt: new Date("2026-06-18T12:00:00.000Z"),
    },
  });

  const response = await billingFamilyCheckoutRoute.POST(
    new Request("https://join.example.test/api/settings/billing/family/checkout", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.createHostedFamilyBillingCheckout).not.toHaveBeenCalled();
});
