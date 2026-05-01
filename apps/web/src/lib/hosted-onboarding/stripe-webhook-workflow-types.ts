export const HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER = "1m";
export const HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES = 12;

export type HostedStripeWebhookReconciliationWorkflowInput = {
  eventId: string;
};

export type HostedStripeWebhookReconciliationWorkflowStartResult = {
  runId: string;
};
