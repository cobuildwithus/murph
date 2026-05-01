export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER = "5s";
export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES = 12;
export const HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS = 5_000;

export type HostedWebhookNudgeWorkflowSource = "linq" | "telegram";

export type HostedWebhookNudgeWorkflowInput = {
  mailboxItemId: string;
  source: HostedWebhookNudgeWorkflowSource;
};

export type HostedWebhookNudgeWorkflowStartResult = {
  runId: string;
};

export type HostedWebhookNudgeWorkflowStepResult = {
  accepted: true;
};
