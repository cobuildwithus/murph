import type {
  HostedRuntimeGroupSharedFreshnessRequirement,
  HostedRuntimeGroupSharedMember,
  HostedRuntimeGroupSharedProjection,
  HostedRuntimeGroupSharedReadResult,
} from "./runtime-control.ts";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS,
  type HostedVaultShareDataSource,
  type HostedVaultShareSelectableProjectionScope,
} from "./vault-share.ts";

const WEARABLE_SCOPE_KEYS = new Set<string>(
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS
    .filter((spec) => spec.source.kind === "metric-series")
    .map((spec) => spec.projectionKind),
);

export function parseHostedGroupSharedFreshnessRequirements(
  value: unknown,
  scopes: readonly HostedVaultShareSelectableProjectionScope[],
): HostedRuntimeGroupSharedFreshnessRequirement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 21) {
    throw new TypeError("Shared freshness requires one to twenty-one scope/date pairs.");
  }
  const scopeKeys = new Set(scopes.map(buildHostedVaultShareProjectionScopeKey));
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Shared freshness requires a scope/date object.");
    }
    const record = entry as Record<string, unknown>;
    const { projectionScopeKey, date } = record;
    if (Object.keys(record).some((key) => key !== "projectionScopeKey" && key !== "date")
      || typeof projectionScopeKey !== "string"
      || !scopeKeys.has(projectionScopeKey)
      || !WEARABLE_SCOPE_KEYS.has(projectionScopeKey)
      || typeof date !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
      || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))
      || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
      throw new TypeError("Shared freshness requires an exact requested wearable scope and calendar date.");
    }
    const key = `${projectionScopeKey}:${date}`;
    if (seen.has(key)) {
      throw new TypeError("Shared freshness scope/date pairs must be unique.");
    }
    seen.add(key);
    return { projectionScopeKey, date };
  });
}

/** Existing reconcile jobs recover recent civil dates, never arbitrary history. */
export function selectRefreshableHostedGroupWearableDates(
  requirements: readonly HostedRuntimeGroupSharedFreshnessRequirement[],
  nowMs = Date.now(),
): HostedRuntimeGroupSharedFreshnessRequirement[] {
  const todayMs = Date.parse(new Date(nowMs).toISOString().slice(0, 10));
  return requirements.filter(({ date }) => {
    const ageDays = (todayMs - Date.parse(date)) / 86_400_000;
    return ageDays >= -1 && ageDays <= 2;
  });
}

/** Membership and grant visibility come only from the current authorized read. */
export function hostedGroupMemberHasMissingWearableDates(
  member: HostedRuntimeGroupSharedMember,
  requirements: readonly HostedRuntimeGroupSharedFreshnessRequirement[],
): boolean {
  return member.projections.some((projection) =>
    getHostedGroupWearableReportingGaps(projection, requirements).length > 0
  );
}

/** Derived only from currently shared records and grant age, never private device state. */
export function getHostedGroupWearableReportingGaps(
  projection: HostedRuntimeGroupSharedProjection,
  requirements: readonly HostedRuntimeGroupSharedFreshnessRequirement[],
  nowMs = Date.now(),
) {
  if (projection.grantStatus !== "granted") return [];
  // Only already shared wearable identities establish a source-specific expectation.
  // Manual reports do not imply that a wearable reported that date.
  const sources = new Map<string, HostedVaultShareDataSource>();
  for (const { source } of projection.records) {
    if (source && source.source !== "manual" && source.source !== "murph") {
      sources.set(source.source, source);
    }
  }
  const sourceScopes = sources.size ? [...sources.values()] : [undefined];
  return sourceScopes.flatMap((source) => {
    const records = source
      ? projection.records.filter((record) => record.source?.source === source.source)
      : projection.records;
    return requirements.filter((requirement) =>
      requirement.projectionScopeKey === projection.projectionScopeKey
        && !records.some((record) => "date" in record.data && record.data.date === requirement.date)
    ).map(({ date }) => ({
      date,
      ...(source ? { source } : {}),
      reportingHistory: classifyMissingWearableDate({ ...projection, records }, date, nowMs),
    }));
  });
}

function classifyMissingWearableDate(projection: HostedRuntimeGroupSharedProjection, date: string, nowMs: number) {
  const windowStart = Date.parse(date) - 7 * 86_400_000;
  const hasRecentRecord = projection.records.some((record) => {
    const recordDate = "date" in record.data && typeof record.data.date === "string" ? record.data.date : "";
    return Date.parse(recordDate) >= windowStart && recordDate < date;
  });
  if (hasRecentRecord) return "recent_reporting" as const;
  // A rolling snapshot cannot prove historical absence. Keep positive history,
  // but infer an ongoing absence only for today's check of an established grant.
  if (date !== new Date(nowMs).toISOString().slice(0, 10)
    || projection.dataStatus === "pending" || !projection.grantedAt
    || !(Date.parse(projection.grantedAt) < windowStart)) return "unknown_history" as const;
  return "no_recent_reporting" as const;
}

export function hostedGroupSharedNeedsWearableRecovery(
  result: HostedRuntimeGroupSharedReadResult,
  requirements: readonly HostedRuntimeGroupSharedFreshnessRequirement[],
): boolean {
  const refreshable = selectRefreshableHostedGroupWearableDates(requirements);
  return result.status === "ok" && result.members.some((member) =>
    member.projections.some((projection) => getHostedGroupWearableReportingGaps(projection, refreshable)
      .some((gap) => gap.reportingHistory !== "no_recent_reporting"))
  );
}
