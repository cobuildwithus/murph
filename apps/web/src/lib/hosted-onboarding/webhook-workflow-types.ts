export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER = "5s";
export const HOSTED_WEBHOOK_CHECKPOINT_WORKFLOW_RETRY_AFTER = "30s";
// The workflow first wakes the runner, then waits for checkpointed mailbox
// progress without repeatedly nudging and extending the runner quiet period.
export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES = 120;
export const HOSTED_WEBHOOK_CHECKPOINT_WORKFLOW_STEP_MAX_RETRIES = 720;

export type HostedWebhookNudgeWorkflowSource =
  | "device-sync"
  | "email"
  | "linq"
  | "telegram"
  | "whatsapp";

export type HostedWebhookNudgeWorkflowInput = {
  mailboxItemId: string;
  source: HostedWebhookNudgeWorkflowSource;
};

export type HostedWebhookNudgeWorkflowStartResult = {
  runId: string;
};
