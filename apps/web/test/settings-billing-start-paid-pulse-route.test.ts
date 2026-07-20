import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildHostedPulseTrialContinuationClearCookie: vi.fn(),
  buildHostedPulseTrialContinuationCookie: vi.fn(),
  getPrisma: vi.fn(),
  readHostedPulseTrialContinuationRequest: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/billing-pulse-trial-continuation", () => ({
  buildHostedPulseTrialContinuationClearCookie:
    mocks.buildHostedPulseTrialContinuationClearCookie,
  buildHostedPulseTrialContinuationCookie:
    mocks.buildHostedPulseTrialContinuationCookie,
  readHostedPulseTrialContinuationRequest:
    mocks.readHostedPulseTrialContinuationRequest,
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
  mocks.buildHostedPulseTrialContinuationClearCookie.mockReturnValue(
    "murph-start-pulse=; Max-Age=0",
  );
  mocks.buildHostedPulseTrialContinuationCookie.mockReturnValue(
    "murph-start-pulse=issued; Max-Age=900",
  );
  mocks.readHostedPulseTrialContinuationRequest.mockReturnValue("start_pulse_now");
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    sessionId: "hws_session_123",
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
    paymentMethodContinuation: "settings",
    prisma: {
      label: "test-prisma",
    },
  });
  expect(response.headers.get("set-cookie")).toBe(
    "murph-start-pulse=; Max-Age=0",
  );
});

test("issues a continuation claim before redirecting to payment-method setup", async () => {
  mocks.startHostedPulseTrialPaidPlan.mockResolvedValueOnce({
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
  mocks.startHostedPulseTrialPaidPlan.mockResolvedValueOnce({
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
  expect(response.headers.get("set-cookie")).toBe(
    "murph-start-pulse=; Max-Age=0",
  );
});

test("accepts a valid automatic continuation and consumes its claim", async () => {
  const request = new Request(
    "https://join.example.test/api/settings/billing/start-paid-pulse",
    {
      headers: {
        "x-murph-start-paid-pulse-continuation": "1",
        cookie: "murph-start-pulse=issued",
        origin: "https://join.example.test",
      },
      method: "POST",
    },
  );

  const response = await billingStartPaidPulseRoute.POST(request);

  expect(response.status).toBe(200);
  expect(mocks.readHostedPulseTrialContinuationRequest).toHaveBeenCalledWith({
    memberId: "member_123",
    request,
    sessionId: "hws_session_123",
  });
  expect(mocks.startHostedPulseTrialPaidPlan).toHaveBeenCalledTimes(1);
  expect(response.headers.get("set-cookie")).toBe(
    "murph-start-pulse=; Max-Age=0",
  );
});

test("does not reissue the claim when automatic continuation still needs payment setup", async () => {
  mocks.startHostedPulseTrialPaidPlan.mockResolvedValueOnce({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.stripe.test/session_123",
    resumeStartAfterPaymentMethodSetup: true,
    status: "payment_required",
  });

  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
      headers: {
        "x-murph-start-paid-pulse-continuation": "1",
        cookie: "murph-start-pulse=issued",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.buildHostedPulseTrialContinuationCookie).not.toHaveBeenCalled();
  expect(response.headers.get("set-cookie")).toBe(
    "murph-start-pulse=; Max-Age=0",
  );
  await expect(response.json()).resolves.toEqual({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.stripe.test/session_123",
    status: "payment_required",
  });
});

test("rejects an automatic continuation without its bound claim", async () => {
  mocks.readHostedPulseTrialContinuationRequest.mockReturnValueOnce(null);

  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
      headers: {
        "x-murph-start-paid-pulse-continuation": "1",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.startHostedPulseTrialPaidPlan).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_PULSE_TRIAL_START_PAID_CONTINUATION_INVALID",
    },
  });
});

test("rejects malformed automatic-continuation headers", async () => {
  const response = await billingStartPaidPulseRoute.POST(
    new Request("https://join.example.test/api/settings/billing/start-paid-pulse", {
      headers: {
        "x-murph-start-paid-pulse-continuation": "true",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.readHostedPulseTrialContinuationRequest).not.toHaveBeenCalled();
  expect(mocks.startHostedPulseTrialPaidPlan).not.toHaveBeenCalled();
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
