import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { createJsonPostRequest, createRouteContext } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  createBrowserConnectionId: vi.fn(),
  diagnoseBackfill: vi.fn(),
  disconnectConnection: vi.fn(),
  getConnectionForUser: vi.fn(),
  getPrisma: vi.fn(),
  getConnectionStatus: vi.fn(),
  getStoredConnectionAccountForUser: vi.fn(),
  listConnections: vi.fn(),
  listConnectionsForUser: vi.fn(),
  probeRest: vi.fn(),
  prismaClient: {
    label: "test-prisma",
  },
  registryGet: vi.fn(),
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
type SettingsDeviceSyncDiagnoseBackfillRouteModule =
  typeof import("../app/api/settings/device-sync/diagnose-backfill/route");
type SettingsDeviceSyncDisconnectRouteModule = typeof import("../app/api/settings/device-sync/connections/[connectionId]/disconnect/route");
type SettingsDeviceSyncStatusRouteModule = typeof import("../app/api/settings/device-sync/connections/[connectionId]/status/route");
type ConnectSourceStartRouteModule = typeof import("../app/api/connect-sources/[sourceId]/start/route");

let settingsDeviceSyncRoute: SettingsDeviceSyncRouteModule;
let settingsDeviceSyncSidebarStatusRoute: SettingsDeviceSyncSidebarStatusRouteModule;
let settingsDeviceSyncDiagnoseBackfillRoute: SettingsDeviceSyncDiagnoseBackfillRouteModule;
let settingsDeviceSyncDisconnectRoute: SettingsDeviceSyncDisconnectRouteModule;
let settingsDeviceSyncStatusRoute: SettingsDeviceSyncStatusRouteModule;
let connectSourceStartRoute: ConnectSourceStartRouteModule;

describe("device sync settings routes", () => {
  beforeAll(async () => {
    settingsDeviceSyncRoute = await import("../app/api/settings/device-sync/route");
    settingsDeviceSyncSidebarStatusRoute = await import("../app/api/settings/device-sync/sidebar-status/route");
    settingsDeviceSyncDiagnoseBackfillRoute =
      await import("../app/api/settings/device-sync/diagnose-backfill/route");
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
    vi.stubEnv("DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED", "true");
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.requireActivePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      connections: {
        createBrowserConnectionId: mocks.createBrowserConnectionId,
      },
      disconnectConnection: mocks.disconnectConnection,
      getConnectionStatus: mocks.getConnectionStatus,
      listConnections: mocks.listConnections,
      publicIngressBaseUrl: "http://localhost:3000/api/device-sync",
      publicIngressBaseUrlSource: "request",
      registry: {
        get: mocks.registryGet,
      },
      startConnection: mocks.startConnection,
      store: {
        getConnectionForUser: mocks.getConnectionForUser,
        getStoredConnectionAccountForUser: mocks.getStoredConnectionAccountForUser,
        listConnectionsForUser: mocks.listConnectionsForUser,
      },
    });
    mocks.createBrowserConnectionId.mockImplementation((connectionId: string) =>
      connectionId === "dsc_junction_123" ? "dspc_junction_123" : connectionId
    );
    mocks.registryGet.mockReturnValue({
      credentialPolicy: {
        kind: "provider_config",
        providerConfigKey: "junction",
      },
      diagnostics: {
        diagnoseBackfill: mocks.diagnoseBackfill,
        probeRest: mocks.probeRest,
      },
      descriptor: {
        provider: "junction",
        webhook: {
          path: "/webhooks/junction",
          supportsAdmin: false,
        },
      },
      provider: "junction",
    });
    mocks.getConnectionForUser.mockResolvedValue(null);
    mocks.getStoredConnectionAccountForUser.mockResolvedValue(null);
    mocks.listConnectionsForUser.mockResolvedValue([]);
    mocks.diagnoseBackfill.mockResolvedValue({
      generatedAt: "2026-04-03T12:00:00.000Z",
      provider: "junction",
      result: {
        account: {
          historicalBackfill: null,
          setupPhase: "link_returned",
          status: "active",
        },
        sourceProviders: {
          ok: true,
          recordCount: 1,
          sourceProviderSlugs: ["garmin"],
        },
        summary: {
          hasUsefulHistoricalRecords: false,
          resources: [],
        },
        timeseriesProbe: {
          days: 1,
          resources: [],
          window: null,
        },
        window: {
          windowEnd: "2026-04-03T12:00:00.000Z",
          windowStart: "2026-01-04T12:00:00.000Z",
        },
      },
    });
    mocks.probeRest.mockResolvedValue({
      generatedAt: "2026-04-03T12:00:00.000Z",
      provider: "junction",
      result: {
        request: {
          endpoint: "timeseries",
          endpointKind: "junction_timeseries_collection",
          resource: "steps",
          resourceCategory: "timeseries",
        },
        response: {
          ok: true,
          recordCount: 1,
          responseStatus: 200,
          shape: {
            kind: "object",
            keys: ["timestamp", "value"],
          },
        },
      },
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

  it("diagnoses Junction backfill using the visible provider-config connection when no stored account is hydrated", async () => {
    mocks.listConnections.mockResolvedValueOnce({
      connectionSources: [
        {
          connectionId: "dspc_junction_123",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-04-03T07:01:00.000Z",
          resourceCount: 0,
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
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastSyncStartedAt: null,
          lastWebhookAt: null,
          metadata: {
            junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
            junctionHistoricalBackfillWindowStart: "2026-01-04T00:00:00.000Z",
          },
          nextReconcileAt: "2026-04-03T16:00:00.000Z",
          provider: "junction",
          scopes: [],
          setupPhase: "link_returned",
          status: "active",
          updatedAt: "2026-04-03T08:00:00.000Z",
        },
      ],
      providers: [],
    });
    mocks.listConnectionsForUser.mockResolvedValueOnce([
      {
        accessTokenExpiresAt: null,
        connectedAt: "2026-04-01T08:00:00.000Z",
        createdAt: "2026-04-01T08:00:00.000Z",
        displayName: "Junction",
        externalAccountId: "junction-user-redacted",
        id: "dsc_junction_123",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        metadata: {
          junctionHistoricalBackfillWindowEnd: "2026-04-03T00:00:00.000Z",
          junctionHistoricalBackfillWindowStart: "2026-01-04T00:00:00.000Z",
        },
        nextReconcileAt: "2026-04-03T16:00:00.000Z",
        provider: "junction",
        scopes: [],
        setupPhase: "link_returned",
        status: "active",
        updatedAt: "2026-04-03T08:00:00.000Z",
      },
    ]);

    const response = await settingsDeviceSyncDiagnoseBackfillRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/diagnose-backfill?provider=junction&timeseriesDays=0"),
    );

    expect(response.status).toBe(200);
    expect(mocks.getStoredConnectionAccountForUser).toHaveBeenCalledWith(
      "member_123",
      "dsc_junction_123",
    );
    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
    expect(mocks.diagnoseBackfill).toHaveBeenCalledWith(expect.objectContaining({
      account: expect.objectContaining({
        credential: {
          credentialMetadata: {},
          kind: "provider_config",
          providerConfigKey: "junction",
        },
        externalAccountId: "junction-user-redacted",
        id: "dsc_junction_123",
      }),
      timeseriesProbeDays: 0,
    }));
    const body = await response.json();
    expect(body).toMatchObject({
      diagnostic: {
        summary: {
          hasUsefulHistoricalRecords: false,
        },
      },
      ok: true,
      publicIngress: {
        baseUrl: "http://localhost:3000/api/device-sync",
        externalReachability: "loopback",
        providerAcceptsWebhooks: true,
        providerSupportsWebhookAdmin: false,
        source: "request",
        webhookPath: "/webhooks/junction",
        webhookUrl: "http://localhost:3000/api/device-sync/webhooks/junction",
      },
      selectedConnection: {
        connectionMatchCount: 1,
        externalAccountIdHash: "ad0b0599272ae642d955ad6b2128dc6e0068605c038942d1e1f95ea6ade9d10a",
        lastErrorCode: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: "2026-04-03T16:00:00.000Z",
        provider: "junction",
        setupPhase: "link_returned",
        status: "active",
      },
      webSourceProjection: [
        {
          resourceCount: 0,
          sourceKey: "source_1",
          status: "connected",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("garmin");
    expect(JSON.stringify(body)).not.toContain("junction-user-redacted");
  });

  it("runs a Junction REST diagnostic probe through the backfill diagnostic route", async () => {
    mocks.listConnections.mockResolvedValueOnce({
      connectionSources: [
        {
          connectionId: "dspc_junction_123",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-04-03T07:01:00.000Z",
          resourceCount: 20,
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
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastSyncStartedAt: null,
          lastWebhookAt: null,
          metadata: {},
          nextReconcileAt: "2026-04-03T16:00:00.000Z",
          provider: "junction",
          scopes: [],
          setupPhase: "source_confirmed",
          status: "active",
          updatedAt: "2026-04-03T08:00:00.000Z",
        },
      ],
      providers: [],
    });
    mocks.listConnectionsForUser.mockResolvedValueOnce([
      {
        accessTokenExpiresAt: null,
        connectedAt: "2026-04-01T08:00:00.000Z",
        createdAt: "2026-04-01T08:00:00.000Z",
        displayName: "Junction",
        externalAccountId: "junction-user-redacted",
        id: "dsc_junction_123",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        metadata: {},
        nextReconcileAt: "2026-04-03T16:00:00.000Z",
        provider: "junction",
        scopes: [],
        setupPhase: "source_confirmed",
        status: "active",
        updatedAt: "2026-04-03T08:00:00.000Z",
      },
    ]);

    const response = await settingsDeviceSyncDiagnoseBackfillRoute.GET(
      new Request(
        "https://join.example.test/api/settings/device-sync/diagnose-backfill?provider=junction&restProbe=timeseries&resource=steps&sourceProvider=garmin&windowStart=2026-04-02T00:00:00.000Z&windowEnd=2026-04-03T00:00:00.000Z",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.probeRest).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "timeseries",
      now: "2026-04-03T12:00:00.000Z",
      resource: "steps",
      sourceProviderSlug: "garmin",
      windowEnd: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-02T00:00:00.000Z",
    }));
    expect(mocks.probeRest).toHaveBeenCalledWith(expect.objectContaining({
      account: expect.objectContaining({
        externalAccountId: "junction-user-redacted",
        id: "dsc_junction_123",
      }),
    }));
    const bodyText = await response.text();
    expect(bodyText).not.toContain("junction-user-redacted");
    expect(bodyText).not.toContain("garmin");
    expect(JSON.parse(bodyText)).toMatchObject({
      ok: true,
      restProbe: {
        provider: "junction",
        result: {
          request: {
            endpoint: "timeseries",
            resource: "steps",
          },
          response: {
            ok: true,
            recordCount: 1,
          },
        },
      },
    });
  });

  it("rejects Junction refresh REST diagnostics from the GET backfill diagnostic route", async () => {
    const response = await settingsDeviceSyncDiagnoseBackfillRoute.GET(
      new Request(
        "https://join.example.test/api/settings/device-sync/diagnose-backfill?provider=junction&restProbe=refresh&timeout=45",
      ),
    );

    expect(response.status).toBe(405);
    expect(mocks.probeRest).not.toHaveBeenCalled();
  });

  it("runs a Junction refresh REST diagnostic through the POST backfill diagnostic route", async () => {
    mocks.probeRest.mockResolvedValueOnce({
      generatedAt: "2026-04-03T12:00:00.000Z",
      provider: "junction",
      result: {
        request: {
          endpoint: "refresh",
          endpointKind: "junction_user_refresh",
          method: "POST",
          queryParameterNames: ["timeout"],
          timeoutSeconds: 45,
        },
        response: {
          failedSourceCount: 0,
          inProgressSourceCount: 0,
          ok: true,
          refreshedSourceCount: 1,
          responseStatus: 200,
          success: true,
        },
      },
    });
    mocks.listConnections.mockResolvedValueOnce({
      connectionSources: [],
      connections: [
        {
          accessTokenExpiresAt: null,
          connectedAt: "2026-04-01T08:00:00.000Z",
          createdAt: "2026-04-01T08:00:00.000Z",
          displayName: "Junction",
          id: "dspc_junction_123",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastSyncStartedAt: null,
          lastWebhookAt: null,
          metadata: {},
          nextReconcileAt: "2026-04-03T16:00:00.000Z",
          provider: "junction",
          scopes: [],
          setupPhase: "source_confirmed",
          status: "active",
          updatedAt: "2026-04-03T08:00:00.000Z",
        },
      ],
      providers: [],
    });
    mocks.listConnectionsForUser.mockResolvedValueOnce([
      {
        accessTokenExpiresAt: null,
        connectedAt: "2026-04-01T08:00:00.000Z",
        createdAt: "2026-04-01T08:00:00.000Z",
        displayName: "Junction",
        externalAccountId: "junction-user-redacted",
        id: "dsc_junction_123",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        metadata: {},
        nextReconcileAt: "2026-04-03T16:00:00.000Z",
        provider: "junction",
        scopes: [],
        setupPhase: "source_confirmed",
        status: "active",
        updatedAt: "2026-04-03T08:00:00.000Z",
      },
    ]);

    const response = await settingsDeviceSyncDiagnoseBackfillRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/settings/device-sync/diagnose-backfill?provider=junction&restProbe=refresh&timeout=45",
        {},
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.probeRest).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "refresh",
      now: "2026-04-03T12:00:00.000Z",
      resource: null,
      sourceProviderSlug: null,
      timeoutSeconds: 45,
      windowEnd: null,
      windowStart: null,
    }));
    const bodyText = await response.text();
    expect(bodyText).not.toContain("junction-user-redacted");
    expect(bodyText).not.toContain("garmin");
    expect(JSON.parse(bodyText)).toMatchObject({
      ok: true,
      restProbe: {
        provider: "junction",
        result: {
          request: {
            endpoint: "refresh",
            method: "POST",
            timeoutSeconds: 45,
          },
          response: {
            ok: true,
            success: true,
          },
        },
      },
    });
  });

  it("does not run Junction backfill diagnostics for inactive connections", async () => {
    mocks.listConnections.mockResolvedValueOnce({
      connectionSources: [],
      connections: [
        {
          accessTokenExpiresAt: null,
          connectedAt: "2026-04-01T08:00:00.000Z",
          createdAt: "2026-04-01T08:00:00.000Z",
          displayName: "Junction",
          id: "dspc_junction_123",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: null,
          lastSyncErrorAt: null,
          lastSyncStartedAt: null,
          lastWebhookAt: null,
          metadata: {},
          nextReconcileAt: null,
          provider: "junction",
          scopes: [],
          setupPhase: null,
          status: "disconnected",
          updatedAt: "2026-04-03T08:00:00.000Z",
        },
      ],
      providers: [],
    });

    const response = await settingsDeviceSyncDiagnoseBackfillRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/diagnose-backfill?provider=junction"),
    );

    expect(response.status).toBe(409);
    expect(mocks.diagnoseBackfill).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "DEVICE_SYNC_DIAGNOSTIC_CONNECTION_NOT_ACTIVE",
        message: "Backfill diagnostics require an active device-sync connection.",
        retryable: false,
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

  it("uses an explicit provider selector when a visible source has direct and Junction targets", async () => {
    vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "whoop_v2");
    vi.stubEnv("JUNCTION_REGION", "us");

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/whoop/start",
        {
          connectTarget: "whoop",
          provider: "junction",
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ sourceId: "whoop" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "junction",
      "/device-sync/connect/complete?source=connect&connectSource=whoop&connectTarget=whoop",
      {
        connectSourceId: "whoop",
        connectTarget: "whoop",
        sourceProviderSlug: "whoop_v2",
      },
    );
  });

  it("uses the preferred source target when a visible source selector omits provider", async () => {
    vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "whoop_v2");
    vi.stubEnv("JUNCTION_REGION", "us");

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/whoop/start",
        {
          connectTarget: "whoop",
        },
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ sourceId: "whoop" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "junction",
      "/device-sync/connect/complete?source=connect&connectSource=whoop&connectTarget=whoop",
      {
        connectSourceId: "whoop",
        connectTarget: "whoop",
        sourceProviderSlug: "whoop_v2",
      },
    );
  });

  it("reports malformed hosted connect provider config as a server configuration failure", async () => {
    vi.stubEnv("OURA_CLIENT_SECRET", "");

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

    expect(response.status).toBe(503);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_DEVICE_CONNECT_SOURCE_CONFIGURATION_UNAVAILABLE",
        message: "Hosted device connect source configuration is temporarily unavailable.",
        retryable: true,
      },
    });
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

  it("keeps upstream source context on connection status lookups", async () => {
    const junctionConnection = {
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
      updatedAt: "2026-04-03T08:00:00.000Z",
    };
    mocks.getConnectionStatus.mockResolvedValueOnce({
      connection: junctionConnection,
    });
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
          ...junctionConnection,
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

    const response = await settingsDeviceSyncStatusRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/connections/dspc_junction_123/status"),
      createRouteContext({ connectionId: "dspc_junction_123" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      source: {
        connectionId: "dspc_junction_123",
        provider: "junction",
        providerLabel: "Garmin",
        statusLabel: "Connected",
        tone: "calm",
        updatedAt: "2026-04-03T08:00:00.000Z",
        upstreamSources: [
          {
            providerLabel: "Garmin",
            resourceCount: 3,
            sourceProviderSlug: "garmin",
            status: "connected",
          },
        ],
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
