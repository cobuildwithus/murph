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

let signInTokenRoute: SignInTokenRouteModule;
let statusRoute: StatusRouteModule;

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

describe("device sync companion routes", () => {
  beforeAll(async () => {
    signInTokenRoute = await import("../app/api/device-sync/companion/sign-in-token/route");
    statusRoute = await import("../app/api/device-sync/companion/status/route");
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
