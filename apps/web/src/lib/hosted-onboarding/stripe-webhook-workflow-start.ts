import {
  hostedStripeWebhookReconciliationWorkflow,
} from "./stripe-webhook-workflows";
import type {
  HostedStripeWebhookReconciliationWorkflowInput,
  HostedStripeWebhookReconciliationWorkflowStartResult,
} from "./stripe-webhook-workflow-types";
import { startHostedPointerWorkflow } from "./workflow-start";

export async function startHostedStripeWebhookReconciliationWorkflow(
  input: HostedStripeWebhookReconciliationWorkflowInput,
): Promise<HostedStripeWebhookReconciliationWorkflowStartResult> {
  return startHostedPointerWorkflow({
    error: {
      code: "HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      message: "Stripe webhook processing is temporarily unavailable.",
    },
    payload: input,
    workflow: hostedStripeWebhookReconciliationWorkflow,
  });
}
