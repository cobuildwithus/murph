import {
  nudgeHostedWebhookMailboxItemStep,
} from "./webhook-workflow-steps";
import type {
  HostedWebhookNudgeWorkflowInput,
} from "./webhook-workflow-types";

export async function hostedWebhookNudgeWorkflow(
  input: HostedWebhookNudgeWorkflowInput,
) {
  "use workflow";

  return nudgeHostedWebhookMailboxItemStep(input);
}
