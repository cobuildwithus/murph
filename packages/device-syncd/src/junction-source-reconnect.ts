import {
  JUNCTION_SCHEDULE_TIME_EXTENDED_HISTORY_RESOURCE_VERSIONS,
  removeJunctionExtendedTimeseriesHistoryBackfillCoverage,
} from "./junction-historical-backfill-progress.ts";

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
