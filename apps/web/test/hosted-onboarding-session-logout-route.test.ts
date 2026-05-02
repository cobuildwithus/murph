import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  revokeHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  revokeHostedAppSessionFromRequest: mocks.revokeHostedAppSessionFromRequest,
}));

type LogoutRouteModule = typeof import("../app/api/hosted-onboarding/session/logout/route");

let logoutRoute: LogoutRouteModule;

describe("hosted onboarding session logout route", () => {
  beforeAll(async () => {
    logoutRoute = await import("../app/api/hosted-onboarding/session/logout/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.revokeHostedAppSessionFromRequest.mockResolvedValue(
      "murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("revokes the hosted app session and clears the cookie on logout", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/session/logout", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const response = await logoutRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBe(
      "murph-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.revokeHostedAppSessionFromRequest).toHaveBeenCalledWith({
      reason: "logout",
      request,
    });
  });
});
