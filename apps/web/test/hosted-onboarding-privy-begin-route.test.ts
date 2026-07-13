import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildHostedPrivyAuthIntentCookie: vi.fn(),
  issueHostedPrivyAuthIntent: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-auth-intent", () => ({
  buildHostedPrivyAuthIntentCookie: mocks.buildHostedPrivyAuthIntentCookie,
  issueHostedPrivyAuthIntent: mocks.issueHostedPrivyAuthIntent,
}));

type PrivyBeginRouteModule = typeof import("../app/api/hosted-onboarding/privy/begin/route");

let privyBeginRoute: PrivyBeginRouteModule;

describe("hosted onboarding Privy authentication begin route", () => {
  beforeAll(async () => {
    privyBeginRoute = await import("../app/api/hosted-onboarding/privy/begin/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.issueHostedPrivyAuthIntent.mockReturnValue("signed-auth-intent");
    mocks.buildHostedPrivyAuthIntentCookie.mockReturnValue(
      "murph-privy-auth-intent=signed-auth-intent; Path=/; Max-Age=600; HttpOnly; SameSite=Strict",
    );
  });

  it.each(["email", "phone", "telegram"] as const)(
    "issues a server-signed %s authentication intent cookie",
    async (method) => {
      const response = await privyBeginRoute.POST(createBeginRequest({
        inviteCode: "invite_123",
        method,
      }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(mocks.issueHostedPrivyAuthIntent).toHaveBeenCalledWith({
        inviteCode: "invite_123",
        method,
      });
      expect(mocks.buildHostedPrivyAuthIntentCookie).toHaveBeenCalledWith(
        "signed-auth-intent",
      );
      expect(response.headers.get("Set-Cookie")).toBe(
        "murph-privy-auth-intent=signed-auth-intent; Path=/; Max-Age=600; HttpOnly; SameSite=Strict",
      );
      expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
        expect.any(Request),
      );
    },
  );

  it("binds a direct sign-in intent to a null invite code", async () => {
    const response = await privyBeginRoute.POST(createBeginRequest({
      method: "email",
    }));

    expect(response.status).toBe(200);
    expect(mocks.issueHostedPrivyAuthIntent).toHaveBeenCalledWith({
      inviteCode: null,
      method: "email",
    });
  });

  it("rejects an unsupported method without issuing a cookie", async () => {
    const response = await privyBeginRoute.POST(createBeginRequest({
      method: "wallet",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_AUTH_INTENT_INVALID",
      },
    });
    expect(mocks.issueHostedPrivyAuthIntent).not.toHaveBeenCalled();
    expect(mocks.buildHostedPrivyAuthIntentCookie).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request before issuing an authentication intent", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        httpStatus: 403,
        message: "Hosted browser mutation origin is not allowed.",
      });
    });

    const response = await privyBeginRoute.POST(createBeginRequest({
      method: "email",
    }, "https://untrusted.example.test"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
      },
    });
    expect(mocks.issueHostedPrivyAuthIntent).not.toHaveBeenCalled();
    expect(mocks.buildHostedPrivyAuthIntentCookie).not.toHaveBeenCalled();
  });
});

function createBeginRequest(input: {
  inviteCode?: string;
  method: string;
}, origin = "https://join.example.test"): Request {
  return new Request("https://join.example.test/api/hosted-onboarding/privy/begin", {
    body: JSON.stringify(input),
    headers: {
      origin,
    },
    method: "POST",
  });
}
