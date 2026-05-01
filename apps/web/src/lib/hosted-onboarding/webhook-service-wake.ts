import {
  nudgeHostedRunnerUserBestEffortResult,
} from "../hosted-runner/control";
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
import {
  HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
} from "./webhook-workflow-types";

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

  const memberId = input.userId ?? null;

  if (!memberId) {
    return;
  }

  const handoffTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-handoff`,
    {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      responseReason: input.response.reason,
      userIdPresent: true,
      userIdSuffix: toHostedOnboardingLogIdSuffix(memberId),
    },
  );

  try {
    const nudgeResult = await nudgeHostedExecutionWebhookWake({
      eventId: input.eventId,
      responseReason: input.response.reason,
      source: input.source,
      userId: memberId,
    });

    if (nudgeResult.accepted) {
      finishHostedOnboardingTiming(handoffTiming, "completed");
      return;
    }

    if (!input.mailboxItemId) {
      throw buildHostedRunnerNudgeRetryError();
    }

    const workflow = await startHostedWebhookNudgeWorkflow({
      mailboxItemId: input.mailboxItemId,
      source: input.source,
    });
    finishHostedOnboardingTiming(handoffTiming, "fallback-enqueued", {
      workflowRunIdSuffix: toHostedOnboardingLogIdSuffix(workflow.runId),
    });
  } catch (error) {
    finishHostedOnboardingTiming(handoffTiming, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

async function nudgeHostedExecutionWebhookWake(input: {
  eventId: string;
  responseReason: string | undefined;
  source: "linq" | "telegram";
  userId: string;
}): Promise<Awaited<ReturnType<typeof nudgeHostedRunnerUserBestEffortResult>>> {
  const nudgeTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-nudge`,
    {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      responseReason: input.responseReason,
      timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
      userIdPresent: true,
      userIdSuffix: toHostedOnboardingLogIdSuffix(input.userId),
    },
  );
  const result = await nudgeHostedRunnerUserBestEffortResult({
    context: `webhook:${input.source}`,
    timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
    userId: input.userId,
  });
  finishHostedOnboardingTiming(nudgeTiming, result.accepted ? "accepted" : "not-accepted", {
    accepted: result.accepted,
    alarmScheduled: result.alarmScheduled,
    alreadyRunning: result.alreadyRunning,
    configured: result.configured,
    errorCode: result.errorCode,
    inFlight: result.inFlight,
    nextAlarmAtPresent: result.nextAlarmAtPresent,
  });

  return result;
}

function buildHostedRunnerNudgeRetryError() {
  return hostedOnboardingError({
    code: "HOSTED_RUNNER_NUDGE_RETRY_REQUIRED",
    httpStatus: 503,
    message: "Webhook processing is temporarily unavailable.",
    retryable: true,
  });
}
