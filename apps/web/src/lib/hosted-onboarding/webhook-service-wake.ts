import {
  startHostedWebhookNudgeWorkflow,
} from "./webhook-workflow-start";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import type { HostedWebhookServiceResponse } from "./webhook-service-types";

export type HostedWebhookWakeHandoffResult =
  | {
      reason: "workflow-started";
      runId: string;
      started: true;
    }
  | {
      errorName?: string | null;
      reason: "missing-mailbox-item" | "workflow-start-failed";
      started: false;
    };

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
        started: false,
      };
    }

    const workflow = await startHostedWebhookNudgeWorkflow({
      mailboxItemId: input.mailboxItemId,
      source: input.source,
    });
    finishHostedOnboardingTiming(handoffTiming, "workflow-enqueued", {
      workflowRunIdSuffix: toHostedOnboardingLogIdSuffix(workflow.runId),
    });
    return {
      reason: "workflow-started",
      runId: workflow.runId,
      started: true,
    };
  } catch (error) {
    const errorName = deriveHostedOnboardingTimingErrorName(error);
    finishHostedOnboardingTiming(handoffTiming, "failed", {
      errorName,
    });
    return {
      errorName,
      reason: "workflow-start-failed",
      started: false,
    };
  }
}
