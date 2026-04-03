import type { PublicProviderDescriptor } from "@murphai/device-syncd/public-ingress";

import type { HostedBrowserDeviceSyncConnection } from "./public-connection";

export interface HostedDeviceSyncSettingsAction {
  kind: "connect" | "reconnect" | "disconnect";
  label: string;
}

export type HostedDeviceSyncSettingsTone = "attention" | "calm" | "muted";
export type HostedDeviceSyncSettingsSourceState =
  | HostedBrowserDeviceSyncConnection["status"]
  | "available"
  | "unavailable";

export interface HostedDeviceSyncSettingsSource {
  connectionId: string | null;
  connectedAt: string | null;
  detail: string;
  displayName: string | null;
  guidance: string;
  headline: string;
  lastActivityAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastWebhookAt: string | null;
  nextReconcileAt: string | null;
  primaryAction: HostedDeviceSyncSettingsAction | null;
  provider: string;
  providerConfigured: boolean;
  providerLabel: string;
  secondaryAction: HostedDeviceSyncSettingsAction | null;
  state: HostedDeviceSyncSettingsSourceState;
  statusLabel: string;
  tone: HostedDeviceSyncSettingsTone;
  updatedAt: string | null;
}

export interface HostedDeviceSyncSettingsResponse {
  generatedAt: string;
  ok: true;
  sources: HostedDeviceSyncSettingsSource[];
}

const FIRST_SYNC_GRACE_MS = 6 * 60 * 60_000;
const RECENT_SYNC_WINDOW_MS = 36 * 60 * 60_000;
const STALE_SYNC_WINDOW_MS = 4 * 24 * 60 * 60_000;

export function buildHostedDeviceSyncSettingsSources(input: {
  connections: readonly HostedBrowserDeviceSyncConnection[];
  now?: Date;
  providers: readonly PublicProviderDescriptor[];
}): HostedDeviceSyncSettingsSource[] {
  const now = input.now ?? new Date();
  const connectionsByProvider = new Map<string, HostedBrowserDeviceSyncConnection[]>();

  for (const connection of input.connections) {
    const key = connection.provider.trim().toLowerCase();
    const bucket = connectionsByProvider.get(key);

    if (bucket) {
      bucket.push(connection);
    } else {
      connectionsByProvider.set(key, [connection]);
    }
  }

  for (const bucket of connectionsByProvider.values()) {
    bucket.sort((left, right) => compareDescendingIsoTimestamps(left.updatedAt, right.updatedAt));
  }

  const configuredProviders = new Map(
    input.providers.map((provider) => [provider.provider.trim().toLowerCase(), provider] as const),
  );
  const sources: HostedDeviceSyncSettingsSource[] = [];

  for (const provider of input.providers) {
    const key = provider.provider.trim().toLowerCase();
    const connections = connectionsByProvider.get(key) ?? [];

    if (connections.length === 0) {
      sources.push(buildAvailableSource(provider));
      continue;
    }

    for (const connection of connections) {
      sources.push(buildConnectedSource({
        connection,
        now,
        provider,
      }));
    }
  }

  for (const [providerKey, connections] of connectionsByProvider.entries()) {
    if (configuredProviders.has(providerKey)) {
      continue;
    }

    for (const connection of connections) {
      sources.push(buildUnavailableSource(connection));
    }
  }

  return sources;
}

export function formatHostedDeviceSyncProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();

  switch (normalized) {
    case "oura":
      return "Oura";
    case "garmin":
      return "Garmin";
    case "whoop":
      return "WHOOP";
    default:
      return normalized
        .split(/[-_\s]+/u)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ") || provider;
  }
}

function buildAvailableSource(provider: PublicProviderDescriptor): HostedDeviceSyncSettingsSource {
  return {
    connectionId: null,
    connectedAt: null,
    detail: "Connect once for ongoing sync.",
    displayName: null,
    guidance: provider.supportsWebhooks
      ? "Murph keeps an eye on this in the background and only asks for help when access expires."
      : "Murph checks this quietly in the background and only asks for help when access expires.",
    headline: "Ready when you are",
    lastActivityAt: null,
    lastSuccessfulSyncAt: null,
    lastWebhookAt: null,
    nextReconcileAt: null,
    primaryAction: {
      kind: "connect",
      label: "Connect",
    },
    provider: provider.provider,
    providerConfigured: true,
    providerLabel: formatHostedDeviceSyncProviderLabel(provider.provider),
    secondaryAction: null,
    state: "available",
    statusLabel: "Not connected",
    tone: "muted",
    updatedAt: null,
  } satisfies HostedDeviceSyncSettingsSource;
}

function buildConnectedSource(input: {
  connection: HostedBrowserDeviceSyncConnection;
  now: Date;
  provider: PublicProviderDescriptor;
}): HostedDeviceSyncSettingsSource {
  const { connection, now } = input;
  const providerLabel = formatHostedDeviceSyncProviderLabel(connection.provider);
  const displayName = normalizeDisplayName(connection.displayName, providerLabel);
  const lastSuccessfulSyncAt = connection.lastSyncCompletedAt;
  const lastActivityAt = latestIsoTimestamp(
    connection.lastSyncCompletedAt,
    connection.lastSyncStartedAt,
    connection.lastSyncErrorAt,
    connection.lastWebhookAt,
    connection.updatedAt,
    connection.connectedAt,
  );
  const lastSuccessfulSyncAgeMs = ageInMilliseconds(lastSuccessfulSyncAt, now);
  const hasRecentError = isIsoTimestampNewer(connection.lastSyncErrorAt, connection.lastSyncCompletedAt);
  const connectedAgeMs = ageInMilliseconds(connection.connectedAt, now);

  if (connection.status === "disconnected") {
    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      detail: lastSuccessfulSyncAt
        ? "This source is disconnected. Your past history stays in place."
        : "This source is disconnected.",
      displayName,
      guidance: "Reconnect any time if you want fresh updates again.",
      headline: "Disconnected",
      lastActivityAt,
      lastSuccessfulSyncAt,
      lastWebhookAt: connection.lastWebhookAt,
      nextReconcileAt: null,
      primaryAction: input.provider
        ? {
            kind: "reconnect",
            label: "Reconnect",
          }
        : null,
      provider: connection.provider,
      providerConfigured: true,
      providerLabel,
      secondaryAction: null,
      state: connection.status,
      statusLabel: "Disconnected",
      tone: "muted",
      updatedAt: connection.updatedAt,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  if (connection.status === "reauthorization_required") {
    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      detail: "The provider asked Murph to renew access before it can keep syncing.",
      displayName,
      guidance: lastSuccessfulSyncAt
        ? "Your earlier history is still here. Reconnect when you're ready."
        : "Reconnect when you're ready and Murph can finish the first full sync.",
      headline: "Needs a quick reconnect",
      lastActivityAt,
      lastSuccessfulSyncAt,
      lastWebhookAt: connection.lastWebhookAt,
      nextReconcileAt: connection.nextReconcileAt,
      primaryAction: {
        kind: "reconnect",
        label: "Reconnect",
      },
      provider: connection.provider,
      providerConfigured: true,
      providerLabel,
      secondaryAction: {
        kind: "disconnect",
        label: "Disconnect",
      },
      state: connection.status,
      statusLabel: "Needs reconnect",
      tone: "attention",
      updatedAt: connection.updatedAt,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  if (!lastSuccessfulSyncAt) {
    const stillWithinFirstSyncWindow = connectedAgeMs !== null && connectedAgeMs <= FIRST_SYNC_GRACE_MS;
    const detail = stillWithinFirstSyncWindow
      ? "Waiting for the first full sync."
      : "Murph has not seen a successful sync from this source yet.";
    const guidance = hasRecentError
      ? "A reconnect could help if this has been stuck for a while."
      : stillWithinFirstSyncWindow
        ? "This usually settles on its own after the initial connection."
        : "Give it a little time before reconnecting unless you expect data here already.";

    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      detail,
      displayName,
      guidance,
      headline: "Connected",
      lastActivityAt,
      lastSuccessfulSyncAt: null,
      lastWebhookAt: connection.lastWebhookAt,
      nextReconcileAt: connection.nextReconcileAt,
      primaryAction: hasRecentError
        ? {
            kind: "reconnect",
            label: "Reconnect",
          }
        : null,
      provider: connection.provider,
      providerConfigured: true,
      providerLabel,
      secondaryAction: {
        kind: "disconnect",
        label: "Disconnect",
      },
      state: connection.status,
      statusLabel: hasRecentError ? "Needs attention" : "Connected",
      tone: hasRecentError ? "attention" : "calm",
      updatedAt: connection.updatedAt,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  if (lastSuccessfulSyncAgeMs !== null && lastSuccessfulSyncAgeMs <= RECENT_SYNC_WINDOW_MS) {
    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      detail: "Murph has a fresh sync from this source.",
      displayName,
      guidance: "Nothing to do here.",
      headline: "Connected and syncing normally",
      lastActivityAt,
      lastSuccessfulSyncAt,
      lastWebhookAt: connection.lastWebhookAt,
      nextReconcileAt: connection.nextReconcileAt,
      primaryAction: null,
      provider: connection.provider,
      providerConfigured: true,
      providerLabel,
      secondaryAction: {
        kind: "disconnect",
        label: "Disconnect",
      },
      state: connection.status,
      statusLabel: "Connected",
      tone: "calm",
      updatedAt: connection.updatedAt,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  if (lastSuccessfulSyncAgeMs !== null && lastSuccessfulSyncAgeMs <= STALE_SYNC_WINDOW_MS && !hasRecentError) {
    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      detail: "Murph has a recent sync from this source.",
      displayName,
      guidance: "Nothing urgent here. It may update again on the next quiet background check.",
      headline: "Connected",
      lastActivityAt,
      lastSuccessfulSyncAt,
      lastWebhookAt: connection.lastWebhookAt,
      nextReconcileAt: connection.nextReconcileAt,
      primaryAction: null,
      provider: connection.provider,
      providerConfigured: true,
      providerLabel,
      secondaryAction: {
        kind: "disconnect",
        label: "Disconnect",
      },
      state: connection.status,
      statusLabel: "Connected",
      tone: "calm",
      updatedAt: connection.updatedAt,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  return {
    connectionId: connection.id,
    connectedAt: connection.connectedAt,
    detail: "Murph has not seen a fresh sync from this source recently.",
    displayName,
    guidance: hasRecentError
      ? "A reconnect could help if you expect new data here."
      : "This may resolve on its own. Reconnect only if you expect new data and it stays quiet.",
    headline: "Connected, but updates have been quiet lately",
    lastActivityAt,
    lastSuccessfulSyncAt,
    lastWebhookAt: connection.lastWebhookAt,
    nextReconcileAt: connection.nextReconcileAt,
    primaryAction: {
      kind: "reconnect",
      label: "Reconnect",
    },
    provider: connection.provider,
    providerConfigured: true,
    providerLabel,
    secondaryAction: {
      kind: "disconnect",
      label: "Disconnect",
    },
    state: connection.status,
    statusLabel: hasRecentError ? "Needs attention" : "Quiet lately",
    tone: hasRecentError ? "attention" : "muted",
    updatedAt: connection.updatedAt,
  } satisfies HostedDeviceSyncSettingsSource;
}

function buildUnavailableSource(
  connection: HostedBrowserDeviceSyncConnection,
): HostedDeviceSyncSettingsSource {
  const providerLabel = formatHostedDeviceSyncProviderLabel(connection.provider);
  const displayName = normalizeDisplayName(connection.displayName, providerLabel);
  const lastActivityAt = latestIsoTimestamp(
    connection.lastSyncCompletedAt,
    connection.lastSyncStartedAt,
    connection.lastSyncErrorAt,
    connection.lastWebhookAt,
    connection.updatedAt,
    connection.connectedAt,
  );

  return {
    connectionId: connection.id,
    connectedAt: connection.connectedAt,
    detail: "This source exists on your account, but it is not enabled in this environment right now.",
    displayName,
    guidance: "If you still need it, re-enable that provider here before reconnecting.",
    headline: "Unavailable here",
    lastActivityAt,
    lastSuccessfulSyncAt: connection.lastSyncCompletedAt,
    lastWebhookAt: connection.lastWebhookAt,
    nextReconcileAt: connection.nextReconcileAt,
    primaryAction: null,
    provider: connection.provider,
    providerConfigured: false,
    providerLabel,
    secondaryAction: connection.status !== "disconnected"
      ? {
          kind: "disconnect",
          label: "Disconnect",
        }
      : null,
    state: "unavailable",
    statusLabel: "Unavailable",
    tone: "muted",
    updatedAt: connection.updatedAt,
  } satisfies HostedDeviceSyncSettingsSource;
}

function normalizeDisplayName(value: string | null, providerLabel: string): string | null {
  const normalized = value?.trim() ?? "";

  if (!normalized || normalized.toLowerCase() === providerLabel.toLowerCase()) {
    return null;
  }

  return normalized;
}

function latestIsoTimestamp(...values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;

  for (const value of values) {
    if (!value) {
      continue;
    }

    if (!latest || isIsoTimestampNewer(value, latest)) {
      latest = value;
    }
  }

  return latest;
}

function ageInMilliseconds(value: string | null | undefined, now: Date): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.max(0, now.getTime() - parsed);
}

function isIsoTimestampNewer(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;

  if (Number.isNaN(leftTime)) {
    return false;
  }

  if (Number.isNaN(rightTime)) {
    return true;
  }

  return leftTime > rightTime;
}

function compareDescendingIsoTimestamps(left: string | null | undefined, right: string | null | undefined): number {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
}
