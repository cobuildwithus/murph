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
  "sleep-times.v0": {
    label: "Recent sleep timing",
    description:
      "Allows this group to receive your recent sleep start and end times as bounded shared records.",
  },
};

const MAX_JOIN_POLICY_PROJECTIONS = 8;

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
