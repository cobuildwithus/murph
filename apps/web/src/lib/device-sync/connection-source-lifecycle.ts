import {
  canonicalizeJunctionProviderSlug,
} from "@murphai/device-syncd/connect-config";
import {
  resolveDeviceSyncSourceState,
} from "@murphai/device-syncd/public-account";

import type { HostedDeviceConnectionSource } from "./prisma-store/sources";

export {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
    as HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE
    as HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE
    as HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE,
  isDeviceSyncSourceAdmitted as isHostedConnectionSourceAdmitted,
  isDeviceSyncSourceDisconnectFenced as isHostedSourceDisconnectFenced,
} from "@murphai/device-syncd/public-account";

export function resolveHostedJunctionConnectionSource(
  sources: readonly HostedDeviceConnectionSource[],
  sourceProviderSlug: string,
): HostedDeviceConnectionSource | null {
  const canonicalSourceProviderSlug = canonicalizeJunctionProviderSlug(sourceProviderSlug);
  if (!canonicalSourceProviderSlug) {
    return null;
  }
  const candidates = sources
    .filter((source) =>
      canonicalizeJunctionProviderSlug(source.sourceProviderSlug)
        === canonicalSourceProviderSlug
    )
    .map((source) => ({
      ...source,
      resourceAvailabilitySummary: source.resourceAvailabilitySummary ?? undefined,
    }));
  const first = candidates[0];
  if (!first) {
    return null;
  }
  const resolved = resolveDeviceSyncSourceState(
    [first, ...candidates.slice(1)],
    () => new TypeError("Hosted Junction source lifecycle authority is inconsistent."),
  );

  return {
    ...resolved.lifecycleSource,
    connectionId: resolved.identitySource.connectionId,
    createdAt: resolved.identitySource.createdAt,
    firstSeenAt: resolved.identitySource.firstSeenAt,
    id: resolved.identitySource.id,
    lastDataAt: resolved.lastDataAt,
    resourceAvailabilitySummary:
      resolved.lifecycleSource.resourceAvailabilitySummary ?? null,
    sourceInstanceKey: resolved.identitySource.sourceInstanceKey,
    sourceProviderSlug: resolved.identitySource.sourceProviderSlug,
  };
}
