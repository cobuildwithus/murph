// Dependency-free values shared by runtime execution and orchestration.
export const HOSTED_MAILBOX_LANES = [
  "system",
  "conversation",
] as const;

export type HostedMailboxLane = (typeof HOSTED_MAILBOX_LANES)[number];

export const HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES = [
  "default",
  "inbox_media_retention",
  "system_mailbox",
] as const;

export type HostedWorkspaceInvocationProcessingMode =
  (typeof HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES)[number];

export function isHostedMailboxLane(value: string): value is HostedMailboxLane {
  return HOSTED_MAILBOX_LANES.includes(value as HostedMailboxLane);
}

// Member-facing name for the internal launch_group_monthly billing SKU.
// The hosted wire contract retains "Group" for rolling-deploy compatibility.
export const HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME = "Core" as const;
