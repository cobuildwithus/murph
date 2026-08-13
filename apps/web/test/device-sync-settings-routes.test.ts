import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { createHostedBrowserConnectionId } from "../src/lib/device-sync/public-connection";
import { STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION } from "../src/lib/device-sync/provider-setup/registry";
import { createJsonPostRequest, createRouteContext } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  authorizeMemberOwnedProviderSetup: vi.fn(),
  cancelMemberOwnedProviderSetup: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  createBrowserConnectionId: vi.fn(),
  diagnoseBackfill: vi.fn(),
  disconnectConnection: vi.fn(),
  disconnectConnectionSource: vi.fn(),
  findManyDeviceConnectionSources: vi.fn(),
  findManyDeviceConnections: vi.fn(),
  getConnectionForUser: vi.fn(),
  getPrisma: vi.fn(),
  getConnectionStatus: vi.fn(),
  getStoredConnectionAccountForUser: vi.fn(),
  issueMemberOwnedProviderSetupHandoff: vi.fn(),
  listConfiguredDeviceSyncPublicProviderDescriptors: vi.fn(),
  listConnectionSources: vi.fn(),
  listConnections: vi.fn(),
  listConnectionsForUser: vi.fn(),
  markMemberOwnedSetupDisconnected: vi.fn(),
  readMemberOwnedProviderSetup: vi.fn(),
  readMemberOwnedProviderSetupRegistration: vi.fn(),
  probeRest: vi.fn(),
  prepareConnectionStart: vi.fn(),
  prismaClient: {} as {
    deviceConnection: { findMany: ReturnType<typeof vi.fn> };
    deviceConnectionSource: { findMany: ReturnType<typeof vi.fn> };
    label: string;
  },
  registryGet: vi.fn(),
  requireActivePrivyMemberAuth: vi.fn(),
  startConnection: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/device-sync/provider-setup", () => ({
  createMemberOwnedProviderSetupService: () => ({
    authorizeAndContinue: mocks.authorizeMemberOwnedProviderSetup,
    cancel: mocks.cancelMemberOwnedProviderSetup,
    issueHandoff: mocks.issueMemberOwnedProviderSetupHandoff,
    markDisconnected: mocks.markMemberOwnedSetupDisconnected,
    read: mocks.readMemberOwnedProviderSetup,
  }),
  readMemberOwnedProviderSetupRegistration: mocks.readMemberOwnedProviderSetupRegistration,
}));

vi.mock("@/src/lib/device-sync/providers", () => ({
  createHostedDeviceSyncRegistry: vi.fn(() => ({
    get: mocks.registryGet,
  })),
}));

vi.mock("@murphai/device-syncd/public-provider-descriptors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/device-syncd/public-provider-descriptors")>();

  return {
    ...actual,
    listConfiguredDeviceSyncPublicProviderDescriptors: (
      ...args: Parameters<typeof actual.listConfiguredDeviceSyncPublicProviderDescriptors>
    ) => {
      mocks.listConfiguredDeviceSyncPublicProviderDescriptors(...args);
      return actual.listConfiguredDeviceSyncPublicProviderDescriptors(...args);
    },
  };
});

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActivePrivyMemberAuth,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted:
    mocks.assertHostedHistoricalLaunchConsentGranted,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type SettingsDeviceSyncRouteModule = typeof import("../app/api/settings/device-sync/route");
type SettingsDeviceSyncSidebarStatusRouteModule = typeof import("../app/api/settings/device-sync/sidebar-status/route");
type SettingsDeviceSyncDiagnoseBackfillRouteModule =
  typeof import("../app/api/settings/device-sync/diagnose-backfill/route");
type SettingsDeviceSyncDisconnectRouteModule = typeof import("../app/api/settings/device-sync/connections/[connectionId]/disconnect/route");
type SettingsDeviceSyncSourceDisconnectRouteModule =
  typeof import("../app/api/settings/device-sync/connections/[connectionId]/sources/[sourceProviderSlug]/disconnect/route");
type SettingsDeviceSyncStatusRouteModule = typeof import("../app/api/settings/device-sync/connections/[connectionId]/status/route");
type SettingsDeviceSyncProviderSetupRouteModule = typeof import("../app/api/settings/device-sync/provider-setups/[provider]/route");
type ConnectSourceStartRouteModule = typeof import("../app/api/connect-sources/[sourceId]/start/route");

let settingsDeviceSyncRoute: SettingsDeviceSyncRouteModule;
let settingsDeviceSyncSidebarStatusRoute: SettingsDeviceSyncSidebarStatusRouteModule;
let settingsDeviceSyncDiagnoseBackfillRoute: SettingsDeviceSyncDiagnoseBackfillRouteModule;
let settingsDeviceSyncDisconnectRoute: SettingsDeviceSyncDisconnectRouteModule;
let settingsDeviceSyncSourceDisconnectRoute: SettingsDeviceSyncSourceDisconnectRouteModule;
let settingsDeviceSyncStatusRoute: SettingsDeviceSyncStatusRouteModule;
let settingsDeviceSyncProviderSetupRoute: SettingsDeviceSyncProviderSetupRouteModule;
let connectSourceStartRoute: ConnectSourceStartRouteModule;

const ROUTING_INDEX_KEY = Buffer.from(
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "hex",
);
const OURA_PUBLIC_CONNECTION_ID = createHostedBrowserConnectionId(
  ROUTING_INDEX_KEY,
  "dsc_oura_123",
);
const JUNCTION_PUBLIC_CONNECTION_ID = createHostedBrowserConnectionId(
  ROUTING_INDEX_KEY,
  "dsc_junction_123",
);

function buildDeviceConnectionRecord(overrides: Partial<{
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  connectedAt: Date;
  createdAt: Date;
  credentialKind: "oauth_tokens" | "provider_config" | "none";
  credentialMetadataJson: Record<string, unknown>;
  displayName: string | null;
  externalAccountIdEncrypted: string | null;
  id: string;
  keyVersion: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastSyncCompletedAt: Date | null;
  lastSyncErrorAt: Date | null;
  lastSyncStartedAt: Date | null;
  lastWebhookAt: Date | null;
  metadataJson: Record<string, unknown>;
  nextReconcileAt: Date | null;
  provider: string;
  providerAccountBlindIndex: string | null;
  providerConfigKey: string | null;
  refreshLeaseExpiresAt: Date | null;
  refreshLeaseOwner: string | null;
  refreshLeaseTokenVersion: number | null;
  refreshTokenEncrypted: string | null;
  scopesJson: string[];
  setupExpiresAt: Date | null;
  setupPhase: "pending_link" | "link_returned" | "source_confirmed" | "failed" | null;
  status: "active" | "reauthorization_required" | "disconnected";
  tokenVersion: number | null;
  updatedAt: Date;
  userId: string;
}> = {}) {
  return {
    accessTokenEncrypted: null,
    accessTokenExpiresAt: null,
    connectedAt: new Date("2026-04-01T08:00:00.000Z"),
    createdAt: new Date("2026-04-01T08:00:00.000Z"),
    credentialKind: "oauth_tokens" as const,
    credentialMetadataJson: {},
    displayName: null,
    externalAccountIdEncrypted: null,
    id: "dsc_123",
    keyVersion: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastSyncStartedAt: null,
    lastWebhookAt: null,
    metadataJson: {},
    nextReconcileAt: null,
    provider: "oura",
    providerAccountBlindIndex: null,
    providerConfigKey: null,
    refreshLeaseExpiresAt: null,
    refreshLeaseOwner: null,
    refreshLeaseTokenVersion: null,
    refreshTokenEncrypted: null,
    scopesJson: [],
    setupExpiresAt: null,
    setupPhase: null,
    status: "active" as const,
    tokenVersion: null,
    updatedAt: new Date("2026-04-01T08:05:00.000Z"),
    userId: "member_123",
    ...overrides,
  };
}

function buildDeviceConnectionSourceRecord(overrides: Partial<{
  connectionId: string;
  createdAt: Date;
  displayName: string | null;
  firstSeenAt: Date;
  id: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastSeenAt: Date;
  resourceAvailabilitySummaryJson: Record<string, unknown> | null;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  status: "connected" | "disconnected" | "error" | "unavailable";
  updatedAt: Date;
}> = {}) {
  return {
    connectionId: "dsc_123",
    createdAt: new Date("2026-04-01T08:00:00.000Z"),
    displayName: null,
    firstSeenAt: new Date("2026-04-01T08:00:00.000Z"),
    id: "dcs_123",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: new Date("2026-04-03T07:01:00.000Z"),
    resourceAvailabilitySummaryJson: null,
    sourceInstanceKey: "source_123",
    sourceProviderSlug: "garmin",
    status: "connected" as const,
    updatedAt: new Date("2026-04-03T07:01:00.000Z"),
    ...overrides,
  };
}

function buildHostedDeviceConnectionSource(overrides: Partial<{
  connectionId: string;
  createdAt: string;
  displayName: string | null;
  firstSeenAt: string;
  id: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastSeenAt: string;
  resourceAvailabilitySummary: Record<string, unknown> | null;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  status: "connected" | "disconnected" | "error" | "unavailable";
  updatedAt: string;
}> = {}) {
  return {
    connectionId: "dsc_junction_123",
    createdAt: "2026-04-01T08:00:00.000Z",
    displayName: null,
    firstSeenAt: "2026-04-01T08:00:00.000Z",
    id: "dcs_123",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T07:01:00.000Z",
    resourceAvailabilitySummary: null,
    sourceInstanceKey: "garmin:default",
    sourceProviderSlug: "garmin",
    status: "connected" as const,
    updatedAt: "2026-04-03T07:01:00.000Z",
    ...overrides,
  };
}

describe("device sync settings routes", () => {
  beforeAll(async () => {
    settingsDeviceSyncRoute = await import("../app/api/settings/device-sync/route");
    settingsDeviceSyncSidebarStatusRoute = await import("../app/api/settings/device-sync/sidebar-status/route");
    settingsDeviceSyncDiagnoseBackfillRoute =
      await import("../app/api/settings/device-sync/diagnose-backfill/route");
    settingsDeviceSyncDisconnectRoute = await import("../app/api/settings/device-sync/connections/[connectionId]/disconnect/route");
    settingsDeviceSyncSourceDisconnectRoute = await import(
      "../app/api/settings/device-sync/connections/[connectionId]/sources/[sourceProviderSlug]/disconnect/route"
    );
    settingsDeviceSyncStatusRoute = await import("../app/api/settings/device-sync/connections/[connectionId]/status/route");
    settingsDeviceSyncProviderSetupRoute = await import(
      "../app/api/settings/device-sync/provider-setups/[provider]/route"
    );
    connectSourceStartRoute = await import("../app/api/connect-sources/[sourceId]/start/route");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00.000Z"));
    vi.clearAllMocks();
    vi.stubEnv("OURA_CLIENT_ID", "oura-client");
    vi.stubEnv("OURA_CLIENT_SECRET", "oura-secret");
    vi.stubEnv(
      "HOSTED_DEVICE_ROUTING_INDEX_KEY",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    vi.stubEnv("JUNCTION_API_KEY", "");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "");
    vi.stubEnv("JUNCTION_ENV", "");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "");
    vi.stubEnv("JUNCTION_REGION", "");
    vi.stubEnv("DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED", "true");
    vi.stubEnv(
      "DEVICE_SYNC_PUBLIC_BASE_URL",
      "https://join.example.test/api/device-sync",
    );
    mocks.prismaClient.deviceConnection = {
      findMany: mocks.findManyDeviceConnections,
    };
    mocks.prismaClient.deviceConnectionSource = {
      findMany: mocks.findManyDeviceConnectionSources,
    };
    mocks.prismaClient.label = "test-prisma";
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.assertHostedHistoricalLaunchConsentGranted.mockResolvedValue(undefined);
    mocks.requireActivePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
      sessionId: "session_123",
    });
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      createBrowserConnectionId: mocks.createBrowserConnectionId,
      publicIngressBaseUrl: "http://localhost:3000/api/device-sync",
      publicIngressBaseUrlSource: "request",
      env: {
        routingIndexKey: ROUTING_INDEX_KEY,
      },
      store: {
        getConnectionForUser: mocks.getConnectionForUser,
        getStoredConnectionAccountForUser: mocks.getStoredConnectionAccountForUser,
        listConnectionSources: mocks.listConnectionSources,
        listConnectionsForUser: mocks.listConnectionsForUser,
      },
    });
    mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
      disconnectConnection: mocks.disconnectConnection,
      disconnectConnectionSource: mocks.disconnectConnectionSource,
      prepareConnectionStart: mocks.prepareConnectionStart,
      startConnection: mocks.startConnection,
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
    mocks.listConnectionSources.mockResolvedValue([]);
    mocks.listConnectionsForUser.mockResolvedValue([]);
    mocks.findManyDeviceConnections.mockResolvedValue([
      buildDeviceConnectionRecord({
        displayName: "Alice Oura",
        id: "dsc_oura_123",
        lastSyncCompletedAt: new Date("2026-04-03T07:00:00.000Z"),
        lastSyncStartedAt: new Date("2026-04-03T06:55:00.000Z"),
        lastWebhookAt: new Date("2026-04-03T07:01:00.000Z"),
        nextReconcileAt: new Date("2026-04-03T16:00:00.000Z"),
        provider: "oura",
        scopesJson: ["daily"],
        updatedAt: new Date("2026-04-03T07:05:00.000Z"),
      }),
    ]);
    mocks.findManyDeviceConnectionSources.mockResolvedValue([]);
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
      state: "callback_state_1234567890",
    });
    mocks.disconnectConnection.mockResolvedValue({
      connection: {
        id: "dspc_oura_123",
        provider: "oura",
        status: "disconnected",
      },
      warning: {
        code: "REMOTE_REVOKE_FAILED",
        message: "Provider revocation timed out.",
      },
    });
    mocks.cancelMemberOwnedProviderSetup.mockResolvedValue({
      action: "authorize",
      applicationRevision: null,
      connected: false,
      message: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION.messages.canceled,
      provider: "strava",
      setupId: "dps_synthetic",
      status: "canceled",
      updatedAt: "2026-04-03T12:00:00.000Z",
    });
    mocks.issueMemberOwnedProviderSetupHandoff.mockResolvedValue(
      "https://join.example.test/computer/handoff/synthetic-capability",
    );
    mocks.markMemberOwnedSetupDisconnected.mockResolvedValue(undefined);
    mocks.readMemberOwnedProviderSetupRegistration.mockReturnValue(null);
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
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    expect(mocks.listConfiguredDeviceSyncPublicProviderDescriptors).toHaveBeenCalledWith(
      expect.objectContaining({
        oura: expect.any(Object),
      }),
      {
        publicBaseUrl: "https://join.example.test/api/device-sync",
      },
    );
    expect(mocks.findManyDeviceConnections).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "member_123",
      },
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sources: [
        {
          connectionId: expect.stringMatching(/^dspc_/),
          headline: "Connected and syncing normally",
          provider: "oura",
          providerLabel: "Oura",
          statusLabel: "Connected",
          tone: "calm",
        },
      ],
    });
  });

  it("batches full settings source reads across multiple connections", async () => {
    mocks.findManyDeviceConnections.mockResolvedValueOnce([
      buildDeviceConnectionRecord({
        id: "dsc_oura_123",
        provider: "oura",
      }),
      buildDeviceConnectionRecord({
        id: "dsc_oura_456",
        provider: "oura",
        updatedAt: new Date("2026-04-01T08:06:00.000Z"),
      }),
    ]);

    const response = await settingsDeviceSyncRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync"),
    );

    expect(response.status).toBe(200);
    expect(mocks.findManyDeviceConnections).toHaveBeenCalledTimes(1);
    expect(mocks.findManyDeviceConnectionSources).toHaveBeenCalledTimes(1);
    expect(mocks.findManyDeviceConnectionSources).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        connectionId: {
          in: ["dsc_oura_123", "dsc_oura_456"],
        },
      },
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sources: [
        {
          connectionId: expect.stringMatching(/^dspc_/),
          provider: "oura",
        },
        {
          connectionId: expect.stringMatching(/^dspc_/),
          provider: "oura",
        },
      ],
    });
  });

  it("does not mark settings sources configured when authoritative provider config is invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("OURA_RECONCILE_DAYS", "soon");

    try {
      const response = await settingsDeviceSyncRoute.GET(
        new Request("https://join.example.test/api/settings/device-sync"),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request.",
        },
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("fails closed for the settings route in production when no public base URL is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEVICE_SYNC_PUBLIC_BASE_URL", "");
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "");
    vi.stubEnv("HOSTED_WEB_BASE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");

    try {
      const response = await settingsDeviceSyncRoute.GET(
        new Request("https://preview.example.test/api/settings/device-sync"),
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
      expect(mocks.findManyDeviceConnections).not.toHaveBeenCalled();
      expect(mocks.listConfiguredDeviceSyncPublicProviderDescriptors).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "DEVICE_SYNC_PUBLIC_BASE_URL_REQUIRED",
          message:
            "Hosted device-sync public callback and webhook routes require DEVICE_SYNC_PUBLIC_BASE_URL or a canonical hosted public URL in production.",
          retryable: false,
        },
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("returns a minimized sidebar status summary for the authenticated hosted member", async () => {
    const response = await settingsDeviceSyncSidebarStatusRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/sidebar-status"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    expect(mocks.listConfiguredDeviceSyncPublicProviderDescriptors).toHaveBeenCalledWith(
      expect.objectContaining({
        oura: expect.any(Object),
      }),
      {
        publicBaseUrl: "https://join.example.test/api/device-sync",
      },
    );
    expect(mocks.findManyDeviceConnections).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "member_123",
      },
    }));
    expect(mocks.findManyDeviceConnections).toHaveBeenCalledTimes(1);
    expect(mocks.findManyDeviceConnectionSources).toHaveBeenCalledTimes(1);
    expect(mocks.findManyDeviceConnectionSources).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        connectionId: {
          in: ["dsc_oura_123"],
        },
      },
    }));
    expect(mocks.findManyDeviceConnections.mock.calls[0]?.[0]?.select).toEqual({
      connectedAt: true,
      createdAt: true,
      id: true,
      lastErrorCode: true,
      lastSyncCompletedAt: true,
      lastSyncErrorAt: true,
      lastSyncStartedAt: true,
      lastWebhookAt: true,
      nextReconcileAt: true,
      provider: true,
      setupExpiresAt: true,
      setupPhase: true,
      status: true,
      updatedAt: true,
    });
    expect(mocks.findManyDeviceConnections.mock.calls[0]?.[0]?.select).not.toHaveProperty(
      "externalAccountIdEncrypted",
    );
    expect(mocks.findManyDeviceConnections.mock.calls[0]?.[0]?.select).not.toHaveProperty(
      "accessTokenEncrypted",
    );
    expect(mocks.findManyDeviceConnections.mock.calls[0]?.[0]?.select).not.toHaveProperty(
      "refreshTokenEncrypted",
    );
    await expect(response.json()).resolves.toEqual({
      generatedAt: "2026-04-03T12:00:00.000Z",
      ok: true,
      status: {
        message: "Oura connected",
        tone: "connected",
      },
    });
  });

  it("uses only the connection query when the sidebar member has no connections", async () => {
    mocks.findManyDeviceConnections.mockResolvedValueOnce([]);

    const response = await settingsDeviceSyncSidebarStatusRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/sidebar-status"),
    );

    expect(response.status).toBe(200);
    expect(mocks.findManyDeviceConnections).toHaveBeenCalledTimes(1);
    expect(mocks.findManyDeviceConnectionSources).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      generatedAt: "2026-04-03T12:00:00.000Z",
      ok: true,
      status: null,
    });
  });

  it("keeps sidebar database reads constant for multiple connections", async () => {
    mocks.findManyDeviceConnections.mockResolvedValueOnce([
      buildDeviceConnectionRecord({
        id: "dsc_oura_123",
        provider: "oura",
      }),
      buildDeviceConnectionRecord({
        id: "dsc_oura_456",
        provider: "oura",
        updatedAt: new Date("2026-04-01T08:06:00.000Z"),
      }),
    ]);

    const response = await settingsDeviceSyncSidebarStatusRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/sidebar-status"),
    );

    expect(response.status).toBe(200);
    expect(mocks.findManyDeviceConnections).toHaveBeenCalledTimes(1);
    expect(mocks.findManyDeviceConnectionSources).toHaveBeenCalledTimes(1);
    expect(mocks.findManyDeviceConnectionSources).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        connectionId: {
          in: ["dsc_oura_123", "dsc_oura_456"],
        },
      },
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: {
        message: "2 wearables connected",
        tone: "connected",
      },
    });
  });

  it("fails closed for sidebar status in production when no public base URL is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEVICE_SYNC_PUBLIC_BASE_URL", "");
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "");
    vi.stubEnv("HOSTED_WEB_BASE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");

    try {
      const response = await settingsDeviceSyncSidebarStatusRoute.GET(
        new Request("https://preview.example.test/api/settings/device-sync/sidebar-status"),
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
      expect(mocks.findManyDeviceConnections).not.toHaveBeenCalled();
      expect(mocks.listConfiguredDeviceSyncPublicProviderDescriptors).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "DEVICE_SYNC_PUBLIC_BASE_URL_REQUIRED",
          message:
            "Hosted device-sync public callback and webhook routes require DEVICE_SYNC_PUBLIC_BASE_URL or a canonical hosted public URL in production.",
          retryable: false,
        },
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("returns a Junction upstream wearable label in the minimized sidebar status", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret-value");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_REGION", "us");
    mocks.findManyDeviceConnections.mockResolvedValueOnce([
      buildDeviceConnectionRecord({
        credentialKind: "provider_config",
        displayName: "Junction",
        id: "dsc_junction_123",
        lastSyncCompletedAt: new Date("2026-04-03T07:00:00.000Z"),
        lastSyncStartedAt: new Date("2026-04-03T06:55:00.000Z"),
        lastWebhookAt: new Date("2026-04-03T07:01:00.000Z"),
        nextReconcileAt: new Date("2026-04-03T16:00:00.000Z"),
        provider: "junction",
        providerConfigKey: "junction",
        scopesJson: [],
        updatedAt: new Date("2026-04-03T07:05:00.000Z"),
      }),
    ]);
    mocks.findManyDeviceConnectionSources.mockResolvedValueOnce([
      buildDeviceConnectionSourceRecord({
        connectionId: "dsc_junction_123",
        resourceAvailabilitySummaryJson: {
          sleep: true,
          steps: true,
          workouts: true,
        },
        sourceProviderSlug: "garmin",
      }),
    ]);

    const response = await settingsDeviceSyncSidebarStatusRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/sidebar-status"),
    );

    expect(response.status).toBe(200);
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
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
    mocks.listConnectionSources.mockResolvedValueOnce([
      buildHostedDeviceConnectionSource({
        resourceAvailabilitySummary: null,
      }),
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
    expect(mocks.listConnectionSources).toHaveBeenCalledTimes(1);
    expect(mocks.listConnectionSources).toHaveBeenCalledWith("dsc_junction_123");
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
    mocks.listConnectionSources.mockResolvedValueOnce([
      buildHostedDeviceConnectionSource({
        resourceAvailabilitySummary: {
          steps: true,
        },
      }),
    ]);

    const response = await settingsDeviceSyncDiagnoseBackfillRoute.GET(
      new Request(
        "https://join.example.test/api/settings/device-sync/diagnose-backfill?provider=junction&restProbe=timeseries&resource=steps&sourceProvider=garmin&windowStart=2026-04-02T00:00:00.000Z&windowEnd=2026-04-03T00:00:00.000Z",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.listConnectionSources).toHaveBeenCalledTimes(1);
    expect(mocks.listConnectionSources).toHaveBeenCalledWith("dsc_junction_123");
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
    mocks.listConnectionSources.mockResolvedValueOnce([
      buildHostedDeviceConnectionSource(),
    ]);

    const response = await settingsDeviceSyncDiagnoseBackfillRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/settings/device-sync/diagnose-backfill?provider=junction&restProbe=refresh&timeout=45",
        {},
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.listConnectionSources).toHaveBeenCalledTimes(1);
    expect(mocks.listConnectionSources).toHaveBeenCalledWith("dsc_junction_123");
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
        nextReconcileAt: null,
        provider: "junction",
        scopes: [],
        setupPhase: null,
        status: "disconnected",
        updatedAt: "2026-04-03T08:00:00.000Z",
      },
    ]);

    const response = await settingsDeviceSyncDiagnoseBackfillRoute.GET(
      new Request("https://join.example.test/api/settings/device-sync/diagnose-backfill?provider=junction"),
    );

    expect(response.status).toBe(409);
    expect(mocks.listConnectionSources).not.toHaveBeenCalled();
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
    expect(response.headers.get("set-cookie")).toContain("murph-device-sync-oura=");
    expect(mocks.prepareConnectionStart).toHaveBeenCalledWith(
      "member_123",
      expect.objectContaining({
        connectSourceId: "oura",
        connectTarget: "oura",
        provider: "oura",
      }),
    );
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
    expect(mocks.findManyDeviceConnections).not.toHaveBeenCalled();
  });

  it("prevents the generic source-start route from bypassing member-owned Strava setup", async () => {
    vi.stubEnv("STRAVA_CLIENT_ID", "strava-client-id");
    vi.stubEnv("STRAVA_CLIENT_SECRET", "strava-client-secret");
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "strava");
    vi.stubEnv("JUNCTION_REGION", "us");

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/strava/start",
        {},
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ sourceId: "strava" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "DEVICE_PROVIDER_SETUP_REQUIRED",
        message: "This connection must use the private provider setup journey.",
        retryable: false,
      },
    });
    expect(mocks.startConnection).not.toHaveBeenCalled();
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
    expect(mocks.findManyDeviceConnections).toHaveBeenCalledWith({
      where: {
        status: { not: "disconnected" },
        OR: [
          { provider: "whoop" },
          {
            provider: "junction",
            sources: {
              some: {
                sourceProviderSlug: "whoop_v2",
                status: { not: "disconnected" },
              },
            },
          },
        ],
      },
      select: { userId: true },
      distinct: ["userId"],
    });
  });

  it("rejects a new member when current WHOOP capacity is full", async () => {
    vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");
    mocks.findManyDeviceConnections.mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, index) => ({ userId: `member_existing_${index}` })),
    );

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/whoop/start",
        {},
        {
          headers: {
            origin: "https://join.example.test",
          },
        },
      ),
      createRouteContext({ sourceId: "whoop" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
        message:
          "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
        retryable: false,
      },
    });
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it("allows a new member to take the second current WHOOP slot", async () => {
    vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");
    mocks.findManyDeviceConnections.mockResolvedValueOnce(
      Array.from({ length: 1 }, (_, index) => ({ userId: `member_existing_${index}` })),
    );

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/whoop/start",
        {},
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
      "whoop",
      "/device-sync/connect/complete?source=connect&connectSource=whoop&connectTarget=whoop",
      {
        connectSourceId: "whoop",
        connectTarget: "whoop",
        sourceProviderSlug: null,
      },
    );
  });

  it("allows an existing WHOOP member to reconnect when capacity is full", async () => {
    vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client-id");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-client-secret");
    mocks.findManyDeviceConnections.mockResolvedValueOnce([
      { userId: "member_123" },
      ...Array.from({ length: 9 }, (_, index) => ({ userId: `member_existing_${index}` })),
    ]);

    const response = await connectSourceStartRoute.POST(
      createJsonPostRequest(
        "https://join.example.test/api/connect-sources/whoop/start",
        {},
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
      "whoop",
      "/device-sync/connect/complete?source=connect&connectSource=whoop&connectTarget=whoop",
      {
        connectSourceId: "whoop",
        connectTarget: "whoop",
        sourceProviderSlug: null,
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

  it("starts a connect source flow when launch-document acceptance is stale", async () => {
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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prismaClient,
    });
    expect(mocks.startConnection).toHaveBeenCalledTimes(1);
  });

  it("rejects connect source flow without both historical launch grants", async () => {
    mocks.assertHostedHistoricalLaunchConsentGranted.mockRejectedValue(
      hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the Murph legal consent before continuing.",
      }),
    );

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
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_CONSENT_REQUIRED" },
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
      new Request(`https://join.example.test/api/settings/device-sync/connections/${OURA_PUBLIC_CONNECTION_ID}/status`),
      createRouteContext({ connectionId: OURA_PUBLIC_CONNECTION_ID }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getConnectionStatus).not.toHaveBeenCalled();
    expect(mocks.listConnections).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      source: {
        connectionId: OURA_PUBLIC_CONNECTION_ID,
        provider: "oura",
        statusLabel: "Connected",
        tone: "calm",
      },
    });
  });

  it("keeps upstream source context on connection status lookups", async () => {
    mocks.findManyDeviceConnections.mockResolvedValueOnce([
      buildDeviceConnectionRecord({
        displayName: "Junction",
        id: "dsc_junction_123",
        lastSyncCompletedAt: new Date("2026-04-03T07:00:00.000Z"),
        lastSyncStartedAt: new Date("2026-04-03T06:55:00.000Z"),
        lastWebhookAt: new Date("2026-04-03T07:01:00.000Z"),
        nextReconcileAt: new Date("2026-04-03T16:00:00.000Z"),
        provider: "junction",
        scopesJson: [],
        updatedAt: new Date("2026-04-03T08:00:00.000Z"),
      }),
    ]);
    mocks.findManyDeviceConnectionSources.mockResolvedValueOnce([
      buildDeviceConnectionSourceRecord({
        connectionId: "dsc_junction_123",
        resourceAvailabilitySummaryJson: {
          sleep: true,
          steps: true,
          workouts: true,
        },
        sourceProviderSlug: "garmin",
      }),
    ]);

    const response = await settingsDeviceSyncStatusRoute.GET(
      new Request(`https://join.example.test/api/settings/device-sync/connections/${JUNCTION_PUBLIC_CONNECTION_ID}/status`),
      createRouteContext({ connectionId: JUNCTION_PUBLIC_CONNECTION_ID }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      source: {
        connectionId: JUNCTION_PUBLIC_CONNECTION_ID,
        provider: "junction",
        providerLabel: "Garmin",
        statusLabel: "Unavailable",
        tone: "muted",
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
      connection: {
        id: "dspc_oura_123",
        provider: "oura",
        status: "disconnected",
      },
      warning: {
        code: "REMOTE_REVOKE_FAILED",
        message: "Provider revocation timed out.",
      },
    });
  });


  it("cancels only the authenticated member's active provider setup without requiring historical consent", async () => {
    mocks.readMemberOwnedProviderSetupRegistration.mockReturnValueOnce({
      coordinates: {
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        sourceProviderSlug: null,
      },
      presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    });

    const response = await settingsDeviceSyncProviderSetupRoute.DELETE(
      new Request(
        "https://join.example.test/api/settings/device-sync/provider-setups/strava",
        {
          body: JSON.stringify({ setupId: "dps_synthetic" }),
          headers: {
            "content-type": "application/json",
            origin: "https://join.example.test",
          },
          method: "DELETE",
        },
      ),
      createRouteContext({ provider: "strava" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.cancelMemberOwnedProviderSetup).toHaveBeenCalledWith(
      "member_123",
      "dps_synthetic",
    );
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
      provider: "strava",
      setup: {
        action: "authorize",
        status: "canceled",
      },
    });
  });

  it("issues a same-origin handoff only for the authenticated member's exact setup", async () => {
    mocks.readMemberOwnedProviderSetupRegistration.mockReturnValueOnce({
      coordinates: {
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        sourceProviderSlug: null,
      },
      presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    });

    const response = await settingsDeviceSyncProviderSetupRoute.PUT(
      new Request(
        "https://join.example.test/api/settings/device-sync/provider-setups/strava",
        {
          body: JSON.stringify({ setupId: "dps_synthetic" }),
          headers: {
            "content-type": "application/json",
            origin: "https://join.example.test",
          },
          method: "PUT",
        },
      ),
      createRouteContext({ provider: "strava" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.requireActivePrivyMemberAuth).toHaveBeenCalledWith(
      expect.any(Request),
    );
    expect(mocks.issueMemberOwnedProviderSetupHandoff).toHaveBeenCalledWith(
      "member_123",
      "dps_synthetic",
    );
    await expect(response.json()).resolves.toEqual({
      handoffUrl: "/computer/handoff/synthetic-capability",
    });
  });

  it("rejects a provider handoff request without one exact setup id", async () => {
    mocks.readMemberOwnedProviderSetupRegistration.mockReturnValueOnce({
      coordinates: {
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        sourceProviderSlug: null,
      },
      presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    });

    const response = await settingsDeviceSyncProviderSetupRoute.PUT(
      new Request(
        "https://join.example.test/api/settings/device-sync/provider-setups/strava",
        {
          body: JSON.stringify({}),
          headers: {
            "content-type": "application/json",
            origin: "https://join.example.test",
          },
          method: "PUT",
        },
      ),
      createRouteContext({ provider: "strava" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.issueMemberOwnedProviderSetupHandoff).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DEVICE_PROVIDER_SETUP_HANDOFF_INVALID" },
    });
  });

  it("rejects provider setup cancellation without one exact setup owner", async () => {
    mocks.readMemberOwnedProviderSetupRegistration.mockReturnValueOnce({
      coordinates: {
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        sourceProviderSlug: null,
      },
      presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
    });

    const response = await settingsDeviceSyncProviderSetupRoute.DELETE(
      new Request(
        "https://join.example.test/api/settings/device-sync/provider-setups/strava",
        {
          body: JSON.stringify({}),
          headers: {
            "content-type": "application/json",
            origin: "https://join.example.test",
          },
          method: "DELETE",
        },
      ),
      createRouteContext({ provider: "strava" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.cancelMemberOwnedProviderSetup).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "DEVICE_PROVIDER_SETUP_CANCELLATION_INVALID",
      },
    });
  });

  it("returns a completed member-owned disconnect when setup projection repair fails", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.disconnectConnection.mockResolvedValueOnce({
      connection: {
        id: "dspc_strava_123",
        provider: "strava",
        status: "disconnected",
      },
      warning: null,
    });
    mocks.readMemberOwnedProviderSetupRegistration.mockReturnValueOnce({
      coordinates: {
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        sourceProviderSlug: null,
      },
    });
    mocks.markMemberOwnedSetupDisconnected.mockRejectedValueOnce(
      new Error("NON_SECRET_TEST_PROJECTION_FAILURE"),
    );

    const response = await settingsDeviceSyncDisconnectRoute.POST(
      new Request(
        "https://join.example.test/api/settings/device-sync/connections/dspc_strava_123/disconnect",
        {
          headers: { origin: "https://join.example.test" },
          method: "POST",
        },
      ),
      createRouteContext({ connectionId: "dspc_strava_123" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connection: {
        id: "dspc_strava_123",
        provider: "strava",
        status: "disconnected",
      },
      warning: null,
    });
    expect(mocks.markMemberOwnedSetupDisconnected).toHaveBeenCalledWith("member_123");
    expect(warningSpy).toHaveBeenCalledWith(
      "Member-owned provider setup disconnect projection failed.",
      { errorType: "Error", provider: "strava" },
    );
  });

  it("disconnects only the selected hosted Junction source", async () => {
    mocks.disconnectConnectionSource.mockResolvedValue({
      sourceProviderSlug: "oura",
      status: "disconnected",
    });

    const response = await settingsDeviceSyncSourceDisconnectRoute.POST(
      new Request(
        "https://join.example.test/api/settings/device-sync/connections/dspc_junction_123/sources/oura/disconnect",
        {
          headers: { origin: "https://join.example.test" },
          method: "POST",
        },
      ),
      createRouteContext({
        connectionId: "dspc_junction_123",
        sourceProviderSlug: "oura",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.disconnectConnectionSource).toHaveBeenCalledWith(
      "member_123",
      "dspc_junction_123",
      "oura",
    );
    await expect(response.json()).resolves.toEqual({
      sourceProviderSlug: "oura",
      status: "disconnected",
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
