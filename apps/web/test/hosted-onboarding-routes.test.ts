import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getHostedLinqRouteAuthorityMismatchReasonForLog,
  hostedOnboardingError,
} from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  createHostedBillingCheckout: vi.fn(),
  getHostedAppSessionFromRequest: vi.fn(),
  getHostedInviteStatus: vi.fn(),
  getPrisma: vi.fn(),
  issueHostedAppSession: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  requirePrivyCompletionSession: vi.fn(),
  requireHostedInviteCodeFromRequest: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
  runtimeEnv: {
    hostedOnboardingPublicBaseUrl: "https://join.example.test" as string | null,
  },
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      ...actual.getHostedOnboardingEnvironment(),
      hostedOnboardingPublicBaseUrl: mocks.runtimeEnv.hostedOnboardingPublicBaseUrl,
    }),
  };
});

vi.mock("@/src/lib/hosted-onboarding/authentication-service", () => ({
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  HOSTED_HEALTH_DATA_CONSENT_SCOPE: "launch.health-data",
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
  readHostedConsentStatus: mocks.readHostedConsentStatus,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-service", () => ({
  createHostedBillingCheckout: mocks.createHostedBillingCheckout,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/invite-service")>(
    "@/src/lib/hosted-onboarding/invite-service",
  );

  return {
    ...actual,
    getHostedInviteStatus: mocks.getHostedInviteStatus,
  };
});

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyCompletionSession: mocks.requirePrivyCompletionSession,
  requirePrivyMemberAuth: mocks.requirePrivyMemberAuth,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  getHostedAppSessionFromRequest: mocks.getHostedAppSessionFromRequest,
  issueHostedAppSession: mocks.issueHostedAppSession,
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/route-helpers", () => ({
  requireHostedInviteCodeFromRequest: mocks.requireHostedInviteCodeFromRequest,
}));

type BillingCheckoutRouteModule = typeof import("../app/api/hosted-onboarding/billing/checkout/route");
type HostedOnboardingHttpModule = typeof import("../src/lib/hosted-onboarding/http");

let billingCheckoutRoute: BillingCheckoutRouteModule;
let hostedOnboardingHttp: HostedOnboardingHttpModule;

const SAME_ORIGIN_HEADERS = {
  origin: "https://join.example.test",
};
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setHostedOnboardingTestNodeEnv(value: string | undefined): void {
  Reflect.set(process.env, "NODE_ENV", value);
}

describe("hosted onboarding routes", () => {
  beforeAll(async () => {
    billingCheckoutRoute = await import("../app/api/hosted-onboarding/billing/checkout/route");
    hostedOnboardingHttp = await import("../src/lib/hosted-onboarding/http");
  });

  beforeEach(() => {
    setHostedOnboardingTestNodeEnv(ORIGINAL_NODE_ENV);
    vi.stubEnv("HOSTED_SIGNUP_NOTIFICATION_EMAILS", "");
    vi.stubEnv("HOSTED_SIGNUP_WELCOME_EMAIL_FROM", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.clearAllMocks();
    mocks.requirePrivyCompletionSession.mockResolvedValue({
      identity: {
        phone: {
          number: "+15551234567",
          verifiedAt: 1742990400,
        },
        userId: "did:privy:user_123",
        wallet: {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chainType: "ethereum",
          id: "wallet_123",
          type: "wallet",
        },
      },
      linkedAccounts: [],
      member: null,
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.completeHostedPrivyVerification.mockResolvedValue({
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      member: createHostedMember(),
      memberId: "member_123",
      messagingSetupRequired: false,
      stage: "checkout",
    });
    mocks.getHostedInviteStatus.mockResolvedValue(createInviteStatus("checkout"));
    mocks.issueHostedAppSession.mockResolvedValue({
      cookie: "murph-session=session-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
      sessionId: "hws_123",
    });
    mocks.getHostedAppSessionFromRequest.mockResolvedValue(null);
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.readHostedConsentStatus.mockResolvedValue({
      launchGranted: false,
    });
    mocks.createHostedBillingCheckout.mockResolvedValue({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      identity: {
        email: {
          address: "user@example.com",
          verifiedAt: 1_710_000_000,
        },
        phone: null,
        telegram: null,
        userId: "did:privy:user_123",
        wallet: null,
      },
      linkedAccounts: [
        {
          address: "user@example.com",
          type: "email",
        },
      ],
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValue({
      body: {
        inviteCode: "invite-code",
      },
      inviteCode: "invite-code",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setHostedOnboardingTestNodeEnv(ORIGINAL_NODE_ENV);
  });


  it("keeps no-store headers when hosted onboarding errors are serialized", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = hostedOnboardingHttp.jsonError(
      hostedOnboardingError({
        code: "INVITE_INVALID",
        details: { inviteCode: "invite-code" },
        httpStatus: 404,
        message: "Invite code is invalid.",
        retryable: false,
      }),
      { "x-test": "present" },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("x-test")).toBe("present");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVITE_INVALID",
        details: { inviteCode: "invite-code" },
        message: "Invite code is invalid.",
        retryable: false,
      },
    });
    expect(warnSpy).toHaveBeenCalledWith("Hosted onboarding route failed.", {
      errorCode: "INVITE_INVALID",
      errorMessage: "Invite code is invalid.",
      errorResponseCode: "INVITE_INVALID",
      errorResponseRetryable: false,
      errorResponseStatus: 404,
      errorType: "HostedOnboardingError",
      internalMessage: "Hosted onboarding route failed unexpectedly.",
    });
  });

  describe.each(["production", "development"])("private Linq authority reasons in %s", (nodeEnv) => {
    const code = "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH";
    const message = "Linq egress target does not match the runtime user's Linq route.";
    const reasons = [
      "durable_thread_container_mismatch", "durable_target_missing", "requested_target_missing",
      "member_routing_missing", "target_not_owned", "route_projection_mismatch",
      "pending_recipient_invalid", "member_identity_missing", "member_recipient_invalid",
    ] as const;
    const failure = () => hostedOnboardingError({ code, message, httpStatus: 403 });
    beforeEach(() => setHostedOnboardingTestNodeEnv(nodeEnv));
    afterEach(() => vi.restoreAllMocks());

    async function expectPrivateReason(error: ReturnType<typeof failure>, reason?: string) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const otherLogs = (["error", "info", "log"] as const)
        .map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
      const payloadGetter = vi.fn(() => { throw new Error("synthetic-private-payload"); });
      Object.defineProperty(error, "providerPayload", { enumerable: true, get: payloadGetter });
      const response = await hostedOnboardingHttp.withJsonError<[Request]>(async () => { throw error; })(
        new Request("https://synthetic.example.test/engagement?private=synthetic-private-query", {
          method: "POST", headers: { authorization: "Bearer synthetic-private-token" },
          body: JSON.stringify({ content: "synthetic-private-body" }),
        }),
      );
      expect(error.name).toBe("HostedOnboardingError");
      expect(error.constructor.name).toBe("HostedOnboardingError");
      expect(error.details).toBeUndefined();
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).toBe(JSON.stringify({
        error: { code: error.code, message: error.message, retryable: false },
      }));
      expect(warn).toHaveBeenCalledTimes(1);
      for (const log of otherLogs) expect(log).not.toHaveBeenCalled();
      expect(payloadGetter).not.toHaveBeenCalled();
      expect(warn.mock.calls[0]).toEqual(["Hosted onboarding route failed.", {
        errorType: "HostedOnboardingError", errorCode: error.code, errorMessage: error.message,
        internalMessage: "Hosted onboarding route failed unexpectedly.", requestMethod: "POST",
        errorResponseCode: error.code, errorResponseStatus: 403, errorResponseRetryable: false,
        ...(reason ? { linqRouteAuthorityMismatchReason: reason } : {}),
      }]);
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/synthetic-private|example\.test|15550000071/);
    }

    it.each(reasons)("logs only the closed reason %s with an unchanged public envelope", async (reason) => {
      await expectPrivateReason(hostedOnboardingError({
        code, message, httpStatus: 403, linqRouteAuthorityMismatchReason: reason,
      }), reason);
    });

    it.each([
      undefined, null, 42, true, ["target_not_owned"], { reason: "target_not_owned" },
      "unknown_future_reason", "target_not_owned ", "target_not_owned\nsynthetic-private-body",
      "synthetic-private-chat +15550000071",
    ].map((value) => ({ value })))("omits unknown or malformed reason $value", async ({ value }) => {
      const error = failure();
      Object.defineProperty(error, "linqRouteAuthorityMismatchReason", { value });
      await expectPrivateReason(error);
    });

    it("ignores a diagnostic getter without invoking it", async () => {
      const error = failure();
      const getter = vi.fn(() => { throw new Error("synthetic-private-reason"); });
      Object.defineProperty(error, "linqRouteAuthorityMismatchReason", { get: getter });
      await expectPrivateReason(error);
      expect(getter).not.toHaveBeenCalled();
    });

    it("does not coerce or serialize a diagnostic object", async () => {
      const getter = vi.fn(() => { throw new Error("synthetic-private-reason"); });
      const value = Object.defineProperties({}, {
        reason: { enumerable: true, get: getter }, toJSON: { get: getter },
        toString: { get: getter }, valueOf: { get: getter }, [Symbol.toPrimitive]: { get: getter },
      });
      const error = failure();
      Object.defineProperty(error, "linqRouteAuthorityMismatchReason", { value });
      await expectPrivateReason(error);
      expect(getter).not.toHaveBeenCalled();
    });

    it.each([
      { code: "UNRELATED_ERROR", message },
      { code, message: "Linq egress route authority does not match the requested thread." },
    ])("does not annotate another owner with code=$code and message=$message", async (owner) => {
      await expectPrivateReason(hostedOnboardingError({
        ...owner, httpStatus: 403, linqRouteAuthorityMismatchReason: "target_not_owned",
      }));
    });
  });

  it("ignores forged reason accessors outside the hosted error class", () => {
    const code = "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH";
    const message = "Linq egress target does not match the runtime user's Linq route.";
    const getter = vi.fn(() => { throw new Error("synthetic-private-reason"); });
    for (const error of [{ code, message }, Object.assign(new Error(message), { code })]) {
      Object.defineProperty(error, "linqRouteAuthorityMismatchReason", { get: getter });
      expect(getHostedLinqRouteAuthorityMismatchReasonForLog(error)).toBeUndefined();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(["code", "message"])("does not invoke the diagnostic owner %s accessor", (property) => {
    const error = hostedOnboardingError({
      code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH", httpStatus: 403,
      message: "Linq egress target does not match the runtime user's Linq route.",
      linqRouteAuthorityMismatchReason: "target_not_owned",
    });
    const getter = vi.fn(() => { throw new Error("synthetic-private-owner"); });
    Object.defineProperty(error, property, { get: getter });
    expect(getHostedLinqRouteAuthorityMismatchReasonForLog(error)).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });

  it("logs allowlisted hosted onboarding error details without logging arbitrary response details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = hostedOnboardingHttp.jsonError(
      hostedOnboardingError({
        code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
        details: {
          code: "resource_missing",
          inviteCode: "invite-code",
          operationName: "subscription.retrieve",
          providerErrorCode: "rate_limit_exceeded",
          providerErrorMessage: "Rate limit reached for this request.",
          providerErrorType: "rate_limit_error",
          providerRequestIdPresent: true,
          requestIdPresent: true,
          statusCode: 404,
          type: "StripeInvalidRequestError",
        },
        httpStatus: 502,
        message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
        retryable: true,
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
        details: {
          code: "resource_missing",
          inviteCode: "invite-code",
          operationName: "subscription.retrieve",
          providerErrorCode: "rate_limit_exceeded",
          providerErrorMessage: "Rate limit reached for this request.",
          providerErrorType: "rate_limit_error",
          providerRequestIdPresent: true,
          requestIdPresent: true,
          statusCode: 404,
          type: "StripeInvalidRequestError",
        },
        message: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
        retryable: true,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith("Hosted onboarding route failed.", {
      errorCode: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
      errorDetails: {
        code: "resource_missing",
        operationName: "subscription.retrieve",
        providerErrorCode: "rate_limit_exceeded",
        providerErrorMessage: "Rate limit reached for this request.",
        providerErrorType: "rate_limit_error",
        providerRequestIdPresent: true,
        requestIdPresent: true,
        statusCode: 404,
        type: "StripeInvalidRequestError",
      },
      errorMessage: "Stripe billing is unavailable for plan changes right now. Try again shortly.",
      errorResponseCode: "HOSTED_BILLING_STRIPE_PLAN_CHANGE_UNAVAILABLE",
      errorResponseRetryable: true,
      errorResponseStatus: 502,
      errorType: "HostedOnboardingError",
      internalMessage: "Hosted onboarding route failed unexpectedly.",
    });
  });

  it("reuses the shared JSON object reader for hosted onboarding bodies", async () => {
    await expect(
      hostedOnboardingHttp.readJsonObject(
        new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
          body: JSON.stringify(["not", "an", "object"]),
          method: "POST",
        }),
      ),
    ).rejects.toThrow("Request body must be a JSON object.");
  });

  it("ignores a retained legacy trial offer on ordinary paid checkout", async () => {
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValueOnce({
      body: {
        checkoutOffer: "pulse_trial_7d",
        inviteCode: "invite-code",
      },
      inviteCode: "invite-code",
      verifiedPrivyUser: {
        id: "did:privy:user_123",
      },
    });

    const request = new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
      body: JSON.stringify({
        checkoutOffer: "pulse_trial_7d",
        inviteCode: "invite-code",
      }),
      headers: SAME_ORIGIN_HEADERS,
      method: "POST",
    });

    const response = await billingCheckoutRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
    });
  });

  it("does not forward wallet state from the hosted billing checkout request body", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
      body: JSON.stringify({
        inviteCode: "invite-code",

      }),
      headers: SAME_ORIGIN_HEADERS,
      method: "POST",
    });

    const response = await billingCheckoutRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.requirePrivyMemberAuth).not.toHaveBeenCalled();
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
    });
    await expect(response.json()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
  });

  it("logs sanitized development diagnostics for unexpected hosted billing checkout failures", async () => {
    setHostedOnboardingTestNodeEnv("development");

    class StripeAuthenticationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "StripeAuthenticationError";
      }
    }

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const billingError = new StripeAuthenticationError(
      "Stripe auth failed for sk_test_123 from https://api.stripe.com while reading /Users/test/app",
    ) as StripeAuthenticationError & {
      detail: string;
      headers: Record<string, string>;
      requestId: string;
      statusCode: number;
      type: string;
    };
    billingError.type = "StripeAuthenticationError";
    billingError.statusCode = 401;
    billingError.requestId = "req_123";
    billingError.detail = "See https://dashboard.stripe.com/test/logs/req_123";
    billingError.headers = {
      authorization: "Bearer sk_test_123",
      requestId: "req_123",
    };
    mocks.createHostedBillingCheckout.mockRejectedValue(billingError);

    const response = await billingCheckoutRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
        body: JSON.stringify({
          inviteCode: "invite-code",
        }),
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    const loggedPayload = errorSpy.mock.calls[0]?.[1];
    expect(loggedPayload).toBeDefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted onboarding route failed.",
      expect.objectContaining({
        errorType: "StripeAuthenticationError",
        internalMessage: "Hosted onboarding route failed unexpectedly.",
        errorMessage:
          "Stripe auth failed for <redacted-secret> from <redacted-url> while reading <redacted-path>",
        errorStack: expect.stringContaining(
          "StripeAuthenticationError: Stripe auth failed for <redacted-secret> from <redacted-url> while reading <redacted-path>",
        ),
        errorDetails: expect.objectContaining({
          detail: "See <redacted-url>",
          headers: {
            authorization: "[redacted]",
            requestId: "req_123",
          },
          name: "StripeAuthenticationError",
          requestId: "req_123",
          statusCode: 401,
          type: "StripeAuthenticationError",
        }),
      }),
    );
    expect(loggedPayload).toMatchObject({
      errorStack: expect.not.stringContaining("file:///"),
    });
  });

  it("keeps unexpected hosted billing checkout failures sanitized outside development", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createHostedBillingCheckout.mockRejectedValue(
      new Error(
        "Stripe auth failed for sk_test_123 from https://api.stripe.com while reading /Users/test/app",
      ),
    );

    const response = await billingCheckoutRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
        body: JSON.stringify({
          inviteCode: "invite-code",
        }),
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    expect(errorSpy).toHaveBeenCalledWith("Hosted onboarding route failed.", {
      errorMessage:
        "Stripe auth failed for <redacted-secret> from <redacted-url> while reading <redacted-path>",
      errorResponseCode: "INTERNAL_ERROR",
      errorType: "Error",
      internalMessage: "Hosted onboarding route failed unexpectedly.",
      requestMethod: "POST",
    });
    const loggedPayload = errorSpy.mock.calls[0]?.[1];
    expect(loggedPayload).not.toHaveProperty("errorDetails");
    expect(loggedPayload).not.toHaveProperty("errorStack");
  });

});

function createInviteStatus(stage: "checkout") {
  return {
    billing: {
      defaultPlanCode: "launch_monthly",
      plans: [],
    },
    capabilities: {
      billingReady: true,
    },
    invite: {
      code: "invite-code",
      expiresAt: "2026-03-27T12:00:00.000Z",
      phoneAuthTarget: {
        kind: "saved",
        phoneHint: "*** 4567",
      },
      phoneHint: "*** 4567",
      verificationMode: "invite_phone",
    },
    messagingSetupRequired: false,
    session: {
      authenticated: true,
      expiresAt: null,
      matchesInvite: true,
    },
    stage,
  };
}

function createHostedMember() {
  return {
    billingStatus: "active",
    createdAt: new Date("2026-03-27T12:00:00.000Z"),
    id: "member_123",
    suspendedAt: null,
    updatedAt: new Date("2026-03-27T12:00:00.000Z"),
  };
}
