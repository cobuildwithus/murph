import {
  startHostedWebhookNudgeWorkflow,
} from "./webhook-workflow-start";
import {
  sendHostedLinqReadReceipt,
} from "./linq";
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

const HOSTED_WEBHOOK_LINQ_DIRECT_READ_RECEIPT_TIMEOUT_MS = 5_000;

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
  linqChatId?: string | null;
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

    const directNudge = await tryNudgeHostedWebhookRunnerDirect(input);
    if (directNudge.accepted) {
      if (input.source === "linq") {
        await sendHostedLinqDirectReadReceiptBestEffort({
          chatId: input.linqChatId ?? null,
          eventId: input.eventId,
        });
      }
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

async function sendHostedLinqDirectReadReceiptBestEffort(input: {
  chatId: string | null;
  eventId: string;
}): Promise<void> {
  const chatId = input.chatId?.trim() ?? "";
  const chatIdPresent = chatId.length > 0;
  const timing = startHostedOnboardingTiming(
    "hosted-onboarding.webhook.linq.direct-read-receipt",
    {
      chatIdPresent,
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      timeoutMs: HOSTED_WEBHOOK_LINQ_DIRECT_READ_RECEIPT_TIMEOUT_MS,
    },
  );

  if (!chatIdPresent) {
    finishHostedOnboardingTiming(timing, "skipped-missing-chat", {
      chatIdPresent: false,
    });
    return;
  }

  try {
    const result = await sendHostedLinqReadReceipt({
      chatId,
      timeoutMs: HOSTED_WEBHOOK_LINQ_DIRECT_READ_RECEIPT_TIMEOUT_MS,
    });
    finishHostedOnboardingTiming(timing, result.ok ? "sent" : "failed", {
      chatIdPresent: true,
      httpStatus: result.status,
    });
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      chatIdPresent: true,
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
  }
}
