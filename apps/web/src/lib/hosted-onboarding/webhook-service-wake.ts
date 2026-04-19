import type { PrismaClient } from "@prisma/client";

import {
  readHostedWakeTarget,
} from "../hosted-wake/lifecycle";
import {
  triggerHostedWakeUserBestEffort,
} from "../hosted-wake/control";
import {
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import type { HostedWebhookServiceResponse } from "./webhook-service-types";

export async function maybeHandoffHostedExecutionWebhookWake(input: {
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
  eventId: string;
  maxInlineDrainMs?: number;
  prisma: PrismaClient;
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

  const wakeTarget = await readHostedWakeTarget({
    eventId: input.eventId,
    prisma: input.prisma,
    userId: memberId,
  });

  if (!wakeTarget) {
    return;
  }

  const handoffTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-handoff`,
    {
      deferred: Boolean(input.defer),
      eventId: input.eventId,
      inlineTimeoutMs: input.maxInlineDrainMs ?? null,
      responseReason: input.response.reason,
    },
  );

  if (typeof input.maxInlineDrainMs === "number" && input.maxInlineDrainMs > 0) {
    const completedInline = await waitForHostedExecutionWebhookWake({
      eventId: input.eventId,
      responseReason: input.response.reason,
      source: input.source,
      targetSeqHint: wakeTarget.seq ?? null,
      timeoutMs: input.maxInlineDrainMs,
      userId: wakeTarget.userId,
    });

    if (completedInline) {
      finishHostedOnboardingTiming(handoffTiming, "completed", {
        deferred: false,
      });
      return;
    }

    if (input.defer) {
      await input.defer(() =>
        handoffHostedExecutionWebhookWake({
          deferred: true,
          eventId: input.eventId,
          responseReason: input.response.reason,
          source: input.source,
          targetSeqHint: wakeTarget.seq ?? null,
          userId: wakeTarget.userId,
        }),
      );
      finishHostedOnboardingTiming(handoffTiming, "scheduled", {
        deferred: true,
        inlineCompleted: false,
      });
      return;
    }

    finishHostedOnboardingTiming(handoffTiming, "completed", {
      deferred: false,
      inlineCompleted: false,
    });
    return;
  }

  if (input.defer) {
    await input.defer(() =>
      handoffHostedExecutionWebhookWake({
        deferred: true,
        eventId: input.eventId,
        responseReason: input.response.reason,
        source: input.source,
        targetSeqHint: wakeTarget.seq ?? null,
        userId: wakeTarget.userId,
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
    targetSeqHint: wakeTarget.seq ?? null,
    userId: wakeTarget.userId,
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
  targetSeqHint: string | null;
  userId: string;
}): Promise<void> {
  const drainTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-drain`,
    {
      deferred: input.deferred,
      eventId: input.eventId,
      responseReason: input.responseReason,
      targetSeqHint: input.targetSeqHint,
      userId: input.userId,
    },
  );
  await triggerHostedWakeUserBestEffort({
    context: `webhook:${input.source}`,
    targetSeqHint: input.targetSeqHint,
    userId: input.userId,
  });
  finishHostedOnboardingTiming(drainTiming, "completed");
}

async function waitForHostedExecutionWebhookWake(input: {
  eventId: string;
  responseReason: string | undefined;
  source: "linq" | "telegram";
  targetSeqHint: string | null;
  timeoutMs: number;
  userId: string;
}): Promise<boolean> {
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs));

  if (!Number.isFinite(timeoutMs)) {
    return false;
  }

  return triggerHostedWakeUserBestEffort({
    context: `webhook:${input.source}`,
    targetSeqHint: input.targetSeqHint,
    timeoutMs,
    userId: input.userId,
  });
}
