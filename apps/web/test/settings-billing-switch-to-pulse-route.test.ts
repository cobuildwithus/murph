import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  scheduleHostedBillingPlanSwitchToPulse: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service", () => ({
  scheduleHostedBillingPlanSwitchToPulse: mocks.scheduleHostedBillingPlanSwitchToPulse,
}));

type BillingSwitchRouteModule = typeof import("../app/api/settings/billing/switch-to-pulse/route");

let billingSwitchRoute: BillingSwitchRouteModule;

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
  mocks.scheduleHostedBillingPlanSwitchToPulse.mockResolvedValue({
    effectiveAt: "2026-05-06T12:00:00.000Z",
    scheduledBillingPlanCode: "launch_monthly",
    status: "scheduled",
  });

  billingSwitchRoute = await import("../app/api/settings/billing/switch-to-pulse/route");
});

test("allows the bounded Stripe plan-switch transaction to finish", () => {
  expect(billingSwitchRoute.maxDuration).toBe(800);
});

test("schedules an authenticated hosted Edge member to switch to Pulse", async () => {
  const response = await billingSwitchRoute.POST(
    new Request("https://join.example.test/api/settings/billing/switch-to-pulse", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    effectiveAt: "2026-05-06T12:00:00.000Z",
    scheduledBillingPlanCode: "launch_monthly",
    status: "scheduled",
  });
  expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
  expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
  expect(mocks.scheduleHostedBillingPlanSwitchToPulse).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: {
      label: "test-prisma",
    },
  });
});

test("does not read a generic target plan request body", async () => {
  const response = await billingSwitchRoute.POST(
    new Request("https://join.example.test/api/settings/billing/switch-to-pulse", {
      body: JSON.stringify({
        targetPlanCode: "launch_edge_monthly",
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.scheduleHostedBillingPlanSwitchToPulse).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: {
      label: "test-prisma",
    },
  });
});

test("rejects unauthenticated requests", async () => {
  mocks.requireHostedAppSessionFromRequest.mockRejectedValueOnce(hostedOnboardingError({
    code: "HOSTED_APP_SESSION_REQUIRED",
    httpStatus: 401,
    message: "Sign in before continuing.",
  }));

  const response = await billingSwitchRoute.POST(
    new Request("https://join.example.test/api/settings/billing/switch-to-pulse", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(401);
  expect(mocks.scheduleHostedBillingPlanSwitchToPulse).not.toHaveBeenCalled();
});

test("rejects cross-origin mutations before reading the session", async () => {
  mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
      httpStatus: 403,
      message: "Invalid request origin.",
    });
  });

  const response = await billingSwitchRoute.POST(
    new Request("https://join.example.test/api/settings/billing/switch-to-pulse", {
      headers: {
        origin: "https://evil.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
  expect(mocks.scheduleHostedBillingPlanSwitchToPulse).not.toHaveBeenCalled();
});

test("rejects suspended hosted members", async () => {
  mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: new Date("2026-05-06T00:00:00.000Z"),
    },
  });

  const response = await billingSwitchRoute.POST(
    new Request("https://join.example.test/api/settings/billing/switch-to-pulse", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.scheduleHostedBillingPlanSwitchToPulse).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_MEMBER_SUSPENDED",
    },
  });
});
