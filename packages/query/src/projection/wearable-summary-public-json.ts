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
  "activityEvidence",
  "activitySessions",
  "candidateId",
  "dataOrigin",
  "externalRef",
  "reconciliationDurationConsistent",
  "reconciliationExactKey",
  "reconciliationResourceKey",
  "sessionContributors",
  "workoutMetricContributors",
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
    const parsed = projectPublicWearableSummary(summary) as TSummary | null;
    if (parsed !== null) {
      projected.push(parsed);
    }
  }

  return projected;
}

const UNSUPPORTED_PLAIN_DATA = Symbol("unsupported plain data");
// Composed summaries are a few levels deep; deeper input takes the JSON path,
// which keeps its cycle errors.
const MAX_PLAIN_DATA_DEPTH = 32;

/**
 * Equals parsing `stringifyPublicWearableProjectionSummary(summary)` without
 * the text round trip. Values outside plain JSON data (class instances,
 * `toJSON`, bigint, very deep or cyclic graphs) fall back to that exact path;
 * a fallback rereads accessors, which composed summaries do not define.
 */
function projectPublicWearableSummary(summary: unknown): unknown {
  try {
    return copyPublicPlainData(summary, 0) ?? null;
  } catch (error) {
    if (error !== UNSUPPORTED_PLAIN_DATA) throw error;
    return parseJsonValue<unknown>(stringifyPublicWearableProjectionSummary(summary), null);
  }
}

/** Returns `undefined` where JSON omits a value. Every container is fresh. */
function copyPublicPlainData(value: unknown, depth: number): unknown {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      // JSON writes -0 as 0 and non-finite numbers as null.
      return Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "object":
      break;
    default:
      throw UNSUPPORTED_PLAIN_DATA;
  }

  if (value === null) return null;
  if (depth >= MAX_PLAIN_DATA_DEPTH || typeof (value as { toJSON?: unknown }).toJSON === "function") {
    throw UNSUPPORTED_PLAIN_DATA;
  }
  if (Array.isArray(value)) {
    const copied = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      copied[index] = copyPublicPlainData(value[index], depth + 1) ?? null;
    }
    return copied;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw UNSUPPORTED_PLAIN_DATA;

  return copyPublicPlainRecord(value as Record<string, unknown>, depth);
}

function copyPublicPlainRecord(record: Record<string, unknown>, depth: number): Record<string, unknown> {
  const copied: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    let entry: unknown;
    // Same key policy and precedence as the stringify replacer.
    if (key === "candidates" || key === "paths" || key === "recordIds") {
      entry = [];
    } else if (WEARABLE_SUMMARY_PROVENANCE_KEYS.has(key)) {
      continue;
    } else {
      entry = copyPublicPlainData(record[key], depth + 1);
      if (entry === undefined) continue;
    }

    if (key === "__proto__") {
      // JSON.parse creates an own data property rather than invoking the setter.
      Object.defineProperty(copied, key, { configurable: true, enumerable: true, value: entry, writable: true });
    } else {
      copied[key] = entry;
    }
  }
  return copied;
}
