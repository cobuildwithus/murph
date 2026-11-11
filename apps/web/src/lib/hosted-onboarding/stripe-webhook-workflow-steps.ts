import { FatalError } from "workflow";

import { getPrisma } from "../prisma";
import { reconcileHostedStripeEventById } from "./stripe-event-reconciliation";
import type { HostedStripeWebhookReconciliationWorkflowInput } from "./stripe-webhook-workflow-types";
import { withHostedWorkflowStepMaxRetries } from "./workflow-step-options";

export async function processHostedStripeWebhookEventStep(
  input: HostedStripeWebhookReconciliationWorkflowInput,
): Promise<void> {
  "use step";

  try {
    await reconcileHostedStripeEventById({ eventId: input.eventId, prisma: getPrisma() });
  } catch {
    // The minute sweep retries the receipt. Never journal provider/DB errors.
    throw new FatalError("Stripe receipt attempt could not run.");
  }
}

// Workflow supplies execution time beyond the cron request. The receipt alone
// owns retry eligibility, backoff, activation acknowledgement and completion.
withHostedWorkflowStepMaxRetries(processHostedStripeWebhookEventStep, 0);
