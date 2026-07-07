import "server-only";

import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
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
      "Share your email so this group's Murph can send the newsletter. Your address is visible to the group.",
  },
  "activity-days.v0": {
    label: "Recent activity minutes",
    description:
      "Allows this group to receive your recent daily active-minute totals as bounded shared records.",
  },
  "active-calories-days.v0": {
    label: "Recent active calories",
    description:
      "Allows this group to receive your recent daily active-calorie totals as bounded shared records.",
  },
  "activity-score-days.v0": {
    label: "Recent activity scores",
    description:
      "Allows this group to receive your recent daily activity scores as bounded shared records.",
  },
  "day-strain-days.v0": {
    label: "Recent day strain",
    description:
      "Allows this group to receive your recent daily strain values as bounded shared records.",
  },
  "distance-days.v0": {
    label: "Recent distance",
    description:
      "Allows this group to receive your recent daily distance totals as bounded shared records.",
  },
  "elevation-gain-days.v0": {
    label: "Recent elevation gain",
    description:
      "Allows this group to receive your recent daily elevation-gain totals as bounded shared records.",
  },
  "floors-climbed-days.v0": {
    label: "Recent floors climbed",
    description:
      "Allows this group to receive your recent daily floors-climbed totals as bounded shared records.",
  },
  "heart-rate-zones-days.v0": {
    label: "Recent heart-rate zones",
    description:
      "Allows this group to receive your recent daily workout heart-rate zone minutes as bounded shared records.",
  },
  "hrv-days.v0": {
    label: "Recent HRV",
    description:
      "Allows this group to receive your recent daily HRV values as bounded shared records.",
  },
  "max-heart-rate-days.v0": {
    label: "Recent daily max heart rate",
    description:
      "Allows this group to receive your recent daily observed max heart rate as bounded shared records.",
  },
  "resting-heart-rate-days.v0": {
    label: "Recent resting heart rate",
    description:
      "Allows this group to receive your recent daily resting heart rate as bounded shared records.",
  },
  "sleep-times.v0": {
    label: "Recent sleep timing",
    description:
      "Allows this group to receive your recent sleep start and end times as bounded shared records.",
  },
  "steps-days.v0": {
    label: "Recent steps",
    description:
      "Allows this group to receive your recent daily step totals as bounded shared records.",
  },
  "vo2-max-days.v0": {
    label: "Recent VO2 max",
    description:
      "Allows this group to receive your recent estimated VO2 max values as bounded shared records.",
  },
  "workout-days.v0": {
    label: "Recent workout summaries",
    description:
      "Allows this group to receive your recent daily workout counts and minutes as bounded shared records.",
  },
  "workout-strain-days.v0": {
    label: "Recent workout strain",
    description:
      "Allows this group to receive your recent daily workout strain values as bounded shared records.",
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
      label: `Recent ${label} minutes`,
      description:
        `Allows this group to receive your recent daily ${label}-minute totals as bounded shared records.`,
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
