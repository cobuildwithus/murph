export const HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER = "1m";
// Align with the DB-backed Stripe event retry policy and leave room for
// Temporal runtime signal outages after reconciliation has already completed.
export const HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES = 120;

export type HostedStripeWebhookReconciliationWorkflowInput = {
  eventId: string;
};

export type HostedStripeWebhookReconciliationWorkflowStartResult = {
  runId: string;
};
