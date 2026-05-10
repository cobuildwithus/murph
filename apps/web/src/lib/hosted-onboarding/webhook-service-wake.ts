import {
  startHostedWebhookNudgeWorkflow,
} from "./webhook-workflow-start";
import { after } from "next/server";
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
      directRunnerNudgeAccepted: boolean | null;
      directRunnerNudgeDeferred: boolean;
      reason: "workflow-started";
      runId: string;
      started: true;
      workflowStarted: true;
    }
  | {
      directRunnerNudgeAccepted: boolean | null;
      directRunnerNudgeDeferred: boolean;
      errorName?: string | null;
      reason: "missing-mailbox-item" | "workflow-start-failed";
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
      directRunnerNudgeAccepted: null,
      directRunnerNudgeDeferred: false,
      reason: "missing-mailbox-item",
      started: false,
      workflowStarted: false,
    };
  }
  const mailboxItemId = input.mailboxItemId;

  const directNudgePromise = observeHostedWebhookDirectNudge({
    eventId: input.eventId,
    mailboxItemId,
    nudge: tryNudgeHostedWebhookRunnerDirectForMailboxItem({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      mailboxItemId,
      source: input.source,
      userId: input.userId,
    }),
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
      directRunnerNudgeAccepted: directNudge.accepted,
      directRunnerNudgeDeferred: false,
      errorName,
      reason: "workflow-start-failed",
      started: false,
      workflowStarted: false,
    };
  }

  scheduleAfterResponseOrFireAndForget(async () => {
    await directNudgePromise;
  });
  finishHostedOnboardingTiming(handoffTiming, "workflow-enqueued", {
    directNudgeDeferred: true,
    workflowRunIdSuffix: toHostedOnboardingLogIdSuffix(workflow.runId),
  });
  return {
    directRunnerNudgeAccepted: null,
    directRunnerNudgeDeferred: true,
    reason: "workflow-started",
    runId: workflow.runId,
    started: true,
    workflowStarted: true,
  };
}

function observeHostedWebhookDirectNudge(input: {
  eventId: string;
  mailboxItemId: string;
  nudge: Promise<HostedWebhookDirectNudgeSummary>;
  source: "linq" | "telegram" | "whatsapp";
  userId?: string;
}): Promise<HostedWebhookDirectNudgeSummary> {
  const timing = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.direct-runner-nudge`,
    {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      mailboxItemIdSuffix: toHostedOnboardingLogIdSuffix(input.mailboxItemId),
      userIdPresent: Boolean(input.userId),
      userIdSuffix: input.userId ? toHostedOnboardingLogIdSuffix(input.userId) : null,
    },
  );

  return input.nudge.then((summary) => {
    finishHostedOnboardingTiming(timing, summary.accepted ? "accepted" : "completed", {
      directNudgeAttempted: summary.attempted,
      directNudgeConfigured: summary.configured,
      directNudgeErrorCode: summary.errorCode,
    });
    return summary;
  }, (error: unknown) => {
    const errorName = deriveHostedOnboardingTimingErrorName(error);
    finishHostedOnboardingTiming(timing, "failed", {
      directNudgeAttempted: false,
      directNudgeConfigured: null,
      directNudgeErrorCode: errorName,
    });
    return {
      accepted: false,
      attempted: false,
      configured: null,
      errorCode: errorName,
    };
  });
}

function scheduleAfterResponseOrFireAndForget(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
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
