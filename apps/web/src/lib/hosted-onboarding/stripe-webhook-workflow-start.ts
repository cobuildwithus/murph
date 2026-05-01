import { start } from "workflow/api";

import { hostedOnboardingError } from "./errors";
import {
  hostedStripeWebhookReconciliationWorkflow,
} from "./stripe-webhook-workflows";
import type {
  HostedStripeWebhookReconciliationWorkflowInput,
  HostedStripeWebhookReconciliationWorkflowStartResult,
} from "./stripe-webhook-workflow-types";

export async function startHostedStripeWebhookReconciliationWorkflow(
  input: HostedStripeWebhookReconciliationWorkflowInput,
): Promise<HostedStripeWebhookReconciliationWorkflowStartResult> {
  try {
    const run = await start(hostedStripeWebhookReconciliationWorkflow, [input]);

    return {
      runId: run.runId,
    };
  } catch {
    throw hostedOnboardingError({
      code: "HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_START_RETRY_REQUIRED",
      httpStatus: 503,
      message: "Stripe webhook processing is temporarily unavailable.",
      retryable: true,
    });
  }
}
