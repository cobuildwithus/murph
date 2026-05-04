import type { PublicProviderDescriptor } from "@murphai/device-syncd/public-ingress";

import type { HostedBrowserDeviceSyncConnection } from "./public-connection";
import type { HostedBrowserDeviceSyncConnectionSource } from "./public-ingress-service";

import { formatHostedDeviceSyncProviderLabel } from "./provider-label";

export { formatHostedDeviceSyncProviderLabel };

export interface HostedDeviceSyncSettingsAction {
  kind: "disconnect";
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
  upstreamSources: HostedDeviceSyncSettingsUpstreamSource[];
}

export interface HostedDeviceSyncSettingsUpstreamSource {
  providerLabel: string;
  resourceCount: number;
  sourceProviderSlug: string;
  status: HostedBrowserDeviceSyncConnectionSource["status"];
}

export interface HostedDeviceSyncSettingsResponse {
  generatedAt: string;
  ok: true;
  sources: HostedDeviceSyncSettingsSource[];
}

export function isActiveHostedDeviceSyncSource(
  source: Pick<HostedDeviceSyncSettingsSource, "connectionId" | "state">,
): boolean {
  return Boolean(source.connectionId)
    && source.state !== "available"
    && source.state !== "disconnected"
    && source.state !== "unavailable";
}

const FIRST_SYNC_GRACE_MS = 6 * 60 * 60_000;
const RECENT_SYNC_WINDOW_MS = 36 * 60 * 60_000;
const STALE_SYNC_WINDOW_MS = 4 * 24 * 60 * 60_000;
const CONNECTION_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function buildHostedDeviceSyncSettingsSources(input: {
  connectionSources?: readonly HostedBrowserDeviceSyncConnectionSource[];
  connections: readonly HostedBrowserDeviceSyncConnection[];
  now?: Date;
  providers: readonly PublicProviderDescriptor[];
}): HostedDeviceSyncSettingsSource[] {
  const now = input.now ?? new Date();
  const connectionsByProvider = new Map<string, HostedBrowserDeviceSyncConnection[]>();
  const upstreamSourcesByConnectionId = groupUpstreamSourcesByConnectionId(input.connectionSources ?? []);

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
      continue;
    }

    for (const [connectionIndex, connection] of connections.entries()) {
      sources.push(buildConnectedSource({
        connection,
        connectionIndex,
        duplicateCount: connections.length,
        now,
        provider,
        upstreamSources: upstreamSourcesByConnectionId.get(connection.id) ?? [],
      }));
    }
  }

  for (const [providerKey, connections] of connectionsByProvider.entries()) {
    if (configuredProviders.has(providerKey)) {
      continue;
    }

    for (const [connectionIndex, connection] of connections.entries()) {
      sources.push(buildUnavailableSource(connection, {
        connectionIndex,
        duplicateCount: connections.length,
        upstreamSources: upstreamSourcesByConnectionId.get(connection.id) ?? [],
      }));
    }
  }

  return sources;
}

function buildConnectedSource(input: {
  connection: HostedBrowserDeviceSyncConnection;
  connectionIndex: number;
  duplicateCount: number;
  now: Date;
  provider: PublicProviderDescriptor;
  upstreamSources: HostedDeviceSyncSettingsUpstreamSource[];
}): HostedDeviceSyncSettingsSource {
  const { connection, now } = input;
  const providerLabel = formatHostedDeviceSyncProviderLabel(connection.provider);
  const displayName = resolveDisplayName({
    connection,
    connectionIndex: input.connectionIndex,
    duplicateCount: input.duplicateCount,
    providerLabel,
  });
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
  const setupPhase = connection.setupPhase ?? null;

  if (connection.status === "disconnected") {
    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      detail: lastSuccessfulSyncAt
        ? "This source is disconnected. Your past history stays in place."
        : "This source is disconnected.",
      displayName,
      guidance: "Past history stays in place.",
      headline: "Disconnected",
      lastActivityAt,
      lastSuccessfulSyncAt,
      lastWebhookAt: connection.lastWebhookAt,
      nextReconcileAt: null,
      primaryAction: null,
      provider: connection.provider,
      providerConfigured: true,
      providerLabel,
      secondaryAction: null,
      state: connection.status,
      statusLabel: "Disconnected",
      tone: "muted",
      updatedAt: connection.updatedAt,
      upstreamSources: input.upstreamSources,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  if (setupPhase === "pending_link" || setupPhase === "link_returned" || setupPhase === "failed") {
    const setupExpired =
      setupPhase !== "failed" && !isFutureIsoTimestamp(connection.setupExpiresAt, now);
    const setupNeedsAttention = setupPhase === "failed" || setupExpired;

    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      detail: setupNeedsAttention
        ? "The provider connection setup did not finish cleanly."
        : "Waiting for the provider to confirm the source.",
      displayName,
      guidance: setupNeedsAttention
        ? "Disconnect this source if you no longer need it."
        : "Murph can keep listening for provider confirmation in the background.",
      headline: setupNeedsAttention ? "Setup needs attention" : "Finishing setup",
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
      statusLabel: setupNeedsAttention ? "Setup incomplete" : "Setting up",
      tone: setupNeedsAttention ? "attention" : "muted",
      updatedAt: connection.updatedAt,
      upstreamSources: input.upstreamSources,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  if (connection.status === "reauthorization_required") {
    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      detail: "The provider asked Murph to renew access before it can keep syncing.",
      displayName,
      guidance: lastSuccessfulSyncAt
        ? "Your earlier history is still here."
        : "Murph cannot finish the first full sync until access is renewed.",
      headline: "Access needs attention",
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
      statusLabel: "Needs access",
      tone: "attention",
      updatedAt: connection.updatedAt,
      upstreamSources: input.upstreamSources,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  if (!lastSuccessfulSyncAt) {
    const stillWithinFirstSyncWindow = connectedAgeMs !== null && connectedAgeMs <= FIRST_SYNC_GRACE_MS;
    const detail = stillWithinFirstSyncWindow
      ? "Waiting for the first full sync."
      : "Murph has not seen a successful sync from this source yet.";
    const guidance = hasRecentError
      ? "Disconnect this source if you no longer need it."
      : stillWithinFirstSyncWindow
        ? "This usually settles on its own after the initial connection."
        : "Give it a little time unless you expect data here already.";

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
      primaryAction: null,
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
      upstreamSources: input.upstreamSources,
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
      upstreamSources: input.upstreamSources,
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
      upstreamSources: input.upstreamSources,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  return {
    connectionId: connection.id,
    connectedAt: connection.connectedAt,
    detail: "Murph has not seen a fresh sync from this source recently.",
    displayName,
    guidance: hasRecentError
      ? "Disconnect this source if you no longer need it."
      : "This may resolve on its own if the provider sends new data.",
    headline: "Connected, but updates have been quiet lately",
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
    statusLabel: hasRecentError ? "Needs attention" : "Quiet lately",
    tone: hasRecentError ? "attention" : "muted",
    updatedAt: connection.updatedAt,
    upstreamSources: input.upstreamSources,
  } satisfies HostedDeviceSyncSettingsSource;
}

function buildUnavailableSource(
  connection: HostedBrowserDeviceSyncConnection,
  input: {
    connectionIndex: number;
    duplicateCount: number;
    upstreamSources: HostedDeviceSyncSettingsUpstreamSource[];
  },
): HostedDeviceSyncSettingsSource {
  const providerLabel = formatHostedDeviceSyncProviderLabel(connection.provider);
  const displayName = resolveDisplayName({
    connection,
    connectionIndex: input.connectionIndex,
    duplicateCount: input.duplicateCount,
    providerLabel,
  });
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
    guidance: "If you still need it, this provider has to be enabled in the active environment first.",
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
    upstreamSources: input.upstreamSources,
  } satisfies HostedDeviceSyncSettingsSource;
}

function normalizeDisplayName(value: string | null, providerLabel: string): string | null {
  const normalized = value?.trim() ?? "";

  if (!normalized || normalized.toLowerCase() === providerLabel.toLowerCase()) {
    return null;
  }

  return normalized;
}

function resolveDisplayName(input: {
  connection: HostedBrowserDeviceSyncConnection;
  connectionIndex: number;
  duplicateCount: number;
  providerLabel: string;
}): string | null {
  const normalized = normalizeDisplayName(input.connection.displayName, input.providerLabel);

  if (normalized) {
    return normalized;
  }

  if (input.duplicateCount <= 1) {
    return null;
  }

  const disambiguatorTimestamp =
    input.connection.connectedAt ?? input.connection.createdAt ?? input.connection.updatedAt;
  const parsed = disambiguatorTimestamp ? Date.parse(disambiguatorTimestamp) : Number.NaN;

  if (Number.isNaN(parsed)) {
    return `Connection ${input.connectionIndex + 1}`;
  }

  return `Connected ${CONNECTION_LABEL_FORMATTER.format(new Date(parsed))} (#${input.connectionIndex + 1})`;
}

function groupUpstreamSourcesByConnectionId(
  sources: readonly HostedBrowserDeviceSyncConnectionSource[],
): Map<string, HostedDeviceSyncSettingsUpstreamSource[]> {
  const grouped = new Map<string, HostedDeviceSyncSettingsUpstreamSource[]>();

  for (const source of sources) {
    const connectionId = source.connectionId.trim();
    if (!connectionId) {
      continue;
    }

    const entry = toSettingsUpstreamSource(source);
    const existing = grouped.get(connectionId);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(connectionId, [entry]);
    }
  }

  for (const entries of grouped.values()) {
    entries.sort(compareUpstreamSources);
  }

  return grouped;
}

function toSettingsUpstreamSource(
  source: HostedBrowserDeviceSyncConnectionSource,
): HostedDeviceSyncSettingsUpstreamSource {
  return {
    providerLabel: formatPublicUpstreamSourceLabel(source.sourceProviderSlug),
    resourceCount: source.resourceCount,
    sourceProviderSlug: source.sourceProviderSlug,
    status: source.status,
  };
}

function compareUpstreamSources(
  left: HostedDeviceSyncSettingsUpstreamSource,
  right: HostedDeviceSyncSettingsUpstreamSource,
): number {
  if (left.status !== right.status) {
    return sourceStatusRank(left.status) - sourceStatusRank(right.status);
  }

  if (left.providerLabel !== right.providerLabel) {
    return left.providerLabel.localeCompare(right.providerLabel);
  }

  return left.resourceCount - right.resourceCount;
}

function formatPublicUpstreamSourceLabel(sourceProviderSlug: string): string {
  const normalized = sourceProviderSlug.trim().toLowerCase().replace(/_/gu, "-");

  switch (normalized) {
    case "dexcom-v3":
      return "Dexcom";
    case "fitbit":
      return "Fitbit";
    case "freestyle-libre":
      return "Freestyle Libre";
    case "garmin":
      return "Garmin";
    case "oura":
      return "Oura";
    case "strava":
      return "Strava";
    case "whoop":
      return "WHOOP";
    case "withings":
      return "Withings";
  }

  return "Connected source";
}

function sourceStatusRank(status: HostedDeviceSyncSettingsUpstreamSource["status"]): number {
  switch (status) {
    case "connected":
      return 0;
    case "error":
      return 1;
    case "unavailable":
      return 2;
  }

  return 3;
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

function isFutureIsoTimestamp(value: string | null | undefined, now: Date): boolean {
  if (!value) {
    return false;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return false;
  }

  return parsed > now.getTime();
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
