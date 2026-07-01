import "server-only";

import {
  HOSTED_VAULT_SHARE_PROJECTION_KINDS,
  isHostedVaultShareProjectionKind,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";

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

const HOSTED_VAULT_SHARE_PROJECTION_DISPLAY: Record<HostedVaultShareProjectionKind, {
  description: string;
  label: string;
}> = {
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

export function normalizeHostedVaultShareProjectionKinds(
  value: unknown,
): HostedVaultShareProjectionKind[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<HostedVaultShareProjectionKind>();
  for (const entry of value) {
    if (!isHostedVaultShareProjectionKind(entry)) {
      continue;
    }
    seen.add(entry);
    if (seen.size > MAX_JOIN_POLICY_PROJECTIONS) {
      break;
    }
  }
  return HOSTED_VAULT_SHARE_PROJECTION_KINDS.filter((kind) => seen.has(kind));
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
  return normalizeHostedVaultShareProjectionKinds(projectionKinds).map((projectionKind) => ({
    projectionKind,
    ...HOSTED_VAULT_SHARE_PROJECTION_DISPLAY[projectionKind],
  }));
}
