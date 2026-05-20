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
import {
  nudgeHostedAssistantRunnerUserBestEffortResult,
  type HostedAssistantRunnerUserNudgeBestEffortResult,
} from "../hosted-runner/assistant-nudge";
import {
  nudgeHostedRunnerUserBestEffortResult,
  type HostedRunnerUserNudgeBestEffortResult,
} from "../hosted-runner/control";
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

  const bypassMailboxProgressChecks = isHostedDeviceSyncRecoveryNudgeIntent(input.runnerNudgeIntent);

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

  const context = resolveHostedNudgeWorkflowContext(input);
  const result = bypassMailboxProgressChecks
    ? await nudgeHostedRunnerUserBestEffortResult({
        context,
        timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
        userId: mailboxItem.userId,
      })
    : await nudgeHostedAssistantRunnerUserBestEffortResult({
        context,
        timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
        userId: mailboxItem.userId,
      });

  if (!result.accepted) {
    logHostedWebhookNudgeNotAccepted({
      context,
      result,
      workflowInput: input,
    });
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
  switch (input.runnerNudgeIntent) {
    case "device-sync-dirty-recovery":
      return "device-sync.dirty-recovery:workflow";
    case "device-sync-reconcile-recovery":
      return "device-sync.reconcile-recovery:workflow";
    case undefined:
      break;
  }

  return input.source === "device-sync"
    ? "device-sync.wake:workflow"
    : `webhook:${input.source}:workflow`;
}

function isHostedDeviceSyncRecoveryNudgeIntent(
  intent: HostedWebhookNudgeWorkflowInput["runnerNudgeIntent"],
): boolean {
  return intent === "device-sync-dirty-recovery"
    || intent === "device-sync-reconcile-recovery";
}

function logHostedWebhookNudgeNotAccepted(event: {
  context: string;
  result:
    | HostedAssistantRunnerUserNudgeBestEffortResult
    | HostedRunnerUserNudgeBestEffortResult;
  workflowInput: HostedWebhookNudgeWorkflowInput;
}): void {
  console.warn("Hosted webhook runner nudge was not accepted.", {
    alarmScheduled: event.result.alarmScheduled,
    configured: event.result.configured,
    context: event.context,
    errorCode: event.result.errorCode,
    immediateDriveStarted: event.result.immediateDriveStarted,
    inFlight: event.result.inFlight,
    kind: event.result.kind,
    nextAlarmAtPresent: event.result.nextAlarmAtPresent,
    runnerNudgeIntent: event.workflowInput.runnerNudgeIntent ?? null,
    source: event.workflowInput.source,
    usageGateDenied: "usageGateDenied" in event.result
      ? event.result.usageGateDenied
      : null,
  });
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
