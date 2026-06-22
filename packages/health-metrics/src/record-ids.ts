import { uniqueStrings } from "./catalog.ts";
import type { MetricPoint } from "./types.ts";

export function metricPointRecordIds(point: MetricPoint): string[] {
  const ids = new Set<string>();
  const contributingRecordIds = point.context.contributingRecordIds;
  if (Array.isArray(contributingRecordIds)) {
    for (const value of contributingRecordIds) {
      if (typeof value === "string" && value.length > 0) {
        ids.add(value);
      }
    }
  }

  ids.add(point.source.recordId);
  if (point.source.kind === "sample-summary") {
    for (const id of [...ids]) {
      for (const alias of sampleSummaryRecordIdAliases(id)) {
        ids.add(alias);
      }
    }
  }

  return uniqueStrings([...ids]);
}

function sampleSummaryRecordIdAliases(recordId: string): string[] {
  const [prefix, first, second] = recordId.split(":");
  if (prefix !== "sample-summary" || !first || !second) {
    return [];
  }

  return isIsoDate(first) ? [`sample-summary:${second}:${first}`] : [];
}

function isIsoDate(value: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value);
}
