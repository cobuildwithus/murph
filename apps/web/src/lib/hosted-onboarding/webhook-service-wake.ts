import {
  startHostedWebhookNudgeWorkflow,
} from "./webhook-workflow-start";
import {
  nudgeHostedRunnerUserBestEffortResult,
} from "../hosted-runner/control";
import {
  HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
} from "./webhook-nudge-policy";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import type { HostedWebhookServiceResponse } from "./webhook-service-types";

export type HostedWebhookWakeHandoffResult =
  | {
      reason: "runner-nudged";
      runnerNudgeAccepted: true;
      started: true;
      workflowStarted: false;
    }
  | {
      reason: "workflow-started";
      runId: string;
      runnerNudgeAccepted: false;
      started: true;
      workflowStarted: true;
    }
  | {
      errorName?: string | null;
      reason: "missing-mailbox-item" | "workflow-start-failed";
      runnerNudgeAccepted: false;
      started: false;
      workflowStarted: false;
    };

interface HostedWebhookDirectNudgeSummary {
  accepted: boolean;
  attempted: boolean;
  configured: boolean | null;
  errorCode: string | null;
}

export async function maybeHandoffHostedExecutionWebhookWake(input: {
  eventId: string;
  mailboxItemId?: string;
  response: HostedWebhookServiceResponse;
  source: "linq" | "telegram";
  userId?: string;
}): Promise<HostedWebhookWakeHandoffResult | null> {
  if (input.response.reason !== "wake-appended-active-member") {
    return null;
  }

  const handoffTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-handoff`,
    {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      responseReason: input.response.reason,
      userIdPresent: Boolean(input.userId),
      userIdSuffix: input.userId ? toHostedOnboardingLogIdSuffix(input.userId) : null,
    },
  );

  try {
    if (!input.mailboxItemId) {
      finishHostedOnboardingTiming(handoffTiming, "missing-mailbox-item", {
        eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      });
      return {
        reason: "missing-mailbox-item",
        runnerNudgeAccepted: false,
        started: false,
        workflowStarted: false,
      };
    }

    if (input.source === "linq") {
      const workflow = await startHostedWebhookNudgeWorkflow({
        mailboxItemId: input.mailboxItemId,
        source: input.source,
      });
      finishHostedOnboardingTiming(handoffTiming, "workflow-enqueued", {
        directNudgeAttempted: false,
        directNudgeConfigured: null,
        directNudgeErrorCode: null,
        workflowRunIdSuffix: toHostedOnboardingLogIdSuffix(workflow.runId),
      });
      return {
        reason: "workflow-started",
        runId: workflow.runId,
        runnerNudgeAccepted: false,
        started: true,
        workflowStarted: true,
      };
    }

    const directNudge = await tryNudgeHostedWebhookRunnerDirect(input);
    if (directNudge.accepted) {
      finishHostedOnboardingTiming(handoffTiming, "runner-nudged", {
        directNudgeAttempted: directNudge.attempted,
        directNudgeConfigured: directNudge.configured,
        directNudgeErrorCode: directNudge.errorCode,
      });
      return {
        reason: "runner-nudged",
        runnerNudgeAccepted: true,
        started: true,
        workflowStarted: false,
      };
    }

    const workflow = await startHostedWebhookNudgeWorkflow({
      mailboxItemId: input.mailboxItemId,
      source: input.source,
    });
    finishHostedOnboardingTiming(handoffTiming, "workflow-enqueued", {
      directNudgeAttempted: directNudge.attempted,
      directNudgeConfigured: directNudge.configured,
      directNudgeErrorCode: directNudge.errorCode,
      workflowRunIdSuffix: toHostedOnboardingLogIdSuffix(workflow.runId),
    });
    return {
      reason: "workflow-started",
      runId: workflow.runId,
      runnerNudgeAccepted: false,
      started: true,
      workflowStarted: true,
    };
  } catch (error) {
    const errorName = deriveHostedOnboardingTimingErrorName(error);
    finishHostedOnboardingTiming(handoffTiming, "failed", {
      errorName,
    });
    return {
      errorName,
      reason: "workflow-start-failed",
      runnerNudgeAccepted: false,
      started: false,
      workflowStarted: false,
    };
  }
}

async function tryNudgeHostedWebhookRunnerDirect(input: {
  source: "linq" | "telegram";
  userId?: string;
}): Promise<HostedWebhookDirectNudgeSummary> {
  if (!input.userId) {
    return {
      accepted: false,
      attempted: false,
      configured: null,
      errorCode: "missing-user-id",
    };
  }

  const result = await nudgeHostedRunnerUserBestEffortResult({
    context: `webhook:${input.source}:direct`,
    timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
    userId: input.userId,
  });

  return {
    accepted: result.accepted,
    attempted: true,
    configured: result.configured,
    errorCode: result.errorCode,
  };
}
