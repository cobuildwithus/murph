import type {
  HostedRuntimeGroupSharedFreshnessRequirement,
  HostedRuntimeGroupSharedMember,
  HostedRuntimeGroupSharedReadResult,
} from "./runtime-control.ts";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS,
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

/** Membership and grant visibility come only from the current authorized read. */
export function hostedGroupMemberHasMissingWearableDates(
  member: HostedRuntimeGroupSharedMember,
  requirements: readonly HostedRuntimeGroupSharedFreshnessRequirement[],
): boolean {
  return requirements.some((requirement) => {
    const projection = member.projections.find((entry) =>
      entry.projectionScopeKey === requirement.projectionScopeKey
    );
    return projection?.grantStatus === "granted"
      && !projection.records.some((record) => "date" in record.data && record.data.date === requirement.date);
  });
}

export function hostedGroupSharedHasMissingWearableDates(
  result: HostedRuntimeGroupSharedReadResult,
  requirements: readonly HostedRuntimeGroupSharedFreshnessRequirement[],
): boolean {
  return result.status === "ok" && result.members.some((member) =>
    hostedGroupMemberHasMissingWearableDates(member, requirements)
  );
}
