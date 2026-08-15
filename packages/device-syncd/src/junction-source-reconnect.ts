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
