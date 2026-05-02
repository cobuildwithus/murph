import {
  hostedWebhookNudgeWorkflow,
} from "./webhook-workflows";
import type {
  HostedWebhookNudgeWorkflowInput,
  HostedWebhookNudgeWorkflowStartResult,
} from "./webhook-workflow-types";
import { startHostedPointerWorkflow } from "./workflow-start";

export async function startHostedWebhookNudgeWorkflow(
  input: HostedWebhookNudgeWorkflowInput,
): Promise<HostedWebhookNudgeWorkflowStartResult> {
  return startHostedPointerWorkflow({
    error: {
      code: "HOSTED_WEBHOOK_NUDGE_WORKFLOW_START_RETRY_REQUIRED",
      message: "Webhook processing is temporarily unavailable.",
    },
    payload: input,
    workflow: hostedWebhookNudgeWorkflow,
  });
}
