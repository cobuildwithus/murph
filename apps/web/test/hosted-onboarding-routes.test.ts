import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  completeHostedPrivyVerification: vi.fn(),
  createHostedBillingCheckout: vi.fn(),
  requireHostedInviteCodeFromRequest: vi.fn(),
  requireHostedPrivyCompletionIdentityFromRequest: vi.fn(),
  requireHostedPrivyRequestAuthContext: vi.fn(),
  runtimeEnv: {
    privyAppId: "cm_app_123" as string | null,
    privyVerificationKey: "line-1\\nline-2" as string | null,
    telegramBotUsername: null as string | null,
    telegramWebhookSecret: null as string | null,
  },
  verifyIdentityToken: vi.fn(),
}));

vi.mock("@privy-io/node", () => ({
  verifyIdentityToken: mocks.verifyIdentityToken,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => mocks.runtimeEnv,
}));

vi.mock("@/src/lib/hosted-onboarding/member-service", () => ({
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-service", () => ({
  createHostedBillingCheckout: mocks.createHostedBillingCheckout,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireHostedPrivyRequestAuthContext: mocks.requireHostedPrivyRequestAuthContext,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  requireHostedPrivyCompletionIdentityFromRequest: mocks.requireHostedPrivyCompletionIdentityFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/route-helpers", () => ({
  requireHostedInviteCodeFromRequest: mocks.requireHostedInviteCodeFromRequest,
}));

type BillingCheckoutRouteModule = typeof import("../app/api/hosted-onboarding/billing/checkout/route");
type HostedOnboardingHttpModule = typeof import("../src/lib/hosted-onboarding/http");
type PrivyCompleteRouteModule = typeof import("../app/api/hosted-onboarding/privy/complete/route");

let billingCheckoutRoute: BillingCheckoutRouteModule;
let hostedOnboardingHttp: HostedOnboardingHttpModule;
let privyCompleteRoute: PrivyCompleteRouteModule;

const SAME_ORIGIN_HEADERS = {
  origin: "https://join.example.test",
};

describe("hosted onboarding routes", () => {
  beforeAll(async () => {
    billingCheckoutRoute = await import("../app/api/hosted-onboarding/billing/checkout/route");
    hostedOnboardingHttp = await import("../src/lib/hosted-onboarding/http");
    privyCompleteRoute = await import("../app/api/hosted-onboarding/privy/complete/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runtimeEnv.privyAppId = "cm_app_123";
    mocks.runtimeEnv.privyVerificationKey = "line-1\\nline-2";
    mocks.requireHostedPrivyCompletionIdentityFromRequest.mockResolvedValue({
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
    });
    mocks.completeHostedPrivyVerification.mockResolvedValue({
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      stage: "checkout",
    });
    mocks.createHostedBillingCheckout.mockResolvedValue({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
    mocks.requireHostedPrivyRequestAuthContext.mockResolvedValue({
      linkedAccounts: [
        {
          address: "user@example.com",
          type: "email",
        },
      ],
      member: { id: "member_123" },
    });
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValue({
      body: {
        inviteCode: "invite-code",
      },
      inviteCode: "invite-code",
    });
  });

  it("marks Privy verification responses as no-store", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          inviteCode: "invite-code",
        }),
        headers: {
          "x-privy-identity-token": "header-token",
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
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
    });
    await expect(response.json()).resolves.toEqual({
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      ok: true,
      stage: "checkout",
    });
  });

  it("accepts a valid Privy identity cookie even when the request body is empty", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        headers: {
          "x-privy-identity-token": "header-token",
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
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
    });
  });

  it("ignores any body identity token and keeps the cookie authoritative", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          identityToken: "body-token",
          inviteCode: "invite-code",
        }),
        headers: {
          "x-privy-identity-token": "header-token",
          origin: SAME_ORIGIN_HEADERS.origin,
          "user-agent": "test-agent",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
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
    });
  });

  it("rejects hosted Privy completion requests that are missing the Privy identity cookie", async () => {
    mocks.requireHostedPrivyCompletionIdentityFromRequest.mockRejectedValue(
      hostedOnboardingError({
        code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
        httpStatus: 401,
        message: "A Privy identity token is required to continue. Refresh and verify your phone again.",
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
        code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
        message: "A Privy identity token is required to continue. Refresh and verify your phone again.",
        retryable: false,
      },
    });
  });

  it("checks the Privy identity cookie before parsing malformed request JSON", async () => {
    mocks.requireHostedPrivyCompletionIdentityFromRequest.mockRejectedValue(
      hostedOnboardingError({
        code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
        httpStatus: 401,
        message: "A Privy identity token is required to continue. Refresh and verify your phone again.",
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
    expect(mocks.requireHostedPrivyCompletionIdentityFromRequest).toHaveBeenCalledTimes(1);
    expect(mocks.completeHostedPrivyVerification).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
        message: "A Privy identity token is required to continue. Refresh and verify your phone again.",
        retryable: false,
      },
    });
  });

  it("does not accept a body identity token when the Privy identity cookie is missing", async () => {
    mocks.requireHostedPrivyCompletionIdentityFromRequest.mockRejectedValue(
      hostedOnboardingError({
        code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
        httpStatus: 401,
        message: "A Privy identity token is required to continue. Refresh and verify your phone again.",
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
        code: "PRIVY_IDENTITY_TOKEN_REQUIRED",
        message: "A Privy identity token is required to continue. Refresh and verify your phone again.",
        retryable: false,
      },
    });
  });

  it("serializes retryable server-side Privy lag errors during completion", async () => {
    mocks.requireHostedPrivyCompletionIdentityFromRequest.mockRejectedValue(
      hostedOnboardingError({
        code: "PRIVY_WALLET_NOT_READY",
        httpStatus: 409,
        message: "Your setup has not reached the server-side Privy session yet. Wait a moment and try again.",
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
        code: "PRIVY_WALLET_NOT_READY",
        message: "Your setup has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
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
      headers: SAME_ORIGIN_HEADERS,
      method: "POST",
    });

    const response = await billingCheckoutRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedPrivyRequestAuthContext).toHaveBeenCalledWith(request);
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      linkedAccounts: [
        {
          address: "user@example.com",
          type: "email",
        },
      ],
      member: { id: "member_123" },
    });
    await expect(response.json()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
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
    expect(mocks.requireHostedPrivyRequestAuthContext).toHaveBeenCalledWith(request);
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      linkedAccounts: [
        {
          address: "user@example.com",
          type: "email",
        },
      ],
      member: { id: "member_123" },
    });
    await expect(response.json()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
  });

  it("forwards share state through the hosted billing checkout route when present", async () => {
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValue({
      body: {
        inviteCode: "invite-code",
        shareCode: "share_123",
      },
      inviteCode: "invite-code",
    });
    const request = new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
      body: JSON.stringify({
        inviteCode: "invite-code",
        shareCode: "share_123",
      }),
      headers: SAME_ORIGIN_HEADERS,
      method: "POST",
    });

    const response = await billingCheckoutRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireHostedPrivyRequestAuthContext).toHaveBeenCalledWith(request);
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      linkedAccounts: [
        {
          address: "user@example.com",
          type: "email",
        },
      ],
      member: { id: "member_123" },
      shareCode: "share_123",
    });
    await expect(response.json()).resolves.toEqual({
      alreadyActive: false,
      url: "https://billing.example.test/session_123",
    });
  });

  it("uses the real Privy header verifier at the route boundary and ignores any body token", async () => {
    mocks.verifyIdentityToken.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          latest_verified_at: 1741194420,
          phone_number: "+1 415 555 2671",
          type: "phone",
        },
        {
          address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chain_type: "ethereum",
          connector_type: "embedded",
          delegated: false,
          id: "wallet_123",
          imported: false,
          type: "wallet",
          wallet_client: "privy",
          wallet_client_type: "privy",
          wallet_index: 0,
        },
      ],
    });
    vi.resetModules();
    vi.doUnmock("@/src/lib/hosted-onboarding/privy");

    try {
      const { POST } = await import("../app/api/hosted-onboarding/privy/complete/route");
      const response = await POST(
        new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
          body: JSON.stringify({
            identityToken: "body-token",
            inviteCode: "invite-code",
          }),
          headers: {
            "x-privy-identity-token": "header-token",
            origin: SAME_ORIGIN_HEADERS.origin,
            "user-agent": "test-agent",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(mocks.verifyIdentityToken).toHaveBeenCalledWith({
        app_id: "cm_app_123",
        identity_token: "header-token",
        verification_key: "line-1\nline-2",
      });
      expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
        identity: expect.objectContaining({
          phone: {
            number: "+14155552671",
            verifiedAt: 1741194420,
          },
          userId: "did:privy:user_123",
          wallet: {
            address: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            chainType: "ethereum",
            id: "wallet_123",
            type: "wallet",
          },
        }),
        inviteCode: "invite-code",
      });
    } finally {
      vi.doMock("@/src/lib/hosted-onboarding/privy", () => ({
        requireHostedPrivyCompletionIdentityFromRequest: mocks.requireHostedPrivyCompletionIdentityFromRequest,
      }));
      vi.resetModules();
    }
  });
});
