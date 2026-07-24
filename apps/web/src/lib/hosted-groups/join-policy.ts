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
  schema: typeof HOSTED_GROUP_JOIN_POLICY_SCHEMA;
  requestedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  /** Compatibility view for fixed-kind callers. Prefer requestedVaultShareProjectionScopes. */
  requestedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
}

export interface HostedVaultShareProjectionDisplay {
  description: string;
  label: string;
  projectionKind: HostedVaultShareProjectionKind;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

const HOSTED_VAULT_SHARE_PROJECTION_DISPLAY: Record<HostedVaultShareSelectableProjectionKind, {
  description: string;
  label: string;
}> = {
  "group-email.v0": {
    label: "Email address",
    description:
      "Shares your email so the group's Murph can send the newsletter. Visible to the group.",
  },
  "device-sync-status.v0": {
    label: "Health source connection status",
    description:
      "Shares which health sources are connected. No health values.",
  },
  "activity-days.v0": {
    label: "Activity minutes",
    description: "Shares your last 7 days of active minutes.",
  },
  "active-calories-days.v0": {
    label: "Active calories",
    description: "Shares your last 7 days of active calories.",
  },
  "activity-score-days.v0": {
    label: "Activity scores",
    description: "Shares your last 7 days of activity scores.",
  },
  "day-strain-days.v0": {
    label: "Day strain",
    description: "Shares your last 7 days of day strain.",
  },
  "distance-days.v0": {
    label: "Distance",
    description: "Shares your last 7 days of distance.",
  },
  "elevation-gain-days.v0": {
    label: "Elevation gain",
    description: "Shares your last 7 days of elevation gain.",
  },
  "floors-climbed-days.v0": {
    label: "Floors climbed",
    description: "Shares your last 7 days of floors climbed.",
  },
  "heart-rate-zones-days.v0": {
    label: "Heart-rate zones",
    description: "Shares your last 7 days of heart-rate zone minutes.",
  },
  "hrv-days.v0": {
    label: "HRV",
    description: "Shares your last 7 days of HRV.",
  },
  "max-heart-rate-days.v0": {
    label: "Daily max heart rate",
    description: "Shares your last 7 days of max heart rate.",
  },
  "resting-heart-rate-days.v0": {
    label: "Resting heart rate",
    description: "Shares your last 7 days of resting heart rate.",
  },
  "sleep-times.v0": {
    label: "Sleep timing",
    description: "Shares your last 7 days of sleep start and end times.",
  },
  "sleep-duration-days.v0": {
    label: "Sleep duration",
    description: "Shares your last 7 days of total sleep duration.",
  },
  "deep-sleep-days.v0": {
    label: "Deep sleep",
    description: "Shares your last 7 days of deep sleep minutes.",
  },
  "rem-sleep-days.v0": {
    label: "REM sleep",
    description: "Shares your last 7 days of REM sleep minutes.",
  },
  "steps-days.v0": {
    label: "Steps",
    description: "Shares your last 7 days of steps.",
  },
  "vo2-max-days.v0": {
    label: "VO2 max",
    description: "Shares your last 7 days of VO2 max.",
  },
  "workout-days.v0": {
    label: "Workout summaries",
    description: "Shares your last 7 days of workout counts and minutes.",
  },
  "workout-latest-start-days.v0": {
    label: "Latest daily workout start",
    description:
      "Shares the latest observed local workout start time for each day in the last 7 days with an observed workout. Local time uses the workout event timezone when available, otherwise your vault timezone, and does not prove physical location. This is more detailed than daily workout counts or minutes. It does not share absolute timestamps, end times, sport, provider, routes, location, heart rate, or individual workout history.",
    offerDisclosure:
      "the latest observed local workout start time for each day in the last 7 days with a workout",
  },
  "workout-strain-days.v0": {
    label: "Workout strain",
    description: "Shares your last 7 days of workout strain.",
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
  );
}

export function emptyHostedGroupJoinPolicy(): HostedGroupJoinPolicy {
  return hostedGroupJoinPolicyFromScopes([]);
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

export function mergeHostedGroupJoinPolicy(input: {
  existing: unknown;
  requestedVaultShareProjectionScopes: readonly HostedVaultShareProjectionScope[];
}): HostedGroupJoinPolicy {
  const existing = readHostedGroupJoinPolicy(input.existing);
  return hostedGroupJoinPolicyFromScopes(
    normalizeHostedVaultShareProjectionScopes([
      ...existing.requestedVaultShareProjectionScopes,
      ...input.requestedVaultShareProjectionScopes,
    ]),
  );
}

export function projectHostedVaultShareProjectionDisplays(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): HostedVaultShareProjectionDisplay[] {
  return normalizeHostedVaultShareProjectionScopes(projectionScopes)
    .map((projectionScope) => {
      const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);
      return {
        projectionKind: projectionScope.projectionKind,
        projectionScope,
        projectionScopeKey,
        ...hostedVaultShareProjectionScopeDisplay(projectionScope),
      };
    });
}

function hostedGroupJoinPolicyFromScopes(
  requestedVaultShareProjectionScopes: HostedVaultShareProjectionScope[],
): HostedGroupJoinPolicy {
  return {
    schema: HOSTED_GROUP_JOIN_POLICY_SCHEMA,
    requestedVaultShareProjectionKinds: [
      ...new Set(requestedVaultShareProjectionScopes.map((scope) => scope.projectionKind)),
    ],
    requestedVaultShareProjectionScopes,
  };
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
      description: `Shares your last 7 days of ${label} minutes.`,
    };
  }
  if (projectionScope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND) {
    const label = formatHostedVaultShareActivityKindLabel(
      projectionScope.selector.activityKind,
    );
    return {
      label: `Recent ${label} distance and session count`,
      description: `Shares daily ${label} distance and session count.`,
    };
  }
  if (projectionScope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND) {
    const label = formatHostedVaultShareActivityKindLabel(
      projectionScope.selector.activityKind,
    );
    return {
      label: `Recent ${label} session count`,
      description: `Shares daily ${label} session count.`,
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
