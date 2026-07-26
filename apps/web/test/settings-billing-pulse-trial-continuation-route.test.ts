import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
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
      "x-murph-pulse-continuation-action": action,
    }));
    expect(wrongSessionResponse.status).toBe(403);
    expect(mocks.continuePulse).not.toHaveBeenCalled();
    expect(mocks.startPulse).not.toHaveBeenCalled();

    const response = await route.POST(buildPostRequest(undefined, {
      cookie: requestCookie!,
      "x-murph-pulse-continuation-action": action,
    }));

    expect(response.status).toBe(200);
    expect(mocks[expectedService]).toHaveBeenCalledWith({
      memberId: "member_123",
      paymentMethodContinuation: "conversation",
      prisma: { label: "test-prisma" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  },
);

test("rejects a stale rendered action before either billing service", async () => {
  mocks.readContinuationRequest.mockReturnValueOnce("start_pulse_now");
  const response = await route.POST(buildPostRequest(undefined, {
    "x-murph-pulse-continuation-action": "continue_pulse",
  }));

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "HOSTED_PULSE_TRIAL_CONTINUATION_CHANGED",
    },
  });
  expect(mocks.continuePulse).not.toHaveBeenCalled();
  expect(mocks.startPulse).not.toHaveBeenCalled();
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("keeps a newer start claim usable when an older continue page retries", async () => {
  const actual = await vi.importActual<typeof import(
    "../src/lib/hosted-onboarding/billing-pulse-trial-continuation"
  )>("@/src/lib/hosted-onboarding/billing-pulse-trial-continuation");
  mocks.buildContinuationCookie.mockImplementation(
    actual.buildHostedPulseTrialContinuationCookie,
  );
  mocks.readContinuationRequest.mockImplementation(
    actual.readHostedPulseTrialContinuationRequest,
  );
  mocks.readPaymentReturnAction.mockImplementation(
    actual.readHostedPulseTrialPaymentReturnAction,
  );

  const continueReturn = await route.GET(new Request(
    actual.buildHostedPulseTrialPaymentReturnUrl({
      action: "continue_pulse",
      memberId: "member_123",
      publicBaseUrl: "https://join.example.test",
    }),
  ));
  const continueCookie = continueReturn.headers.get("set-cookie")?.split(";", 1)[0];
  expect(continueCookie).toBeTruthy();

  mocks.continuePulse.mockResolvedValueOnce({
    billingPlanCode: "launch_monthly",
    paymentUrl: "https://billing.stripe.test/session_retry",
    status: "payment_required",
  });
  const delayedContinue = await route.POST(buildPostRequest(undefined, {
    cookie: continueCookie!,
    "x-murph-pulse-continuation-action": "continue_pulse",
  }));
  expect(delayedContinue.status).toBe(200);

  const startReturn = await route.GET(new Request(
    actual.buildHostedPulseTrialPaymentReturnUrl({
      action: "start_pulse_now",
      memberId: "member_123",
      publicBaseUrl: "https://join.example.test",
    }),
  ));
  const startCookie = startReturn.headers.get("set-cookie")?.split(";", 1)[0];
  expect(startCookie).toBeTruthy();

  const staleRetry = await route.POST(buildPostRequest(undefined, {
    cookie: startCookie!,
    "x-murph-pulse-continuation-action": "continue_pulse",
  }));
  expect(staleRetry.status).toBe(409);
  expect(mocks.startPulse).not.toHaveBeenCalled();
  expect(staleRetry.headers.get("set-cookie")).toBeNull();

  const currentConfirmation = await route.POST(buildPostRequest(undefined, {
    cookie: startCookie!,
    "x-murph-pulse-continuation-action": "start_pulse_now",
  }));
  expect(currentConfirmation.status).toBe(200);
  expect(mocks.startPulse).toHaveBeenCalledTimes(1);
  expect(currentConfirmation.headers.get("set-cookie")).toBeNull();
});

test("keeps a newer continue claim usable when an older start page confirms", async () => {
  const actual = await vi.importActual<typeof import(
    "../src/lib/hosted-onboarding/billing-pulse-trial-continuation"
  )>("@/src/lib/hosted-onboarding/billing-pulse-trial-continuation");
  mocks.buildContinuationCookie.mockImplementation(
    actual.buildHostedPulseTrialContinuationCookie,
  );
  mocks.readContinuationRequest.mockImplementation(
    actual.readHostedPulseTrialContinuationRequest,
  );
  mocks.readPaymentReturnAction.mockImplementation(
    actual.readHostedPulseTrialPaymentReturnAction,
  );

  const startReturn = await route.GET(new Request(
    actual.buildHostedPulseTrialPaymentReturnUrl({
      action: "start_pulse_now",
      memberId: "member_123",
      publicBaseUrl: "https://join.example.test",
    }),
  ));
  expect(startReturn.headers.get("set-cookie")).toBeTruthy();

  const continueReturn = await route.GET(new Request(
    actual.buildHostedPulseTrialPaymentReturnUrl({
      action: "continue_pulse",
      memberId: "member_123",
      publicBaseUrl: "https://join.example.test",
    }),
  ));
  const continueCookie = continueReturn.headers.get("set-cookie")?.split(";", 1)[0];
  expect(continueCookie).toBeTruthy();

  const staleConfirmation = await route.POST(buildPostRequest(undefined, {
    cookie: continueCookie!,
    "x-murph-pulse-continuation-action": "start_pulse_now",
  }));
  expect(staleConfirmation.status).toBe(409);
  expect(mocks.startPulse).not.toHaveBeenCalled();
  expect(mocks.continuePulse).not.toHaveBeenCalled();
  expect(staleConfirmation.headers.get("set-cookie")).toBeNull();

  const currentCheck = await route.POST(buildPostRequest(undefined, {
    cookie: continueCookie!,
    "x-murph-pulse-continuation-action": "continue_pulse",
  }));
  expect(currentCheck.status).toBe(200);
  expect(mocks.continuePulse).toHaveBeenCalledTimes(1);
  expect(currentCheck.headers.get("set-cookie")).toBeNull();
});

test("keeps an invalid return inert so settings cannot bounce it back here", async () => {
  mocks.readPaymentReturnAction.mockReturnValueOnce(null);
  const invalidResponse = await route.GET(new Request(
    "https://join.example.test/api/settings/billing/pulse-trial-continuation?action=continue_pulse&expires=123&signature=signed",
  ));
  expect(invalidResponse.headers.get("location")).toBe(
    "https://join.example.test/settings#subscription",
  );
  expect(invalidResponse.headers.get("set-cookie")).toBeNull();
  expect(mocks.buildContinuationCookie).not.toHaveBeenCalled();
});

test("carries a signed-out return to settings so signing in can resume it", async () => {
  mocks.getHostedAppSessionFromRequest.mockResolvedValueOnce(null);
  const signedOutResponse = await route.GET(new Request(
    "https://join.example.test/api/settings/billing/pulse-trial-continuation?action=continue_pulse&expires=123&signature=signed",
  ));

  // The signature is bound to a member id absent from the URL, so it cannot be
  // verified until a session exists; dropping the params here is what stranded
  // members who paid in a browser that never held a Murph session.
  expect(signedOutResponse.headers.get("location")).toBe(
    "https://join.example.test/settings?action=continue_pulse&expires=123&signature=signed#subscription",
  );
  expect(mocks.readPaymentReturnAction).not.toHaveBeenCalled();
  expect(mocks.buildContinuationCookie).not.toHaveBeenCalled();
});

test("does not forward repeated continuation params from a signed-out return", async () => {
  mocks.getHostedAppSessionFromRequest.mockResolvedValueOnce(null);
  const response = await route.GET(new Request(
    "https://join.example.test/api/settings/billing/pulse-trial-continuation?action=continue_pulse&action=start_pulse_now&expires=123&signature=signed",
  ));

  expect(response.headers.get("location")).toBe(
    "https://join.example.test/settings?expires=123&signature=signed#subscription",
  );
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
    paymentMethodContinuation: "conversation",
    prisma: { label: "test-prisma" },
  });
  expect(mocks.startPulse).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toEqual({
    billingPlanCode: "launch_monthly",
    status: "continuing",
  });
  expect(response.headers.get("set-cookie")).toBe(
    null,
  );
});

test("dispatches start_pulse_now through the same canonical service", async () => {
  mocks.readContinuationRequest.mockReturnValueOnce("start_pulse_now");
  const response = await route.POST(buildPostRequest(undefined, {
    "x-murph-pulse-continuation-action": "start_pulse_now",
  }));

  expect(response.status).toBe(200);
  expect(mocks.startPulse).toHaveBeenCalledWith({
    memberId: "member_123",
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

  const missingRenderedActionResponse = await route.POST(new Request(
    "https://join.example.test/api/settings/billing/pulse-trial-continuation",
    {
      headers: {
        cookie: "murph-start-pulse=issued",
        origin: "https://join.example.test",
      },
      method: "POST",
    },
  ));
  expect(missingRenderedActionResponse.status).toBe(409);
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
        "x-murph-pulse-continuation-action": "continue_pulse",
        ...headers,
      },
      method: "POST",
    },
  );
}
