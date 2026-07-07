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
      "Lets this group see your daily active minutes from the last 7 days.",
  },
  "active-calories-days.v0": {
    label: "Active calories",
    description:
      "Lets this group see your daily active calories from the last 7 days.",
  },
  "activity-score-days.v0": {
    label: "Activity scores",
    description:
      "Lets this group see your daily activity scores from the last 7 days.",
  },
  "day-strain-days.v0": {
    label: "Day strain",
    description:
      "Lets this group see your day strain from the last 7 days.",
  },
  "distance-days.v0": {
    label: "Distance",
    description:
      "Lets this group see your daily distance totals from the last 7 days.",
  },
  "elevation-gain-days.v0": {
    label: "Elevation gain",
    description:
      "Lets this group see your daily elevation gain from the last 7 days.",
  },
  "floors-climbed-days.v0": {
    label: "Floors climbed",
    description:
      "Lets this group see your daily floors climbed from the last 7 days.",
  },
  "heart-rate-zones-days.v0": {
    label: "Heart-rate zones",
    description:
      "Lets this group see your workout heart-rate zone minutes from the last 7 days.",
  },
  "hrv-days.v0": {
    label: "HRV",
    description:
      "Lets this group see your daily HRV from the last 7 days.",
  },
  "max-heart-rate-days.v0": {
    label: "Daily max heart rate",
    description:
      "Lets this group see your daily max heart rate from the last 7 days.",
  },
  "resting-heart-rate-days.v0": {
    label: "Resting heart rate",
    description:
      "Lets this group see your daily resting heart rate from the last 7 days.",
  },
  "sleep-times.v0": {
    label: "Sleep timing",
    description:
      "Lets this group see your sleep start and end times from the last 7 days.",
  },
  "steps-days.v0": {
    label: "Steps",
    description:
      "Lets this group see your daily step totals from the last 7 days.",
  },
  "vo2-max-days.v0": {
    label: "VO2 max",
    description:
      "Lets this group see your daily VO2 max estimates from the last 7 days.",
  },
  "workout-days.v0": {
    label: "Workout summaries",
    description:
      "Lets this group see your workout counts and minutes from the last 7 days.",
  },
  "workout-strain-days.v0": {
    label: "Workout strain",
    description:
      "Lets this group see your daily workout strain from the last 7 days.",
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
