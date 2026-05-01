import {
  FatalError,
  RetryableError,
} from "workflow";

import { HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS } from "./webhook-nudge-policy";
import {
  isHostedOnboardingError,
} from "./errors";
import {
  processRecordedHostedStripeWebhookEvent,
} from "./stripe-webhook-reconciliation";
import {
  HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER,
  HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
  type HostedStripeWebhookReconciliationWorkflowInput,
} from "./stripe-webhook-workflow-types";

export async function processHostedStripeWebhookEventStep(
  input: HostedStripeWebhookReconciliationWorkflowInput,
): Promise<void> {
  "use step";

  let result;

  try {
    result = await processRecordedHostedStripeWebhookEvent({
      eventId: input.eventId,
      timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
    });
  } catch (error) {
    throw mapHostedStripeWorkflowStepError(error);
  }

  if (!result.accepted) {
    throw new RetryableError(
      "Hosted Stripe webhook runner nudge is temporarily unavailable.",
      {
        retryAfter: HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER,
      },
    );
  }
}

Object.assign(processHostedStripeWebhookEventStep, {
  maxRetries: HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
});

function mapHostedStripeWorkflowStepError(error: unknown): unknown {
  if (!isHostedOnboardingError(error)) {
    return error;
  }

  if (!error.retryable) {
    return new FatalError(error.message);
  }

  return new RetryableError(error.message, {
    retryAfter: HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER,
  });
}
