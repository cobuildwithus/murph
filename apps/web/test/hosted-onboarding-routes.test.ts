import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  applyHostedSessionCookie: vi.fn(),
  beginHostedPasskeyAuthentication: vi.fn(),
  beginHostedPasskeyRegistration: vi.fn(),
  createHostedBillingCheckout: vi.fn(),
  clearHostedSessionCookie: vi.fn(),
  finishHostedPasskeyAuthentication: vi.fn(),
  finishHostedPasskeyRegistration: vi.fn(),
  requireHostedSessionFromRequest: vi.fn(),
  revokeHostedSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/service", () => ({
  attachHostedSessionCookie: mocks.applyHostedSessionCookie,
  beginHostedPasskeyAuthentication: mocks.beginHostedPasskeyAuthentication,
  beginHostedPasskeyRegistration: mocks.beginHostedPasskeyRegistration,
  createHostedBillingCheckout: mocks.createHostedBillingCheckout,
  finishHostedPasskeyAuthentication: mocks.finishHostedPasskeyAuthentication,
  finishHostedPasskeyRegistration: mocks.finishHostedPasskeyRegistration,
}));

vi.mock("@/src/lib/hosted-onboarding/session", () => ({
  clearHostedSessionCookie: mocks.clearHostedSessionCookie,
  requireHostedSessionFromRequest: mocks.requireHostedSessionFromRequest,
  revokeHostedSessionFromRequest: mocks.revokeHostedSessionFromRequest,
}));

type BillingCheckoutRouteModule = typeof import("../app/api/hosted-onboarding/billing/checkout/route");
type RegisterOptionsRouteModule = typeof import("../app/api/hosted-onboarding/passkeys/register/options/route");
type RegisterVerifyRouteModule = typeof import("../app/api/hosted-onboarding/passkeys/register/verify/route");
type AuthenticateVerifyRouteModule = typeof import("../app/api/hosted-onboarding/passkeys/authenticate/verify/route");
type LogoutRouteModule = typeof import("../app/api/hosted-onboarding/session/logout/route");
type HostedOnboardingHttpModule = typeof import("../src/lib/hosted-onboarding/http");

let authenticateVerifyRoute: AuthenticateVerifyRouteModule;
let billingCheckoutRoute: BillingCheckoutRouteModule;
let hostedOnboardingHttp: HostedOnboardingHttpModule;
let logoutRoute: LogoutRouteModule;
let registerOptionsRoute: RegisterOptionsRouteModule;
let registerVerifyRoute: RegisterVerifyRouteModule;

describe("hosted onboarding passkey routes", () => {
  beforeAll(async () => {
    authenticateVerifyRoute = await import("../app/api/hosted-onboarding/passkeys/authenticate/verify/route");
    billingCheckoutRoute = await import("../app/api/hosted-onboarding/billing/checkout/route");
    hostedOnboardingHttp = await import("../src/lib/hosted-onboarding/http");
    logoutRoute = await import("../app/api/hosted-onboarding/session/logout/route");
    registerOptionsRoute = await import("../app/api/hosted-onboarding/passkeys/register/options/route");
    registerVerifyRoute = await import("../app/api/hosted-onboarding/passkeys/register/verify/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.beginHostedPasskeyRegistration.mockResolvedValue({
      options: {
        publicKey: {
          challenge: "0xabcdef",
        },
      },
    });
    mocks.createHostedBillingCheckout.mockResolvedValue({
      checkoutUrl: "https://billing.example.test/session_123",
    });
    mocks.finishHostedPasskeyAuthentication.mockResolvedValue({
      expiresAt: new Date("2026-03-28T12:00:00.000Z"),
      stage: "checkout",
      token: "auth-session-token",
    });
    mocks.finishHostedPasskeyRegistration.mockResolvedValue({
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      stage: "checkout",
      token: "session-token",
    });
    mocks.requireHostedSessionFromRequest.mockResolvedValue({
      member: { id: "member_123" },
      session: { id: "session_123" },
    });
    mocks.revokeHostedSessionFromRequest.mockResolvedValue(true);
  });

  it("marks registration option responses as no-store", async () => {
    const response = await registerOptionsRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/passkeys/register/options", {
        body: JSON.stringify({ inviteCode: "invite-code" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
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
        new Request("https://join.example.test/api/hosted-onboarding/passkeys/register/options", {
          body: JSON.stringify(["not", "an", "object"]),
          method: "POST",
        }),
      ),
    ).rejects.toThrow("Request body must be a JSON object.");
  });

  it("marks registration verify responses as no-store and still attaches the session cookie", async () => {
    const response = await registerVerifyRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/passkeys/register/verify", {
        body: JSON.stringify({
          inviteCode: "invite-code",
          response: {
            id: "cred-1",
          },
        }),
        headers: {
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.applyHostedSessionCookie).toHaveBeenCalledWith({
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      response: expect.anything(),
      token: "session-token",
    });
  });

  it("marks authentication verify responses as no-store and still attaches the session cookie", async () => {
    const response = await authenticateVerifyRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/passkeys/authenticate/verify", {
        body: JSON.stringify({
          inviteCode: "invite-code",
          response: {
            id: "cred-1",
          },
        }),
        headers: {
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.applyHostedSessionCookie).toHaveBeenCalledWith({
      expiresAt: new Date("2026-03-28T12:00:00.000Z"),
      response: expect.anything(),
      token: "auth-session-token",
    });
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
      checkoutUrl: "https://billing.example.test/session_123",
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
      checkoutUrl: "https://billing.example.test/session_123",
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
