import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { createJsonPostRequest, createRouteContext } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
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

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActivePrivyMemberAuth,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type SettingsDeviceSyncRouteModule = typeof import("../app/api/settings/device-sync/route");
type SettingsDeviceSyncSidebarStatusRouteModule = typeof import("../app/api/settings/device-sync/sidebar-status/route");
type SettingsDeviceSyncDisconnectRouteModule = typeof import("../app/api/settings/device-sync/connections/[connectionId]/disconnect/route");
type SettingsDeviceSyncStatusRouteModule = typeof import("../app/api/settings/device-sync/connections/[connectionId]/status/route");
type ConnectSourceStartRouteModule = typeof import("../app/api/connect-sources/[sourceId]/start/route");

let settingsDeviceSyncRoute: SettingsDeviceSyncRouteModule;
let settingsDeviceSyncSidebarStatusRoute: SettingsDeviceSyncSidebarStatusRouteModule;
let settingsDeviceSyncDisconnectRoute: SettingsDeviceSyncDisconnectRouteModule;
let settingsDeviceSyncStatusRoute: SettingsDeviceSyncStatusRouteModule;
let connectSourceStartRoute: ConnectSourceStartRouteModule;

describe("device sync settings routes", () => {
  beforeAll(async () => {
    settingsDeviceSyncRoute = await import("../app/api/settings/device-sync/route");
    settingsDeviceSyncSidebarStatusRoute = await import("../app/api/settings/device-sync/sidebar-status/route");
    settingsDeviceSyncDisconnectRoute = await import("../app/api/settings/device-sync/connections/[connectionId]/disconnect/route");
    settingsDeviceSyncStatusRoute = await import("../app/api/settings/device-sync/connections/[connectionId]/status/route");
    connectSourceStartRoute = await import("../app/api/connect-sources/[sourceId]/start/route");
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
      connectionSources: [],
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

  it("returns a Junction upstream wearable label in the minimized sidebar status", async () => {
    mocks.listConnections.mockResolvedValueOnce({
      connectionSources: [
        {
          connectionId: "dspc_junction_123",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-04-03T07:01:00.000Z",
          resourceCount: 3,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
      ],
      connections: [
        {
          accessTokenExpiresAt: null,
          connectedAt: "2026-04-01T08:00:00.000Z",
          createdAt: "2026-04-01T08:00:00.000Z",
          displayName: "Junction",
          id: "dspc_junction_123",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-04-03T07:00:00.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-04-03T06:55:00.000Z",
          lastWebhookAt: "2026-04-03T07:01:00.000Z",
          metadata: {},
          nextReconcileAt: "2026-04-03T16:00:00.000Z",
          provider: "junction",
          scopes: [],
          status: "active",
          updatedAt: "2026-04-03T07:05:00.000Z",
        },
      ],
      providers: [
        {
          callbackPath: "/connect/junction/callback",
          callbackUrl: "https://join.example.test/connect/junction/callback",
          defaultScopes: [],
          provider: "junction",
          supportsWebhooks: true,
          webhookPath: "/webhooks/junction",
          webhookUrl: "https://join.example.test/webhooks/junction",
        },
      ],
    });

    const response = await settingsDeviceSyncSidebarStatusRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/sidebar-status"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: {
        message: "Garmin connected",
        tone: "connected",
      },
    });
  });

  it("starts a hosted connect source flow by source id with the server-owned completion return", async () => {
    mocks.startConnection.mockResolvedValueOnce({
      authorizationUrl: "https://provider.example.test/oauth/source-start",
      state: "state_browser_leak",
    });

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/oura/start",
        {
          returnTo: "/connect?connectSource=oura",
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ sourceId: "oura" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "oura",
      "/device-sync/connect/complete?source=connect&connectSource=oura&connectTarget=oura",
      {
        connectSourceId: "oura",
        connectTarget: "oura",
        sourceProviderSlug: null,
      },
    );
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/source-start",
    });
  });

  it("starts a hosted connect source flow through Junction by source id", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "garmin");
    vi.stubEnv("JUNCTION_REGION", "us");

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/garmin/start",
        {},
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ sourceId: "garmin" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "junction",
      "/device-sync/connect/complete?source=connect&connectSource=garmin&connectTarget=garmin",
      {
        connectSourceId: "garmin",
        connectTarget: "garmin",
        sourceProviderSlug: "garmin",
      },
    );
  });

  it("requires hosted auth before starting a connect source flow", async () => {
    mocks.requireActivePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/oura/start",
        {},
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ sourceId: "oura" }),
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

  it("requires launch consent before starting a connect source flow", async () => {
    mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 403,
      message: "Accept the current Murph legal consent before continuing.",
    }));

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/oura/start",
        {},
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ sourceId: "oura" }),
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

  it("rejects connect source requests from an untrusted origin", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {
      throw hostedOnboardingError({
        code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
        httpStatus: 403,
        message: "Hosted browser mutation origin is not allowed.",
      });
    });

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/oura/start",
        {},
        {
          headers: {
            origin: "https://evil.example.test",
          },
        },
      ),
      createRouteContext({ sourceId: "oura" }),
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
