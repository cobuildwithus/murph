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
import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
import { readHostedWorkspace } from "../hosted-workspace/store";
import {
  HOSTED_WEBHOOK_CHECKPOINT_WORKFLOW_RETRY_AFTER,
  HOSTED_WEBHOOK_CHECKPOINT_WORKFLOW_STEP_MAX_RETRIES,
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

  if (await isHostedWebhookMailboxItemCheckpointed(mailboxItem)) {
    return;
  }

  if (!(await isHostedWebhookMailboxItemLatestInLane(mailboxItem))) {
    return;
  }

  const result = await nudgeHostedRunnerUserBestEffortResult({
    context: resolveHostedNudgeWorkflowContext(input.source),
    timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
    userId: mailboxItem.userId,
  });

  if (!result.accepted) {
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

export async function waitHostedWebhookMailboxItemCheckpointStep(
  input: HostedWebhookNudgeWorkflowInput,
): Promise<void> {
  "use step";

  const mailboxItem = await readHostedMailboxItemCheckpointById({
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItem) {
    throw new FatalError("Hosted webhook mailbox item is missing.");
  }

  const checkpointed = await isHostedWebhookMailboxItemCheckpointed(mailboxItem);
  if (!checkpointed) {
    throw new RetryableError(
      "Hosted webhook mailbox item import is not checkpointed yet.",
      {
        retryAfter: HOSTED_WEBHOOK_CHECKPOINT_WORKFLOW_RETRY_AFTER,
      },
    );
  }
}

withHostedWorkflowStepMaxRetries(
  waitHostedWebhookMailboxItemCheckpointStep,
  HOSTED_WEBHOOK_CHECKPOINT_WORKFLOW_STEP_MAX_RETRIES,
);

function resolveHostedNudgeWorkflowContext(
  source: HostedWebhookNudgeWorkflowInput["source"],
): string {
  return source === "device-sync"
    ? "device-sync.wake:workflow"
    : `webhook:${source}:workflow`;
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
