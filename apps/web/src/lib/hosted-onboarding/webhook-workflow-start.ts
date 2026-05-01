import { start } from "workflow/api";

import { hostedOnboardingError } from "./errors";
import {
  hostedWebhookNudgeWorkflow,
} from "./webhook-workflows";
import type {
  HostedWebhookNudgeWorkflowInput,
  HostedWebhookNudgeWorkflowStartResult,
} from "./webhook-workflow-types";

export async function startHostedWebhookNudgeWorkflow(
  input: HostedWebhookNudgeWorkflowInput,
): Promise<HostedWebhookNudgeWorkflowStartResult> {
  try {
    const run = await start(hostedWebhookNudgeWorkflow, [input]);

    return {
      runId: run.runId,
    };
  } catch {
    throw buildHostedWebhookWorkflowStartError();
  }
}

function buildHostedWebhookWorkflowStartError() {
  return hostedOnboardingError({
    code: "HOSTED_WEBHOOK_NUDGE_WORKFLOW_START_RETRY_REQUIRED",
    httpStatus: 503,
    message: "Webhook processing is temporarily unavailable.",
    retryable: true,
  });
}
