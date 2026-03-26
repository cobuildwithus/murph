import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyHostedSessionCookie: vi.fn(),
  beginHostedPasskeyRegistration: vi.fn(),
  clearHostedSessionCookie: vi.fn(),
  finishHostedPasskeyRegistration: vi.fn(),
  revokeHostedSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/service", () => ({
  attachHostedSessionCookie: mocks.applyHostedSessionCookie,
  beginHostedPasskeyRegistration: mocks.beginHostedPasskeyRegistration,
  finishHostedPasskeyRegistration: mocks.finishHostedPasskeyRegistration,
}));

vi.mock("@/src/lib/hosted-onboarding/session", () => ({
  clearHostedSessionCookie: mocks.clearHostedSessionCookie,
  revokeHostedSessionFromRequest: mocks.revokeHostedSessionFromRequest,
}));

type RegisterOptionsRouteModule = typeof import("../app/api/hosted-onboarding/passkeys/register/options/route");
type RegisterVerifyRouteModule = typeof import("../app/api/hosted-onboarding/passkeys/register/verify/route");
type LogoutRouteModule = typeof import("../app/api/hosted-onboarding/session/logout/route");

let logoutRoute: LogoutRouteModule;
let registerOptionsRoute: RegisterOptionsRouteModule;
let registerVerifyRoute: RegisterVerifyRouteModule;

describe("hosted onboarding passkey routes", () => {
  beforeAll(async () => {
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
    mocks.finishHostedPasskeyRegistration.mockResolvedValue({
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      stage: "checkout",
      token: "session-token",
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
