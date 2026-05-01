import {
  FatalError,
  RetryableError,
} from "workflow";

import { HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS } from "./webhook-nudge-policy";
import {
  isHostedOnboardingError,
} from "./errors";
import {
  nudgeHostedStripeWebhookActivationRunner,
  reconcileRecordedHostedStripeWebhookEvent,
  type HostedStripeWebhookReconciliationResult,
} from "./stripe-webhook-reconciliation";
import {
  HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER,
  HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
  type HostedStripeWebhookReconciliationWorkflowInput,
} from "./stripe-webhook-workflow-types";

export async function reconcileHostedStripeWebhookEventStep(
  input: HostedStripeWebhookReconciliationWorkflowInput,
): Promise<HostedStripeWebhookReconciliationResult> {
  "use step";

  try {
    return await reconcileRecordedHostedStripeWebhookEvent({
      eventId: input.eventId,
    });
  } catch (error) {
    throw mapHostedStripeWorkflowStepError(error);
  }
}

Object.assign(reconcileHostedStripeWebhookEventStep, {
  maxRetries: HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
});

export async function nudgeHostedStripeWebhookActivationStep(
  input: HostedStripeWebhookReconciliationResult,
): Promise<void> {
  "use step";

  const result = await nudgeHostedStripeWebhookActivationRunner({
    ...input,
    timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
  });

  if (!result.accepted) {
    throw new RetryableError(
      "Hosted Stripe webhook runner nudge is temporarily unavailable.",
      {
        retryAfter: HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER,
      },
    );
  }
}

Object.assign(nudgeHostedStripeWebhookActivationStep, {
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
