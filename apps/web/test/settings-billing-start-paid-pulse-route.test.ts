import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildHostedPulseTrialContinuationCookie: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  startHostedTrialPaidPlan: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/billing-pulse-trial-continuation", () => ({
  buildHostedPulseTrialContinuationCookie:
    mocks.buildHostedPulseTrialContinuationCookie,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-start-paid-pulse-service", () => ({
  startHostedTrialPaidPlan: mocks.startHostedTrialPaidPlan,
}));

type BillingStartPaidPulseRouteModule =
  typeof import("../app/api/settings/billing/start-paid-pulse/route");

let billingStartPaidPulseRoute: BillingStartPaidPulseRouteModule;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.getPrisma.mockReturnValue({ label: "test-prisma" });
  mocks.buildHostedPulseTrialContinuationCookie.mockReturnValue(
    "murph-start-pulse=issued; Max-Age=900",
  );
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    sessionId: "hws_session_123",
  });
  mocks.startHostedTrialPaidPlan.mockResolvedValue({
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
  expect(mocks.startHostedTrialPaidPlan).toHaveBeenCalledWith({
    memberId: "member_123",
    paymentMethodContinuation: "settings",
    prisma: {
      label: "test-prisma",
    },
    targetPlanCode: "launch_monthly",
    timing: "now",
  });
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("issues a continuation claim before redirecting to payment-method setup", async () => {
  mocks.startHostedTrialPaidPlan.mockResolvedValueOnce({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.stripe.test/session_123",
    resumeStartAfterPaymentMethodSetup: true,
    status: "payment_required",
  });

  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.buildHostedPulseTrialContinuationCookie).toHaveBeenCalledWith({
    action: "start_pulse_now",
    memberId: "member_123",
    sessionId: "hws_session_123",
  });
  expect(response.headers.get("set-cookie")).toBe(
    "murph-start-pulse=issued; Max-Age=900",
  );
  await expect(response.json()).resolves.toEqual({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.stripe.test/session_123",
    status: "payment_required",
  });
});

test("does not issue a continuation claim for hosted-invoice recovery", async () => {
  mocks.startHostedTrialPaidPlan.mockResolvedValueOnce({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://invoice.stripe.test/in_123",
    status: "payment_required",
  });

  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.buildHostedPulseTrialContinuationCookie).not.toHaveBeenCalled();
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("starts Group after the current trial from an exact request body", async () => {
  mocks.startHostedTrialPaidPlan.mockResolvedValueOnce({
    effectiveAt: "2026-05-13T00:00:00.000Z",
    scheduledBillingPlanCode: "launch_group_monthly",
    status: "scheduled",
  });

  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
      body: JSON.stringify({
        targetPlanCode: "launch_group_monthly",
        timing: "at_trial_end",
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.startHostedTrialPaidPlan).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: { label: "test-prisma" },
    targetPlanCode: "launch_group_monthly",
    timing: "at_trial_end",
  });
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("rejects an unsupported trial plan", async () => {
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
  expect(mocks.startHostedTrialPaidPlan).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_TRIAL_START_PAID_PLAN_INVALID",
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
  expect(mocks.startHostedTrialPaidPlan).not.toHaveBeenCalled();
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
  expect(mocks.startHostedTrialPaidPlan).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_MEMBER_SUSPENDED",
    },
  });
});
