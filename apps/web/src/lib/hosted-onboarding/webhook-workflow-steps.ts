import {
  FatalError,
  RetryableError,
} from "workflow";

import { readHostedMailboxItemOwnerById } from "../hosted-mailbox/store";
import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
import {
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER,
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES,
  type HostedWebhookNudgeWorkflowInput,
} from "./webhook-workflow-types";
import {
  HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
} from "./webhook-nudge-policy";
import { withHostedWorkflowStepMaxRetries } from "./workflow-step-options";

export const nudgeHostedWebhookMailboxItemStep = withHostedWorkflowStepMaxRetries(
  async function nudgeHostedWebhookMailboxItemStep(
    input: HostedWebhookNudgeWorkflowInput,
  ): Promise<void> {
    "use step";

    const mailboxItemOwner = await readHostedMailboxItemOwnerById({
      mailboxItemId: input.mailboxItemId,
    });

    if (!mailboxItemOwner) {
      throw new FatalError("Hosted webhook mailbox item is missing.");
    }

    const result = await nudgeHostedRunnerUserBestEffortResult({
      context: resolveHostedNudgeWorkflowContext(input.source),
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
  },
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES,
);

function resolveHostedNudgeWorkflowContext(
  source: HostedWebhookNudgeWorkflowInput["source"],
): string {
  return source === "device-sync"
    ? "device-sync.wake:workflow"
    : `webhook:${source}:workflow`;
}
