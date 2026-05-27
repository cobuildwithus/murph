import type {
  ProjectedWearableActivitySummary,
  ProjectedWearableBodyStateSummary,
  ProjectedWearableRecoverySummary,
  ProjectedWearableSleepSummary,
  ProjectedWearableSourceHealthSummary,
  ProjectedWearableSummaryBundle,
  WearableSummaryBundle,
} from "../wearables.ts";
import {
  parseJsonValue,
} from "./schema.ts";

const WEARABLE_SUMMARY_PROVENANCE_KEYS = new Set([
  "candidateId",
  "dataOrigin",
  "externalRef",
]);

export function stringifyPublicWearableProjectionSummary(summary: unknown): string {
  return JSON.stringify(summary, (key, value) => {
    if (key === "candidates") {
      return [];
    }

    if (WEARABLE_SUMMARY_PROVENANCE_KEYS.has(key)) {
      return undefined;
    }

    if (key === "paths" || key === "recordIds") {
      return [];
    }

    return value;
  });
}

export function projectPublicWearableSummaryBundle(bundle: WearableSummaryBundle): ProjectedWearableSummaryBundle {
  return {
    activityDays: projectPublicWearableSummaries<ProjectedWearableActivitySummary>(bundle.activityDays),
    bodyStateDays: projectPublicWearableSummaries<ProjectedWearableBodyStateSummary>(bundle.bodyStateDays),
    recoveryDays: projectPublicWearableSummaries<ProjectedWearableRecoverySummary>(bundle.recoveryDays),
    sleepNights: projectPublicWearableSummaries<ProjectedWearableSleepSummary>(bundle.sleepNights),
    sourceHealth: projectPublicWearableSummaries<ProjectedWearableSourceHealthSummary>(bundle.sourceHealth),
  };
}

function projectPublicWearableSummaries<TSummary>(summaries: readonly unknown[]): TSummary[] {
  const projected: TSummary[] = [];

  for (const summary of summaries) {
    const parsed = parseJsonValue<TSummary | null>(stringifyPublicWearableProjectionSummary(summary), null);
    if (parsed !== null) {
      projected.push(parsed);
    }
  }

  return projected;
}
