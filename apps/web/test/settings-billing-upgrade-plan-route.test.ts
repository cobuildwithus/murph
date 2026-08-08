import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  upgradeHostedBillingPlan: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/billing-plan-change-service", () => ({
  upgradeHostedBillingPlan: mocks.upgradeHostedBillingPlan,
}));

type BillingUpgradeRouteModule = typeof import("../app/api/settings/billing/upgrade-plan/route");

let billingUpgradeRoute: BillingUpgradeRouteModule;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.getPrisma.mockReturnValue({ label: "test-prisma" });
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
  });
  mocks.upgradeHostedBillingPlan.mockResolvedValue({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.stripe.test/session_fixture",
    status: "pending_payment",
  });

  billingUpgradeRoute = await import("../app/api/settings/billing/upgrade-plan/route");
});

test("opens Stripe confirmation for an authenticated hosted member upgrading to Edge", async () => {
  const response = await billingUpgradeRoute.POST(
    new Request("https://join.example.test/api/settings/billing/upgrade-plan", {
      body: JSON.stringify({
        expectedCurrentPlanCode: "launch_monthly",
        targetPlanCode: "launch_edge_monthly",
      }),
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.stripe.test/session_fixture",
    status: "pending_payment",
  });
  expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
  expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
  expect(mocks.upgradeHostedBillingPlan).toHaveBeenCalledWith({
    expectedCurrentPlanCode: "launch_monthly",
    memberId: "member_123",
    prisma: {
      label: "test-prisma",
    },
    targetPlanCode: "launch_edge_monthly",
  });
});

test("opens Stripe confirmation for an authenticated Edge member upgrading to Max", async () => {
  mocks.upgradeHostedBillingPlan.mockResolvedValueOnce({
    billingPlanCode: "launch_edge_monthly",
    paymentUrl: "https://billing.stripe.test/session_max",
    status: "pending_payment",
  });

  const response = await billingUpgradeRoute.POST(
    new Request("https://join.example.test/api/settings/billing/upgrade-plan", {
      body: JSON.stringify({
        expectedCurrentPlanCode: "launch_edge_monthly",
        targetPlanCode: "launch_max_monthly",
      }),
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    billingPlanCode: "launch_edge_monthly",
    paymentUrl: "https://billing.stripe.test/session_max",
    status: "pending_payment",
  });
  expect(mocks.upgradeHostedBillingPlan).toHaveBeenCalledWith({
    expectedCurrentPlanCode: "launch_edge_monthly",
    memberId: "member_123",
    prisma: {
      label: "test-prisma",
    },
    targetPlanCode: "launch_max_monthly",
  });
});

test("upgrades an authenticated Group member to Pulse", async () => {
  mocks.upgradeHostedBillingPlan.mockResolvedValueOnce({
    billingPlanCode: "launch_group_monthly",
    paymentUrl: "https://billing.stripe.test/session_fixture",
    status: "pending_payment",
  });

  const response = await billingUpgradeRoute.POST(
    new Request("https://join.example.test/api/settings/billing/upgrade-plan", {
      body: JSON.stringify({
        expectedCurrentPlanCode: "launch_group_monthly",
        targetPlanCode: "launch_monthly",
      }),
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.upgradeHostedBillingPlan).toHaveBeenCalledWith({
    expectedCurrentPlanCode: "launch_group_monthly",
    memberId: "member_123",
    prisma: {
      label: "test-prisma",
    },
    targetPlanCode: "launch_monthly",
  });
});

test("rejects unauthenticated requests", async () => {
  mocks.requireHostedAppSessionFromRequest.mockRejectedValueOnce(hostedOnboardingError({
    code: "HOSTED_APP_SESSION_REQUIRED",
    httpStatus: 401,
    message: "Sign in before continuing.",
  }));

  const response = await billingUpgradeRoute.POST(
    new Request("https://join.example.test/api/settings/billing/upgrade-plan", {
      body: JSON.stringify({
        targetPlanCode: "launch_edge_monthly",
      }),
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(401);
  expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_APP_SESSION_REQUIRED",
    },
  });
});

test("rejects cross-origin mutations before reading the session", async () => {
  mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
      httpStatus: 403,
      message: "Invalid request origin.",
    });
  });

  const response = await billingUpgradeRoute.POST(
    new Request("https://join.example.test/api/settings/billing/upgrade-plan", {
      body: JSON.stringify({
        targetPlanCode: "launch_edge_monthly",
      }),
      headers: {
        origin: "https://evil.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
  expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
});

test("rejects suspended hosted members", async () => {
  mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: new Date("2026-05-06T00:00:00.000Z"),
    },
  });

  const response = await billingUpgradeRoute.POST(
    new Request("https://join.example.test/api/settings/billing/upgrade-plan", {
      body: JSON.stringify({
        targetPlanCode: "launch_edge_monthly",
      }),
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_MEMBER_SUSPENDED",
    },
  });
});

test("rejects unsupported target plan payloads", async () => {
  const response = await billingUpgradeRoute.POST(
    new Request("https://join.example.test/api/settings/billing/upgrade-plan", {
      body: JSON.stringify({
        targetPlanCode: "launch_group_monthly",
      }),
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_BILLING_PLAN_UPGRADE_TARGET_INVALID",
    },
  });
});

test("rejects an upgrade without the displayed source plan", async () => {
  const response = await billingUpgradeRoute.POST(
    new Request("https://join.example.test/api/settings/billing/upgrade-plan", {
      body: JSON.stringify({
        targetPlanCode: "launch_edge_monthly",
      }),
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.upgradeHostedBillingPlan).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_INVALID",
    },
  });
});
