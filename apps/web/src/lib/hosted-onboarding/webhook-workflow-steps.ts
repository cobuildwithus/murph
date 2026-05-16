import {
  FatalError,
  RetryableError,
} from "workflow";

import {
  readHostedMailboxItemCheckpointById,
  readHostedMailboxMaxSeqByLane,
  type HostedMailboxItemCheckpointRecord,
} from "../hosted-mailbox/store";
import {
  isHostedMailboxLaneCheckpointed,
} from "../hosted-mailbox/lag";
import { nudgeHostedAssistantRunnerUserBestEffortResult } from "../hosted-runner/assistant-nudge";
import { readHostedWorkspace } from "../hosted-workspace/store";
import {
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER,
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES,
  type HostedWebhookNudgeWorkflowInput,
} from "./webhook-workflow-types";
import {
  HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
} from "./webhook-nudge-policy";
import { withHostedWorkflowStepMaxRetries } from "./workflow-step-options";

export async function nudgeHostedWebhookMailboxItemStep(
  input: HostedWebhookNudgeWorkflowInput,
): Promise<void> {
  "use step";

  const mailboxItem = await readHostedMailboxItemCheckpointById({
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItem) {
    throw new FatalError("Hosted webhook mailbox item is missing.");
  }

  const bypassMailboxProgressChecks = input.runnerNudgeIntent === "device-sync-dirty-recovery";

  if (bypassMailboxProgressChecks && input.source !== "device-sync") {
    throw new FatalError("Hosted webhook nudge intent is not valid for this source.");
  }

  if (!bypassMailboxProgressChecks) {
    if (await isHostedWebhookMailboxItemCheckpointed(mailboxItem)) {
      return;
    }

    if (!(await isHostedWebhookMailboxItemLatestInLane(mailboxItem))) {
      return;
    }
  }

  const result = await nudgeHostedAssistantRunnerUserBestEffortResult({
    context: resolveHostedNudgeWorkflowContext(input),
    timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
    userId: mailboxItem.userId,
  });

  if (!result.accepted) {
    if ("usageGateDenied" in result && result.usageGateDenied) {
      return;
    }
    throw new RetryableError(
      "Hosted webhook runner nudge is temporarily unavailable.",
      {
        retryAfter: HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER,
      },
    );
  }
}

withHostedWorkflowStepMaxRetries(
  nudgeHostedWebhookMailboxItemStep,
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES,
);

function resolveHostedNudgeWorkflowContext(
  input: HostedWebhookNudgeWorkflowInput,
): string {
  if (input.runnerNudgeIntent === "device-sync-dirty-recovery") {
    return "device-sync.dirty-recovery:workflow";
  }

  return input.source === "device-sync"
    ? "device-sync.wake:workflow"
    : `webhook:${input.source}:workflow`;
}

async function isHostedWebhookMailboxItemCheckpointed(
  mailboxItem: HostedMailboxItemCheckpointRecord,
): Promise<boolean> {
  const workspace = await readHostedWorkspace({
    userId: mailboxItem.userId,
  });

  return isHostedMailboxLaneCheckpointed({
    lane: mailboxItem.lane,
    laneSeq: mailboxItem.laneSeq,
    redactedStatusJson: workspace?.redactedStatusJson ?? null,
  });
}

async function isHostedWebhookMailboxItemLatestInLane(
  mailboxItem: HostedMailboxItemCheckpointRecord,
): Promise<boolean> {
  const [highWater] = await readHostedMailboxMaxSeqByLane({
    lanes: [mailboxItem.lane],
    userId: mailboxItem.userId,
  });
  const currentMaxSeq = BigInt(highWater?.maxSeq ?? "0");
  const mailboxSeq = BigInt(mailboxItem.laneSeq);

  return currentMaxSeq <= mailboxSeq;
}
