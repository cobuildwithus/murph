import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { createBearerRequest, createJsonPostRequest } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const SIGN_IN_TOKEN = "junction-sdk-sign-in-token-do-not-log";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  createSdkSignInSession: vi.fn(),
  getPrisma: vi.fn(),
  listConnectionSources: vi.fn(),
  listConnectionsForUser: vi.fn(),
  listRecentConnectionWebhookSignals: vi.fn(),
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
  prismaClient: {
    hostedMember: {
      findUnique: vi.fn(),
    },
    label: "test-prisma",
  },
  readHostedMemberCoreState: vi.fn(),
  runtimeEnv: {
    privyAppId: "cm_app_123" as string | null,
    privyAppSecret: null as string | null,
    privyVerificationKey: "verification-key" as string | null,
    telegramBotUsername: null as string | null,
    telegramWebhookSecret: null as string | null,
  },
  verifyIdentityToken: vi.fn(),
}));

vi.mock("@privy-io/node", () => ({
  PrivyClient: vi.fn(),
  verifyIdentityToken: mocks.verifyIdentityToken,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => mocks.runtimeEnv,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  lookupHostedMemberForPrivyPrincipal: mocks.lookupHostedMemberForPrivyPrincipal,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type SignInTokenRouteModule = typeof import("../app/api/device-sync/companion/sign-in-token/route");
type StatusRouteModule = typeof import("../app/api/device-sync/companion/status/route");
type AuthDiagnosticsRouteModule =
  typeof import("../app/api/device-sync/companion/auth-diagnostics/route");

let signInTokenRoute: SignInTokenRouteModule;
let statusRoute: StatusRouteModule;
let authDiagnosticsRoute: AuthDiagnosticsRouteModule;

const ACTIVE_MEMBER = {
  billingStatus: "active",
  id: "member_1",
  suspendedAt: null,
};

function mockVerifiedPrivyUser(): void {
  mocks.verifyIdentityToken.mockResolvedValue({
    custom_metadata: {
      murph_member_id: ACTIVE_MEMBER.id,
    },
    id: "did:privy:user_123",
    linked_accounts: [
      {
        latest_verified_at: 1741194420,
        phoneNumber: "+1 415 555 2671",
        type: "phone",
      },
    ],
  });
  mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue({
    core: ACTIVE_MEMBER,
  });
  mocks.readHostedMemberCoreState.mockResolvedValue(ACTIVE_MEMBER);
  mocks.prismaClient.hostedMember.findUnique.mockResolvedValue({
    accountGroupMemberships: [],
    billingStatus: ACTIVE_MEMBER.billingStatus,
    suspendedAt: ACTIVE_MEMBER.suspendedAt,
    threadContainer: null,
  });
}

function signInTokenRequest(body?: unknown, bearerToken: string | null = "privy-identity-token") {
  const url = "https://app.example.test/api/device-sync/companion/sign-in-token";
  const init = bearerToken === null
    ? {}
    : { headers: { authorization: `Bearer ${bearerToken}` } };

  return body === undefined
    ? new Request(url, { ...init, method: "POST" })
    : createJsonPostRequest(url, body, init);
}

function statusRequest(bearerToken: string | null = "privy-identity-token") {
  const url = "https://app.example.test/api/device-sync/companion/status";
  return bearerToken === null
    ? new Request(url)
    : createBearerRequest(url, bearerToken);
}

function authDiagnosticsRequest(
  body: unknown,
  init: Omit<RequestInit, "body" | "method"> = {},
) {
  return createJsonPostRequest(
    "https://app.example.test/api/device-sync/companion/auth-diagnostics",
    body,
    init,
  );
}

describe("device sync companion routes", () => {
  beforeAll(async () => {
    signInTokenRoute = await import("../app/api/device-sync/companion/sign-in-token/route");
    statusRoute = await import("../app/api/device-sync/companion/status/route");
    authDiagnosticsRoute = await import("../app/api/device-sync/companion/auth-diagnostics/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.createSdkSignInSession.mockResolvedValue({
      account: {
        externalAccountId: "junction-user-1",
        id: "dsc_1",
        provider: "junction",
        status: "active",
      },
      environment: "sandbox",
      signInToken: SIGN_IN_TOKEN,
    });
    mocks.listConnectionsForUser.mockResolvedValue([]);
    mocks.listConnectionSources.mockResolvedValue([]);
    mocks.listRecentConnectionWebhookSignals.mockResolvedValue([]);
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      store: {
        listConnectionSources: mocks.listConnectionSources,
        listConnectionsForUser: mocks.listConnectionsForUser,
        listRecentConnectionWebhookSignals: mocks.listRecentConnectionWebhookSignals,
      },
    });
    mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
      createSdkSignInSession: mocks.createSdkSignInSession,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/device-sync/companion/auth-diagnostics", () => {
    const initialNow = Date.now();
    const throttleWindowStepMs = 61_000;
    const testClock = { current: initialNow };

    beforeEach(() => {
      testClock.current += throttleWindowStepMs;
      vi.spyOn(Date, "now").mockReturnValue(testClock.current);
    });

    it("records sanitized pre-login Privy auth diagnostics", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        appVersion: "1.0.0",
        errorKind: "rate_limited",
        httpStatus: 429,
        method: "email",
        providerErrorCode: "too_many_requests",
        providerMessage:
          "Privy failed for person@example.test (415) 555-2671 backup 4155552671 phone_4155552671 international +44 7911 123456 compact +447911123456 code 12345 invalid_code_123456 otp_654321 code123456 token=secret-token raw AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA https://auth.example.test/path auth.privy.io/path 192.0.2.55 ip_192.0.2.55 2001:db8::1 ip_2001:db8::1 host_auth.example.com",
        stage: "send_code",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.10" } }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith("Companion auth diagnostic.", {
        appVersion: "1.0.0",
        errorKind: "rate_limited",
        httpStatus: 429,
        method: "email",
        platform: "ios",
        provider: "privy",
        providerErrorCode: "too_many_requests",
        redactedProviderMessage:
          "Privy failed for <redacted-email> <redacted-phone> backup <redacted-phone> phone_<redacted-phone> international <redacted-phone> compact <redacted-phone> code <redacted-code> invalid_code_<redacted-code> otp_<redacted-code> code<redacted-code> token=<redacted-secret> raw <redacted-secret> <redacted-url> <redacted-url> <redacted-ip> ip_<redacted-ip> <redacted-ip> ip_<redacted-ip> host_<redacted-url>",
        stage: "send_code",
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("person@example");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("555-2671");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("4155552671");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("phone_4155552671");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("+44 7911 123456");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("+447911123456");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("12345");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("invalid_code_123456");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("otp_654321");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("code123456");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret-token");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("auth.privy.io");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("192.0.2.55");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("ip_192.0.2.55");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("2001:db8::1");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("ip_2001:db8::1");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("host_auth.example.com");
    });

    it("redacts whole secrets before embedded numeric runs", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        errorKind: "provider",
        method: "email",
        providerMessage:
          "Bearer abcdefghijklmnop123456qrstuvwxyzabcdef raw abcdefghijklmnop123456qrstuvwxyzabcdef jwt abcdefghijklmnop.1234567890abcdef.qrstuvwxyzABCDEF host tenant123456.auth.example.com",
        stage: "send_code",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.16" } }));

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.objectContaining({
          redactedProviderMessage:
            "Bearer <redacted-secret> raw <redacted-secret> jwt <redacted-secret> host <redacted-url>",
        }),
      );
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("abcdefghijklmnop123456");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("1234567890abcdef");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("tenant123456.auth.example.com");
    });

    it("redacts base64 and base64url opaque secrets", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const secrets = [
        "abcdefghijklmnop+/123456qrstuvwxyzabcdef==",
        "/abcdefghijklmnop123456qrstuvwxyzabcdef==",
        "-abcdefghijklmnop123456qrstuvwxyzabcdef",
        "abcdefghijklmnop123456qrstuvwxyzabcdef-",
      ];

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        errorKind: "provider",
        method: "email",
        providerMessage: secrets.map((secret) => `raw ${secret}`).join(" "),
        stage: "send_code",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.17" } }));

      expect(response.status).toBe(200);
      const logged = JSON.stringify(warnSpy.mock.calls);
      for (const secret of secrets) {
        expect(logged).not.toContain(secret);
      }
    });

    it("conservatively redacts contact shapes", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        errorKind: "provider",
        method: "sms",
        providerMessage:
          "short +12345678 compact 12345678901 formatted 12 345 678 email a@b.c punctuated foo,@bar.com unicode t\u00E9st@ex\u00E4mple.c",
        stage: "send_code",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.18" } }));

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.objectContaining({
          redactedProviderMessage:
            "short <redacted-phone> compact <redacted-phone> formatted <redacted-phone> email <redacted-email> punctuated <redacted-email> unicode <redacted-email>",
        }),
      );
    });

    it("keeps the provider message useful while bounding logged text", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const providerMessage = `Privy service unavailable. ${"detail ".repeat(100)}`;

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        errorKind: "unavailable",
        method: "email",
        providerMessage,
        stage: "send_code",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.11" } }));

      expect(response.status).toBe(200);
      const diagnostic = warnSpy.mock.calls.find(([message]) => (
        message === "Companion auth diagnostic."
      ))?.[1] as { redactedProviderMessage?: string } | undefined;
      expect(diagnostic?.redactedProviderMessage).toHaveLength(500);
      expect(diagnostic?.redactedProviderMessage).toMatch(/^Privy service unavailable\./u);
    });

    it("rejects an oversize provider message without logging its contents", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        errorKind: "provider",
        method: "email",
        providerMessage: "A".repeat(1001),
        stage: "send_code",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.19" } }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("A".repeat(100));
    });

    it.each([
      ["OTP", "654321"],
      ["embedded OTP", "invalid_code_123456"],
      ["underscored OTP", "otp_654321"],
      ["letter-prefixed OTP", "code123456"],
      ["phone number", "4155552671"],
      ["prefixed phone number", "phone_4155552671"],
      ["prefixed IPv4 address", "ip_192.0.2.55"],
      ["prefixed IPv6 address", "ip_2001:db8::1"],
      ["prefixed host", "host_auth.example.com"],
      ["token", "A".repeat(32)],
    ])("drops a %s-shaped provider error code", async (_label, providerErrorCode) => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        errorKind: "provider",
        method: "email",
        providerErrorCode,
        stage: "send_code",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.13" } }));

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith("Companion auth diagnostic.", expect.objectContaining({
        providerErrorCode: null,
      }));
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(providerErrorCode);
    });

    it("redacts a phone number crossing the log boundary before truncation", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const providerMessage = `${"note ".repeat(99)}4155552671`;

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        errorKind: "provider",
        method: "sms",
        providerMessage,
        stage: "send_code",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.14" } }));

      expect(response.status).toBe(200);
      const diagnostic = warnSpy.mock.calls.find(([message]) => (
        message === "Companion auth diagnostic."
      ))?.[1] as { redactedProviderMessage?: string } | undefined;
      expect(diagnostic?.redactedProviderMessage).toHaveLength(500);
      expect(diagnostic?.redactedProviderMessage).toMatch(/ <reda$/u);
      expect(diagnostic?.redactedProviderMessage).not.toContain("41555");
    });

    it("drops an unsafe app version without losing the diagnostic", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        appVersion: "1.0 beta",
        errorKind: "provider",
        method: "email",
        stage: "send_code",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.15" } }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.objectContaining({ appVersion: null }),
      );
    });

    it("rejects diagnostic request bodies over eight kilobytes", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        padding: "x".repeat(9_000),
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.12" } }));

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "REQUEST_BODY_TOO_LARGE" },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("x".repeat(100));
    });

    it("uses the trusted Vercel client key when fallback headers rotate", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = {
        errorKind: "provider",
        method: "email",
        stage: "send_code",
      };

      for (let index = 0; index < 30; index += 1) {
        const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest(body, {
          headers: {
            "x-forwarded-for": `203.0.113.${index}`,
            "x-real-ip": `198.51.100.${index}`,
            "x-vercel-forwarded-for": "192.0.2.99",
          },
        }));
        expect(response.status).toBe(200);
      }

      const throttled = await authDiagnosticsRoute.POST(authDiagnosticsRequest(body, {
        headers: {
          "x-forwarded-for": "203.0.113.200",
          "x-real-ip": "198.51.100.200",
          "x-vercel-forwarded-for": "192.0.2.99",
        },
      }));

      expect(throttled.status).toBe(429);
      await expect(throttled.json()).resolves.toMatchObject({
        error: { code: "COMPANION_AUTH_DIAGNOSTIC_RATE_LIMITED" },
      });
      expect(warnSpy.mock.calls.filter(([message]) => (
        message === "Companion auth diagnostic."
      ))).toHaveLength(30);
    });

    it("rejects malformed diagnostics without logging request body fields", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        email: "person@example.test",
        errorKind: "provider",
        method: "email",
        stage: "send_magic_link",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.50" } }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("person@example");
    });

    it("rejects malformed JSON without logging parser body fragments", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const rawBody = "otp_654321 abcdefghijklmnop+/123456qrstuvwxyzabcdef==";
      const request = new Request(
        "https://app.example.test/api/device-sync/companion/auth-diagnostics",
        {
          body: rawBody,
          headers: {
            "content-type": "application/json",
            "x-vercel-forwarded-for": "203.0.113.52",
          },
          method: "POST",
        },
      );

      const response = await authDiagnosticsRoute.POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("otp_654321");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("abcdefghijklmnop+/123456");
    });

    it.each([
      "authorization",
      "email",
      "healthData",
      "memberId",
      "phone",
      "provider",
      "token",
    ])("rejects the unknown %s field without logging it", async (field) => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        errorKind: "provider",
        method: "email",
        stage: "send_code",
        [field]: "sensitive-value",
      }, { headers: { "x-vercel-forwarded-for": "203.0.113.51" } }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(warnSpy).not.toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.anything(),
      );
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("sensitive-value");
    });

    it("enforces the aggregate ceiling across rotating trusted Vercel keys", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = {
        errorKind: "provider",
        method: "email",
        stage: "send_code",
      };
      let throttled: Response | null = null;
      let accepted = 0;

      for (let index = 0; index < 310; index += 1) {
        const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest(body, {
          headers: {
            "x-forwarded-for": `198.51.100.${index % 255}`,
            "x-vercel-forwarded-for": `2001:db8:${index.toString(16)}::1`,
          },
        }));
        if (response.status === 429) {
          throttled = response;
          break;
        }
        accepted += 1;
      }

      expect(throttled).not.toBeNull();
      expect(accepted).toBe(300);
      await expect(throttled?.json()).resolves.toMatchObject({
        error: { code: "COMPANION_AUTH_DIAGNOSTIC_RATE_LIMITED" },
      });
    });
  });

  describe("POST /api/device-sync/companion/sign-in-token", () => {
    it("rejects requests without a bearer token", async () => {
      const response = await signInTokenRoute.POST(signInTokenRequest(undefined, null));

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "AUTH_REQUIRED" },
      });
      expect(mocks.verifyIdentityToken).not.toHaveBeenCalled();
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("never falls back to cookie auth when the bearer header is missing", async () => {
      mockVerifiedPrivyUser();
      const request = new Request(
        "https://app.example.test/api/device-sync/companion/sign-in-token",
        {
          headers: { cookie: "privy-id-token=cookie-identity-token" },
          method: "POST",
        },
      );

      const response = await signInTokenRoute.POST(request);

      expect(response.status).toBe(401);
      expect(mocks.verifyIdentityToken).not.toHaveBeenCalled();
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("rejects non-bearer authorization schemes", async () => {
      mockVerifiedPrivyUser();
      const request = new Request(
        "https://app.example.test/api/device-sync/companion/sign-in-token",
        {
          headers: { authorization: "Basic cHJpdnk6dG9rZW4=" },
          method: "POST",
        },
      );

      const response = await signInTokenRoute.POST(request);

      expect(response.status).toBe(401);
      expect(mocks.verifyIdentityToken).not.toHaveBeenCalled();
    });

    it("rejects members without active access", async () => {
      mockVerifiedPrivyUser();
      const suspendedMember = {
        ...ACTIVE_MEMBER,
        suspendedAt: new Date("2026-06-01T00:00:00.000Z"),
      };
      mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue({
        core: suspendedMember,
      });
      mocks.readHostedMemberCoreState.mockResolvedValue(suspendedMember);
      mocks.prismaClient.hostedMember.findUnique.mockResolvedValue({
        accountGroupMemberships: [],
        billingStatus: suspendedMember.billingStatus,
        suspendedAt: suspendedMember.suspendedAt,
        threadContainer: null,
      });

      const response = await signInTokenRoute.POST(signInTokenRequest({}));

      expect(response.status).toBe(403);
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("rejects malformed sdkVersions metadata", async () => {
      mockVerifiedPrivyUser();

      const arrayResponse = await signInTokenRoute.POST(
        signInTokenRequest({ sdkVersions: ["vital"] }),
      );
      expect(arrayResponse.status).toBe(400);

      const numericResponse = await signInTokenRoute.POST(
        signInTokenRequest({ sdkVersions: { vital: 188 } }),
      );
      expect(numericResponse.status).toBe(400);
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("rejects requests with an invalid bearer token", async () => {
      mocks.verifyIdentityToken.mockRejectedValue(new Error("invalid token"));

      const response = await signInTokenRoute.POST(signInTokenRequest({}));

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "PRIVY_AUTH_FAILED" },
      });
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("rejects members without launch consent", async () => {
      mockVerifiedPrivyUser();
      mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValue(hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the current Murph legal consent before continuing.",
      }));

      const response = await signInTokenRoute.POST(signInTokenRequest({}));

      expect(response.status).toBe(403);
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("rejects malformed installation metadata without reaching Junction", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest({ platform: 17 }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("rejects non-iOS companion platform metadata without reaching Junction", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest({ platform: "android" }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("rejects empty companion platform metadata without reaching Junction", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest({ platform: "" }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("returns exactly the sign-in token and environment for the resolved member", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest({
        appInstallationId: "install-1",
        appVersion: "1.0.0",
        platform: "ios",
        sdkVersions: { vital: "1.8.8" },
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        environment: "sandbox",
        signInToken: SIGN_IN_TOKEN,
      });
      expect(mocks.createSdkSignInSession).toHaveBeenCalledWith("member_1", "junction");
      expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
        memberId: "member_1",
        prisma: mocks.prismaClient,
      });
    });

    it("accepts an empty request body", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        environment: "sandbox",
        signInToken: SIGN_IN_TOKEN,
      });
    });

    it("never passes the sign-in token to any logger call", async () => {
      mockVerifiedPrivyUser();
      const consoleSpies = (["debug", "error", "info", "log", "warn"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );

      const response = await signInTokenRoute.POST(signInTokenRequest({ platform: "ios" }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        environment: "sandbox",
        signInToken: SIGN_IN_TOKEN,
      });

      for (const spy of consoleSpies) {
        for (const callArgs of spy.mock.calls) {
          expect(JSON.stringify(callArgs)).not.toContain(SIGN_IN_TOKEN);
        }
      }
    });

    it("keeps the sign-in token out of error logging when downstream calls fail after auth", async () => {
      mockVerifiedPrivyUser();
      const consoleSpies = (["debug", "error", "info", "log", "warn"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );
      mocks.createSdkSignInSession.mockRejectedValue(new Error(`upstream failed`));

      const response = await signInTokenRoute.POST(signInTokenRequest({}));
      expect(response.status).toBe(500);

      for (const spy of consoleSpies) {
        for (const callArgs of spy.mock.calls) {
          expect(JSON.stringify(callArgs)).not.toContain(SIGN_IN_TOKEN);
        }
      }
    });
  });

  describe("GET /api/device-sync/companion/status", () => {
    it("rejects requests without a bearer token", async () => {
      const response = await statusRoute.GET(statusRequest(null));

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "AUTH_REQUIRED" },
      });
    });

    it("rejects members without launch consent before reading store state", async () => {
      mockVerifiedPrivyUser();
      mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValue(hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the current Murph legal consent before continuing.",
      }));

      const response = await statusRoute.GET(statusRequest());

      expect(response.status).toBe(403);
      expect(mocks.listConnectionsForUser).not.toHaveBeenCalled();
    });

    it("returns empty evidence when the member has no junction connection", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([
        {
          id: "dsc_disconnected",
          lastWebhookAt: "2026-06-01T00:00:00.000Z",
          provider: "junction",
          status: "disconnected",
        },
        {
          id: "dsc_other_provider",
          lastWebhookAt: "2026-06-01T00:00:00.000Z",
          provider: "oura",
          status: "active",
        },
      ]);

      const response = await statusRoute.GET(statusRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        lastDataReceivedAt: null,
        resources: {},
      });
      expect(mocks.listRecentConnectionWebhookSignals).not.toHaveBeenCalled();
    });

    it("maps webhook receipts and source availability into per-resource evidence", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([
        {
          id: "dsc_1",
          lastWebhookAt: "2026-06-11T09:00:00.000Z",
          provider: "junction",
          status: "active",
        },
      ]);
      mocks.listConnectionSources.mockResolvedValue([
        {
          resourceAvailabilitySummary: {
            // Junction's raw alias for the heartrate resource: must merge with
            // the heart_rate webhook receipts below instead of splitting into
            // a second entry.
            heart_rate: true,
            respiratory_rate: false,
            sleep: true,
            sourceInstanceKeyFallback: true,
            workouts: true,
          },
          status: "connected",
        },
        {
          // Stale availability on a non-connected source must not advertise
          // waiting-for-data resources.
          resourceAvailabilitySummary: {
            steps: true,
          },
          status: "disconnected",
        },
      ]);
      mocks.listRecentConnectionWebhookSignals.mockResolvedValue([
        {
          createdAt: "2026-06-11T09:00:00.000Z",
          eventType: "provider.connection.created",
        },
        {
          createdAt: "2026-06-11T08:00:00.000Z",
          eventType: "daily.data.sleep.created",
        },
        {
          createdAt: "2026-06-11T07:00:00.000Z",
          eventType: "daily.data.sleep.created",
        },
        {
          createdAt: "2026-06-11T06:30:00.000Z",
          eventType: "daily.data.heart_rate.updated",
        },
      ]);

      const response = await statusRoute.GET(statusRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        // Lifecycle events such as provider.connection.created never count as
        // received data; only resource-bearing webhook receipts do.
        lastDataReceivedAt: "2026-06-11T08:00:00.000Z",
        resources: {
          heartrate: { lastReceivedAt: "2026-06-11T06:30:00.000Z" },
          sleep: { lastReceivedAt: "2026-06-11T08:00:00.000Z" },
          workouts: { lastReceivedAt: null },
        },
      });
      expect(mocks.listRecentConnectionWebhookSignals).toHaveBeenCalledWith({
        connectionIds: ["dsc_1"],
        userId: "member_1",
      });
    });
  });
});
