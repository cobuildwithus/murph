import {
  HOSTED_RUNTIME_GROUP_KINDS,
  type HostedRuntimeGroupKind,
} from "@murphai/hosted-execution/runtime-control";

export const HOSTED_GROUP_KINDS = HOSTED_RUNTIME_GROUP_KINDS;
export type HostedGroupKind = HostedRuntimeGroupKind;

export const HOSTED_GROUP_MEMBER_ROLES = ["owner", "member"] as const;
export type HostedGroupMemberRole = (typeof HOSTED_GROUP_MEMBER_ROLES)[number];

export function isHostedGroupKind(value: unknown): value is HostedGroupKind {
  return HOSTED_GROUP_KINDS.includes(value as HostedGroupKind);
}

export function normalizeHostedGroupKind(value: unknown): HostedGroupKind {
  return isHostedGroupKind(value) ? value : "custom";
}
