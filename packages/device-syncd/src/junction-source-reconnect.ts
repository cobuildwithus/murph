import {
  JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS,
  removeJunctionExtendedTimeseriesHistoryBackfillCoverage,
} from "./junction-historical-backfill-progress.ts";
import { isDeviceSyncSourceDisconnectFenced } from "./public-account.ts";

export function decideJunctionSourceCallbackAdmission(input: {
  connectionStartedAt?: string | null;
  currentSource: {
    lastErrorCode?: string | null;
    lastSeenAt: string;
    status: string;
  } | null;
}): "advance_lifecycle" | "new_source" | "reject" {
  if (!input.currentSource) {
    return "new_source";
  }
  if (isDeviceSyncSourceDisconnectFenced(input.currentSource)) {
    return "reject";
  }
  if (input.currentSource.status !== "disconnected") {
    return "advance_lifecycle";
  }

  const connectionStartedAtMs = Date.parse(input.connectionStartedAt ?? "");
  const sourceLastSeenAtMs = Date.parse(input.currentSource.lastSeenAt);
  return Number.isFinite(connectionStartedAtMs)
    && Number.isFinite(sourceLastSeenAtMs)
    && connectionStartedAtMs >= sourceLastSeenAtMs
    ? "advance_lifecycle"
    : "reject";
}

export function clearJunctionScheduleTimeExtendedHistoryCoverageForProvider(input: {
  metadata: Record<string, unknown>;
  providerSlug: string;
}): Record<string, unknown> {
  let metadata = input.metadata;

  for (const [resource, version] of JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS) {
    metadata = removeJunctionExtendedTimeseriesHistoryBackfillCoverage({
      metadata,
      providerSlug: input.providerSlug,
      resource,
      version,
    }) ?? metadata;
  }

  return metadata;
}

export function clearJunctionAllExtendedHistoryCoverageForProvider(input: {
  metadata: Record<string, unknown>;
  providerSlug: string;
}): Record<string, unknown> {
  const metadata = removeJunctionExtendedTimeseriesHistoryBackfillCoverage({
    metadata: input.metadata,
    providerSlug: input.providerSlug,
    resource: "blood_pressure",
    version: 1,
  }) ?? input.metadata;

  return clearJunctionScheduleTimeExtendedHistoryCoverageForProvider({
    metadata,
    providerSlug: input.providerSlug,
  });
}
