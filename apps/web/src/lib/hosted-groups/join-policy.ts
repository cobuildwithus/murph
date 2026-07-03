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
      "Allows this group to receive your recent daily workout counts, minutes, and activity types as bounded shared records.",
  },
  "workout-strain-days.v0": {
    label: "Recent workout strain",
    description:
      "Allows this group to receive your recent daily workout strain values as bounded shared records.",
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
