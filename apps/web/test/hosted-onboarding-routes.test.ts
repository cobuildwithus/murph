import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  abortHostedInvitePhoneCode: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  confirmHostedInvitePhoneCode: vi.fn(),
  createHostedBillingCheckout: vi.fn(),
  getHostedAppSessionFromRequest: vi.fn(),
  getHostedInviteStatus: vi.fn(),
  getPrisma: vi.fn(),
  issueHostedAppSession: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  prepareHostedInvitePhoneCode: vi.fn(),
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
    abortHostedInvitePhoneCode: mocks.abortHostedInvitePhoneCode,
    confirmHostedInvitePhoneCode: mocks.confirmHostedInvitePhoneCode,
    getHostedInviteStatus: mocks.getHostedInviteStatus,
    prepareHostedInvitePhoneCode: mocks.prepareHostedInvitePhoneCode,
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
type AbortSendCodeRouteModule = typeof import("../app/api/hosted-onboarding/invites/[inviteCode]/send-code/abort/route");
type ConfirmSendCodeRouteModule = typeof import("../app/api/hosted-onboarding/invites/[inviteCode]/send-code/confirm/route");
type HostedOnboardingHttpModule = typeof import("../src/lib/hosted-onboarding/http");
type PrivyCompleteRouteModule = typeof import("../app/api/hosted-onboarding/privy/complete/route");
type SendCodeRouteModule = typeof import("../app/api/hosted-onboarding/invites/[inviteCode]/send-code/route");

let billingCheckoutRoute: BillingCheckoutRouteModule;
let abortSendCodeRoute: AbortSendCodeRouteModule;
let confirmSendCodeRoute: ConfirmSendCodeRouteModule;
let hostedOnboardingHttp: HostedOnboardingHttpModule;
let privyCompleteRoute: PrivyCompleteRouteModule;
let sendCodeRoute: SendCodeRouteModule;

const SAME_ORIGIN_HEADERS = {
  origin: "https://join.example.test",
};
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setHostedOnboardingTestNodeEnv(value: string | undefined): void {
  Reflect.set(process.env, "NODE_ENV", value);
}

describe("hosted onboarding routes", () => {
  beforeAll(async () => {
    abortSendCodeRoute = await import("../app/api/hosted-onboarding/invites/[inviteCode]/send-code/abort/route");
    billingCheckoutRoute = await import("../app/api/hosted-onboarding/billing/checkout/route");
    confirmSendCodeRoute = await import("../app/api/hosted-onboarding/invites/[inviteCode]/send-code/confirm/route");
    hostedOnboardingHttp = await import("../src/lib/hosted-onboarding/http");
    privyCompleteRoute = await import("../app/api/hosted-onboarding/privy/complete/route");
    sendCodeRoute = await import("../app/api/hosted-onboarding/invites/[inviteCode]/send-code/route");
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
      activationPending: false,
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
    mocks.confirmHostedInvitePhoneCode.mockResolvedValue({
      ok: true,
    });
    mocks.abortHostedInvitePhoneCode.mockResolvedValue({
      ok: true,
    });
    mocks.prepareHostedInvitePhoneCode.mockResolvedValue({
      phoneHint: "*** 4567",
      phoneNumber: "+15551234567",
      sendAttemptId: "send_attempt_123",
    });
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

  it("marks cookie-backed Privy verification responses as no-store", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          inviteCode: "invite-code",
        }),
        headers: {
          cookie: "privy-id-token=cookie-token",
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBe(
      "murph-session=session-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(mocks.getHostedAppSessionFromRequest).toHaveBeenCalledTimes(1);
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      authMethod: "phone",
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
      inviteCode: "invite-code",
      now: expect.any(Date),
    });
    expect(mocks.issueHostedAppSession).toHaveBeenCalledWith({
      memberId: "member_123",
      privyUserId: "did:privy:user_123",
    });
    expect(mocks.getHostedInviteStatus).toHaveBeenCalledWith({
      authenticatedMember: createHostedMember(),
      inviteCode: "invite-code",
    });
    await expect(response.json()).resolves.toEqual({
      inviteCode: "invite-code",
      joinUrl: "/join/invite-code",
      launchConsentGranted: false,
      launchConsentStatus: {
        launchGranted: false,
      },
      messagingSetupRequired: false,
      ok: true,
      stage: "checkout",
      status: createInviteStatus("checkout"),
    });
  });

  it("accepts a valid Privy cookie-backed session even when the request body is empty", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        headers: {
          cookie: "privy-id-token=cookie-token",
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      authMethod: "phone",
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
      inviteCode: null,
      now: expect.any(Date),
    });
  });

  it("ignores any body identity token and keeps the Privy cookie authoritative", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          identityToken: "body-token",
          inviteCode: "invite-code",
        }),
        headers: {
          cookie: "privy-id-token=cookie-token",
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      authMethod: "phone",
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
      inviteCode: "invite-code",
      now: expect.any(Date),
    });
  });

  it("ignores legacy sign-in intent values on the completion route", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          intent: "signin",
          inviteCode: "invite-code",
        }),
        headers: {
          cookie: "privy-id-token=cookie-token",
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith(expect.objectContaining({
      inviteCode: "invite-code",
    }));
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith(expect.not.objectContaining({
      intent: expect.any(String),
    }));
  });

  it("rejects hosted Privy completion requests that are missing the Privy identity cookie", async () => {
    mocks.requirePrivyCompletionSession.mockRejectedValue(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Verify your phone to continue.",
      }),
    );

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          inviteCode: "invite-code",
        }),
        headers: {
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("checks the hosted Privy cookie-backed session before parsing malformed request JSON", async () => {
    mocks.requirePrivyCompletionSession.mockRejectedValue(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Verify your phone to continue.",
      }),
    );

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: "{",
        headers: {
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requirePrivyCompletionSession).toHaveBeenCalledTimes(1);
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("does not accept a body identity token when the hosted Privy identity cookie is missing", async () => {
    mocks.requirePrivyCompletionSession.mockRejectedValue(
      hostedOnboardingError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        message: "Verify your phone to continue.",
      }),
    );

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          identityToken: "body-token",
          inviteCode: "invite-code",
        }),
        headers: {
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("logs a sanitized error message for warning-level hosted Privy completion failures in production", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.requirePrivyCompletionSession.mockRejectedValue(
      new TypeError(
        "HOSTED_CONTACT_PRIVACY_KEYS is required for hosted contact privacy while reading /Users/test/app and notifying user@example.com with Bearer abc.def.ghi",
      ),
    );

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          inviteCode: "invite-code",
        }),
        headers: {
          cookie: "privy-id-token=cookie-token",
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(warnSpy).toHaveBeenCalledWith("Hosted onboarding route failed.", {
      errorMessage:
        "HOSTED_CONTACT_PRIVACY_KEYS is required for hosted contact privacy while reading <redacted-path> and notifying <redacted-email> with Bearer <redacted-secret>",
      errorResponseCode: "INVALID_REQUEST",
      errorType: "TypeError",
      internalMessage: "Hosted onboarding route failed unexpectedly.",
      requestMethod: "POST",
    });
  });

  it("serializes retryable server-side Privy lag errors during completion", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.requirePrivyCompletionSession.mockRejectedValue(
      hostedOnboardingError({
        code: "PRIVY_PHONE_NOT_READY",
        httpStatus: 409,
        message: "Your verified phone number has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      }),
    );

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          inviteCode: "invite-code",
        }),
        headers: {
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_PHONE_NOT_READY",
        message: "Your verified phone number has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
    });
    expect(warnSpy).toHaveBeenCalledWith("Hosted onboarding route failed.", {
      errorCode: "PRIVY_PHONE_NOT_READY",
      errorMessage: "Your verified phone number has not reached the server-side Privy session yet. Wait a moment and try again.",
      errorResponseCode: "PRIVY_PHONE_NOT_READY",
      errorResponseRetryable: true,
      errorResponseStatus: 409,
      errorType: "HostedOnboardingError",
      internalMessage: "Hosted onboarding route failed unexpectedly.",
      requestMethod: "POST",
    });
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

  it("returns no-store invite send-code responses and resolves the decoded invite code from the route", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/send-code", {
      headers: SAME_ORIGIN_HEADERS,
      method: "POST",
    });

    const response = await sendCodeRoute.POST(request, {
      params: Promise.resolve({
        inviteCode: "invite-code",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.prepareHostedInvitePhoneCode).toHaveBeenCalledWith({
      inviteCode: "invite-code",
    });
    await expect(response.json()).resolves.toEqual({
      phoneHint: "*** 4567",
      phoneNumber: "+15551234567",
      sendAttemptId: "send_attempt_123",
    });
  });

  it("serializes invite send-code errors without dropping no-store headers", async () => {
    mocks.prepareHostedInvitePhoneCode.mockRejectedValue(
      hostedOnboardingError({
        code: "PHONE_CODE_COOLDOWN",
        httpStatus: 429,
        message: "Wait a moment before requesting another code.",
        retryable: true,
      }),
    );

    const response = await sendCodeRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/send-code", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
      {
        params: Promise.resolve({
          inviteCode: "invite-code",
        }),
      },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PHONE_CODE_COOLDOWN",
        message: "Wait a moment before requesting another code.",
        retryable: true,
      },
    });
  });

  it("logs sanitized Prisma diagnostics for unexpected invite send-code failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.prepareHostedInvitePhoneCode.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("column missing", {
        clientVersion: "test",
        code: "P2022",
        meta: {
          column: "signup_phone_code_send_attempt_id",
          modelName: "HostedMemberIdentity",
          secretValue: "should-not-log",
        },
      }),
    );

    const response = await sendCodeRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/send-code", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
      {
        params: Promise.resolve({
          inviteCode: "invite-code",
        }),
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    expect(errorSpy).toHaveBeenCalledWith("Hosted onboarding route failed.", {
      errorCode: "P2022",
      errorMessage: "column missing",
      errorResponseCode: "INTERNAL_ERROR",
      errorType: "PrismaClientKnownRequestError",
      internalMessage: "Hosted onboarding route failed unexpectedly.",
      prismaClientVersion: "test",
      prismaCode: "P2022",
      prismaMessage: "column missing",
      prismaMeta: {
        column: "signup_phone_code_send_attempt_id",
        modelName: "HostedMemberIdentity",
      },
      requestMethod: "POST",
    });
  });

  it("logs sanitized Prisma initialization diagnostics for unexpected invite send-code failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.prepareHostedInvitePhoneCode.mockRejectedValue(
      new Prisma.PrismaClientInitializationError(
        "connect failed for https://db.example.test from /Users/test/app while notifying user@example.com at +1 415 555 2671",
        "7.5.0",
        "P1001",
      ),
    );

    const response = await sendCodeRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/send-code", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
      {
        params: Promise.resolve({
          inviteCode: "invite-code",
        }),
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal error.",
      },
    });
    expect(errorSpy).toHaveBeenCalledWith("Hosted onboarding route failed.", {
      errorCode: "P1001",
      errorMessage:
        "connect failed for <redacted-url> from <redacted-path> while notifying <redacted-email> at <redacted-phone>",
      errorResponseCode: "INTERNAL_ERROR",
      errorType: "PrismaClientInitializationError",
      internalMessage: "Hosted onboarding route failed unexpectedly.",
      prismaClientVersion: "7.5.0",
      prismaCode: "P1001",
      prismaMessage:
        "connect failed for <redacted-url> from <redacted-path> while notifying <redacted-email> at <redacted-phone>",
      requestMethod: "POST",
    });
  });

  it("confirms invite send-code attempts through the same-origin no-store route", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/send-code/confirm", {
      body: JSON.stringify({
        sendAttemptId: "send_attempt_123",
      }),
      headers: {
        ...SAME_ORIGIN_HEADERS,
        "content-type": "application/json",
      },
      method: "POST",
    });

    const response = await confirmSendCodeRoute.POST(request, {
      params: Promise.resolve({
        inviteCode: "invite-code",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.confirmHostedInvitePhoneCode).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      sendAttemptId: "send_attempt_123",
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  it("aborts failed invite send-code attempts through the same-origin no-store route", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/send-code/abort", {
      body: JSON.stringify({
        sendAttemptId: "send_attempt_123",
      }),
      headers: {
        ...SAME_ORIGIN_HEADERS,
        "content-type": "application/json",
      },
      method: "POST",
    });

    const response = await abortSendCodeRoute.POST(request, {
      params: Promise.resolve({
        inviteCode: "invite-code",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.abortHostedInvitePhoneCode).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      sendAttemptId: "send_attempt_123",
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  it.each([
    ["missing", {}],
    ["blank", { sendAttemptId: "  " }],
    ["non-string", { sendAttemptId: 123 }],
  ])("rejects %s invite send-code abort attempt ids", async (_label, body) => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/invites/invite-code/send-code/abort", {
      body: JSON.stringify(body),
      headers: {
        ...SAME_ORIGIN_HEADERS,
        "content-type": "application/json",
      },
      method: "POST",
    });

    const response = await abortSendCodeRoute.POST(request, {
      params: Promise.resolve({
        inviteCode: "invite-code",
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.abortHostedInvitePhoneCode).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_INVITE_SEND_ATTEMPT_ID_REQUIRED",
        message: "A send attempt id is required to cancel this code.",
        retryable: false,
      },
    });
  });

  it("forwards invite and session state through the hosted billing checkout route", async () => {
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
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { prisma: true },
    });
    await expect(response.json()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
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
        walletAddress: "0x00000000000000000000000000000000000000aa",
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
      phoneAuthReady: true,
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
