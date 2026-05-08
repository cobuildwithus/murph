export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER = "5s";
// The workflow owns runner nudge handoff after mailbox append, so keep retrying
// long enough to cover deploys, transient Cloudflare issues, and brief web/runner outages.
export const HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES = 120;

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
