import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  applyHostedSessionCookie: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  createHostedBillingCheckout: vi.fn(),
  clearHostedSessionCookie: vi.fn(),
  requireHostedSessionFromRequest: vi.fn(),
  revokeHostedSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/service", () => ({
  attachHostedSessionCookie: mocks.applyHostedSessionCookie,
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
  createHostedBillingCheckout: mocks.createHostedBillingCheckout,
}));

vi.mock("@/src/lib/hosted-onboarding/session", () => ({
  clearHostedSessionCookie: mocks.clearHostedSessionCookie,
  requireHostedSessionFromRequest: mocks.requireHostedSessionFromRequest,
  revokeHostedSessionFromRequest: mocks.revokeHostedSessionFromRequest,
}));

type BillingCheckoutRouteModule = typeof import("../app/api/hosted-onboarding/billing/checkout/route");
type HostedOnboardingHttpModule = typeof import("../src/lib/hosted-onboarding/http");
type LogoutRouteModule = typeof import("../app/api/hosted-onboarding/session/logout/route");
type PrivyCompleteRouteModule = typeof import("../app/api/hosted-onboarding/privy/complete/route");

let billingCheckoutRoute: BillingCheckoutRouteModule;
let hostedOnboardingHttp: HostedOnboardingHttpModule;
let logoutRoute: LogoutRouteModule;
let privyCompleteRoute: PrivyCompleteRouteModule;

describe("hosted onboarding routes", () => {
  beforeAll(async () => {
    billingCheckoutRoute = await import("../app/api/hosted-onboarding/billing/checkout/route");
    hostedOnboardingHttp = await import("../src/lib/hosted-onboarding/http");
    logoutRoute = await import("../app/api/hosted-onboarding/session/logout/route");
    privyCompleteRoute = await import("../app/api/hosted-onboarding/privy/complete/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeHostedPrivyVerification.mockResolvedValue({
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      stage: "checkout",
      token: "session-token",
    });
    mocks.createHostedBillingCheckout.mockResolvedValue({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    mocks.requireHostedSessionFromRequest.mockResolvedValue({
      member: { id: "member_123" },
      session: { id: "session_123" },
    });
    mocks.revokeHostedSessionFromRequest.mockResolvedValue(true);
  });

  it("marks Privy verification responses as no-store and still attaches the session cookie", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          identityToken: "identity-token",
          inviteCode: "invite-code",
        }),
        headers: {
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      identityToken: "identity-token",
      inviteCode: "invite-code",
      userAgent: "test-agent",
    });
    expect(mocks.applyHostedSessionCookie).toHaveBeenCalledWith({
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      response: expect.anything(),
      token: "session-token",
    });
    await expect(response.json()).resolves.toEqual({
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      ok: true,
      stage: "checkout",
    });
  });

  it("keeps no-store headers when hosted onboarding errors are serialized", async () => {
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

  it("forwards invite and session state through the hosted billing checkout route", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
      body: JSON.stringify({
        inviteCode: "invite-code",
      }),
      method: "POST",
    });

    const response = await billingCheckoutRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      sessionRecord: {
        member: { id: "member_123" },
        session: { id: "session_123" },
      },
    });
    await expect(response.json()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
  });

  it("forwards share state through the hosted billing checkout route when present", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
      body: JSON.stringify({
        inviteCode: "invite-code",
        shareCode: "share_123",
      }),
      method: "POST",
    });

    const response = await billingCheckoutRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      shareCode: "share_123",
      sessionRecord: {
        member: { id: "member_123" },
        session: { id: "session_123" },
      },
    });
    await expect(response.json()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
  });

  it("revokes the current hosted session record on logout before clearing the cookie", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/session/logout", {
      headers: {
        cookie: "hb_hosted_session=session-token",
      },
      method: "POST",
    });

    const response = await logoutRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.revokeHostedSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.clearHostedSessionCookie).toHaveBeenCalledWith(response);
  });
});
