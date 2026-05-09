import {
  startHostedWebhookNudgeWorkflow,
} from "./webhook-workflow-start";
import {
  nudgeHostedRunnerUserBestEffortResult,
} from "../hosted-runner/control";
import {
  readHostedMailboxItemOwnerById,
} from "../hosted-mailbox/store";
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
import type { HostedAiUsageAllowDecision } from "@murphai/hosted-execution/runtime-control";

export type HostedWebhookWakeHandoffResult =
  | {
      reason: "workflow-started";
      runId: string;
      runnerNudgeAccepted: boolean;
      started: true;
      workflowStarted: true;
    }
  | {
      errorName?: string | null;
      reason: "missing-mailbox-item" | "workflow-start-failed";
      runnerNudgeAccepted: boolean;
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
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  eventId: string;
  mailboxItemId?: string;
  response: HostedWebhookServiceResponse;
  source: "linq" | "telegram" | "whatsapp";
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
  const mailboxItemId = input.mailboxItemId;

  const directNudgePromise = tryNudgeHostedWebhookRunnerDirectForMailboxItem({
    aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
    mailboxItemId,
    source: input.source,
    userId: input.userId,
  });
  let workflow: Awaited<ReturnType<typeof startHostedWebhookNudgeWorkflow>>;
  try {
    workflow = await startHostedWebhookNudgeWorkflow({
      mailboxItemId,
      source: input.source,
    });
  } catch (error) {
    const errorName = deriveHostedOnboardingTimingErrorName(error);
    const directNudge = await directNudgePromise;
    finishHostedOnboardingTiming(handoffTiming, "failed", {
      directNudgeAttempted: directNudge.attempted,
      directNudgeConfigured: directNudge.configured,
      directNudgeErrorCode: directNudge.errorCode,
      errorName,
    });
    return {
      errorName,
      reason: "workflow-start-failed",
      runnerNudgeAccepted: directNudge.accepted,
      started: false,
      workflowStarted: false,
    };
  }

  const directNudge = await directNudgePromise;
  finishHostedOnboardingTiming(handoffTiming, "workflow-enqueued", {
    directNudgeAttempted: directNudge.attempted,
    directNudgeConfigured: directNudge.configured,
    directNudgeErrorCode: directNudge.errorCode,
    workflowRunIdSuffix: toHostedOnboardingLogIdSuffix(workflow.runId),
  });
  return {
    reason: "workflow-started",
    runId: workflow.runId,
    runnerNudgeAccepted: directNudge.accepted,
    started: true,
    workflowStarted: true,
  };
}

async function tryNudgeHostedWebhookRunnerDirectForMailboxItem(input: {
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  mailboxItemId: string;
  source: "linq" | "telegram" | "whatsapp";
  userId?: string;
}): Promise<HostedWebhookDirectNudgeSummary> {
  try {
    const owner = await readHostedMailboxItemOwnerById({
      mailboxItemId: input.mailboxItemId,
    });

    if (!owner) {
      return {
        accepted: false,
        attempted: false,
        configured: null,
        errorCode: "missing-mailbox-owner",
      };
    }

    if (input.userId && input.userId !== owner.userId) {
      return {
        accepted: false,
        attempted: false,
        configured: null,
        errorCode: "mailbox-owner-mismatch",
      };
    }

    return await tryNudgeHostedWebhookRunnerDirect({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      source: input.source,
      userId: owner.userId,
    });
  } catch (error) {
    return {
      accepted: false,
      attempted: false,
      configured: null,
      errorCode: deriveHostedOnboardingTimingErrorName(error),
    };
  }
}

async function tryNudgeHostedWebhookRunnerDirect(input: {
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  source: "linq" | "telegram" | "whatsapp";
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
    ...(input.aiUsageAllowDecision
      ? { aiUsageAllowDecision: input.aiUsageAllowDecision }
      : {}),
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
