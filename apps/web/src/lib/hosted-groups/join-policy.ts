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
      "Share your email so this group's Murph can send the newsletter. Your email is visible to the group.",
  },
  "activity-days.v0": {
    label: "Activity minutes",
    description:
      "Lets this group see your 7 most recent days of daily active minutes.",
  },
  "active-calories-days.v0": {
    label: "Active calories",
    description:
      "Lets this group see your 7 most recent days of daily active calories.",
  },
  "activity-score-days.v0": {
    label: "Activity scores",
    description:
      "Lets this group see your 7 most recent days of daily activity scores.",
  },
  "day-strain-days.v0": {
    label: "Day strain",
    description:
      "Lets this group see your 7 most recent days of day strain.",
  },
  "distance-days.v0": {
    label: "Distance",
    description:
      "Lets this group see your 7 most recent days of daily distance totals.",
  },
  "elevation-gain-days.v0": {
    label: "Elevation gain",
    description:
      "Lets this group see your 7 most recent days of daily elevation gain.",
  },
  "floors-climbed-days.v0": {
    label: "Floors climbed",
    description:
      "Lets this group see your 7 most recent days of daily floors climbed.",
  },
  "heart-rate-zones-days.v0": {
    label: "Heart-rate zones",
    description:
      "Lets this group see your 7 most recent days of workout heart-rate zone minutes.",
  },
  "hrv-days.v0": {
    label: "HRV",
    description:
      "Lets this group see your 7 most recent days of daily HRV.",
  },
  "max-heart-rate-days.v0": {
    label: "Daily max heart rate",
    description:
      "Lets this group see your 7 most recent days of daily max heart rate.",
  },
  "resting-heart-rate-days.v0": {
    label: "Resting heart rate",
    description:
      "Lets this group see your 7 most recent days of daily resting heart rate.",
  },
  "sleep-times.v0": {
    label: "Sleep timing",
    description:
      "Lets this group see your 7 most recent days of sleep start and end times.",
  },
  "steps-days.v0": {
    label: "Steps",
    description:
      "Lets this group see your 7 most recent days of daily step totals.",
  },
  "vo2-max-days.v0": {
    label: "VO2 max",
    description:
      "Lets this group see your 7 most recent days of daily VO2 max estimates.",
  },
  "workout-days.v0": {
    label: "Workout summaries",
    description:
      "Lets this group see your 7 most recent days of workout counts and minutes.",
  },
  "workout-strain-days.v0": {
    label: "Workout strain",
    description:
      "Lets this group see your 7 most recent days of daily workout strain.",
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
      description:
        `Lets this group see your 7 most recent days of daily ${label} minutes.`,
    };
  }
  if (projectionScope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_DISTANCE_PROJECTION_KIND) {
    const label = formatHostedVaultShareActivityKindLabel(
      projectionScope.selector.activityKind,
    );
    return {
      label: `Recent ${label} distance and session count`,
      description:
        `Shares daily total distance and session count for ${label} activities. Does not share routes, GPS, pace, timestamps, heart rate, calories, or individual workouts.`,
    };
  }
  if (projectionScope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_SESSION_COUNT_PROJECTION_KIND) {
    const label = formatHostedVaultShareActivityKindLabel(
      projectionScope.selector.activityKind,
    );
    return {
      label: `Recent ${label} session count`,
      description:
        `Shares daily count of ${label} activity sessions. Does not share duration, distance, routes, GPS, timestamps, heart rate, calories, or individual workouts.`,
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
