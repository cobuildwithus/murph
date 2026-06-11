import type { HostedDeviceSyncSettingsSource } from "@/src/lib/device-sync/settings-surface";

export type SidebarAccountStatusTone = "attention" | "connected" | "muted";

export interface SidebarAccountStatus {
  message: string;
  tone: SidebarAccountStatusTone;
}

export interface SidebarDeviceSyncStatusResponse {
  generatedAt: string;
  ok: true;
  status: SidebarAccountStatus | null;
}

export function summarizeSidebarDeviceSyncStatus(
  sources: readonly HostedDeviceSyncSettingsSource[],
): SidebarAccountStatus | null {
  if (sources.length === 0) {
    return null;
  }

  const attentionSource = sources.find(
    (source) => Boolean(source.connectionId) && source.tone === "attention",
  );

  if (attentionSource) {
    return describeSourceStatus(attentionSource, "attention");
  }

  const activeSources = sources.filter(isActiveConnectionSource);
  const quietSource = activeSources.find((source) => source.tone !== "calm");

  if (quietSource) {
    return describeSourceStatus(quietSource, "muted");
  }

  if (activeSources.length === 1) {
    return describeSourceStatus(activeSources[0], "connected");
  }

  if (activeSources.length > 1) {
    return {
      message: `${activeSources.length} wearables connected`,
      tone: "connected",
    };
  }

  const disconnectedSources = sources.filter(
    (source) => Boolean(source.connectionId) && source.state === "disconnected",
  );

  if (disconnectedSources.length === 1) {
    return describeSourceStatus(disconnectedSources[0], "muted");
  }

  if (disconnectedSources.length > 1) {
    return {
      message: "Wearables disconnected",
      tone: "muted",
    };
  }

  const unavailableSources = sources.filter(
    (source) => Boolean(source.connectionId) && source.state === "unavailable",
  );

  if (unavailableSources.length === 1) {
    return describeSourceStatus(unavailableSources[0], "muted");
  }

  if (unavailableSources.length > 1) {
    return {
      message: "Wearables unavailable",
      tone: "muted",
    };
  }

  return {
    message: "No wearables connected",
    tone: "muted",
  };
}

function isActiveConnectionSource(source: HostedDeviceSyncSettingsSource): boolean {
  return Boolean(source.connectionId)
    && source.state !== "available"
    && source.state !== "disconnected"
    && source.state !== "unavailable";
}

function describeSourceStatus(
  source: HostedDeviceSyncSettingsSource,
  tone: SidebarAccountStatusTone,
): SidebarAccountStatus {
  const fragment = toSentenceFragment(source.statusLabel);
  const providerLabel = source.providerLabel === "Wearable source"
    ? "Wearable"
    : source.providerLabel;
  const connectedUpstreamSources = source.upstreamSources.filter(
    (upstreamSource) => upstreamSource.status === "connected",
  );
  const [connectedUpstreamSource] = connectedUpstreamSources;

  if (connectedUpstreamSources.length === 1 && connectedUpstreamSource) {
    return {
      message: `${connectedUpstreamSource.providerLabel} ${fragment}`,
      tone,
    };
  }

  if (connectedUpstreamSources.length > 1 && fragment === "connected") {
    return {
      message: `${connectedUpstreamSources.length} wearables connected`,
      tone,
    };
  }

  return {
    message: `${providerLabel} ${fragment}`,
    tone,
  };
}

function toSentenceFragment(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "connected";
  }

  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}
