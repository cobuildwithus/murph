import {
  FatalError,
  RetryableError,
} from "workflow";

import { readHostedMailboxItemOwnerById } from "../hosted-mailbox/store";
import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
import {
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER,
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES,
  HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
  type HostedWebhookNudgeWorkflowInput,
  type HostedWebhookNudgeWorkflowStepResult,
} from "./webhook-workflow-types";

export async function nudgeHostedWebhookMailboxItemStep(
  input: HostedWebhookNudgeWorkflowInput,
): Promise<HostedWebhookNudgeWorkflowStepResult> {
  "use step";

  const mailboxItemOwner = await readHostedMailboxItemOwnerById({
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItemOwner) {
    throw new FatalError("Hosted webhook mailbox item is missing.");
  }

  const result = await nudgeHostedRunnerUserBestEffortResult({
    context: `webhook:${input.source}:workflow`,
    timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
    userId: mailboxItemOwner.userId,
  });

  if (!result.accepted) {
    throw new RetryableError(
      "Hosted webhook runner nudge is temporarily unavailable.",
      {
        retryAfter: HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER,
      },
    );
  }

  return {
    accepted: true,
  };
}

Object.assign(nudgeHostedWebhookMailboxItemStep, {
  maxRetries: HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES,
});
