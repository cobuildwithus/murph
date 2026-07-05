import {
  readHostedIngressLatencySource,
  type HostedIngressLatencySource,
} from "@murphai/hosted-execution/runtime-control";

import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  recordHostedIngressAcceptedFromMailboxItem,
  recordHostedIngressTemporalSignalAccepted,
} from "../hosted-runtime-latency/store";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import type {
  HostedWebhookServiceResponse,
  HostedWebhookWakeMailboxCheckpoint,
} from "./webhook-service-types";

// Latency traces are observability only. They are scheduled after the webhook
// response so ingress wake handoff stays focused on durable mailbox acceptance
// plus Temporal signaling; losing a trace row is acceptable, blocking ingress is not.

export type HostedWebhookWakeHandoffResult =
  {
    reason: "temporal-signaled";
    signalAccepted: true;
    started: true;
    workflowId: string;
  };

type HostedWebhookPostResponseScheduler = (task: () => Promise<void>) => void;

export async function maybeHandoffHostedExecutionWebhookWake(input: {
  eventId: string;
  mailboxItemId?: string;
  response: HostedWebhookServiceResponse;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
  source: "linq" | "telegram" | "whatsapp";
  userId?: string;
  wakeMailboxCheckpoint?: HostedWebhookWakeMailboxCheckpoint;
}): Promise<HostedWebhookWakeHandoffResult | null> {
  if (!input.mailboxItemId) {
    return null;
  }
  const mailboxItemId = input.mailboxItemId;
  // Guarded at runtime: a checkpoint missing lane facts falls back to the
  // legacy signal path (checkpoint re-read + workspace ensure) instead of
  // failing the wake on malformed planner data.
  const knownCheckpoint =
    input.userId
    && typeof input.wakeMailboxCheckpoint?.lane === "string"
    && input.wakeMailboxCheckpoint.lane.length > 0
    && typeof input.wakeMailboxCheckpoint.laneSeq === "string"
    && input.wakeMailboxCheckpoint.laneSeq.length > 0
      ? {
          lane: input.wakeMailboxCheckpoint.lane,
          laneSeq: input.wakeMailboxCheckpoint.laneSeq,
          userId: input.userId,
        }
      : undefined;
  const handoffTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-handoff`,
    {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      responseReason: input.response.reason,
      userIdPresent: Boolean(input.userId),
      userIdSuffix: input.userId ? toHostedOnboardingLogIdSuffix(input.userId) : null,
    },
  );

  let signal: Awaited<ReturnType<typeof signalHostedMailboxAppendRuntime>>;
  let temporalSignalAcceptedAt: Date | null = null;
  try {
    signal = await signalHostedMailboxAppendRuntime({
      expectedUserId: input.userId ?? null,
      ...(knownCheckpoint ? { knownCheckpoint } : {}),
      mailboxItemId,
    });
    temporalSignalAcceptedAt = new Date();
  } catch (error) {
    scheduleHostedWebhookIngressLatencyTraceWritesAfterResponse({
      mailboxItemId,
      scheduleAfterResponse: input.scheduleAfterResponse,
      source: input.source,
      temporalSignalAcceptedAt,
      userId: input.userId ?? null,
    });
    const errorName = deriveHostedOnboardingTimingErrorName(error);
    finishHostedOnboardingTiming(handoffTiming, "failed", {
      errorName,
    });
    throw error;
  }

  scheduleHostedWebhookIngressLatencyTraceWritesAfterResponse({
    mailboxItemId,
    scheduleAfterResponse: input.scheduleAfterResponse,
    source: input.source,
    temporalSignalAcceptedAt,
    userId: input.userId ?? null,
  });

  finishHostedOnboardingTiming(handoffTiming, "temporal-signaled", {
    workflowIdSuffix: toHostedOnboardingLogIdSuffix(signal.workflowId),
  });
  return {
    reason: "temporal-signaled",
    signalAccepted: true,
    started: true,
    workflowId: signal.workflowId,
  };
}

function scheduleHostedWebhookIngressLatencyTraceWritesAfterResponse(input: {
  mailboxItemId: string;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
  source: "linq" | "telegram" | "whatsapp";
  temporalSignalAcceptedAt: Date | null;
  userId: string | null;
}): void {
  const source = readHostedIngressLatencySource(input.source);
  if (!source) {
    return;
  }
  const task = async () => {
    if (input.temporalSignalAcceptedAt) {
      await recordHostedWebhookIngressLatencyTemporalSignalBestEffort({
        at: input.temporalSignalAcceptedAt,
        mailboxItemId: input.mailboxItemId,
        source,
        userId: input.userId,
      });
      return;
    }
    await recordHostedWebhookIngressLatencyAcceptedBestEffort({
      mailboxItemId: input.mailboxItemId,
      source,
    });
  };

  try {
    if (input.scheduleAfterResponse) {
      input.scheduleAfterResponse(task);
    } else {
      void task();
    }
  } catch {
    void task();
  }
}

async function recordHostedWebhookIngressLatencyAcceptedBestEffort(input: {
  mailboxItemId: string;
  source: HostedIngressLatencySource;
}): Promise<void> {
  const { mailboxItemId, source } = input;
  try {
    await recordHostedIngressAcceptedFromMailboxItem({
      mailboxItemId,
      source,
    });
  } catch (error) {
    console.warn("Hosted ingress latency accepted write failed.", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      source,
      stage: "accepted",
    });
  }
}

async function recordHostedWebhookIngressLatencyTemporalSignalBestEffort(input: {
  at: Date;
  mailboxItemId: string;
  source: HostedIngressLatencySource;
  userId: string | null;
}): Promise<void> {
  const { at, mailboxItemId, source, userId } = input;
  try {
    await recordHostedIngressTemporalSignalAccepted({
      at,
      expectedUserId: userId,
      mailboxItemId,
      source,
    });
  } catch (error) {
    console.warn("Hosted ingress latency temporal signal write failed.", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      source,
      stage: "temporal_signal",
    });
  }
}
