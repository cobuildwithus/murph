import {
  nudgeHostedStripeWebhookActivationStep,
  reconcileHostedStripeWebhookEventStep,
} from "./stripe-webhook-workflow-steps";
import type {
  HostedStripeWebhookReconciliationWorkflowInput,
} from "./stripe-webhook-workflow-types";

export async function hostedStripeWebhookReconciliationWorkflow(
  input: HostedStripeWebhookReconciliationWorkflowInput,
): Promise<void> {
  "use workflow";

  const reconciliation = await reconcileHostedStripeWebhookEventStep(input);
  await nudgeHostedStripeWebhookActivationStep(reconciliation);
}
