import "server-only";

import {
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  type HostedVaultShareProjectionKind,
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
  requestedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
}

export interface HostedVaultShareProjectionDisplay {
  description: string;
  label: string;
  projectionKind: HostedVaultShareProjectionKind;
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
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS.length;

export function readHostedGroupJoinPolicy(value: unknown): HostedGroupJoinPolicy {
  if (!value || typeof value !== "object") {
    return emptyHostedGroupJoinPolicy();
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== HOSTED_GROUP_JOIN_POLICY_SCHEMA) {
    return emptyHostedGroupJoinPolicy();
  }
  return {
    schema: HOSTED_GROUP_JOIN_POLICY_SCHEMA,
    requestedVaultShareProjectionKinds: normalizeHostedVaultShareProjectionKinds(
      record.requestedVaultShareProjectionKinds,
    ),
  };
}

export function emptyHostedGroupJoinPolicy(): HostedGroupJoinPolicy {
  return {
    schema: HOSTED_GROUP_JOIN_POLICY_SCHEMA,
    requestedVaultShareProjectionKinds: [],
  };
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

export function mergeHostedGroupJoinPolicy(input: {
  existing: unknown;
  requestedVaultShareProjectionKinds: readonly HostedVaultShareProjectionKind[];
}): HostedGroupJoinPolicy {
  const existing = readHostedGroupJoinPolicy(input.existing);
  return {
    schema: HOSTED_GROUP_JOIN_POLICY_SCHEMA,
    requestedVaultShareProjectionKinds: normalizeHostedVaultShareProjectionKinds([
      ...existing.requestedVaultShareProjectionKinds,
      ...input.requestedVaultShareProjectionKinds,
    ]),
  };
}

export function projectHostedVaultShareProjectionDisplays(
  projectionKinds: readonly HostedVaultShareProjectionKind[],
): HostedVaultShareProjectionDisplay[] {
  return normalizeHostedVaultShareProjectionKinds(projectionKinds)
    .filter(isHostedVaultShareSelectableProjectionKind)
    .map((projectionKind) => ({
      projectionKind,
      ...HOSTED_VAULT_SHARE_PROJECTION_DISPLAY[projectionKind],
    }));
}
