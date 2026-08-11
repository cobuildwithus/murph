import type { PublicProviderDescriptor } from "@murphai/device-syncd/types";
import type { ConfiguredDeviceSyncProviderKey } from "@murphai/device-syncd/connect-config";
import {
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
} from "@murphai/device-syncd/connect-config";

import { formatDeviceSyncProviderLabel } from "@murphai/device-syncd/provider-label";
import { isHistoricalResetIncompleteDeviceSyncAccount } from "@murphai/device-syncd/public-account";

import type { HostedBrowserDeviceSyncConnectionSource } from "./browser-connection-source";
import type { HostedBrowserDeviceSyncConnection } from "./public-connection";

import {
  formatHostedDeviceSyncProviderLabel,
  formatHostedDeviceSyncSourceLabel,
  resolveHostedDeviceSyncBrowserProviderLabel,
} from "./provider-label";

export { formatHostedDeviceSyncProviderLabel };

export interface HostedDeviceSyncSettingsAction {
  kind: "disconnect" | "reconnect";
  label: string;
}

export interface HostedDeviceSyncSettingsConnectTarget {
  connectSourceId: string;
  connectTarget: string;
  provider: ConfiguredDeviceSyncProviderKey;
  sourceProviderSlug?: string | null;
}

export type HostedDeviceSyncSettingsTone = "attention" | "calm" | "muted";
export type HostedDeviceSyncSettingsSourceState =
  | HostedBrowserDeviceSyncConnection["status"]
  | "available"
  | "unavailable";

export interface HostedDeviceSyncSettingsSource {
  connectionId: string | null;
  connectedAt: string | null;
  connectSourceId?: string | null;
  connectTarget?: string | null;
  detail: string;
  displayName: string | null;
  guidance: string;
  headline: string;
  // Set on a disconnected connection whose provider-side revoke failed while a
  // historical reset was pending: the member must remove the old connection in the
  // wearable provider account before reconnecting.
  historicalResetIncomplete?: true;
  lastActivityAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastWebhookAt: string | null;
  nextReconcileAt: string | null;
  primaryAction: HostedDeviceSyncSettingsAction | null;
  provider: string;
  providerConfigured: boolean;
  providerLabel: string;
  secondaryAction: HostedDeviceSyncSettingsAction | null;
  setupIncomplete?: boolean;
  state: HostedDeviceSyncSettingsSourceState;
  statusLabel: string;
  tone: HostedDeviceSyncSettingsTone;
  updatedAt: string | null;
  upstreamSources: HostedDeviceSyncSettingsUpstreamSource[];
}

export interface HostedDeviceSyncSettingsUpstreamSource {
  connectProvider?: ConfiguredDeviceSyncProviderKey | null;
  connectSourceId?: string | null;
  connectTarget?: string | null;
  firstSeenAt?: string;
  lastDataAt?: string | null;
  lastErrorCode?: string | null;
  lastSeenAt?: string;
  providerLabel: string;
  recoveryKind?: HostedBrowserDeviceSyncConnectionSource["recoveryKind"];
  requiresReconnect?: boolean;
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
  source: Pick<HostedDeviceSyncSettingsSource, "connectionId" | "setupIncomplete" | "state">,
): boolean {
  return Boolean(source.connectionId)
    && source.setupIncomplete !== true
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
  connectTargets?: readonly HostedDeviceSyncSettingsConnectTarget[];
  now?: Date;
  providers: readonly PublicProviderDescriptor[];
}): HostedDeviceSyncSettingsSource[] {
  const now = input.now ?? new Date();
  const connectionsByProvider = new Map<string, HostedBrowserDeviceSyncConnection[]>();
  const upstreamSourcesByConnectionId = groupUpstreamSourcesByConnectionId(input.connectionSources ?? []);
  const connectTargets = input.connectTargets ?? [];

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
      const upstreamSources = withUpstreamSourceConnectTargets({
        connection,
        targets: connectTargets,
        upstreamSources: upstreamSourcesByConnectionId.get(connection.id) ?? [],
      });

      sources.push(buildConnectedSource({
        connection,
        connectionIndex,
        connectTarget: resolveHostedDeviceSyncConnectTargetForConnection({
          connection,
          targets: connectTargets,
          upstreamSources,
        }),
        duplicateCount: connections.length,
        now,
        provider,
        upstreamSources,
      }));
    }
  }

  for (const [providerKey, connections] of connectionsByProvider.entries()) {
    if (configuredProviders.has(providerKey)) {
      continue;
    }

    for (const [connectionIndex, connection] of connections.entries()) {
      const upstreamSources = withUpstreamSourceConnectTargets({
        connection,
        targets: connectTargets,
        upstreamSources: upstreamSourcesByConnectionId.get(connection.id) ?? [],
      });

      sources.push(buildUnavailableSource(connection, {
        connectionIndex,
        connectTarget: resolveHostedDeviceSyncConnectTargetForConnection({
          connection,
          targets: connectTargets,
          upstreamSources,
        }),
        duplicateCount: connections.length,
        upstreamSources,
      }));
    }
  }

  return sources;
}

function buildConnectedSource(input: {
  connection: HostedBrowserDeviceSyncConnection;
  connectionIndex: number;
  connectTarget: HostedDeviceSyncSettingsConnectTarget | null;
  duplicateCount: number;
  now: Date;
  provider: PublicProviderDescriptor;
  upstreamSources: HostedDeviceSyncSettingsUpstreamSource[];
}): HostedDeviceSyncSettingsSource {
  const { connection, now } = input;
  const backendProviderLabel = formatDeviceSyncProviderLabel(connection.provider);
  const providerLabel = resolveHostedDeviceSyncBrowserProviderLabel({
    metadata: connection.metadata,
    provider: connection.provider,
    upstreamSources: input.upstreamSources,
  });
  const displayName = resolveDisplayName({
    backendProviderLabel,
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
  const recentErrorReconnectAction = hasRecentError
    ? buildReconnectAction(input.connectTarget)
    : null;
  const connectedAgeMs = ageInMilliseconds(connection.connectedAt, now);
  const setupPhase = connection.setupPhase ?? null;
  const reconnectSource = findRecoveryRequiredUpstreamSource(input.upstreamSources);
  const needsConnectionReset = reconnectSource?.recoveryKind === "connection_reset";
  const sourceReconnectTarget = reconnectSource
    ? resolveUpstreamSourceReconnectTarget(reconnectSource)
    : null;
  const sourceReconnectAction = reconnectSource && !needsConnectionReset
    ? buildReconnectAction(sourceReconnectTarget)
    : null;

  if (connection.status === "disconnected") {
    const resetIncomplete = isHistoricalResetIncompleteDeviceSyncAccount(connection);

    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      connectSourceId: input.connectTarget?.connectSourceId ?? null,
      connectTarget: input.connectTarget?.connectTarget ?? null,
      detail: resetIncomplete
        ? "This source is disconnected, but the last reset did not finish in your wearable provider account."
        : lastSuccessfulSyncAt
          ? "This source is disconnected. Your past history stays in place."
          : "This source is disconnected.",
      displayName,
      guidance: resetIncomplete
        ? "Remove the old connection in your wearable provider account, then connect it again here."
        : "Past history stays in place.",
      headline: "Disconnected",
      ...(resetIncomplete ? { historicalResetIncomplete: true } : {}),
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
      statusLabel: resetIncomplete ? "Needs attention" : "Disconnected",
      tone: resetIncomplete ? "attention" : "muted",
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
      connectSourceId: input.connectTarget?.connectSourceId ?? null,
      connectTarget: input.connectTarget?.connectTarget ?? null,
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
      setupIncomplete: setupNeedsAttention,
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
      connectSourceId: input.connectTarget?.connectSourceId ?? null,
      connectTarget: input.connectTarget?.connectTarget ?? null,
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
      primaryAction: input.connectTarget
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
      statusLabel: "Needs access",
      tone: "attention",
      updatedAt: connection.updatedAt,
      upstreamSources: input.upstreamSources,
    } satisfies HostedDeviceSyncSettingsSource;
  }

  if (reconnectSource) {
    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      connectSourceId: sourceReconnectTarget?.connectSourceId ?? null,
      connectTarget: sourceReconnectTarget?.connectTarget ?? null,
      detail: needsConnectionReset
        ? `${reconnectSource.providerLabel} needs a fresh connection before Murph can bring in its history.`
        : `${reconnectSource.providerLabel} needs to be reconnected before Murph can keep syncing it.`,
      displayName,
      guidance: needsConnectionReset
        ? "Disconnect this source first, then connect it again to start a fresh sync."
        : sourceReconnectAction
          ? "Reconnect this source to refresh access, or disconnect it if you no longer need it."
          : "Disconnect this source if you no longer need it.",
      headline: "Access needs attention",
      lastActivityAt,
      lastSuccessfulSyncAt,
      lastWebhookAt: connection.lastWebhookAt,
      nextReconcileAt: connection.nextReconcileAt,
      primaryAction: sourceReconnectAction,
      provider: connection.provider,
      providerConfigured: true,
      providerLabel: reconnectSource.providerLabel,
      secondaryAction: {
        kind: "disconnect",
        label: "Disconnect",
      },
      state: connection.status,
      statusLabel: needsConnectionReset ? "Needs attention" : "Needs access",
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
      ? recentErrorReconnectAction
        ? "Reconnect this source to refresh access, or disconnect it if you no longer need it."
        : "Disconnect this source if you no longer need it."
      : stillWithinFirstSyncWindow
        ? "This usually settles on its own after the initial connection."
        : "Give it a little time unless you expect data here already.";

    return {
      connectionId: connection.id,
      connectedAt: connection.connectedAt,
      connectSourceId: input.connectTarget?.connectSourceId ?? null,
      connectTarget: input.connectTarget?.connectTarget ?? null,
      detail,
      displayName,
      guidance,
      headline: "Connected",
      lastActivityAt,
      lastSuccessfulSyncAt: null,
      lastWebhookAt: connection.lastWebhookAt,
      nextReconcileAt: connection.nextReconcileAt,
      primaryAction: recentErrorReconnectAction,
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
      connectSourceId: input.connectTarget?.connectSourceId ?? null,
      connectTarget: input.connectTarget?.connectTarget ?? null,
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
      connectSourceId: input.connectTarget?.connectSourceId ?? null,
      connectTarget: input.connectTarget?.connectTarget ?? null,
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
    connectSourceId: input.connectTarget?.connectSourceId ?? null,
    connectTarget: input.connectTarget?.connectTarget ?? null,
    detail: "Murph has not seen a fresh sync from this source recently.",
    displayName,
    guidance: hasRecentError
      ? recentErrorReconnectAction
        ? "Reconnect this source to refresh access, or disconnect it if you no longer need it."
        : "Disconnect this source if you no longer need it."
      : "This may resolve on its own if the provider sends new data.",
    headline: "Connected, but updates have been quiet lately",
    lastActivityAt,
    lastSuccessfulSyncAt,
    lastWebhookAt: connection.lastWebhookAt,
    nextReconcileAt: connection.nextReconcileAt,
    primaryAction: recentErrorReconnectAction,
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

function buildReconnectAction(
  connectTarget: HostedDeviceSyncSettingsConnectTarget | null,
): HostedDeviceSyncSettingsAction | null {
  if (!connectTarget) {
    return null;
  }

  return {
    kind: "reconnect",
    label: "Reconnect",
  };
}

function resolveUpstreamSourceReconnectTarget(
  source: HostedDeviceSyncSettingsUpstreamSource,
): HostedDeviceSyncSettingsConnectTarget | null {
  const connectTarget = source.connectTarget?.trim();
  if (!connectTarget) {
    return null;
  }

  const connectSourceId = source.connectSourceId?.trim();
  if (!connectSourceId) {
    return null;
  }

  const provider = source.connectProvider ?? null;
  if (!provider) {
    return null;
  }

  return {
    connectSourceId,
    connectTarget,
    provider,
    sourceProviderSlug: source.sourceProviderSlug,
  };
}

function buildUnavailableSource(
  connection: HostedBrowserDeviceSyncConnection,
  input: {
    connectionIndex: number;
    connectTarget: HostedDeviceSyncSettingsConnectTarget | null;
    duplicateCount: number;
    upstreamSources: HostedDeviceSyncSettingsUpstreamSource[];
  },
): HostedDeviceSyncSettingsSource {
  const backendProviderLabel = formatDeviceSyncProviderLabel(connection.provider);
  const providerLabel = resolveHostedDeviceSyncBrowserProviderLabel({
    metadata: connection.metadata,
    provider: connection.provider,
    upstreamSources: input.upstreamSources,
  });
  const displayName = resolveDisplayName({
    backendProviderLabel,
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
    connectSourceId: input.connectTarget?.connectSourceId ?? null,
    connectTarget: input.connectTarget?.connectTarget ?? null,
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

function normalizeDisplayName(
  value: string | null,
  providerLabel: string,
  backendProviderLabel: string,
): string | null {
  const normalized = value?.trim() ?? "";

  if (
    !normalized
    || normalized.toLowerCase() === providerLabel.toLowerCase()
    || normalized.toLowerCase() === backendProviderLabel.toLowerCase()
  ) {
    return null;
  }

  return normalized;
}

function resolveDisplayName(input: {
  backendProviderLabel: string;
  connection: HostedBrowserDeviceSyncConnection;
  connectionIndex: number;
  duplicateCount: number;
  providerLabel: string;
}): string | null {
  const normalized = normalizeDisplayName(
    input.connection.displayName,
    input.providerLabel,
    input.backendProviderLabel,
  );

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

export function resolveHostedDeviceSyncConnectTargetForConnection(input: {
  connection: Pick<HostedBrowserDeviceSyncConnection, "provider">;
  targets: readonly HostedDeviceSyncSettingsConnectTarget[];
  upstreamSources: readonly Pick<
    HostedDeviceSyncSettingsUpstreamSource,
    "requiresReconnect" | "sourceProviderSlug"
  >[];
}): HostedDeviceSyncSettingsConnectTarget | null {
  const provider = normalizeProviderKey(input.connection.provider);
  const reconnectTarget = findHostedDeviceSyncConnectTargetForUpstreamSources({
    provider,
    targets: input.targets,
    upstreamSources: input.upstreamSources.filter((source) => source.requiresReconnect === true),
  });

  if (reconnectTarget) {
    return reconnectTarget;
  }

  const upstreamTarget = findHostedDeviceSyncConnectTargetForUpstreamSources({
    provider,
    targets: input.targets,
    upstreamSources: input.upstreamSources,
  });

  if (upstreamTarget) {
    return upstreamTarget;
  }

  const directTarget = input.targets.find((target) =>
    normalizeProviderKey(target.provider) === provider
    && normalizeProviderKey(target.connectTarget) === provider
  );

  if (directTarget) {
    return directTarget;
  }

  return null;
}

function findHostedDeviceSyncConnectTargetForUpstreamSources(input: {
  provider: string | null;
  targets: readonly HostedDeviceSyncSettingsConnectTarget[];
  upstreamSources: readonly Pick<HostedDeviceSyncSettingsUpstreamSource, "sourceProviderSlug">[];
}): HostedDeviceSyncSettingsConnectTarget | null {
  for (const upstreamSource of input.upstreamSources) {
    const sourceProviderSlug = resolveHostedReconnectSourceProviderSlug(
      upstreamSource.sourceProviderSlug,
    );
    const target = input.targets.find((candidate) =>
      normalizeProviderKey(candidate.provider) === input.provider
      && normalizeProviderKey(candidate.sourceProviderSlug ?? null) === sourceProviderSlug
    );

    if (target) {
      return target;
    }
  }

  return null;
}

function resolveHostedReconnectSourceProviderSlug(value: string): string | null {
  const sourceProviderSlug = normalizeProviderKey(value);
  return sourceProviderSlug === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
    ? JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG
    : sourceProviderSlug;
}

function withUpstreamSourceConnectTargets(input: {
  connection: Pick<HostedBrowserDeviceSyncConnection, "provider">;
  targets: readonly HostedDeviceSyncSettingsConnectTarget[];
  upstreamSources: readonly HostedDeviceSyncSettingsUpstreamSource[];
}): HostedDeviceSyncSettingsUpstreamSource[] {
  const provider = normalizeProviderKey(input.connection.provider);

  return input.upstreamSources.map((source) => {
    const target = findHostedDeviceSyncConnectTargetForUpstreamSources({
      provider,
      targets: input.targets,
      upstreamSources: [source],
    });

    return target
      ? {
          ...source,
          connectProvider: target.provider,
          connectSourceId: target.connectSourceId,
          connectTarget: target.connectTarget,
        }
      : source;
  });
}

function toSettingsUpstreamSource(
  source: HostedBrowserDeviceSyncConnectionSource,
): HostedDeviceSyncSettingsUpstreamSource {
  const sourceProviderSlug = normalizeProviderKey(source.sourceProviderSlug);
  const includeMigrationTimeline =
    sourceProviderSlug === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
    || sourceProviderSlug === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG;

  return {
    ...(includeMigrationTimeline
      ? {
          firstSeenAt: source.firstSeenAt,
          lastDataAt: source.lastDataAt ?? null,
          lastSeenAt: source.lastSeenAt,
        }
      : {}),
    ...(source.lastErrorCode ? { lastErrorCode: source.lastErrorCode } : {}),
    providerLabel: formatHostedDeviceSyncSourceLabel(source.sourceProviderSlug),
    ...(source.recoveryKind ? { recoveryKind: source.recoveryKind } : {}),
    ...(source.requiresReconnect ? { requiresReconnect: true } : {}),
    resourceCount: source.resourceCount,
    sourceProviderSlug: source.sourceProviderSlug,
    status: source.status,
  };
}

function findRecoveryRequiredUpstreamSource(
  sources: readonly HostedDeviceSyncSettingsUpstreamSource[],
): HostedDeviceSyncSettingsUpstreamSource | null {
  return sources.find((source) =>
    source.status === "error"
    && (source.requiresReconnect === true || source.recoveryKind === "connection_reset")
  ) ?? null;
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

function normalizeProviderKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function compareDescendingIsoTimestamps(left: string | null | undefined, right: string | null | undefined): number {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
}
