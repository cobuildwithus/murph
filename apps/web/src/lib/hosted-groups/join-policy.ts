import "server-only";

import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import { HOSTED_VAULT_SHARE_TIME_ZONE_DESCRIPTION } from "./projection-display-copy";

type HostedVaultShareSelectableProjectionKind =
  (typeof HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS)[number];

function isHostedVaultShareSelectableProjectionKind(
  value: unknown,
): value is HostedVaultShareSelectableProjectionKind {
  return HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS.includes(
    value as HostedVaultShareSelectableProjectionKind,
  );
}

export const HOSTED_GROUP_JOIN_POLICY_SCHEMA =
  "murph.hosted-group.join-policy.v1" as const;

export interface HostedGroupJoinPolicy {
  offerGeneration: string | null;
  schema: typeof HOSTED_GROUP_JOIN_POLICY_SCHEMA;
  requestedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  /** Compatibility view for fixed-kind callers. Prefer requestedVaultShareProjectionScopes. */
  requestedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
}

export interface HostedVaultShareProjectionDisplay {
  description: string;
  label: string;
  legacyProjectionScope?: HostedVaultShareProjectionScope;
  projectionKind: HostedVaultShareProjectionKind;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

const HOSTED_VAULT_SHARE_PROJECTION_DISPLAY: Record<HostedVaultShareSelectableProjectionKind, {
  description: string;
  label: string;
}> = {
  "time-zone.v0": {
    label: "Time zone",
    description: HOSTED_VAULT_SHARE_TIME_ZONE_DESCRIPTION,
  },
  "group-email.v0": {
    label: "Email address",
    description: "Shares your email with the group and its Murph for group emails.",
  },
  "device-sync-status.v0": {
    label: "Health source connection status",
    description: "Shares which health sources are connected, not their health values.",
  },
  "activity-days.v0": {
    label: "Activity minutes",
    description: "Shares 7 days of active minutes by source.",
  },
  "active-calories-days.v0": {
    label: "Active calories",
    description: "Shares 7 days of active calories by source.",
  },
  "activity-score-days.v0": {
    label: "Activity scores",
    description: "Shares 7 days of activity scores by source.",
  },
  "day-strain-days.v0": {
    label: "Day strain",
    description: "Shares 7 days of day strain by source.",
  },
  "distance-days.v0": {
    label: "Distance",
    description: "Shares 7 days of distance by source.",
  },
  "elevation-gain-days.v0": {
    label: "Elevation gain",
    description: "Shares 7 days of elevation gain by source.",
  },
  "floors-climbed-days.v0": {
    label: "Floors climbed",
    description: "Shares 7 days of floors climbed by source.",
  },
  "heart-rate-zones-days.v0": {
    label: "Heart-rate zones",
    description: "Shares 7 days of heart-rate zone minutes by source.",
  },
  "hrv-days.v0": {
    label: "HRV",
    description: "Shares 7 days of HRV by source.",
  },
  "max-heart-rate-days.v0": {
    label: "Daily max heart rate",
    description: "Shares 7 days of max heart rate by source.",
  },
  "protein-days.v0": {
    label: "Daily protein",
    description: "Shares 7 days of meal protein totals, including imports, with Murph as the source.",
  },
  "calories-days.v0": {
    label: "Daily calories",
    description: "Shares 7 days of meal calorie totals, including imports, with Murph as the source.",
  },
  "carbs-days.v0": {
    label: "Daily carbs",
    description: "Shares 7 days of meal carbohydrate totals, including imports, with Murph as the source.",
  },
  "fat-days.v0": {
    label: "Daily fat",
    description: "Shares 7 days of meal fat totals, including imports, with Murph as the source.",
  },
  "fiber-days.v0": {
    label: "Daily fiber",
    description: "Shares 7 days of meal fiber totals, including imports, with Murph as the source.",
  },
  "resting-heart-rate-days.v0": {
    label: "Resting heart rate",
    description: "Shares 7 days of resting heart rate by source.",
  },
  "sleep-times.v0": {
    label: "Sleep timing",
    description: "Shares 7 days of sleep start and end times by source.",
  },
  "sleep-duration-days.v0": {
    label: "Sleep duration",
    description: "Shares 7 days of total sleep duration by source.",
  },
  "deep-sleep-days.v0": {
    label: "Deep sleep",
    description: "Shares 7 days of deep sleep minutes and recorded times by source.",
  },
  "deep-sleep-sources-days.v1": {
    label: "Deep sleep",
    description: "Shares 7 days of deep sleep minutes and recorded times by source.",
  },
  "rem-sleep-days.v0": {
    label: "REM sleep",
    description: "Shares 7 days of REM sleep minutes and recorded times by source.",
  },
  "rem-sleep-sources-days.v1": {
    label: "REM sleep",
    description: "Shares 7 days of REM sleep minutes and recorded times by source.",
  },
  "steps-days.v0": {
    label: "Steps",
    description: "Shares 7 days of step counts by source.",
  },
  "vo2-max-days.v0": {
    label: "VO2 max",
    description: "Shares 7 days of VO2 max by source.",
  },
  "workout-days.v0": {
    label: "Workout summaries",
    description: "Shares 7 days of workout counts and minutes by source.",
  },
  "workouts.v0": {
    label: "Workout details",
    description: "Shares 7 days of workout sources, local start times, durations, and types—not timestamps, routes, locations, or heart rate.",
  },
  "workout-strain-days.v0": {
    label: "Workout strain",
    description: "Shares 7 days of workout strain by source.",
  },
};

const MAX_JOIN_POLICY_PROJECTIONS =
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.length;
const SELECTABLE_SCOPE_KEYS = new Set(
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map((scope) =>
    buildHostedVaultShareProjectionScopeKey(scope)
  ),
);

export function readHostedGroupJoinPolicy(value: unknown): HostedGroupJoinPolicy {
  if (!value || typeof value !== "object") {
    return emptyHostedGroupJoinPolicy();
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== HOSTED_GROUP_JOIN_POLICY_SCHEMA) {
    return emptyHostedGroupJoinPolicy();
  }
  return hostedGroupJoinPolicyFromScopes(
    normalizeHostedVaultShareProjectionScopes(
      record.requestedVaultShareProjectionScopes
        ?? record.requestedVaultShareProjectionKinds,
    ),
    normalizeHostedGroupJoinOfferGeneration(record.offerGeneration),
  );
}

export function emptyHostedGroupJoinPolicy(): HostedGroupJoinPolicy {
  return hostedGroupJoinPolicyFromScopes([], null);
}

/**
 * Join policies hold only individually selectable health projections. The
 * membership-implied profile-name share is granted directly at join/creation and is
 * silently dropped here so a stale or crafted request cannot turn it into a checkbox.
 */
export function normalizeHostedVaultShareProjectionKinds(
  value: unknown,
): HostedVaultShareProjectionKind[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<HostedVaultShareSelectableProjectionKind>();
  for (const entry of value) {
    if (!isHostedVaultShareSelectableProjectionKind(entry)) {
      continue;
    }
    seen.add(entry);
    if (seen.size > MAX_JOIN_POLICY_PROJECTIONS) {
      break;
    }
  }
  return HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS.filter((kind) => seen.has(kind));
}

export function normalizeHostedVaultShareProjectionScopes(
  value: unknown,
): HostedVaultShareProjectionScope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of value) {
    let scope: HostedVaultShareProjectionScope;
    try {
      scope = parseHostedVaultShareProjectionScope(
        entry,
        "Hosted group join policy projection scope",
      );
    } catch {
      continue;
    }
    const scopeKey = buildHostedVaultShareProjectionScopeKey(scope);
    if (!SELECTABLE_SCOPE_KEYS.has(scopeKey)) {
      continue;
    }
    seen.add(scopeKey);
    if (seen.size > MAX_JOIN_POLICY_PROJECTIONS) {
      break;
    }
  }
  return HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.filter((scope) =>
    seen.has(buildHostedVaultShareProjectionScopeKey(scope))
  );
}

/**
 * Comprehensive defaults expose one Deep sleep permission and one REM sleep
 * permission. Their source-aware v1 scopes are the complete contracts. An
 * explicitly supplied list stays exact, including legacy aggregate v0 scopes.
 */
function normalizeHostedGroupAccessOfferDefaultProjectionScopes(
  value: unknown,
): HostedVaultShareProjectionScope[] {
  const offered = normalizeHostedVaultShareProjectionScopes(value).map((scope) => {
    if (scope.projectionKind === "deep-sleep-days.v0") {
      return { projectionKind: "deep-sleep-sources-days.v1" } as const;
    }
    if (scope.projectionKind === "rem-sleep-days.v0") {
      return { projectionKind: "rem-sleep-sources-days.v1" } as const;
    }
    return scope;
  });
  return normalizeHostedVaultShareProjectionScopes(offered);
}

export function resolveHostedGroupAccessOfferProjectionScopes(
  value: unknown,
): HostedVaultShareProjectionScope[] {
  return value === undefined || value === null
    ? normalizeHostedGroupAccessOfferDefaultProjectionScopes(
        HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
      )
    : normalizeHostedVaultShareProjectionScopes(value);
}

export function legacyHostedGroupSleepProjectionScope(
  projectionScope: HostedVaultShareProjectionScope,
): HostedVaultShareProjectionScope | null {
  if (projectionScope.projectionKind === "deep-sleep-sources-days.v1") {
    return { projectionKind: "deep-sleep-days.v0" };
  }
  if (projectionScope.projectionKind === "rem-sleep-sources-days.v1") {
    return { projectionKind: "rem-sleep-days.v0" };
  }
  return null;
}

export function sourceAwareHostedGroupSleepProjectionScope(
  projectionScope: HostedVaultShareProjectionScope,
): HostedVaultShareProjectionScope | null {
  if (projectionScope.projectionKind === "deep-sleep-days.v0") {
    return { projectionKind: "deep-sleep-sources-days.v1" };
  }
  if (projectionScope.projectionKind === "rem-sleep-days.v0") {
    return { projectionKind: "rem-sleep-sources-days.v1" };
  }
  return null;
}

export function includeLegacyHostedGroupSleepProjectionScopes(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): HostedVaultShareProjectionScope[] {
  return normalizeHostedVaultShareProjectionScopes(projectionScopes.flatMap((scope) => {
    const legacyScope = legacyHostedGroupSleepProjectionScope(scope);
    return legacyScope ? [scope, legacyScope] : [scope];
  }));
}

export function includeSourceAwareHostedGroupSleepProjectionScopes(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): HostedVaultShareProjectionScope[] {
  return normalizeHostedVaultShareProjectionScopes(projectionScopes.flatMap((scope) => {
    const sourceAwareScope = sourceAwareHostedGroupSleepProjectionScope(scope);
    return sourceAwareScope ? [scope, sourceAwareScope] : [scope];
  }));
}

export function mergeHostedGroupJoinPolicy(input: {
  existing: unknown;
  offerGeneration?: string | null;
  requestedVaultShareProjectionScopes: readonly HostedVaultShareProjectionScope[];
}): HostedGroupJoinPolicy {
  const existing = readHostedGroupJoinPolicy(input.existing);
  const offered = normalizeHostedVaultShareProjectionScopes(
    input.requestedVaultShareProjectionScopes,
  );
  return hostedGroupJoinPolicyFromScopes(
    normalizeHostedVaultShareProjectionScopes([
      ...existing.requestedVaultShareProjectionScopes,
      ...offered,
    ]),
    input.offerGeneration === undefined
      ? existing.offerGeneration
      : normalizeHostedGroupJoinOfferGeneration(input.offerGeneration),
  );
}

export function projectHostedVaultShareProjectionDisplays(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): HostedVaultShareProjectionDisplay[] {
  return collapseLegacySleepProjectionScopes(
    normalizeHostedVaultShareProjectionScopes(projectionScopes),
  )
    .map((projectionScope) => {
      const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);
      const legacyProjectionScope = legacyHostedGroupSleepProjectionScope(projectionScope);
      return {
        ...(legacyProjectionScope ? { legacyProjectionScope } : {}),
        projectionKind: projectionScope.projectionKind,
        projectionScope,
        projectionScopeKey,
        ...hostedVaultShareProjectionScopeDisplay(projectionScope),
      };
    });
}

function collapseLegacySleepProjectionScopes(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): HostedVaultShareProjectionScope[] {
  const hasDeepSleepV1 = projectionScopes.some(
    (scope) => scope.projectionKind === "deep-sleep-sources-days.v1",
  );
  const hasRemSleepV1 = projectionScopes.some(
    (scope) => scope.projectionKind === "rem-sleep-sources-days.v1",
  );
  return projectionScopes.filter((scope) =>
    !(hasDeepSleepV1 && scope.projectionKind === "deep-sleep-days.v0")
    && !(hasRemSleepV1 && scope.projectionKind === "rem-sleep-days.v0")
  );
}

function hostedGroupJoinPolicyFromScopes(
  requestedVaultShareProjectionScopes: HostedVaultShareProjectionScope[],
  offerGeneration: string | null,
): HostedGroupJoinPolicy {
  return {
    offerGeneration,
    schema: HOSTED_GROUP_JOIN_POLICY_SCHEMA,
    requestedVaultShareProjectionKinds: [
      ...new Set(requestedVaultShareProjectionScopes.map((scope) => scope.projectionKind)),
    ],
    requestedVaultShareProjectionScopes,
  };
}

function normalizeHostedGroupJoinOfferGeneration(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return /^hgrpjog_[A-Za-z0-9_-]{16}$/u.test(normalized)
    ? normalized
    : null;
}

function hostedVaultShareProjectionScopeDisplay(
  projectionScope: HostedVaultShareProjectionScope,
): { description: string; label: string } {
  if (projectionScope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND) {
    const label = formatHostedVaultShareActivityKindLabel(
      projectionScope.selector.activityKind,
    );
    return {
      label: `${capitalizeHostedVaultShareLabel(label)} minutes`,
      description: `Shares 7 days of ${label} minutes by source.`,
    };
  }
  if (projectionScope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND) {
    const label = formatHostedVaultShareActivityKindLabel(
      projectionScope.selector.activityKind,
    );
    return {
      label: `Recent ${label} distance and session count`,
      description: `Shares 7 days of ${label} distance and session counts by source.`,
    };
  }
  if (projectionScope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND) {
    const label = formatHostedVaultShareActivityKindLabel(
      projectionScope.selector.activityKind,
    );
    return {
      label: `Recent ${label} session count`,
      description: `Shares 7 days of ${label} session counts by source.`,
    };
  }
  if (!isHostedVaultShareSelectableProjectionKind(projectionScope.projectionKind)) {
    throw new TypeError("Vault-share projection scope is not selectable.");
  }
  return HOSTED_VAULT_SHARE_PROJECTION_DISPLAY[projectionScope.projectionKind];
}

function formatHostedVaultShareActivityKindLabel(activityKind: string): string {
  return activityKind.replace(/-/gu, " ");
}

function capitalizeHostedVaultShareLabel(label: string): string {
  const first = label[0];
  return first ? `${first.toUpperCase()}${label.slice(1)}` : label;
}
