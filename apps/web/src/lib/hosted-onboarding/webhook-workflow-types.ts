export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER = "5s";
// The workflow owns only the durable runner-nudge handoff. Workspace checkpoint
// progress is owned by the hosted runtime and its idle-shutdown checkpoint path.
export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES = 120;

export type HostedWebhookNudgeWorkflowSource =
  | "device-sync"
  | "email"
  | "linq"
  | "telegram"
  | "whatsapp";

export type HostedWebhookNudgeWorkflowInput = {
  mailboxItemId: string;
  runnerNudgeIntent?: "device-sync-dirty-recovery";
  source: HostedWebhookNudgeWorkflowSource;
};

export type HostedWebhookNudgeWorkflowStartResult = {
  runId: string;
};
