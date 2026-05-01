export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER = "5s";
// Direct wake handoff has already failed before this workflow starts, so keep
// retrying long enough to cover deploys, transient Cloudflare issues, and brief web/runner outages.
export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES = 120;

export type HostedWebhookNudgeWorkflowSource = "device-sync" | "email" | "linq" | "telegram";

export type HostedWebhookNudgeWorkflowInput = {
  mailboxItemId: string;
  source: HostedWebhookNudgeWorkflowSource;
};

export type HostedWebhookNudgeWorkflowStartResult = {
  runId: string;
};
