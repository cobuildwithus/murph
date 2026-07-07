import { resolveDeviceConnectSourceById } from "./config/connect-routes.ts";
import { resolveJunctionConnectSourceLabel } from "./config/junction-connect-sources.ts";

export function formatDeviceSyncProviderLabel(provider: string): string {
  const directConnectSourceLabel = resolveDeviceConnectSourceById(provider)?.label;

  if (directConnectSourceLabel) {
    return directConnectSourceLabel;
  }

  const junctionLabel = resolveJunctionConnectSourceLabel(provider);
  if (junctionLabel) {
    return junctionLabel;
  }

  const normalized = provider.trim().toLowerCase();

  return normalized
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatDeviceSyncAccountLabel(provider: string, externalAccountId: string): string {
  const providerLabel = formatDeviceSyncProviderLabel(provider);
  const normalizedAccountId = externalAccountId.trim();
  return normalizedAccountId ? `${providerLabel} ${normalizedAccountId}` : providerLabel;
}
