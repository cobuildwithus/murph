export const HOSTED_GROUP_KINDS = [
  "custom",
  "family",
  "couple",
  "friends",
  "household",
  "team",
] as const;
export type HostedGroupKind = (typeof HOSTED_GROUP_KINDS)[number];

export const HOSTED_GROUP_MEMBER_ROLES = ["owner", "member"] as const;
export type HostedGroupMemberRole = (typeof HOSTED_GROUP_MEMBER_ROLES)[number];

export function isHostedGroupKind(value: unknown): value is HostedGroupKind {
  return HOSTED_GROUP_KINDS.includes(value as HostedGroupKind);
}

export function normalizeHostedGroupKind(value: unknown): HostedGroupKind {
  return isHostedGroupKind(value) ? value : "custom";
}
