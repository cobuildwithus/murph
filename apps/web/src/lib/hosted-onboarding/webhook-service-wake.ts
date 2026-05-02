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
      directNudgeAttempted: true;
      directNudgeErrorCode: string | null;
      nudgeAccepted: true;
      reason: "runner-nudged";
      started: true;
      workflowStarted: false;
    }
  | {
      directNudgeAccepted: false;
      directNudgeAttempted: boolean;
      directNudgeConfigured: boolean | null;
      directNudgeErrorCode: string | null;
      nudgeAccepted: false;
      reason: "workflow-started";
      runId: string;
      started: false;
      workflowStarted: true;
    }
  | {
      directNudgeAccepted?: false;
      directNudgeAttempted?: boolean;
      directNudgeConfigured?: boolean | null;
      directNudgeErrorCode?: string | null;
      errorName?: string | null;
      reason: "missing-mailbox-item" | "workflow-start-failed";
      nudgeAccepted: false;
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
        nudgeAccepted: false,
        started: false,
        workflowStarted: false,
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
        directNudgeAttempted: true,
        directNudgeErrorCode: directNudge.errorCode,
        nudgeAccepted: true,
        reason: "runner-nudged",
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
      directNudgeAccepted: false,
      directNudgeAttempted: directNudge.attempted,
      directNudgeConfigured: directNudge.configured,
      directNudgeErrorCode: directNudge.errorCode,
      nudgeAccepted: false,
      reason: "workflow-started",
      runId: workflow.runId,
      started: false,
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
      nudgeAccepted: false,
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
