import { hostedOnboardingError } from "./errors";
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

export async function maybeHandoffHostedExecutionWebhookWake(input: {
  eventId: string;
  mailboxItemId?: string;
  response: HostedWebhookServiceResponse;
  source: "linq" | "telegram";
  userId?: string;
}): Promise<void> {
  if (input.response.reason !== "wake-appended-active-member") {
    return;
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
      throw buildHostedRunnerNudgeRetryError();
    }

    const workflow = await startHostedWebhookNudgeWorkflow({
      mailboxItemId: input.mailboxItemId,
      source: input.source,
    });
    finishHostedOnboardingTiming(handoffTiming, "workflow-enqueued", {
      workflowRunIdSuffix: toHostedOnboardingLogIdSuffix(workflow.runId),
    });
  } catch (error) {
    finishHostedOnboardingTiming(handoffTiming, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

function buildHostedRunnerNudgeRetryError() {
  return hostedOnboardingError({
    code: "HOSTED_RUNNER_NUDGE_RETRY_REQUIRED",
    httpStatus: 503,
    message: "Webhook processing is temporarily unavailable.",
    retryable: true,
  });
}
