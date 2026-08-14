import { readFile } from "node:fs/promises";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT,
  serializeHostedExecutionDeviceSyncDirtyPayloadIdentity,
} from "@murphai/device-syncd/hosted-runtime";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { createBearerRequest, createJsonPostRequest } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const SIGN_IN_TOKEN = "junction-sdk-sign-in-token-do-not-log";
const HRV_ROUTE_NOW = "2026-07-10T13:46:00.000Z";

const mocks = vi.hoisted(() => ({
  acceptCompanionHrvRmssdObservation: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  createSdkSignInSession: vi.fn(),
  getPrisma: vi.fn(),
  listConnectionSources: vi.fn(),
  listBoundedConnectionSourcesForConnections: vi.fn(),
  listConnectionsForUser: vi.fn(),
  listMemberConnectionStatuses: vi.fn(),
  listRecentConnectionWebhookSignals: vi.fn(),
  lookupHostedMemberForPrivyPrincipal: vi.fn(),
  persistHostedDeviceSyncCompanionMetadata: vi.fn(),
  prismaClient: {
    hostedMailboxItem: {
      findUnique: vi.fn(),
    },
    hostedMember: {
      findUnique: vi.fn(),
    },
    label: "test-prisma",
  },
  runtimeEnv: {
    privyAppId: "cm_app_123" as string | null,
    privyAppSecret: null as string | null,
    privyVerificationKey: "verification-key" as string | null,
    telegramBotUsername: null as string | null,
    telegramWebhookSecret: null as string | null,
  },
  signalHostedMemberActivationRuntimeWakeBestEffortResult: vi.fn(),
  verifyIdentityToken: vi.fn(),
}));

vi.mock("@privy-io/node", () => ({
  NotFoundError: class NotFoundError extends Error {},
  PrivyClient: vi.fn(),
  verifyIdentityToken: mocks.verifyIdentityToken,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => mocks.runtimeEnv,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  lookupHostedMemberForPrivyPrincipal: mocks.lookupHostedMemberForPrivyPrincipal,
}));

vi.mock("@/src/lib/hosted-onboarding/member-activation-runtime-wake", () => ({
  signalHostedMemberActivationRuntimeWakeBestEffortResult:
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  HOSTED_HEALTH_DATA_CONSENT_SCOPE: "launch.health-data",
  assertHostedHistoricalLaunchConsentGranted:
    mocks.assertHostedHistoricalLaunchConsentGranted,
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/device-sync/wake-service", () => ({
  persistHostedDeviceSyncCompanionMetadata: mocks.persistHostedDeviceSyncCompanionMetadata,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type SignInTokenRouteModule = typeof import("../app/api/device-sync/companion/sign-in-token/route");
type HrvRmssdRouteModule = typeof import("../app/api/device-sync/companion/hrv-rmssd/route");
type StatusRouteModule = typeof import("../app/api/device-sync/companion/status/route");
type HealthMetadataRouteModule = typeof import("../app/api/device-sync/companion/health-metadata/route");
type AuthDiagnosticsRouteModule =
  typeof import("../app/api/device-sync/companion/auth-diagnostics/route");

let signInTokenRoute: SignInTokenRouteModule;
let hrvRmssdRoute: HrvRmssdRouteModule;
let statusRoute: StatusRouteModule;
let healthMetadataRoute: HealthMetadataRouteModule;
let authDiagnosticsRoute: AuthDiagnosticsRouteModule;

const ACTIVE_MEMBER = {
  billingStatus: "active",
  id: "member_1",
  suspendedAt: null,
};

function mockVerifiedPrivyUser(): void {
  mocks.verifyIdentityToken.mockResolvedValue({
    id: "did:privy:user_123",
    linked_accounts: [
      {
        latest_verified_at: 1741194420,
        phoneNumber: "+1 415 555 2671",
        type: "phone",
      },
    ],
  });
  mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(ACTIVE_MEMBER);
  mocks.prismaClient.hostedMember.findUnique.mockResolvedValue({
    accountGroupMemberships: [],
    billingStatus: ACTIVE_MEMBER.billingStatus,
    suspendedAt: ACTIVE_MEMBER.suspendedAt,
    threadContainer: null,
  });
}

function rejectHistoricalLaunchConsent(): void {
  mocks.assertHostedHistoricalLaunchConsentGranted.mockRejectedValue(
    hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the Murph legal consent before continuing.",
    }),
  );
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

function statusRequest(
  bearerToken: string | null = "privy-identity-token",
  sourceProviderSlug?: string,
) {
  const url = new URL("https://app.example.test/api/device-sync/companion/status");
  if (sourceProviderSlug) {
    url.searchParams.set("sourceProviderSlug", sourceProviderSlug);
  }
  return bearerToken === null
    ? new Request(url.toString())
    : createBearerRequest(url.toString(), bearerToken);
}

function healthMetadataRequest(body: unknown, bearerToken: string | null = "privy-identity-token") {
  const url = "https://app.example.test/api/device-sync/companion/health-metadata";
  const init = bearerToken === null
    ? {}
    : { headers: { authorization: `Bearer ${bearerToken}` } };

  return createJsonPostRequest(url, body, init);
}

function healthMetadataRecord(overrides: Record<string, unknown> = {}) {
  return {
    endAt: "2026-07-08T12:00:00.000Z",
    kind: "recovery_score",
    recordId: "a".repeat(64),
    startAt: "2026-07-08T04:00:00.000Z",
    syncVersion: 1,
    value: 80,
    ...overrides,
  };
}

const validHrvObservation = {
  schema: "murph.companion.overnight-prv-rmssd.v1",
  methodVersion: "prv-rmssd-5m-mean-scheduled-0000-0800-local-v1",
  nightDate: "2026-07-10",
  rmssdMs: 52.75,
  completedWindowCount: 96,
  acceptedWindowCount: 72,
};

function hrvRmssdRequest(
  body: unknown,
  bearerToken: string | null = "privy-identity-token",
) {
  return createJsonPostRequest(
    "https://app.example.test/api/device-sync/companion/hrv-rmssd",
    body,
    bearerToken === null
      ? {}
      : { headers: { authorization: `Bearer ${bearerToken}` } },
  );
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

async function withProductionAuthDiagnosticsEnv<T>(
  enabled: boolean,
  callback: () => Promise<T>,
): Promise<T> {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED", enabled ? "1" : "");

  try {
    return await callback();
  } finally {
    vi.unstubAllEnvs();
  }
}

describe("device sync companion routes", () => {
  beforeAll(async () => {
    signInTokenRoute = await import("../app/api/device-sync/companion/sign-in-token/route");
    hrvRmssdRoute = await import("../app/api/device-sync/companion/hrv-rmssd/route");
    statusRoute = await import("../app/api/device-sync/companion/status/route");
    healthMetadataRoute = await import("../app/api/device-sync/companion/health-metadata/route");
    authDiagnosticsRoute = await import("../app/api/device-sync/companion/auth-diagnostics/route");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.prismaClient.hostedMailboxItem.findUnique.mockResolvedValue(null);
    mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult.mockResolvedValue({
      accepted: true,
      configured: true,
      errorCode: null,
      mailboxItemIdPresent: true,
      signalAccepted: true,
      workflowIdPresent: true,
    });
    mocks.assertHostedHistoricalLaunchConsentGranted.mockResolvedValue(undefined);
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
    mocks.listBoundedConnectionSourcesForConnections.mockResolvedValue([]);
    mocks.listMemberConnectionStatuses.mockResolvedValue([]);
    mocks.listRecentConnectionWebhookSignals.mockResolvedValue([]);
    mocks.persistHostedDeviceSyncCompanionMetadata.mockResolvedValue(undefined);
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      store: {
        listConnectionSources: mocks.listConnectionSources,
        listBoundedConnectionSourcesForConnections: mocks.listBoundedConnectionSourcesForConnections,
        listConnectionsForUser: mocks.listConnectionsForUser,
        listMemberConnectionStatuses: mocks.listMemberConnectionStatuses,
        listRecentConnectionWebhookSignals: mocks.listRecentConnectionWebhookSignals,
      },
    });
    mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
      acceptCompanionHrvRmssdObservation: mocks.acceptCompanionHrvRmssdObservation,
      createSdkSignInSession: mocks.createSdkSignInSession,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("POST /api/device-sync/companion/auth-diagnostics", () => {
    it("records typed pre-login Privy auth diagnostics without raw provider prose", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        appVersion: "1.0.0",
        diagnosticCode: "privy_rate_limited",
        errorKind: "rate_limited",
        httpStatus: 429,
        method: "email",
        providerErrorCode: "too_many_requests",
        retryable: true,
        stage: "send_code",
      }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith("Companion auth diagnostic.", expect.objectContaining({
        appVersion: "1.0.0",
        diagnosticCode: "privy_rate_limited",
        diagnosticDescription: "Privy rate limited the auth request.",
        errorKind: "rate_limited",
        httpStatus: 429,
        method: "email",
        platform: "ios",
        provider: "privy",
        providerErrorCode: "too_many_requests",
        retryable: true,
        stage: "send_code",
      }));
    });

    it("records native app configuration failures as typed diagnostics", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        diagnosticCode: "privy_invalid_native_app_id",
        errorKind: "configuration",
        method: "email",
        providerErrorCode: null,
        retryable: false,
        stage: "send_code",
      }));

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.objectContaining({
          diagnosticCode: "privy_invalid_native_app_id",
          diagnosticDescription: "Privy rejected the native app configuration.",
          providerErrorCode: null,
          retryable: false,
        }),
      );
    });

    it("records Android auth diagnostics with an explicit platform", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        diagnosticCode: "privy_network_error",
        errorKind: "network",
        method: "sms",
        platform: "android",
        retryable: true,
        stage: "send_code",
      }));

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.objectContaining({
          platform: "android",
        }),
      );
    });

    it("rejects unsupported auth diagnostic platforms", async () => {
      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        diagnosticCode: "privy_network_error",
        errorKind: "network",
        method: "sms",
        platform: "web",
        retryable: true,
        stage: "send_code",
      }));

      expect(response.status).toBe(400);
    });

    it("accepts the checked-in iOS OTP failure contract", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const contract = JSON.parse(await readFile(
        new URL("./fixtures/companion-auth-diagnostic-ios-rate-limited.json", import.meta.url),
        "utf8",
      )) as unknown;

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest(
        contract,
        { headers: { "x-vercel-forwarded-for": "203.0.113.27" } },
      ));

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.objectContaining({
          diagnosticCode: "privy_rate_limited",
          errorKind: "rate_limited",
          method: "email",
          providerErrorCode: "too_many_requests",
          retryable: true,
          stage: "send_code",
        }),
      );
    });

    it("quietly hides auth diagnostics in production until explicitly enabled", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await withProductionAuthDiagnosticsEnv(false, () =>
        authDiagnosticsRoute.POST(authDiagnosticsRequest({
          diagnosticCode: "privy_unknown",
          errorKind: "provider",
          method: "email",
          retryable: true,
          stage: "send_code",
        })),
      );

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("allows auth diagnostics in production after the explicit deployment gate is enabled", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await withProductionAuthDiagnosticsEnv(true, () =>
        authDiagnosticsRoute.POST(authDiagnosticsRequest({
          diagnosticCode: "privy_unknown",
          errorKind: "provider",
          method: "email",
          retryable: true,
          stage: "send_code",
        })),
      );

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.objectContaining({ errorKind: "provider" }),
      );
    });

    it.each([
      ["authorization", "not-a-real-auth-header"],
      ["email", "person@example.test"],
      ["healthData", "blood glucose 280 mg/dL"],
      ["memberId", "hbm_abc123xyz"],
      ["phone", "+14155552671"],
      ["provider", "privy"],
      ["providerMessage", "Privy failed for person@example.test code 123456"],
      ["token", "secret-token"],
    ])("rejects the unknown %s field without logging it", async (field, value) => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        diagnosticCode: "privy_unknown",
        errorKind: "provider",
        method: "email",
        retryable: true,
        stage: "send_code",
        [field]: value,
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(warnSpy).not.toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.anything(),
      );
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(value);
    });

    it.each([
      "UPPERCASE",
      "contains-hyphens",
      "contains spaces",
      "x".repeat(65),
      "123456",
      "otp_654321",
      "hbm_abc123xyz",
      "14155552671",
      "hiv_positive",
      "unexpected_provider_error",
    ])("drops unsupported provider machine code %s without logging it", async (providerErrorCode) => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        diagnosticCode: "privy_unknown",
        errorKind: "provider",
        method: "email",
        providerErrorCode,
        retryable: true,
        stage: "send_code",
      }));

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.objectContaining({ providerErrorCode: null }),
      );
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(providerErrorCode);
    });

    it.each([
      ["absent", undefined],
      ["null", null],
      ["number", 123456],
      ["object", { code: "invalid_code" }],
      ["array", ["invalid_code"]],
    ])("drops %s provider error code values", async (_label, providerErrorCode) => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        diagnosticCode: "privy_unknown",
        errorKind: "provider",
        method: "email",
        providerErrorCode,
        retryable: true,
        stage: "send_code",
      }));

      expect(response.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.objectContaining({ providerErrorCode: null }),
      );
    });

    it("drops an unsafe app version without losing the diagnostic", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        appVersion: "1.0 beta",
        diagnosticCode: "privy_unknown",
        errorKind: "provider",
        method: "email",
        retryable: true,
        stage: "send_code",
      }));

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
      }));

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "REQUEST_BODY_TOO_LARGE" },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("x".repeat(100));
    });

    it("does not keep a process-local rate-limit owner after WAF admission", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = {
        diagnosticCode: "privy_unknown",
        errorKind: "provider",
        method: "email",
        retryable: true,
        stage: "send_code",
      };

      for (let index = 0; index < 31; index += 1) {
        const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest(body, {
          headers: {
            "x-vercel-forwarded-for": "192.0.2.99",
          },
        }));
        expect(response.status).toBe(200);
      }

      expect(warnSpy.mock.calls.filter(([message]) => (
        message === "Companion auth diagnostic."
      ))).toHaveLength(31);
      expect(warnSpy.mock.calls).toHaveLength(31);
    });

    it("rejects malformed diagnostics without logging request body fields", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        email: "person@example.test",
        diagnosticCode: "privy_unknown",
        errorKind: "provider",
        method: "email",
        retryable: true,
        stage: "send_magic_link",
      }));

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

    it("rejects unknown diagnostic codes without logging them", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await authDiagnosticsRoute.POST(authDiagnosticsRequest({
        diagnosticCode: "HIV_POSITIVE",
        errorKind: "provider",
        method: "email",
        retryable: false,
        stage: "send_code",
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(warnSpy).not.toHaveBeenCalledWith(
        "Companion auth diagnostic.",
        expect.anything(),
      );
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("HIV");
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
      mocks.lookupHostedMemberForPrivyPrincipal.mockResolvedValue(suspendedMember);
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

    it.each([null, 17, "automatic", "connect "])(
      "rejects invalid connection intent %j before reaching Junction",
      async (connectionIntent) => {
        mockVerifiedPrivyUser();

        const response = await signInTokenRoute.POST(signInTokenRequest({
          connectionIntent,
        }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "COMPANION_REQUEST_INVALID" },
        });
        expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
      },
    );

    it("rejects requests with an invalid bearer token", async () => {
      mocks.verifyIdentityToken.mockRejectedValue(new Error("invalid token"));

      const response = await signInTokenRoute.POST(signInTokenRequest({}));

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "PRIVY_AUTH_FAILED" },
      });
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("issues a device sign-in token when launch-document acceptance is stale", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest({}));

      expect(response.status).toBe(200);
      expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
        memberId: "member_1",
        prisma: mocks.prismaClient,
      });
      expect(mocks.createSdkSignInSession).toHaveBeenCalledTimes(1);
    });

    it("returns a retryable error before Junction when a pending activation wake is rejected", async () => {
      mockVerifiedPrivyUser();
      mocks.prismaClient.hostedMailboxItem.findUnique.mockResolvedValue({
        consumedAt: null,
        id: "mailbox_activation_1",
      });
      mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult.mockResolvedValue({
        accepted: false,
        configured: true,
        errorCode: "runtime_signal_rejected",
        mailboxItemIdPresent: true,
        signalAccepted: false,
        workflowIdPresent: true,
      });

      const response = await signInTokenRoute.POST(signInTokenRequest({}));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "HOSTED_STARTER_USAGE_RUNTIME_WAKE_REQUIRED",
          retryable: true,
        },
      });
      expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
        .toHaveBeenCalledWith(expect.objectContaining({
          mailboxItemId: "mailbox_activation_1",
          memberId: "member_1",
          source: "starter-usage.activation.retry",
        }));
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("issues a device sign-in token after a pending activation wake is accepted", async () => {
      mockVerifiedPrivyUser();
      mocks.prismaClient.hostedMailboxItem.findUnique.mockResolvedValue({
        consumedAt: null,
        id: "mailbox_activation_1",
      });

      const response = await signInTokenRoute.POST(signInTokenRequest({}));

      expect(response.status).toBe(200);
      expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
        .toHaveBeenCalledTimes(1);
      expect(mocks.createSdkSignInSession).toHaveBeenCalledTimes(1);
    });

    it("does not re-signal a consumed activation before issuing a device sign-in token", async () => {
      mockVerifiedPrivyUser();
      mocks.prismaClient.hostedMailboxItem.findUnique.mockResolvedValue({
        consumedAt: new Date("2026-07-09T11:59:00.000Z"),
        id: "mailbox_activation_1",
      });

      const response = await signInTokenRoute.POST(signInTokenRequest({}));

      expect(response.status).toBe(200);
      expect(mocks.signalHostedMemberActivationRuntimeWakeBestEffortResult)
        .not.toHaveBeenCalled();
      expect(mocks.createSdkSignInSession).toHaveBeenCalledTimes(1);
    });

    it("rejects a device sign-in token without both historical launch grants", async () => {
      mockVerifiedPrivyUser();
      rejectHistoricalLaunchConsent();

      const response = await signInTokenRoute.POST(signInTokenRequest({}));

      expect(response.status).toBe(403);
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "HOSTED_CONSENT_REQUIRED" },
      });
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

    it("accepts Android companion platform metadata", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest({
        connectionIntent: "connect",
        platform: "android",
      }));

      expect(response.status).toBe(200);
      expect(mocks.createSdkSignInSession).toHaveBeenCalledWith(
        "member_1",
        "junction",
        "connect",
      );
    });

    it("requires Android companion requests to declare their lifecycle intent", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest({
        platform: "android",
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
    });

    it("rejects unsupported companion platform metadata without reaching Junction", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest({ platform: "web" }));

      expect(response.status).toBe(400);
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
        connectionIntent: "connect",
        platform: "ios",
        sdkVersions: { vital: "1.8.8" },
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        environment: "sandbox",
        signInToken: SIGN_IN_TOKEN,
      });
      expect(mocks.createSdkSignInSession).toHaveBeenCalledWith(
        "member_1",
        "junction",
        "connect",
      );
      expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
        memberId: "member_1",
        prisma: mocks.prismaClient,
      });
    });

    it("forwards passive session repair as resume intent", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest({
        connectionIntent: "resume",
        platform: "ios",
      }));

      expect(response.status).toBe(200);
      expect(mocks.createSdkSignInSession).toHaveBeenCalledWith(
        "member_1",
        "junction",
        "resume",
      );
    });

    it("returns a typed reconnect requirement for terminal server state", async () => {
      mockVerifiedPrivyUser();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mocks.createSdkSignInSession.mockRejectedValueOnce(deviceSyncError({
        code: "SDK_SIGN_IN_RECONNECT_REQUIRED",
        message: "Reconnect the device-sync provider before resuming SDK sign-in.",
        retryable: false,
        httpStatus: 409,
      }));

      const response = await signInTokenRoute.POST(signInTokenRequest({
        connectionIntent: "resume",
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: {
          code: "SDK_SIGN_IN_RECONNECT_REQUIRED",
          message: "Reconnect the device-sync provider before resuming SDK sign-in.",
          retryable: false,
        },
      });
      warn.mockRestore();
    });

    it("accepts an empty request body", async () => {
      mockVerifiedPrivyUser();

      const response = await signInTokenRoute.POST(signInTokenRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        environment: "sandbox",
        signInToken: SIGN_IN_TOKEN,
      });
      expect(mocks.createSdkSignInSession).toHaveBeenCalledWith(
        "member_1",
        "junction",
        null,
      );
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

  describe("POST /api/device-sync/companion/hrv-rmssd", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(HRV_ROUTE_NOW));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("requires bearer auth before accepting an observation", async () => {
      const response = await hrvRmssdRoute.POST(hrvRmssdRequest(validHrvObservation, null));

      expect(response.status).toBe(401);
      expect(mocks.acceptCompanionHrvRmssdObservation).not.toHaveBeenCalled();
    });

    it("accepts current device observations when launch-document acceptance is stale", async () => {
      mockVerifiedPrivyUser();

      const response = await hrvRmssdRoute.POST(hrvRmssdRequest(validHrvObservation));

      expect(response.status).toBe(202);
      expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
        memberId: "member_1",
        prisma: mocks.prismaClient,
      });
      expect(mocks.acceptCompanionHrvRmssdObservation).toHaveBeenCalledTimes(1);
    });

    it("rejects current device observations without both historical launch grants", async () => {
      mockVerifiedPrivyUser();
      rejectHistoricalLaunchConsent();

      const response = await hrvRmssdRoute.POST(hrvRmssdRequest(validHrvObservation));

      expect(response.status).toBe(403);
      expect(mocks.acceptCompanionHrvRmssdObservation).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "HOSTED_CONSENT_REQUIRED" },
      });
    });

    it("accepts exactly one compact derived observation without echoing the value", async () => {
      mockVerifiedPrivyUser();

      const response = await hrvRmssdRoute.POST(hrvRmssdRequest(validHrvObservation));
      const responseBody = await response.json();

      expect(response.status).toBe(202);
      expect(responseBody).toEqual({
        acceptedAt: expect.any(String),
        nightDate: validHrvObservation.nightDate,
        status: "accepted",
      });
      expect(JSON.stringify(responseBody)).not.toContain(String(validHrvObservation.rmssdMs));
      expect(mocks.acceptCompanionHrvRmssdObservation).toHaveBeenCalledWith({
        acceptedAt: expect.any(String),
        observation: validHrvObservation,
        userId: ACTIVE_MEMBER.id,
      });
    });

    it.each([
      ["more accepted windows than completed windows", {
        ...validHrvObservation,
        acceptedWindowCount: 97,
      }],
      ["fewer than half of completed windows accepted", {
        ...validHrvObservation,
        acceptedWindowCount: 48,
        completedWindowCount: 97,
      }],
      ["a removed capture identifier", {
        ...validHrvObservation,
        captureId: "wearable_serial_1234567890",
      }],
    ])("rejects %s before staging", async (_label, observation) => {
      mockVerifiedPrivyUser();

      const response = await hrvRmssdRoute.POST(hrvRmssdRequest(observation));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
      expect(mocks.acceptCompanionHrvRmssdObservation).not.toHaveBeenCalled();
    });

    it.each([
      ["a stale observation", {
        ...validHrvObservation,
        nightDate: "2026-07-07",
      }],
      ["a future observation", {
        ...validHrvObservation,
        nightDate: "2026-07-12",
      }],
    ])("defers the first-admission night-date gate for %s to the replay-aware service", async (
      _label,
      observation,
    ) => {
      mockVerifiedPrivyUser();

      const response = await hrvRmssdRoute.POST(hrvRmssdRequest(observation));

      expect(response.status).toBe(202);
      expect(mocks.acceptCompanionHrvRmssdObservation).toHaveBeenCalledWith({
        acceptedAt: expect.any(String),
        observation,
        userId: ACTIVE_MEMBER.id,
      });
    });

    it.each([
      ["RR intervals", { rrIntervals: [800, 810] }],
      ["BLE bytes", { rawBleBytes: "001122" }],
      ["device identity", { deviceIdentifier: "wearable-identifier" }],
      ["packet timestamps", { packetTimestamps: [1, 2] }],
      ["per-window RMSSD values", { windowRmssdMs: [48.25] }],
      ["capture timestamp", { captureStartedAt: "2026-07-10T03:00:00.000Z" }],
      ["capture duration", { captureDurationMs: 8 * 60 * 60 * 1_000 }],
      ["capture end offset", { captureEndUtcOffsetMinutes: -4 * 60 }],
      ["aggregate interval coverage", { acceptedCoverageMs: 72 * 280_000 }],
    ])("rejects raw %s fields before staging", async (_label, rawField) => {
      mockVerifiedPrivyUser();

      const response = await hrvRmssdRoute.POST(hrvRmssdRequest({
        ...validHrvObservation,
        ...rawField,
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "COMPANION_REQUEST_INVALID" },
      });
      expect(mocks.acceptCompanionHrvRmssdObservation).not.toHaveBeenCalled();
    });

    it("rejects oversized request bodies before staging", async () => {
      mockVerifiedPrivyUser();

      const response = await hrvRmssdRoute.POST(hrvRmssdRequest({
        ...validHrvObservation,
        padding: "x".repeat(600),
      }));

      expect(response.status).toBe(413);
      expect(mocks.acceptCompanionHrvRmssdObservation).not.toHaveBeenCalled();
    });

    it("keeps malformed HRV JSON fragments out of logs", async () => {
      mockVerifiedPrivyUser();
      const rawHealthMarker = "raw-rr-interval-811ms-do-not-log";
      const consoleSpies = (["debug", "error", "info", "log", "warn"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );
      const response = await hrvRmssdRoute.POST(new Request(
        "https://app.example.test/api/device-sync/companion/hrv-rmssd",
        {
          body: `{"rrIntervals":[${rawHealthMarker}]}`,
          headers: {
            authorization: "Bearer privy-identity-token",
            "content-type": "application/json",
          },
          method: "POST",
        },
      ));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "COMPANION_REQUEST_INVALID",
          message: "Companion HRV RMSSD observation must be valid JSON.",
          retryable: false,
        },
      });
      expect(mocks.acceptCompanionHrvRmssdObservation).not.toHaveBeenCalled();
      for (const spy of consoleSpies) {
        for (const callArgs of spy.mock.calls) {
          expect(JSON.stringify(callArgs)).not.toContain(rawHealthMarker);
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

    it("reads current device sync status when launch-document acceptance is stale", async () => {
      mockVerifiedPrivyUser();

      const response = await statusRoute.GET(statusRequest());

      expect(response.status).toBe(200);
      expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
        memberId: "member_1",
        prisma: mocks.prismaClient,
      });
      expect(mocks.listMemberConnectionStatuses).toHaveBeenCalledWith({
        limit: 32,
        provider: "junction",
        status: "not_disconnected",
        userId: "member_1",
      });
      expect(mocks.listConnectionsForUser).not.toHaveBeenCalled();
    });

    it("rejects current device sync status without both historical launch grants", async () => {
      mockVerifiedPrivyUser();
      rejectHistoricalLaunchConsent();

      const response = await statusRoute.GET(statusRequest());

      expect(response.status).toBe(403);
      expect(mocks.listMemberConnectionStatuses).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "HOSTED_CONSENT_REQUIRED" },
      });
    });

    it("returns empty evidence when the member has no junction connection", async () => {
      mockVerifiedPrivyUser();
      mocks.listMemberConnectionStatuses.mockResolvedValue([]);

      const response = await statusRoute.GET(statusRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        lastDataReceivedAt: null,
        observedAt: "2026-07-09T12:00:00.000Z",
        resources: {},
      });
      expect(mocks.listBoundedConnectionSourcesForConnections).toHaveBeenCalledWith({
        connectionIds: [],
        excludeDisconnected: false,
        limitPerConnection:
          HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT,
        sourceProviderSlugs: null,
      });
      expect(mocks.listRecentConnectionWebhookSignals).not.toHaveBeenCalled();
    });

    it("returns unscoped status for a Junction connection with all 33 configured sources", async () => {
      mockVerifiedPrivyUser();
      mocks.listMemberConnectionStatuses.mockResolvedValue([{
        id: "dsc_1",
        status: "active",
      }]);
      mocks.listBoundedConnectionSourcesForConnections.mockResolvedValue(
        Array.from({ length: 33 }, (_, index) => ({
          connectionId: "dsc_1",
          resourceAvailabilitySummary: index === 0 ? { sleep: true } : {},
          sourceProviderSlug: index === 32 ? "strava" : `source_${index}`,
          status: index === 32 ? "disconnected" : "connected",
        })),
      );
      mocks.listRecentConnectionWebhookSignals.mockResolvedValue([{
        connectionId: "dsc_1",
        createdAt: "2026-07-09T11:30:00.000Z",
        eventType: "daily.data.sleep.updated",
        sourceProviderSlug: "source_0",
      }]);

      const response = await statusRoute.GET(statusRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        lastDataReceivedAt: "2026-07-09T11:30:00.000Z",
        observedAt: "2026-07-09T12:00:00.000Z",
        resources: {
          sleep: { lastReceivedAt: "2026-07-09T11:30:00.000Z" },
        },
      });
      expect(mocks.listBoundedConnectionSourcesForConnections).toHaveBeenCalledOnce();
      expect(mocks.listBoundedConnectionSourcesForConnections).toHaveBeenCalledWith({
        connectionIds: ["dsc_1"],
        excludeDisconnected: false,
        limitPerConnection:
          HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT,
        sourceProviderSlugs: null,
      });
      expect(mocks.listRecentConnectionWebhookSignals).toHaveBeenCalledOnce();
      expect(mocks.listConnectionSources).not.toHaveBeenCalled();
      expect(mocks.listConnectionsForUser).not.toHaveBeenCalled();
    });

    it("maps webhook receipts and source availability into per-resource evidence", async () => {
      mockVerifiedPrivyUser();
      mocks.listMemberConnectionStatuses.mockResolvedValue([
        {
          id: "dsc_1",
          status: "active",
        },
      ]);
      mocks.listBoundedConnectionSourcesForConnections.mockResolvedValue([
        {
          connectionId: "dsc_1",
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
          connectionId: "dsc_1",
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
        observedAt: "2026-07-09T12:00:00.000Z",
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
      expect(mocks.listBoundedConnectionSourcesForConnections).toHaveBeenCalledWith({
        connectionIds: ["dsc_1"],
        excludeDisconnected: false,
        limitPerConnection:
          HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT,
        sourceProviderSlugs: null,
      });
      expect(mocks.listConnectionSources).not.toHaveBeenCalled();
      expect(mocks.listConnectionsForUser).not.toHaveBeenCalled();
    });

    it("scopes availability and receipt reads to Health Connect", async () => {
      mockVerifiedPrivyUser();
      mocks.listMemberConnectionStatuses.mockResolvedValue([{
        id: "dsc_1",
        status: "active",
      }]);
      mocks.listBoundedConnectionSourcesForConnections.mockResolvedValue([
        {
          connectionId: "dsc_1",
          resourceAvailabilitySummary: { sleep: true },
          sourceProviderSlug: "apple_health_kit",
          status: "connected",
        },
        {
          connectionId: "dsc_1",
          resourceAvailabilitySummary: { workouts: true },
          sourceProviderSlug: "health_connect",
          status: "connected",
        },
      ]);
      mocks.listRecentConnectionWebhookSignals.mockResolvedValue([{
        connectionId: "dsc_1",
        createdAt: "2026-07-25T18:00:00.000Z",
        eventType: "daily.data.workouts.updated",
        sourceProviderSlug: "health_connect",
      }]);

      const response = await statusRoute.GET(statusRequest(
        "privy-identity-token",
        "health_connect",
      ));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        lastDataReceivedAt: "2026-07-25T18:00:00.000Z",
        observedAt: "2026-07-09T12:00:00.000Z",
        resources: {
          workouts: { lastReceivedAt: "2026-07-25T18:00:00.000Z" },
        },
      });
      expect(mocks.listRecentConnectionWebhookSignals).toHaveBeenCalledWith({
        connectionIds: ["dsc_1"],
        sourceProviderSlug: "health_connect",
        userId: "member_1",
      });
      expect(mocks.listMemberConnectionStatuses).toHaveBeenCalledWith({
        limit: 32,
        provider: "junction",
        status: "active",
        userId: "member_1",
      });
      expect(mocks.listBoundedConnectionSourcesForConnections).toHaveBeenCalledWith({
        connectionIds: ["dsc_1"],
        excludeDisconnected: false,
        limitPerConnection: 32,
        sourceProviderSlugs: ["health_connect"],
      });
    });

    it("invalidates Health Connect receipts older than a disconnected source", async () => {
      mockVerifiedPrivyUser();
      mocks.listMemberConnectionStatuses.mockResolvedValue([{
        id: "dsc_1",
        status: "active",
      }]);
      mocks.listBoundedConnectionSourcesForConnections.mockResolvedValue([
        {
          connectionId: "dsc_1",
          lastSeenAt: "2026-07-25T17:00:00.000Z",
          resourceAvailabilitySummary: { sleep: true },
          sourceProviderSlug: "apple_health_kit",
          status: "connected",
        },
        {
          connectionId: "dsc_1",
          lastSeenAt: "2026-07-25T19:00:00.000Z",
          resourceAvailabilitySummary: { workouts: true },
          sourceProviderSlug: "health_connect",
          status: "disconnected",
          updatedAt: "2026-07-25T19:00:00.000Z",
        },
      ]);
      mocks.listRecentConnectionWebhookSignals.mockResolvedValue([{
        connectionId: "dsc_1",
        createdAt: "2026-07-25T18:00:00.000Z",
        eventType: "daily.data.workouts.updated",
        sourceProviderSlug: "health_connect",
      }]);

      const response = await statusRoute.GET(statusRequest(
        "privy-identity-token",
        "health_connect",
      ));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        lastDataReceivedAt: null,
        observedAt: "2026-07-09T12:00:00.000Z",
        resources: {},
      });
    });

    it("accepts a Health Connect receipt newer than a disconnected source projection", async () => {
      mockVerifiedPrivyUser();
      mocks.listMemberConnectionStatuses.mockResolvedValue([{
        id: "dsc_1",
        status: "active",
      }]);
      mocks.listBoundedConnectionSourcesForConnections.mockResolvedValue([{
        connectionId: "dsc_1",
        lastSeenAt: "2026-07-25T18:00:00.000Z",
        resourceAvailabilitySummary: { workouts: true },
        sourceProviderSlug: "health_connect",
        status: "disconnected",
        // The ordinary accepted-webhook stamp advances generic updatedAt to
        // the same instant as the durable receipt without moving lastSeenAt.
        updatedAt: "2026-07-25T19:00:00.000Z",
      }]);
      mocks.listRecentConnectionWebhookSignals.mockResolvedValue([{
        connectionId: "dsc_1",
        createdAt: "2026-07-25T19:00:00.000Z",
        eventType: "daily.data.workouts.updated",
        sourceProviderSlug: "health_connect",
      }]);

      const response = await statusRoute.GET(statusRequest(
        "privy-identity-token",
        "health_connect",
      ));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        lastDataReceivedAt: "2026-07-25T19:00:00.000Z",
        observedAt: "2026-07-09T12:00:00.000Z",
        resources: {
          workouts: { lastReceivedAt: "2026-07-25T19:00:00.000Z" },
        },
      });
    });

    it("accepts the first source-attributed receipt before its source projection exists", async () => {
      mockVerifiedPrivyUser();
      mocks.listMemberConnectionStatuses.mockResolvedValue([{
        id: "dsc_1",
        status: "active",
      }]);
      mocks.listBoundedConnectionSourcesForConnections.mockResolvedValue([{
        connectionId: "dsc_1",
        lastSeenAt: "2026-07-25T17:00:00.000Z",
        resourceAvailabilitySummary: { sleep: true },
        sourceProviderSlug: "apple_health_kit",
        status: "connected",
      }]);
      mocks.listRecentConnectionWebhookSignals.mockResolvedValue([{
        connectionId: "dsc_1",
        createdAt: "2026-07-25T18:00:00.000Z",
        eventType: "daily.data.workouts.updated",
        sourceProviderSlug: "health_connect",
      }]);

      const response = await statusRoute.GET(statusRequest(
        "privy-identity-token",
        "health_connect",
      ));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        lastDataReceivedAt: "2026-07-25T18:00:00.000Z",
        observedAt: "2026-07-09T12:00:00.000Z",
        resources: {
          workouts: { lastReceivedAt: "2026-07-25T18:00:00.000Z" },
        },
      });
    });

    it("reads 32 Junction rows through one narrow connection, one source, and one signal query", async () => {
      mockVerifiedPrivyUser();
      const connectionIds = Array.from({ length: 32 }, (_, index) =>
        `dsc_${String(index + 1).padStart(2, "0")}`
      );
      const statuses = connectionIds.map((id) => ({ id, status: "active" as const }));
      const sources = connectionIds.map((connectionId, index) => ({
        connectionId,
        resourceAvailabilitySummary: { sleep: true },
        sourceProviderSlug: "health_connect",
        status: "connected" as const,
        lastSeenAt: `2026-07-25T18:${String(index).padStart(2, "0")}:00.000Z`,
      }));
      const signals = connectionIds.map((connectionId, index) => ({
        connectionId,
        createdAt: `2026-07-25T19:${String(index).padStart(2, "0")}:00.000Z`,
        eventType: "daily.data.sleep.updated",
        sourceProviderSlug: "health_connect",
      }));
      let activeDatabaseReads = 0;
      let peakDatabaseReads = 0;
      const runDatabaseRead = async <Value,>(value: Value): Promise<Value> => {
        activeDatabaseReads += 1;
        peakDatabaseReads = Math.max(peakDatabaseReads, activeDatabaseReads);
        try {
          await Promise.resolve();
          return value;
        } finally {
          activeDatabaseReads -= 1;
        }
      };
      mocks.listMemberConnectionStatuses.mockImplementation(async () =>
        runDatabaseRead(statuses)
      );
      mocks.listBoundedConnectionSourcesForConnections.mockImplementation(async () =>
        runDatabaseRead(sources)
      );
      mocks.listRecentConnectionWebhookSignals.mockImplementation(async () =>
        runDatabaseRead(signals)
      );

      const response = await statusRoute.GET(statusRequest());

      expect(response.status).toBe(200);
      expect(mocks.listMemberConnectionStatuses).toHaveBeenCalledOnce();
      expect(mocks.listMemberConnectionStatuses).toHaveBeenCalledWith({
        limit: 32,
        provider: "junction",
        status: "not_disconnected",
        userId: "member_1",
      });
      expect(mocks.listBoundedConnectionSourcesForConnections).toHaveBeenCalledOnce();
      expect(mocks.listBoundedConnectionSourcesForConnections).toHaveBeenCalledWith({
        connectionIds,
        excludeDisconnected: false,
        limitPerConnection:
          HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT,
        sourceProviderSlugs: null,
      });
      expect(mocks.listRecentConnectionWebhookSignals).toHaveBeenCalledOnce();
      expect(mocks.listRecentConnectionWebhookSignals).toHaveBeenCalledWith({
        connectionIds,
        userId: "member_1",
      });
      expect(mocks.listConnectionsForUser).not.toHaveBeenCalled();
      expect(mocks.listConnectionSources).not.toHaveBeenCalled();
      expect(peakDatabaseReads).toBe(1);
    });

    it("does not use scoped receipts from a connection requiring reauthorization", async () => {
      mockVerifiedPrivyUser();
      mocks.listMemberConnectionStatuses.mockResolvedValue([]);

      const response = await statusRoute.GET(statusRequest(
        "privy-identity-token",
        "health_connect",
      ));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        lastDataReceivedAt: null,
        observedAt: "2026-07-09T12:00:00.000Z",
        resources: {},
      });
      expect(mocks.listBoundedConnectionSourcesForConnections).toHaveBeenCalledWith({
        connectionIds: [],
        excludeDisconnected: false,
        limitPerConnection: 32,
        sourceProviderSlugs: ["health_connect"],
      });
      expect(mocks.listConnectionSources).not.toHaveBeenCalled();
      expect(mocks.listRecentConnectionWebhookSignals).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/device-sync/companion/health-metadata", () => {
    it("requires bearer auth and never falls back to cookies", async () => {
      const body = { records: [healthMetadataRecord()], schemaVersion: 1 };
      const missingResponse = await healthMetadataRoute.POST(healthMetadataRequest(body, null));
      expect(missingResponse.status).toBe(401);

      const cookieResponse = await healthMetadataRoute.POST(new Request(
        "https://app.example.test/api/device-sync/companion/health-metadata",
        {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            cookie: "privy-id-token=cookie-identity-token",
          },
          method: "POST",
        },
      ));
      expect(cookieResponse.status).toBe(401);
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).not.toHaveBeenCalled();
    });

    it("stages current device metadata when launch-document acceptance is stale", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([{
        id: "dsc_1",
        provider: "junction",
        status: "active",
      }]);

      const response = await healthMetadataRoute.POST(healthMetadataRequest({
        records: [healthMetadataRecord()],
        schemaVersion: 1,
      }));

      expect(response.status).toBe(200);
      expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
        memberId: "member_1",
        prisma: mocks.prismaClient,
      });
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).toHaveBeenCalledTimes(1);
    });

    it("rejects current device metadata without both historical launch grants", async () => {
      mockVerifiedPrivyUser();
      rejectHistoricalLaunchConsent();

      const response = await healthMetadataRoute.POST(healthMetadataRequest({
        records: [healthMetadataRecord()],
        schemaVersion: 1,
      }));

      expect(response.status).toBe(403);
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "HOSTED_CONSENT_REQUIRED" },
      });
    });

    it("stages on the sole active Junction connection before source projection", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([{
        id: "dsc_1",
        provider: "junction",
        status: "active",
      }]);
      const secondRecord = healthMetadataRecord({
        endAt: "2026-07-08T14:00:00.000Z",
        kind: "workout_strain",
        recordId: "b".repeat(64),
        startAt: "2026-07-08T13:00:00.000Z",
        syncVersion: 2,
        value: 12.5,
      });

      const response = await healthMetadataRoute.POST(healthMetadataRequest({
        records: [secondRecord, healthMetadataRecord()],
        schemaVersion: 1,
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ acceptedCount: 2 });
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).toHaveBeenCalledTimes(1);
      const input = mocks.persistHostedDeviceSyncCompanionMetadata.mock.calls[0]?.[0];
      expect(input).toMatchObject({
        connectionId: "dsc_1",
        resource: {
          count: 2,
          jobKind: "resource",
          resource: "companion_health_metadata",
          resourceCategory: "summary",
          sourceProviderSlug: "apple-health-kit",
          windowEnd: null,
          windowStart: null,
        },
        userId: "member_1",
      });
      const stagedBatch = JSON.parse(input.resource.payload.webhookDataJson);
      expect(stagedBatch).toEqual({
        records: [healthMetadataRecord(), secondRecord].map((record) => {
          const entries = Object.entries(record).filter(([, value]) => value !== undefined);
          return Object.fromEntries(entries);
        }),
        schemaVersion: 1,
      });
      expect(input.resource.payload).toMatchObject({
        eventType: "companion.health_metadata.v1",
        occurredAt: "2026-07-09T12:00:00.000Z",
        resource: "companion_health_metadata",
        sourceProviderSlug: "apple-health-kit",
      });
      expect(mocks.listConnectionSources).toHaveBeenCalledWith("dsc_1");
    });

    it("rejects metadata from a source-specific Apple Health disconnect", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([
        { id: "dsc_1", provider: "junction", status: "active" },
      ]);
      mocks.listConnectionSources.mockResolvedValue([{
        lastErrorCode: "SOURCE_USER_DISCONNECTED",
        sourceProviderSlug: "apple_health_kit",
        status: "disconnected",
      }]);

      const response = await healthMetadataRoute.POST(healthMetadataRequest({
        records: [healthMetadataRecord()],
        schemaVersion: 1,
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: {
          code: "COMPANION_HEALTH_CONNECTION_REQUIRED",
          message: "Connect Apple Health in the companion before syncing supplemental metadata.",
          retryable: false,
        },
      });
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).not.toHaveBeenCalled();
    });

    it("keeps durable batch identity stable across receipt-time retries", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([{
        id: "dsc_1",
        provider: "junction",
        status: "active",
      }]);
      const body = {
        records: [healthMetadataRecord()],
        schemaVersion: 1,
      };

      const firstResponse = await healthMetadataRoute.POST(healthMetadataRequest(body));
      vi.setSystemTime(new Date("2026-07-09T12:05:00.000Z"));
      const retryResponse = await healthMetadataRoute.POST(healthMetadataRequest(body));

      expect(firstResponse.status).toBe(200);
      expect(retryResponse.status).toBe(200);
      const firstInput = mocks.persistHostedDeviceSyncCompanionMetadata.mock.calls[0]?.[0];
      const retryInput = mocks.persistHostedDeviceSyncCompanionMetadata.mock.calls[1]?.[0];
      expect(firstInput.occurredAt).not.toBe(retryInput.occurredAt);
      expect(firstInput.resource.payload.occurredAt).toBe(firstInput.occurredAt);
      expect(retryInput.resource.payload.occurredAt).toBe(retryInput.occurredAt);
      expect(serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(firstInput.resource.payload))
        .toBe(serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(retryInput.resource.payload));
    });

    it("accepts closed value, sync-version, history, and future-skew boundaries", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([{
        id: "dsc_1",
        provider: "junction",
        status: "active",
      }]);
      const receivedAt = new Date("2026-07-09T12:00:00.000Z");

      const response = await healthMetadataRoute.POST(healthMetadataRequest({
        records: [
          healthMetadataRecord({
            endAt: new Date(receivedAt.getTime() - 366 * 24 * 60 * 60 * 1_000 + 1).toISOString(),
            recordId: "b".repeat(64),
            startAt: new Date(receivedAt.getTime() - 366 * 24 * 60 * 60 * 1_000).toISOString(),
            syncVersion: Number.MAX_SAFE_INTEGER,
            value: 0,
          }),
          healthMetadataRecord({
            endAt: new Date(receivedAt.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
            kind: "workout_strain",
            recordId: "c".repeat(64),
            startAt: new Date(receivedAt.getTime() + 24 * 60 * 60 * 1_000 - 1).toISOString(),
            value: 21,
          }),
        ],
        schemaVersion: 1,
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ acceptedCount: 2 });
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).toHaveBeenCalledTimes(1);
    });

    it("rejects unknown fields, duplicate hashes, and out-of-range values", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([{
        id: "dsc_1",
        provider: "junction",
        status: "active",
      }]);

      const invalidBodies = [
        {
          records: [],
          schemaVersion: 1,
        },
        {
          records: Array.from({ length: 201 }, () => healthMetadataRecord()),
          schemaVersion: 1,
        },
        {
          records: [healthMetadataRecord({ arbitraryMetric: "not-allowed" })],
          schemaVersion: 1,
        },
        {
          records: [healthMetadataRecord()],
          schemaVersion: 1,
          arbitraryMetric: "not-allowed",
        },
        {
          records: [healthMetadataRecord(), healthMetadataRecord()],
          schemaVersion: 1,
        },
        {
          records: [healthMetadataRecord({ syncVersion: undefined })],
          schemaVersion: 1,
        },
        {
          records: [healthMetadataRecord({ value: 101 })],
          schemaVersion: 1,
        },
        {
          records: [healthMetadataRecord({ kind: "workout_strain", value: 21.1 })],
          schemaVersion: 1,
        },
        {
          records: [healthMetadataRecord({
            endAt: "2026-07-08T04:00:00.000Z",
            startAt: "2026-07-08T04:00:00.000Z",
          })],
          schemaVersion: 1,
        },
        {
          records: [healthMetadataRecord({ startAt: "July 8, 2026 04:00:00 UTC" })],
          schemaVersion: 1,
        },
        {
          records: [healthMetadataRecord({
            endAt: "2025-07-07T12:00:00.000Z",
            startAt: "2025-07-07T04:00:00.000Z",
          })],
          schemaVersion: 1,
        },
        {
          records: [healthMetadataRecord({
            endAt: "2026-07-10T12:00:00.001Z",
            startAt: "2026-07-10T11:00:00.000Z",
          })],
          schemaVersion: 1,
        },
      ];

      for (const body of invalidBodies) {
        const response = await healthMetadataRoute.POST(healthMetadataRequest(body));
        expect(response.status).toBe(400);
      }
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).not.toHaveBeenCalled();
    });

    it("rejects payloads over the closed route body limit", async () => {
      mockVerifiedPrivyUser();

      const response = await healthMetadataRoute.POST(healthMetadataRequest({
        padding: "x".repeat(64_000),
        records: [healthMetadataRecord()],
        schemaVersion: 1,
      }));

      expect(response.status).toBe(413);
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).not.toHaveBeenCalled();
    });

    it("keeps malformed health JSON fragments out of logs", async () => {
      mockVerifiedPrivyUser();
      const rawHealthMarker = "raw-health-value-do-not-log";
      const consoleSpies = (["debug", "error", "info", "log", "warn"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );
      const response = await healthMetadataRoute.POST(new Request(
        "https://app.example.test/api/device-sync/companion/health-metadata",
        {
          body: `{"value":${rawHealthMarker}}`,
          headers: {
            authorization: "Bearer privy-identity-token",
            "content-type": "application/json",
          },
          method: "POST",
        },
      ));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "COMPANION_REQUEST_INVALID",
          message: "Companion health metadata must be valid JSON.",
          retryable: false,
        },
      });
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).not.toHaveBeenCalled();
      for (const spy of consoleSpies) {
        for (const callArgs of spy.mock.calls) {
          expect(JSON.stringify(callArgs)).not.toContain(rawHealthMarker);
        }
      }
    });

    it("uses source projection to disambiguate multiple active Junction connections", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([
        { id: "dsc_1", provider: "junction", status: "active" },
        { id: "dsc_2", provider: "junction", status: "active" },
      ]);
      mocks.listConnectionSources.mockImplementation(async (connectionId: string) =>
        connectionId === "dsc_2"
          ? [{ sourceProviderSlug: "apple_health_kit", status: "connected" }]
          : [{ sourceProviderSlug: "oura", status: "connected" }]
      );

      const response = await healthMetadataRoute.POST(healthMetadataRequest({
        records: [healthMetadataRecord()],
        schemaVersion: 1,
      }));

      expect(response.status).toBe(200);
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: "dsc_2" }),
      );
    });

    it("rejects ambiguous active Junction connections without source projection", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([
        { id: "dsc_1", provider: "junction", status: "active" },
        { id: "dsc_2", provider: "junction", status: "active" },
      ]);

      const response = await healthMetadataRoute.POST(healthMetadataRequest({
        records: [healthMetadataRecord()],
        schemaVersion: 1,
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "COMPANION_HEALTH_CONNECTION_AMBIGUOUS" },
      });
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).not.toHaveBeenCalled();
    });

    it("rejects uploads when Apple Health has no active runtime lane", async () => {
      mockVerifiedPrivyUser();
      mocks.listConnectionsForUser.mockResolvedValue([
        { id: "dsc_old", provider: "junction", status: "disconnected" },
      ]);

      const response = await healthMetadataRoute.POST(healthMetadataRequest({
        records: [healthMetadataRecord()],
        schemaVersion: 1,
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "COMPANION_HEALTH_CONNECTION_REQUIRED" },
      });
      expect(mocks.persistHostedDeviceSyncCompanionMetadata).not.toHaveBeenCalled();
    });
  });
});
