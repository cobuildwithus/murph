import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildClearCookie: vi.fn(),
  buildContinuationCookie: vi.fn(),
  continuePulse: vi.fn(),
  getHostedAppSessionFromRequest: vi.fn(),
  getPrisma: vi.fn(),
  readContinuationRequest: vi.fn(),
  readPaymentReturnAction: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  startPulse: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  getHostedAppSessionFromRequest: mocks.getHostedAppSessionFromRequest,
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation",
  async (importOriginal) => {
    const actual = await importOriginal<typeof import(
      "../src/lib/hosted-onboarding/billing-pulse-trial-continuation"
    )>();
    return {
      ...actual,
      buildHostedPulseTrialContinuationClearCookie: mocks.buildClearCookie,
      buildHostedPulseTrialContinuationCookie: mocks.buildContinuationCookie,
      readHostedPulseTrialContinuationRequest: mocks.readContinuationRequest,
      readHostedPulseTrialPaymentReturnAction: mocks.readPaymentReturnAction,
    };
  },
);

vi.mock("@/src/lib/hosted-onboarding/billing-start-paid-pulse-service", () => ({
  continueHostedPulseTrialPaidPlan: mocks.continuePulse,
  startHostedPulseTrialPaidPlan: mocks.startPulse,
}));

type PulseTrialContinuationRouteModule =
  typeof import("../app/api/settings/billing/pulse-trial-continuation/route");

let route: PulseTrialContinuationRouteModule;

beforeEach(async () => {
  vi.clearAllMocks();
  const auth = {
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    sessionId: "hws_session_123",
  };
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.buildClearCookie.mockReturnValue("murph-start-pulse=; Max-Age=0");
  mocks.buildContinuationCookie.mockReturnValue(
    "murph-start-pulse=issued; Max-Age=900",
  );
  mocks.continuePulse.mockResolvedValue({
    billingPlanCode: "launch_monthly",
    status: "continuing",
  });
  mocks.getHostedAppSessionFromRequest.mockResolvedValue(auth);
  mocks.getPrisma.mockReturnValue({ label: "test-prisma" });
  mocks.readContinuationRequest.mockReturnValue("continue_pulse");
  mocks.readPaymentReturnAction.mockReturnValue("continue_pulse");
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue(auth);
  mocks.startPulse.mockResolvedValue({
    billingPlanCode: "launch_monthly",
    status: "started",
  });
  route = await import("../app/api/settings/billing/pulse-trial-continuation/route");
});

test("turns a valid signed Stripe return into an exact-action session claim", async () => {
  const request = new Request(
    "https://join.example.test/api/settings/billing/pulse-trial-continuation?action=continue_pulse&expires=123&signature=signed",
  );
  const response = await route.GET(request);

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://join.example.test/settings?startPulse=complete#subscription",
  );
  expect(mocks.readPaymentReturnAction).toHaveBeenCalledWith({
    memberId: "member_123",
    request,
  });
  expect(mocks.buildContinuationCookie).toHaveBeenCalledWith({
    action: "continue_pulse",
    memberId: "member_123",
    sessionId: "hws_session_123",
  });
  expect(response.headers.get("set-cookie")).toBe(
    "murph-start-pulse=issued; Max-Age=900",
  );
});

test.each([
  ["continue_pulse", "continuePulse"],
  ["start_pulse_now", "startPulse"],
] as const)(
  "preserves %s through the real signed-return and session-cookie bridge",
  async (action, expectedService) => {
    const actual = await vi.importActual<typeof import(
      "../src/lib/hosted-onboarding/billing-pulse-trial-continuation"
    )>("@/src/lib/hosted-onboarding/billing-pulse-trial-continuation");
    mocks.buildClearCookie.mockImplementation(
      actual.buildHostedPulseTrialContinuationClearCookie,
    );
    mocks.buildContinuationCookie.mockImplementation(
      actual.buildHostedPulseTrialContinuationCookie,
    );
    mocks.readContinuationRequest.mockImplementation(
      actual.readHostedPulseTrialContinuationRequest,
    );
    mocks.readPaymentReturnAction.mockImplementation(
      actual.readHostedPulseTrialPaymentReturnAction,
    );

    const returnResponse = await route.GET(new Request(
      actual.buildHostedPulseTrialPaymentReturnUrl({
        action,
        memberId: "member_123",
        publicBaseUrl: "https://join.example.test",
      }),
    ));
    const setCookie = returnResponse.headers.get("set-cookie");

    expect(returnResponse.status).toBe(307);
    expect(returnResponse.headers.get("location")).toBe(
      "https://join.example.test/settings?startPulse=complete#subscription",
    );
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("member_123");
    const requestCookie = setCookie?.split(";", 1)[0];
    expect(requestCookie).toBeTruthy();

    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: null,
      },
      sessionId: "hws_session_other",
    });
    const wrongSessionResponse = await route.POST(buildPostRequest(undefined, {
      cookie: requestCookie!,
    }));
    expect(wrongSessionResponse.status).toBe(403);
    expect(mocks.continuePulse).not.toHaveBeenCalled();
    expect(mocks.startPulse).not.toHaveBeenCalled();

    const response = await route.POST(buildPostRequest(undefined, {
      cookie: requestCookie!,
    }));

    expect(response.status).toBe(200);
    expect(mocks[expectedService]).toHaveBeenCalledWith({
      memberId: "member_123",
      paymentMethodRecoveryConfirmed: true,
      paymentMethodContinuation: "conversation",
      prisma: { label: "test-prisma" },
    });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  },
);

test("keeps invalid or signed-out returns inert", async () => {
  mocks.readPaymentReturnAction.mockReturnValueOnce(null);
  const invalidResponse = await route.GET(new Request(
    "https://join.example.test/api/settings/billing/pulse-trial-continuation?action=continue_pulse",
  ));
  expect(invalidResponse.headers.get("location")).toBe(
    "https://join.example.test/settings#subscription",
  );
  expect(invalidResponse.headers.get("set-cookie")).toBeNull();

  mocks.getHostedAppSessionFromRequest.mockResolvedValueOnce(null);
  const signedOutResponse = await route.GET(new Request(
    "https://join.example.test/api/settings/billing/pulse-trial-continuation?action=continue_pulse",
  ));
  expect(signedOutResponse.headers.get("location")).toBe(
    "https://join.example.test/settings#subscription",
  );
  expect(mocks.readPaymentReturnAction).toHaveBeenCalledTimes(1);
  expect(mocks.buildContinuationCookie).not.toHaveBeenCalled();
});

test("dispatches continue_pulse without ending the trial", async () => {
  const request = buildPostRequest();
  const response = await route.POST(request);

  expect(response.status).toBe(200);
  expect(mocks.readContinuationRequest).toHaveBeenCalledWith({
    memberId: "member_123",
    request,
    sessionId: "hws_session_123",
  });
  expect(mocks.continuePulse).toHaveBeenCalledWith({
    memberId: "member_123",
    paymentMethodRecoveryConfirmed: true,
    paymentMethodContinuation: "conversation",
    prisma: { label: "test-prisma" },
  });
  expect(mocks.startPulse).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toEqual({
    billingPlanCode: "launch_monthly",
    status: "continuing",
  });
  expect(response.headers.get("set-cookie")).toBe(
    "murph-start-pulse=; Max-Age=0",
  );
});

test("dispatches start_pulse_now through the same canonical service", async () => {
  mocks.readContinuationRequest.mockReturnValueOnce("start_pulse_now");
  const response = await route.POST(buildPostRequest());

  expect(response.status).toBe(200);
  expect(mocks.startPulse).toHaveBeenCalledWith({
    memberId: "member_123",
    paymentMethodRecoveryConfirmed: true,
    paymentMethodContinuation: "conversation",
    prisma: { label: "test-prisma" },
  });
  expect(mocks.continuePulse).not.toHaveBeenCalled();
});

test("retains the exact-action claim when Stripe has not exposed the saved method yet", async () => {
  mocks.continuePulse.mockResolvedValueOnce({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.stripe.test/session_retry",
    status: "payment_required",
  });
  const response = await route.POST(buildPostRequest());

  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  await expect(response.json()).resolves.toEqual({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.stripe.test/session_retry",
    status: "payment_required",
  });
});

test("rejects missing claims, request bodies, and cross-origin mutations", async () => {
  mocks.readContinuationRequest.mockReturnValueOnce(null);
  const missingClaimResponse = await route.POST(buildPostRequest());
  expect(missingClaimResponse.status).toBe(403);
  expect(mocks.continuePulse).not.toHaveBeenCalled();
  expect(mocks.startPulse).not.toHaveBeenCalled();

  const bodyResponse = await route.POST(buildPostRequest("{}"));
  expect(bodyResponse.status).toBe(400);

  mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
      httpStatus: 403,
      message: "Invalid request origin.",
    });
  });
  const crossOriginResponse = await route.POST(buildPostRequest(undefined, {
    origin: "https://evil.example.test",
  }));
  expect(crossOriginResponse.status).toBe(403);
});

function buildPostRequest(
  body?: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(
    "https://join.example.test/api/settings/billing/pulse-trial-continuation",
    {
      ...(body === undefined ? {} : { body }),
      headers: {
        cookie: "murph-start-pulse=issued",
        origin: "https://join.example.test",
        ...headers,
      },
      method: "POST",
    },
  );
}
