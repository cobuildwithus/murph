import { resolveJunctionConnectSourceLabel } from "@murphai/device-syncd/connect-config";
import { formatDeviceSyncProviderLabel } from "@murphai/device-syncd/provider-label";

const INTERMEDIARY_DEVICE_SYNC_PROVIDERS = new Set(["junction"]);
const UNKNOWN_SOURCE_LABEL = "Connected source";
const SOURCE_METADATA_KEYS = new Set(["sourceProviderSlug", "connectTarget", "connectSourceId"]);

export interface HostedDeviceSyncBrowserLabelSource {
  providerLabel?: string | null;
  sourceProviderSlug?: string | null;
  status?: string | null;
}

export function formatHostedDeviceSyncProviderLabel(provider: string): string {
  if (INTERMEDIARY_DEVICE_SYNC_PROVIDERS.has(provider.trim().toLowerCase())) {
    return "Wearable source";
  }

  return formatDeviceSyncProviderLabel(provider);
}

export function formatHostedDeviceSyncSourceLabel(sourceProviderSlug: string): string {
  const junctionLabel = resolveJunctionConnectSourceLabel(sourceProviderSlug);
  if (junctionLabel) {
    return junctionLabel;
  }

  const normalized = sourceProviderSlug.trim().toLowerCase().replace(/_/gu, "-");

  switch (normalized) {
    case "apple-health":
    case "apple-health-kit":
    case "apple-healthkit":
      return "Apple Health";
    case "whoop":
      return formatDeviceSyncProviderLabel("whoop");
    default:
      return UNKNOWN_SOURCE_LABEL;
  }
}

export function resolveHostedDeviceSyncBrowserProviderLabel(input: {
  metadata?: unknown;
  provider: string;
  upstreamSources?: readonly HostedDeviceSyncBrowserLabelSource[];
}): string {
  const upstreamSources = input.upstreamSources ?? [];
  const connectedLabels = uniqueSourceLabels(
    upstreamSources
      .filter((source) => source.status === "connected")
      .map(resolveSourceLabel),
  );

  if (connectedLabels.length === 1 && connectedLabels[0]) {
    return connectedLabels[0];
  }

  if (connectedLabels.length > 1) {
    return `${connectedLabels.length} wearables`;
  }

  const knownLabels = uniqueSourceLabels(upstreamSources.map(resolveSourceLabel));

  if (knownLabels.length === 1 && knownLabels[0]) {
    return knownLabels[0];
  }

  if (knownLabels.length > 1) {
    return `${knownLabels.length} wearables`;
  }

  return resolveMetadataSourceLabel(input.metadata) ?? formatHostedDeviceSyncProviderLabel(input.provider);
}

function resolveSourceLabel(source: HostedDeviceSyncBrowserLabelSource): string | null {
  const providerLabel = source.providerLabel?.trim();
  if (providerLabel) {
    return providerLabel;
  }

  return source.sourceProviderSlug
    ? formatHostedDeviceSyncSourceLabel(source.sourceProviderSlug)
    : null;
}

function uniqueSourceLabels(labels: readonly (string | null)[]): string[] {
  return [...new Set(labels.filter((label): label is string =>
    Boolean(label) && label !== UNKNOWN_SOURCE_LABEL,
  ))];
}

function resolveMetadataSourceLabel(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (!SOURCE_METADATA_KEYS.has(key) || typeof value !== "string") {
      continue;
    }

    const label = formatHostedDeviceSyncSourceLabel(value);
    if (label !== UNKNOWN_SOURCE_LABEL) {
      return label;
    }
  }

  return null;
}
