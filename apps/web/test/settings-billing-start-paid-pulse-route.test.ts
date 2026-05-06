import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  startHostedPulseTrialPaidPlan: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/billing-start-paid-pulse-service", () => ({
  startHostedPulseTrialPaidPlan: mocks.startHostedPulseTrialPaidPlan,
}));

type BillingStartPaidPulseRouteModule =
  typeof import("../app/api/settings/billing/start-paid-pulse/route");

let billingStartPaidPulseRoute: BillingStartPaidPulseRouteModule;

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
  mocks.startHostedPulseTrialPaidPlan.mockResolvedValue({
    billingPlanCode: "launch_monthly",
    status: "started",
  });

  billingStartPaidPulseRoute = await import("../app/api/settings/billing/start-paid-pulse/route");
});

test("starts paid Pulse for an authenticated hosted trial member", async () => {
  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    billingPlanCode: "launch_monthly",
    status: "started",
  });
  expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
  expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
  expect(mocks.startHostedPulseTrialPaidPlan).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: {
      label: "test-prisma",
    },
  });
});

test("rejects a generic request body", async () => {
  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
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

  expect(response.status).toBe(400);
  expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
  expect(mocks.startHostedPulseTrialPaidPlan).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_PULSE_TRIAL_START_PAID_BODY_UNSUPPORTED",
    },
  });
});

test("rejects cross-origin mutations before reading the body or session", async () => {
  mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
      httpStatus: 403,
      message: "Invalid request origin.",
    });
  });

  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
      headers: {
        origin: "https://evil.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
  expect(mocks.startHostedPulseTrialPaidPlan).not.toHaveBeenCalled();
});

test("rejects suspended hosted members", async () => {
  mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: new Date("2026-05-06T00:00:00.000Z"),
    },
  });

  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.startHostedPulseTrialPaidPlan).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_MEMBER_SUSPENDED",
    },
  });
});
