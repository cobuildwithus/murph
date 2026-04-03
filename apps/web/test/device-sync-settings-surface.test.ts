import { describe, expect, it } from "vitest";

import type { PublicProviderDescriptor } from "@murphai/device-syncd/public-ingress";

import type { HostedBrowserDeviceSyncConnection } from "@/src/lib/device-sync/public-connection";
import { buildHostedDeviceSyncSettingsSources } from "@/src/lib/device-sync/settings-surface";

const GARMIN_PROVIDER: PublicProviderDescriptor = {
  callbackPath: "/oauth/garmin/callback",
  callbackUrl: "https://example.com/oauth/garmin/callback",
  defaultScopes: ["activity"],
  provider: "garmin",
  supportsWebhooks: false,
  webhookPath: null,
  webhookUrl: null,
};

const OURA_PROVIDER: PublicProviderDescriptor = {
  callbackPath: "/oauth/oura/callback",
  callbackUrl: "https://example.com/oauth/oura/callback",
  defaultScopes: ["daily"],
  provider: "oura",
  supportsWebhooks: true,
  webhookPath: "/webhooks/oura",
  webhookUrl: "https://example.com/webhooks/oura",
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

describe("buildHostedDeviceSyncSettingsSources", () => {
  it("creates an available placeholder when a provider is configured but not connected", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [],
      providers: [GARMIN_PROVIDER],
    });

    expect(source).toMatchObject({
      connectionId: null,
      headline: "Ready when you are",
      primaryAction: { kind: "connect", label: "Connect" },
      provider: "garmin",
      providerLabel: "Garmin",
      state: "available",
      statusLabel: "Not connected",
      tone: "muted",
    });
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

  it("recommends reconnect when the provider requires reauthorization", () => {
    const [source] = buildHostedDeviceSyncSettingsSources({
      connections: [buildConnection({
        lastSyncCompletedAt: "2026-04-02T07:00:00.000Z",
        lastSyncErrorAt: "2026-04-03T08:00:00.000Z",
        status: "reauthorization_required",
      })],
      now: new Date("2026-04-03T12:00:00.000Z"),
      providers: [OURA_PROVIDER],
    });

    expect(source).toMatchObject({
      headline: "Needs a quick reconnect",
      primaryAction: { kind: "reconnect", label: "Reconnect" },
      secondaryAction: { kind: "disconnect", label: "Disconnect" },
      state: "reauthorization_required",
      statusLabel: "Needs reconnect",
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
      primaryAction: { kind: "reconnect", label: "Reconnect" },
      state: "active",
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
