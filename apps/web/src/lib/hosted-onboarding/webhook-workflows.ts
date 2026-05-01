import {
  nudgeHostedWebhookMailboxItemStep,
} from "./webhook-workflow-steps";
import type {
  HostedWebhookNudgeWorkflowInput,
} from "./webhook-workflow-types";

export async function hostedWebhookNudgeWorkflow(
  input: HostedWebhookNudgeWorkflowInput,
): Promise<void> {
  "use workflow";

  await nudgeHostedWebhookMailboxItemStep(input);
}
