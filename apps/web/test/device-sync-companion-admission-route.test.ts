import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedCompanionMemberIdFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService:
    mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/hosted-onboarding/companion-member-access", () => ({
  requireHostedCompanionMemberIdFromRequest:
    mocks.requireHostedCompanionMemberIdFromRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type RouteModule = typeof import(
  "../app/api/device-sync/companion/admission/route"
);

let route: RouteModule;

function request(
  body?: unknown,
  headers: HeadersInit = {},
): Request {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("authorization", "Bearer privy-identity-token");

  if (body === undefined) {
    return new Request(
      "https://app.example.test/api/device-sync/companion/admission",
      {
        headers: requestHeaders,
        method: "POST",
      },
    );
  }

  requestHeaders.set("content-type", "application/json");
  return new Request(
    "https://app.example.test/api/device-sync/companion/admission",
    {
      body: JSON.stringify(body),
      headers: requestHeaders,
      method: "POST",
    },
  );
}

describe("POST /api/device-sync/companion/admission", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/device-sync/companion/admission/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({ label: "test-prisma" });
    mocks.requireHostedCompanionMemberIdFromRequest.mockResolvedValue(
      "member_native",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses canonical welcome defaults and returns the exact non-identifying v1 response without device ingress", async () => {
    const incoming = request({ timeZone: "America/Denver" });
    const response = await route.POST(incoming);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.requireHostedCompanionMemberIdFromRequest).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
      request: incoming,
      timeZone: "America/Denver",
    });
    expect(
      mocks.requireHostedCompanionMemberIdFromRequest.mock.calls[0]?.[0],
    ).not.toHaveProperty("suppressSignupWelcome");
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("prefers the validated device time zone over a conflicting hosting hint", async () => {
    const incoming = request(
      { timeZone: "America/Denver" },
      { "x-vercel-ip-timezone": "America/New_York" },
    );
    const response = await route.POST(incoming);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCompanionMemberIdFromRequest).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
      request: incoming,
      timeZone: "America/Denver",
    });
  });

  it("uses the trusted hosting time-zone hint when the optional field is absent", async () => {
    const incoming = request(undefined, {
      "x-vercel-ip-timezone": "America/New_York",
    });
    const response = await route.POST(incoming);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCompanionMemberIdFromRequest).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
      request: incoming,
      timeZone: "America/New_York",
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("validates the complete closed body before any member mutation", async () => {
    const response = await route.POST(request({
      connectionIntent: "connect",
      platform: "android",
      timeZone: "America/Denver",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "COMPANION_REQUEST_INVALID" },
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.requireHostedCompanionMemberIdFromRequest).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it.each([
    ["non-string", 17],
    ["non-IANA", "local"],
  ])("rejects %s time zones before admission", async (_label, timeZone) => {
    const response = await route.POST(request({ timeZone }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "COMPANION_REQUEST_INVALID" },
    });
    expect(mocks.requireHostedCompanionMemberIdFromRequest).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("bounds the admission request before parsing or member mutation", async () => {
    const response = await route.POST(request({
      timeZone: "A".repeat(300),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_BODY_TOO_LARGE" },
    });
    expect(mocks.requireHostedCompanionMemberIdFromRequest).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      status: 401,
    },
    {
      code: "HOSTED_CONSENT_REQUIRED",
      message: "Accept the Murph legal consent before continuing.",
      status: 403,
    },
    {
      code: "HOSTED_ACCESS_REQUIRED",
      message: "Active hosted access is required to continue.",
      status: 403,
    },
    {
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This account is suspended.",
      status: 403,
    },
    {
      code: "PRIVY_USER_MISMATCH",
      message: "Use the existing account to continue.",
      status: 409,
    },
  ])("returns $code without crossing into device sync", async ({ code, message, status }) => {
    mocks.requireHostedCompanionMemberIdFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code,
        httpStatus: status,
        message,
      }),
    );

    const response = await route.POST(request({ timeZone: null }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code },
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it.each([
    "PRIVY_ACCOUNT_REQUIRED",
    "PRIVY_AUTH_FAILED",
  ])("maps %s to the public login recovery", async (code) => {
    mocks.requireHostedCompanionMemberIdFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code,
        httpStatus: 401,
        message: "Request a fresh code and try again.",
      }),
    );

    const response = await route.POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in to continue.",
      },
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it.each([
    "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED",
  ])("maps %s to the public access recovery", async (code) => {
    mocks.requireHostedCompanionMemberIdFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code,
        httpStatus: 409,
        message: "Starter usage enrollment is not directly actionable here.",
      }),
    );

    const response = await route.POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_ACCESS_REQUIRED",
        message: "Active hosted access is required to continue.",
      },
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("preserves account conflicts for alternate-sign-in recovery", async () => {
    mocks.requireHostedCompanionMemberIdFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "PRIVY_IDENTITY_CONFLICT",
        httpStatus: 409,
        message: "Use the existing typed recovery.",
      }),
    );

    const response = await route.POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PRIVY_IDENTITY_CONFLICT",
        retryable: false,
      },
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("collapses retryable owner failures to one stable retry recovery", async () => {
    mocks.requireHostedCompanionMemberIdFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_AUTO_PULSE_TRIAL_STRIPE_UNAVAILABLE",
        httpStatus: 503,
        message: "Stripe is temporarily unavailable.",
        retryable: true,
      }),
    );

    const response = await route.POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "COMPANION_ADMISSION_RETRYABLE",
        retryable: true,
      },
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("collapses every remaining terminal owner failure to support recovery", async () => {
    mocks.requireHostedCompanionMemberIdFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
        httpStatus: 409,
        message: "Internal routing setup is incomplete.",
      }),
    );

    const response = await route.POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "COMPANION_ADMISSION_SUPPORT_REQUIRED",
        retryable: false,
      },
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("leaves unexpected non-domain failures on the common internal-error path", async () => {
    mocks.requireHostedCompanionMemberIdFromRequest.mockRejectedValueOnce(
      new Error("unexpected owner failure"),
    );

    const response = await route.POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
      },
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });
});
