import {
  nudgeHostedRunnerUserBestEffortResult,
} from "../hosted-runner/control";
import {
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import type { HostedWebhookServiceResponse } from "./webhook-service-types";

export async function maybeHandoffHostedExecutionWebhookWake(input: {
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
  eventId: string;
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
      deferred: Boolean(input.defer),
      eventIdSuffix: toLogIdSuffix(input.eventId),
      responseReason: input.response.reason,
      userIdPresent: true,
      userIdSuffix: toLogIdSuffix(memberId),
    },
  );

  if (input.defer) {
    await input.defer(() =>
      handoffHostedExecutionWebhookWake({
        deferred: true,
        eventId: input.eventId,
        responseReason: input.response.reason,
        source: input.source,
        userId: memberId,
      }),
    );
    finishHostedOnboardingTiming(handoffTiming, "scheduled", {
      deferred: true,
    });
    return;
  }

  await handoffHostedExecutionWebhookWake({
    deferred: false,
    eventId: input.eventId,
    responseReason: input.response.reason,
    source: input.source,
    userId: memberId,
  });
  finishHostedOnboardingTiming(handoffTiming, "completed", {
    deferred: false,
  });
}

async function handoffHostedExecutionWebhookWake(input: {
  deferred: boolean;
  eventId: string;
  responseReason: string | undefined;
  source: "linq" | "telegram";
  userId: string;
}): Promise<void> {
  const nudgeTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-nudge`,
    {
      deferred: input.deferred,
      eventIdSuffix: toLogIdSuffix(input.eventId),
      responseReason: input.responseReason,
      userIdPresent: true,
      userIdSuffix: toLogIdSuffix(input.userId),
    },
  );
  const result = await nudgeHostedRunnerUserBestEffortResult({
    context: `webhook:${input.source}`,
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
}

function toLogIdSuffix(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(-6);
}
