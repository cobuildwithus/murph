import {
  FatalError,
  RetryableError,
  type RetryableErrorOptions,
} from "workflow";

import { HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS } from "./webhook-nudge-policy";
import {
  type HostedOnboardingError,
  isHostedOnboardingError,
} from "./errors";
import {
  HOSTED_STRIPE_WEBHOOK_WORKFLOW_RETRY_AFTER_DETAIL_KEY,
  processRecordedHostedStripeWebhookEvent,
} from "./stripe-webhook-reconciliation";
import {
  HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER,
  HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
  type HostedStripeWebhookReconciliationWorkflowInput,
} from "./stripe-webhook-workflow-types";
import { withHostedWorkflowStepMaxRetries } from "./workflow-step-options";

type HostedStripeWorkflowRetryAfter = NonNullable<RetryableErrorOptions["retryAfter"]>;

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

withHostedWorkflowStepMaxRetries(
  processHostedStripeWebhookEventStep,
  HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_STEP_MAX_RETRIES,
);

function mapHostedStripeWorkflowStepError(error: unknown): unknown {
  if (!isHostedOnboardingError(error)) {
    return error;
  }

  if (!error.retryable) {
    return new FatalError(error.message);
  }

  return new RetryableError(error.message, {
    retryAfter: resolveHostedStripeWorkflowRetryAfter(error),
  });
}

function resolveHostedStripeWorkflowRetryAfter(
  error: HostedOnboardingError,
): HostedStripeWorkflowRetryAfter {
  const retryAfter = error.details?.[
    HOSTED_STRIPE_WEBHOOK_WORKFLOW_RETRY_AFTER_DETAIL_KEY
  ];

  return isHostedStripeWorkflowRetryAfterString(retryAfter)
    ? retryAfter
    : HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER;
}

function isHostedStripeWorkflowRetryAfterString(
  value: unknown,
): value is Extract<HostedStripeWorkflowRetryAfter, string> {
  return typeof value === "string"
    && (
      value === HOSTED_STRIPE_WEBHOOK_RECONCILIATION_WORKFLOW_RETRY_AFTER
      || /^[1-9]\d*s$/u.test(value)
    );
}
