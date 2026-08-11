import { describe, expect, it } from "vitest";

import type { PublicProviderDescriptor } from "@murphai/device-syncd/public-ingress";

import { toHostedBrowserDeviceSyncConnectionSource } from "@/src/lib/device-sync/browser-connection-source";
import type { HostedDeviceConnectionSource } from "@/src/lib/device-sync/prisma-store/sources";
import type { HostedBrowserDeviceSyncConnection } from "@/src/lib/device-sync/public-connection";
import {
  buildHostedDeviceSyncSettingsSources,
  isActiveHostedDeviceSyncSource,
} from "@/src/lib/device-sync/settings-surface";

const STRAVA_PROVIDER: PublicProviderDescriptor = {
  callbackPath: "/oauth/strava/callback",
  callbackUrl: "https://example.com/oauth/strava/callback",
  connectionKind: "oauth2",
  credentialPolicy: "oauth_tokens",
  defaultScopes: ["activity:read"],
  provider: "strava",
  supportsWebhooks: true,
  webhookPath: "/webhooks/strava",
  webhookUrl: "https://example.com/webhooks/strava",
};

const OURA_PROVIDER: PublicProviderDescriptor = {
  callbackPath: "/oauth/oura/callback",
  callbackUrl: "https://example.com/oauth/oura/callback",
  connectionKind: "oauth2",
  credentialPolicy: "oauth_tokens",
  defaultScopes: ["daily"],
  provider: "oura",
  supportsWebhooks: true,
  webhookPath: "/webhooks/oura",
  webhookUrl: "https://example.com/webhooks/oura",
};

const JUNCTION_PROVIDER: PublicProviderDescriptor = {
  callbackPath: "/connect/junction/callback",
  callbackUrl: "https://example.com/connect/junction/callback",
  connectionKind: "external_link",
  credentialPolicy: "provider_config",
  defaultScopes: [],
  provider: "junction",
  supportsWebhooks: true,
  webhookPath: "/webhooks/junction",
  webhookUrl: "https://example.com/webhooks/junction",
};

function buildConnection(overrides: Partial<HostedBrowserDeviceSyncConnection> = {}): HostedBrowserDeviceSyncConnection {
  return {
    accessTokenExpiresAt: null,
    connectedAt: "2026-04-01T08:00:00.000Z",
    createdAt: "2026-04-01T08:00:00.000Z",
    displayName: null,
    id: "dspc_example",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastSyncStartedAt: null,
    lastWebhookAt: null,
    metadata: {},
    nextReconcileAt: null,
    provider: "oura",
    scopes: ["daily"],
    status: "active",
    updatedAt: "2026-04-01T08:00:00.000Z",
    ...overrides,
  } satisfies HostedBrowserDeviceSyncConnection;
}

function buildConnectionSource(overrides: Partial<HostedDeviceConnectionSource> = {}): HostedDeviceConnectionSource {
  return {
    connectionId: "dspc_example",
    createdAt: "2026-04-01T08:00:00.000Z",
    displayName: null,
    firstSeenAt: "2026-04-01T08:00:00.000Z",
    id: "dspcs_example",
    lastDataAt: "2026-04-03T08:00:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSeenAt: "2026-04-03T08:00:00.000Z",
    resourceAvailabilitySummary: { sleep: true },
    sourceInstanceKey: "fitbit",
    sourceProviderSlug: "fitbit",
    status: "connected",
    updatedAt: "2026-04-03T08:00:00.000Z",
    ...overrides,
  } satisfies HostedDeviceConnectionSource;
}

describe("buildHostedDeviceSyncSettingsSources", () => {
  it("carries sanitized upstream source error codes from the database projection", () => {
    expect(
      toHostedBrowserDeviceSyncConnectionSource(
        buildConnectionSource({
          lastErrorCode: "SOURCE_PROVIDER_DISCONNECTED",
          status: "disconnected",
        }),
        "dspc_fitbit",
      ),
    ).toMatchObject({
      connectionId: "dspc_fitbit",
      lastErrorCode: "SOURCE_PROVIDER_DISCONNECTED",
      sourceProviderSlug: "fitbit",
      status: "disconnected",
    });
  });

  it("omits configured providers that do not have a connection yet", () => {
    const sources = buildHostedDeviceSyncSettingsSources({
      connections: [],
      providers: [OURA_PROVIDER],
    });

    expect(sources).toEqual([]);
  });

  it("does not expose configured-only provider labels on the settings surface", () => {
    const sources = buildHostedDeviceSyncSettingsSources({
      connections: [],
      providers: [STRAVA_PROVIDER],
    });

    expect(sources).toEqual([]);
  });

  it("marks fresh active connections as calm and connected", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        lastSyncCompletedAt: "2026-04-03T07:00:00.000Z",
        updatedAt: "2026-04-03T07:05:00.000Z",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      detail: "Murph has a fresh sync from this source.",
      headline: "Connected and syncing normally",
      primaryAction: null,
      state: "active",
      statusLabel: "Connected",
      tone: "calm",
    });
  });

  it("uses upstream source labels for Junction-backed settings rows", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [
        {
          connectionId: "dspc_example",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-04-03T08:00:00.000Z",
          resourceCount: 3,
          sourceProviderSlug: "dexcom_v3",
          status: "connected",
        },
      ],
      connections: [buildConnection({
        displayName: "Junction",
        provider: "junction",
      })],
      providers: [JUNCTION_PROVIDER],
    });

    expect(source?.provider).toBe("junction");
    expect(source?.providerLabel).toBe("Dexcom");
    expect(source?.displayName).toBeNull();
    expect(source?.upstreamSources).toEqual([
      {
        providerLabel: "Dexcom",
        resourceCount: 3,
        sourceProviderSlug: "dexcom_v3",
        status: "connected",
      },
    ]);
  });

  it("maps a persisted legacy Fitbit source to the Google Health reconnect target", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [{
        connectionId: "dspc_fitbit_legacy",
        firstSeenAt: "2026-07-01T08:00:00.000Z",
        lastDataAt: "2026-08-10T08:00:00.000Z",
        lastSeenAt: "2026-08-10T08:00:00.000Z",
        resourceCount: 4,
        sourceProviderSlug: "fitbit",
        status: "connected",
      }],
      connectTargets: [{
        connectSourceId: "fitbit",
        connectTarget: "fitbit",
        provider: "junction",
        sourceProviderSlug: "google_health",
      }],
      connections: [buildConnection({
        id: "dspc_fitbit_legacy",
        provider: "junction",
      })],
      providers: [JUNCTION_PROVIDER],
    });

    expect(source?.upstreamSources).toEqual([{
      connectProvider: "junction",
      connectSourceId: "fitbit",
      connectTarget: "fitbit",
      firstSeenAt: "2026-07-01T08:00:00.000Z",
      lastDataAt: "2026-08-10T08:00:00.000Z",
      lastSeenAt: "2026-08-10T08:00:00.000Z",
      providerLabel: "Fitbit",
      resourceCount: 4,
      sourceProviderSlug: "fitbit",
      status: "connected",
    }]);
  });

  it("projects sanitized upstream source error codes for migration state resolution", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [{
        connectionId: "dspc_fitbit_legacy",
        firstSeenAt: "2026-07-01T08:00:00.000Z",
        lastDataAt: "2026-08-10T08:00:00.000Z",
        lastErrorCode: "SOURCE_PROVIDER_DISCONNECTED",
        lastSeenAt: "2026-08-10T08:00:00.000Z",
        resourceCount: 4,
        sourceProviderSlug: "fitbit",
        status: "disconnected",
      }],
      connections: [buildConnection({
        id: "dspc_fitbit_legacy",
        provider: "junction",
      })],
      providers: [JUNCTION_PROVIDER],
    });

    expect(source?.upstreamSources).toEqual([{
      firstSeenAt: "2026-07-01T08:00:00.000Z",
      lastDataAt: "2026-08-10T08:00:00.000Z",
      lastErrorCode: "SOURCE_PROVIDER_DISCONNECTED",
      lastSeenAt: "2026-08-10T08:00:00.000Z",
      providerLabel: "Fitbit",
      resourceCount: 4,
      sourceProviderSlug: "fitbit",
      status: "disconnected",
    }]);
  });

  it("uses safe aggregate labels for multi-source intermediary connections", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [
        {
          connectionId: "dspc_example",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-04-03T08:00:00.000Z",
          resourceCount: 3,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
        {
          connectionId: "dspc_example",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-04-03T08:00:00.000Z",
          resourceCount: 2,
          sourceProviderSlug: "oura",
          status: "connected",
        },
      ],
      connections: [buildConnection({
        displayName: "Junction",
        provider: "junction",
      })],
      providers: [JUNCTION_PROVIDER],
    });

    expect(source?.provider).toBe("junction");
    expect(source?.providerLabel).toBe("2 wearables");
    expect(source?.displayName).toBeNull();
  });

  it("can fall back to source metadata before an upstream source row exists", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        displayName: "Junction",
        metadata: { sourceProviderSlug: "oura" },
        provider: "junction",
        setupPhase: "pending_link",
      })],
      providers: [JUNCTION_PROVIDER],
    });

    expect(source?.provider).toBe("junction");
    expect(source?.providerLabel).toBe("Oura");
    expect(source?.displayName).toBeNull();
  });

  it("uses a wearable fallback when an intermediary source cannot be resolved yet", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        displayName: "Junction",
        provider: "junction",
      })],
      providers: [JUNCTION_PROVIDER],
    });

    expect(source?.provider).toBe("junction");
    expect(source?.providerLabel).toBe("Wearable source");
    expect(source?.displayName).toBeNull();
  });

  it("hides generic provider labels from the rendered display name", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        displayName: "Oura",
      })],
      providers: [OURA_PROVIDER],
    });

    expect(source?.displayName).toBeNull();
  });

  it("adds a safe disambiguator when multiple same-provider connections would otherwise hide their labels", () => {
    const sources = buildHostedDeviceSyncSettingsSources({
      connections: [
        buildConnection({
          id: "dspc_oura_older",
          displayName: "Oura",
          connectedAt: "2026-04-01T08:00:00.000Z",
          updatedAt: "2026-04-01T08:00:00.000Z",
        }),
        buildConnection({
          id: "dspc_oura_newer",
          displayName: "Oura",
          connectedAt: "2026-04-01T08:00:00.000Z",
          updatedAt: "2026-04-01T08:00:30.000Z",
        }),
      ],
      providers: [OURA_PROVIDER],
    });

    expect(sources).toHaveLength(2);
    expect(sources[0]?.displayName).toContain("Connected");
    expect(sources[1]?.displayName).toContain("Connected");
    expect(sources[0]?.displayName).toContain("(#1)");
    expect(sources[1]?.displayName).toContain("(#2)");
    expect(sources[0]?.displayName).not.toBe(sources[1]?.displayName);
  });

  it("marks provider reauthorization as attention-worthy with a reconnect action when configured", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectTargets: [{
        connectSourceId: "oura",
        connectTarget: "oura",
        provider: "oura",
        sourceProviderSlug: null,
      }],
      connections: [buildConnection({
        lastSyncCompletedAt: "2026-04-02T07:00:00.000Z",
        lastSyncErrorAt: "2026-04-03T08:00:00.000Z",
        status: "reauthorization_required",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      connectSourceId: "oura",
      connectTarget: "oura",
      headline: "Access needs attention",
      primaryAction: { kind: "reconnect", label: "Reconnect" },
      secondaryAction: { kind: "disconnect", label: "Disconnect" },
      state: "reauthorization_required",
      statusLabel: "Needs access",
      tone: "attention",
    });
  });

  it("keeps disconnected configured sources quiet", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectTargets: [{
        connectSourceId: "oura",
        connectTarget: "oura",
        provider: "oura",
        sourceProviderSlug: null,
      }],
      connections: [buildConnection({
        lastErrorCode: "PROVIDER_REVOKE_FAILED",
        lastErrorMessage: "Provider revoke request failed during disconnect.",
        lastSyncCompletedAt: "2026-03-28T07:00:00.000Z",
        status: "disconnected",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      guidance: "Past history stays in place.",
      headline: "Disconnected",
      primaryAction: null,
      secondaryAction: null,
      state: "disconnected",
      statusLabel: "Disconnected",
      tone: "muted",
    });
    expect(source?.historicalResetIncomplete).toBeUndefined();
  });

  it("projects an unfinished historical reset on the disconnected source", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [{
        connectionId: "dspc_junction_garmin",
        firstSeenAt: "2026-04-01T08:00:00.000Z",
        lastSeenAt: "2026-07-09T09:00:00.000Z",
        resourceCount: 0,
        sourceProviderSlug: "garmin",
        status: "disconnected",
      }],
      connectTargets: [{
        connectSourceId: "garmin",
        connectTarget: "garmin",
        provider: "junction",
        sourceProviderSlug: "garmin",
      }],
      connections: [buildConnection({
        id: "dspc_junction_garmin",
        lastErrorCode: "HISTORICAL_RESET_REVOKE_FAILED",
        lastErrorMessage: "Provider revoke did not complete while a historical data reset is pending. "
          + "Remove the connection in the provider account before reconnecting.",
        lastSyncCompletedAt: "2026-07-09T07:00:00.000Z",
        provider: "junction",
        status: "disconnected",
        updatedAt: "2026-07-09T09:00:00.000Z",
      })],
      now: new Date("2026-07-09T12:00:00.000Z"),
      providers: [JUNCTION_PROVIDER],
    });

    expect(source).toMatchObject({
      detail: "This source is disconnected, but the last reset did not finish in your wearable provider account.",
      guidance: "Remove the old connection in your wearable provider account, then connect it again here.",
      headline: "Disconnected",
      historicalResetIncomplete: true,
      primaryAction: null,
      secondaryAction: null,
      state: "disconnected",
      statusLabel: "Needs attention",
      tone: "attention",
    });
    expect(JSON.stringify(source)).not.toContain("HISTORICAL_RESET_REVOKE_FAILED");
    expect(JSON.stringify(source)).not.toContain("Provider revoke did not complete");
  });

  it("uses the Junction reconnect target when direct and Junction targets share a visible source", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [{
        connectionId: "dspc_junction_whoop",
        firstSeenAt: "2026-04-01T08:00:00.000Z",
        lastSeenAt: "2026-04-03T08:00:00.000Z",
        resourceCount: 1,
        sourceProviderSlug: "whoop_v2",
        status: "unavailable",
      }],
      connectTargets: [
        {
          connectSourceId: "whoop",
          connectTarget: "whoop",
          provider: "whoop",
          sourceProviderSlug: null,
        },
        {
          connectSourceId: "whoop",
          connectTarget: "whoop",
          provider: "junction",
          sourceProviderSlug: "whoop_v2",
        },
      ],
      connections: [buildConnection({
        id: "dspc_junction_whoop",
        provider: "junction",
        status: "reauthorization_required",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [JUNCTION_PROVIDER],
    });

    expect(source).toMatchObject({
      connectSourceId: "whoop",
      connectTarget: "whoop",
      primaryAction: { kind: "reconnect", label: "Reconnect" },
      provider: "junction",
      providerLabel: "WHOOP",
      state: "reauthorization_required",
    });
  });

  it("surfaces Junction source token-refresh failures as source reconnect actions", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [{
        connectionId: "dspc_junction_whoop",
        firstSeenAt: "2026-04-01T08:00:00.000Z",
        lastSeenAt: "2026-06-09T08:50:48.000Z",
        requiresReconnect: true,
        resourceCount: 3,
        sourceProviderSlug: "whoop_v2",
        status: "error",
      }],
      connectTargets: [{
        connectSourceId: "whoop",
        connectTarget: "whoop",
        provider: "junction",
        sourceProviderSlug: "whoop_v2",
      }],
      connections: [buildConnection({
        id: "dspc_junction_whoop",
        lastSyncCompletedAt: "2026-06-09T07:00:00.000Z",
        provider: "junction",
        status: "active",
        updatedAt: "2026-06-09T08:50:48.000Z",
      })],
      now: new Date("2026-06-09T12:00:00.000Z"),
      providers: [JUNCTION_PROVIDER],
    });

    expect(source).toMatchObject({
      connectSourceId: "whoop",
      connectTarget: "whoop",
      detail: "WHOOP needs to be reconnected before Murph can keep syncing it.",
      headline: "Access needs attention",
      primaryAction: { kind: "reconnect", label: "Reconnect" },
      provider: "junction",
      providerLabel: "WHOOP",
      secondaryAction: { kind: "disconnect", label: "Disconnect" },
      state: "active",
      statusLabel: "Needs access",
      tone: "attention",
    });
  });

  it("surfaces Junction historical connection resets as disconnect-first recovery", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [{
        connectionId: "dspc_junction_garmin",
        firstSeenAt: "2026-04-01T08:00:00.000Z",
        lastSeenAt: "2026-07-09T08:50:48.000Z",
        recoveryKind: "connection_reset",
        resourceCount: 3,
        sourceProviderSlug: "garmin",
        status: "error",
      }],
      connectTargets: [{
        connectSourceId: "garmin",
        connectTarget: "garmin",
        provider: "junction",
        sourceProviderSlug: "garmin",
      }],
      connections: [buildConnection({
        id: "dspc_junction_garmin",
        lastSyncCompletedAt: "2026-07-09T07:00:00.000Z",
        provider: "junction",
        status: "active",
        updatedAt: "2026-07-09T08:50:48.000Z",
      })],
      now: new Date("2026-07-09T12:00:00.000Z"),
      providers: [JUNCTION_PROVIDER],
    });

    expect(source).toMatchObject({
      detail: "Garmin needs a fresh connection before Murph can bring in its history.",
      guidance: "Disconnect this source first, then connect it again to start a fresh sync.",
      headline: "Access needs attention",
      primaryAction: null,
      providerLabel: "Garmin",
      secondaryAction: { kind: "disconnect", label: "Disconnect" },
      state: "active",
      statusLabel: "Needs attention",
      tone: "attention",
    });
    expect(source?.upstreamSources).toEqual([
      {
        connectProvider: "junction",
        connectSourceId: "garmin",
        connectTarget: "garmin",
        providerLabel: "Garmin",
        recoveryKind: "connection_reset",
        resourceCount: 3,
        sourceProviderSlug: "garmin",
        status: "error",
      },
    ]);
  });

  it("targets the reconnect-required Junction source when another child source is connected", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [
        {
          connectionId: "dspc_junction_multi",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-06-09T08:30:00.000Z",
          resourceCount: 2,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
        {
          connectionId: "dspc_junction_multi",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-06-09T08:50:48.000Z",
          requiresReconnect: true,
          resourceCount: 3,
          sourceProviderSlug: "whoop_v2",
          status: "error",
        },
      ],
      connectTargets: [
        {
          connectSourceId: "garmin",
          connectTarget: "garmin",
          provider: "junction",
          sourceProviderSlug: "garmin",
        },
        {
          connectSourceId: "whoop",
          connectTarget: "whoop",
          provider: "junction",
          sourceProviderSlug: "whoop_v2",
        },
      ],
      connections: [buildConnection({
        id: "dspc_junction_multi",
        lastSyncCompletedAt: "2026-06-09T07:00:00.000Z",
        provider: "junction",
        status: "active",
        updatedAt: "2026-06-09T08:50:48.000Z",
      })],
      now: new Date("2026-06-09T12:00:00.000Z"),
      providers: [JUNCTION_PROVIDER],
    });

    expect(source).toMatchObject({
      connectSourceId: "whoop",
      connectTarget: "whoop",
      detail: "WHOOP needs to be reconnected before Murph can keep syncing it.",
      primaryAction: { kind: "reconnect", label: "Reconnect" },
      providerLabel: "WHOOP",
      statusLabel: "Needs access",
      tone: "attention",
    });
    expect(source?.upstreamSources).toEqual([
      {
        connectProvider: "junction",
        connectSourceId: "garmin",
        connectTarget: "garmin",
        providerLabel: "Garmin",
        resourceCount: 2,
        sourceProviderSlug: "garmin",
        status: "connected",
      },
      {
        connectProvider: "junction",
        connectSourceId: "whoop",
        connectTarget: "whoop",
        providerLabel: "WHOOP",
        requiresReconnect: true,
        resourceCount: 3,
        sourceProviderSlug: "whoop_v2",
        status: "error",
      },
    ]);
  });

  it("does not borrow another Junction child source's target for Apple Health reconnect", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connectionSources: [
        {
          connectionId: "dspc_junction_multi",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-06-09T08:30:00.000Z",
          resourceCount: 2,
          sourceProviderSlug: "garmin",
          status: "connected",
        },
        {
          connectionId: "dspc_junction_multi",
          firstSeenAt: "2026-04-01T08:00:00.000Z",
          lastSeenAt: "2026-06-09T08:50:48.000Z",
          requiresReconnect: true,
          resourceCount: 3,
          sourceProviderSlug: "apple_health_kit",
          status: "error",
        },
      ],
      connectTargets: [{
        connectSourceId: "garmin",
        connectTarget: "garmin",
        provider: "junction",
        sourceProviderSlug: "garmin",
      }],
      connections: [buildConnection({
        id: "dspc_junction_multi",
        lastSyncCompletedAt: "2026-06-09T07:00:00.000Z",
        provider: "junction",
        status: "active",
        updatedAt: "2026-06-09T08:50:48.000Z",
      })],
      now: new Date("2026-06-09T12:00:00.000Z"),
      providers: [JUNCTION_PROVIDER],
    });

    expect(source).toMatchObject({
      connectSourceId: null,
      connectTarget: null,
      detail: "Apple Health needs to be reconnected before Murph can keep syncing it.",
      guidance: "Disconnect this source if you no longer need it.",
      primaryAction: null,
      provider: "junction",
      providerLabel: "Apple Health",
      secondaryAction: { kind: "disconnect", label: "Disconnect" },
      statusLabel: "Needs access",
      tone: "attention",
    });
  });

  it("keeps pending external-link setup separate from the active lifecycle state", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        connectedAt: "2026-04-03T10:00:00.000Z",
        setupExpiresAt: "2026-04-03T13:00:00.000Z",
        setupPhase: "pending_link",
        updatedAt: "2026-04-03T10:00:00.000Z",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      headline: "Finishing setup",
      primaryAction: null,
      secondaryAction: { kind: "disconnect", label: "Disconnect" },
      setupIncomplete: false,
      state: "active",
      statusLabel: "Setting up",
      tone: "muted",
    });
  });

  it("marks failed or expired external-link setup without a settings connect action", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        connectedAt: "2026-04-03T08:00:00.000Z",
        setupExpiresAt: "2026-04-03T11:00:00.000Z",
        setupPhase: "link_returned",
        updatedAt: "2026-04-03T11:05:00.000Z",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      headline: "Setup needs attention",
      primaryAction: null,
      secondaryAction: { kind: "disconnect", label: "Disconnect" },
      setupIncomplete: true,
      state: "active",
      statusLabel: "Setup incomplete",
      tone: "attention",
    });
  });

  it("keeps source-confirmed setup connected before the first sync completes", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        connectedAt: "2026-04-03T11:30:00.000Z",
        lastSyncCompletedAt: null,
        lastSyncStartedAt: null,
        setupExpiresAt: null,
        setupPhase: "source_confirmed",
        updatedAt: "2026-04-03T11:35:00.000Z",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      headline: "Connected",
      state: "active",
      statusLabel: "Connected",
      tone: "calm",
    });
  });

  it("treats pending external-link setup without a valid expiry as needing attention", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        connectedAt: "2026-04-03T08:00:00.000Z",
        setupExpiresAt: null,
        setupPhase: "pending_link",
        updatedAt: "2026-04-03T11:05:00.000Z",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      headline: "Setup needs attention",
      primaryAction: null,
      setupIncomplete: true,
      statusLabel: "Setup incomplete",
      tone: "attention",
    });
  });

  it("treats stale active sources with recent errors as attention-worthy", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        lastSyncCompletedAt: "2026-03-28T07:00:00.000Z",
        lastSyncErrorAt: "2026-04-02T08:00:00.000Z",
        nextReconcileAt: "2026-04-03T16:00:00.000Z",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      detail: "Murph has not seen a fresh sync from this source recently.",
      headline: "Connected, but updates have been quiet lately",
      primaryAction: null,
      state: "active",
      statusLabel: "Needs attention",
      tone: "attention",
    });
  });

  it("offers reconnect for active sources whose latest sync failed when a connect target is available", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        lastErrorCode: "WHOOP_TOKEN_REQUEST_FAILED",
        lastErrorMessage: "WHOOP token request failed.",
        lastSyncCompletedAt: "2026-03-28T07:00:00.000Z",
        lastSyncErrorAt: "2026-04-02T08:00:00.000Z",
        nextReconcileAt: "2026-04-03T16:00:00.000Z",
      })],
      connectTargets: [{
        connectSourceId: "oura",
        connectTarget: "oura",
        provider: "oura",
      }],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      guidance: "Reconnect this source to refresh access, or disconnect it if you no longer need it.",
      primaryAction: { kind: "reconnect", label: "Reconnect" },
      secondaryAction: { kind: "disconnect", label: "Disconnect" },
      statusLabel: "Needs attention",
      tone: "attention",
    });
  });

  it("keeps unavailable connections visible when a provider is no longer configured here", () => {
    const sources = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        id: "dspc_missing_123",
        provider: "whoop",
        status: "active",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });
    const source = sources.find((entry) => entry.provider === "whoop");

    expect(source).toBeDefined();
    expect(source).toMatchObject({
      connectionId: "dspc_missing_123",
      headline: "Unavailable here",
      primaryAction: null,
      provider: "whoop",
      providerConfigured: false,
      secondaryAction: { kind: "disconnect", label: "Disconnect" },
      state: "unavailable",
      statusLabel: "Unavailable",
      tone: "muted",
    });
  });
});

describe("isActiveHostedDeviceSyncSource", () => {
  it("matches sources that represent a live device-sync connection", () => {
    expect(isActiveHostedDeviceSyncSource({
      connectionId: "dspc_active",
      state: "active",
    })).toBe(true);
    expect(isActiveHostedDeviceSyncSource({
      connectionId: "dspc_reauth",
      state: "reauthorization_required",
    })).toBe(true);
  });

  it("ignores placeholders and inactive connection records", () => {
    expect(isActiveHostedDeviceSyncSource({
      connectionId: null,
      state: "available",
    })).toBe(false);
    expect(isActiveHostedDeviceSyncSource({
      connectionId: "dspc_disconnected",
      state: "disconnected",
    })).toBe(false);
    expect(isActiveHostedDeviceSyncSource({
      connectionId: "dspc_unavailable",
      state: "unavailable",
    })).toBe(false);
  });

  it("ignores connections whose setup never finished", () => {
    expect(isActiveHostedDeviceSyncSource({
      connectionId: "dspc_setup_incomplete",
      setupIncomplete: true,
      state: "active",
    })).toBe(false);
    expect(isActiveHostedDeviceSyncSource({
      connectionId: "dspc_setting_up",
      setupIncomplete: false,
      state: "active",
    })).toBe(true);
  });
});
