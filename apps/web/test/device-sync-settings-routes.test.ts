import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { createJsonPostRequest, createRouteContext } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedConsentScopeGranted: vi.fn(),
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  disconnectConnection: vi.fn(),
  getPrisma: vi.fn(),
  getConnectionStatus: vi.fn(),
  listConnections: vi.fn(),
  prismaClient: {
    label: "test-prisma",
  },
  requireActivePrivyMemberAuth: vi.fn(),
  startConnection: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActivePrivyMemberAuth: mocks.requireActivePrivyMemberAuth,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedConsentScopeGranted: mocks.assertHostedConsentScopeGranted,
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type SettingsDeviceSyncRouteModule = typeof import("../app/api/settings/device-sync/route");
type SettingsDeviceSyncSidebarStatusRouteModule = typeof import("../app/api/settings/device-sync/sidebar-status/route");
type SettingsDeviceSyncConnectRouteModule = typeof import("../app/api/settings/device-sync/providers/[provider]/connect/route");
type SettingsDeviceSyncDisconnectRouteModule = typeof import("../app/api/settings/device-sync/connections/[connectionId]/disconnect/route");
type SettingsDeviceSyncStatusRouteModule = typeof import("../app/api/settings/device-sync/connections/[connectionId]/status/route");

let settingsDeviceSyncRoute: SettingsDeviceSyncRouteModule;
let settingsDeviceSyncSidebarStatusRoute: SettingsDeviceSyncSidebarStatusRouteModule;
let settingsDeviceSyncConnectRoute: SettingsDeviceSyncConnectRouteModule;
let settingsDeviceSyncDisconnectRoute: SettingsDeviceSyncDisconnectRouteModule;
let settingsDeviceSyncStatusRoute: SettingsDeviceSyncStatusRouteModule;

describe("device sync settings routes", () => {
  beforeAll(async () => {
    settingsDeviceSyncRoute = await import("../app/api/settings/device-sync/route");
    settingsDeviceSyncSidebarStatusRoute = await import("../app/api/settings/device-sync/sidebar-status/route");
    settingsDeviceSyncConnectRoute = await import("../app/api/settings/device-sync/providers/[provider]/connect/route");
    settingsDeviceSyncDisconnectRoute = await import("../app/api/settings/device-sync/connections/[connectionId]/disconnect/route");
    settingsDeviceSyncStatusRoute = await import("../app/api/settings/device-sync/connections/[connectionId]/status/route");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00.000Z"));
    vi.clearAllMocks();
    vi.stubEnv("OURA_CLIENT_ID", "oura-client");
    vi.stubEnv("OURA_CLIENT_SECRET", "oura-secret");
    vi.stubEnv("JUNCTION_API_KEY", "");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "");
    vi.stubEnv("JUNCTION_ENV", "");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "");
    vi.stubEnv("JUNCTION_REGION", "");
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.assertHostedConsentScopeGranted.mockResolvedValue(undefined);
    mocks.requireActivePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      disconnectConnection: mocks.disconnectConnection,
      getConnectionStatus: mocks.getConnectionStatus,
      listConnections: mocks.listConnections,
      startConnection: mocks.startConnection,
    });
    mocks.getConnectionStatus.mockResolvedValue({
      connection: {
        accessTokenExpiresAt: null,
        connectedAt: "2026-04-01T08:00:00.000Z",
        createdAt: "2026-04-01T08:00:00.000Z",
        displayName: "Alice Oura",
        id: "dspc_oura_123",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-03T07:00:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-03T06:55:00.000Z",
        lastWebhookAt: "2026-04-03T07:01:00.000Z",
        metadata: {},
        nextReconcileAt: "2026-04-03T16:00:00.000Z",
        provider: "oura",
        scopes: ["daily"],
        status: "active",
        updatedAt: "2026-04-03T07:05:00.000Z",
      },
    });
    mocks.listConnections.mockResolvedValue({
      connections: [
        {
          accessTokenExpiresAt: null,
          connectedAt: "2026-04-01T08:00:00.000Z",
          createdAt: "2026-04-01T08:00:00.000Z",
          displayName: "Alice Oura",
          id: "dspc_oura_123",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-04-03T07:00:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-04-03T06:55:00.000Z",
          lastWebhookAt: "2026-04-03T07:01:00.000Z",
          metadata: {},
          nextReconcileAt: "2026-04-03T16:00:00.000Z",
          provider: "oura",
          scopes: ["daily"],
          status: "active",
          updatedAt: "2026-04-03T07:05:00.000Z",
        },
      ],
      providers: [
        {
          callbackPath: "/oauth/oura/callback",
          callbackUrl: "https://join.example.test/oauth/oura/callback",
          defaultScopes: ["daily"],
          provider: "oura",
          supportsWebhooks: true,
          webhookPath: "/webhooks/oura",
          webhookUrl: "https://join.example.test/webhooks/oura",
        },
      ],
    });
    mocks.startConnection.mockResolvedValue({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
    mocks.disconnectConnection.mockResolvedValue({
      warning: {
        code: "REMOTE_REVOKE_FAILED",
        message: "Provider revocation timed out.",
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("lists calm settings sources for the authenticated hosted member", async () => {
    const response = await settingsDeviceSyncRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.listConnections).toHaveBeenCalledWith("member_123");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sources: [
        {
          connectionId: "dspc_oura_123",
          headline: "Connected and syncing normally",
          provider: "oura",
          providerLabel: "Oura",
          statusLabel: "Connected",
          tone: "calm",
        },
      ],
    });
  });

  it("returns a minimized sidebar status summary for the authenticated hosted member", async () => {
    const response = await settingsDeviceSyncSidebarStatusRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/sidebar-status"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.listConnections).toHaveBeenCalledWith("member_123");
    await expect(response.json()).resolves.toEqual({
      generatedAt: "2026-04-03T12:00:00.000Z",
      ok: true,
      status: {
        message: "Oura connected",
        tone: "connected",
      },
    });
  });

  it("starts a hosted settings connect flow for the requested provider", async () => {
    const response = await settingsDeviceSyncConnectRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/settings/device-sync/providers/oura/connect",
        {
          returnTo: "/settings?tab=wearables",
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request), mocks.prismaClient);
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.assertHostedConsentScopeGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
      scope: "feature.connected-health-source",
    });
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "oura",
      "/settings?tab=wearables",
      {
        connectSourceId: "oura",
        connectTarget: "oura",
        sourceProviderSlug: null,
      },
    );
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
  });

  it("starts Garmin settings connect through Junction when Garmin is a Junction target", async () => {
    vi.stubEnv("OURA_CLIENT_ID", "");
    vi.stubEnv("OURA_CLIENT_SECRET", "");
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "fitbit,garmin");
    vi.stubEnv("JUNCTION_REGION", "us");

    const response = await settingsDeviceSyncConnectRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/settings/device-sync/providers/garmin/connect",
        {
          returnTo: "/connect",
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ provider: "garmin" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "junction",
      "/connect",
      {
        connectSourceId: "garmin",
        connectTarget: "garmin",
        sourceProviderSlug: "garmin",
      },
    );
  });

  it("rejects Garmin settings connect when Junction does not expose Garmin", async () => {
    const response = await settingsDeviceSyncConnectRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/settings/device-sync/providers/garmin/connect",
        {
          returnTo: "/connect",
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ provider: "garmin" }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_DEVICE_CONNECT_TARGET_NOT_CONFIGURED",
        message: "Hosted device connect target is not configured.",
        retryable: false,
      },
    });
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it("rejects GET requests on the hosted settings connect route", async () => {
    const response = await settingsDeviceSyncConnectRoute.GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message:
          "Hosted settings device-sync connect routes only allow POST because starting a connection mutates server state.",
      },
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).not.toHaveBeenCalled();
    expect(mocks.requireActivePrivyMemberAuth).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it("returns one settings source for an opaque connection id status lookup", async () => {
    const response = await settingsDeviceSyncStatusRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/connections/dspc_oura_123/status"),
      createRouteContext({ connectionId: "dspc_oura_123" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getConnectionStatus).toHaveBeenCalledWith("member_123", "dspc_oura_123");
    expect(mocks.listConnections).toHaveBeenCalledWith("member_123");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      source: {
        connectionId: "dspc_oura_123",
        provider: "oura",
        statusLabel: "Connected",
        tone: "calm",
      },
    });
  });

  it("disconnects a hosted settings device-sync connection", async () => {
    const response = await settingsDeviceSyncDisconnectRoute.POST(
      new Request("https://join.example.test/api/settings/device-sync/connections/dspc_oura_123/disconnect", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      createRouteContext({ connectionId: "dspc_oura_123" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.disconnectConnection).toHaveBeenCalledWith("member_123", "dspc_oura_123");
    await expect(response.json()).resolves.toEqual({
      warning: {
        code: "REMOTE_REVOKE_FAILED",
        message: "Provider revocation timed out.",
      },
    });
  });

  it("requires hosted auth before starting a connect flow", async () => {
    mocks.requireActivePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await settingsDeviceSyncConnectRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/settings/device-sync/providers/oura/connect",
        {
          returnTo: "/settings",
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("requires connected-health-source consent before starting a connect flow", async () => {
    mocks.assertHostedConsentScopeGranted.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the current Murph legal consent before continuing.",
    }));

    const response = await settingsDeviceSyncConnectRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/settings/device-sync/providers/oura/connect",
        {
          returnTo: "/settings",
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CONSENT_REQUIRED",
        message: "Accept the current Murph legal consent before continuing.",
        retryable: false,
      },
    });
  });

  it("rejects connect requests from an untrusted origin", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        httpStatus: 403,
        message: "Hosted browser mutation origin is not allowed.",
      });
    });

    const response = await settingsDeviceSyncConnectRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/settings/device-sync/providers/oura/connect",
        {
          returnTo: "/settings",
        },
        {
          headers: {
            origin: "https://evil.example.test",
          },
        },
      ),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireActivePrivyMemberAuth).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        message: "Hosted browser mutation origin is not allowed.",
        retryable: false,
      },
    });
  });

  it("requires hosted auth before disconnecting a source", async () => {
    mocks.requireActivePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await settingsDeviceSyncDisconnectRoute.POST(
      new Request("https://join.example.test/api/settings/device-sync/connections/dspc_oura_123/disconnect", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
      createRouteContext({ connectionId: "dspc_oura_123" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.disconnectConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("rejects disconnect requests from an untrusted origin", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        httpStatus: 403,
        message: "Hosted browser mutation origin is not allowed.",
      });
    });

    const response = await settingsDeviceSyncDisconnectRoute.POST(
      new Request("https://join.example.test/api/settings/device-sync/connections/dspc_oura_123/disconnect", {
        headers: {
          origin: "https://evil.example.test",
        },
        method: "POST",
      }),
      createRouteContext({ connectionId: "dspc_oura_123" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireActivePrivyMemberAuth).not.toHaveBeenCalled();
    expect(mocks.disconnectConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        message: "Hosted browser mutation origin is not allowed.",
        retryable: false,
      },
    });
  });
});
