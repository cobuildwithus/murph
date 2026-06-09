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
import type { HostedWebhookServiceResponse } from "./webhook-service-types";

export type HostedWebhookWakeHandoffResult =
  {
    reason: "temporal-signaled";
    signalAccepted: true;
    started: true;
    workflowId: string;
  };

export async function maybeHandoffHostedExecutionWebhookWake(input: {
  eventId: string;
  mailboxItemId?: string;
  response: HostedWebhookServiceResponse;
  source: "linq" | "telegram" | "whatsapp";
  userId?: string;
}): Promise<HostedWebhookWakeHandoffResult | null> {
  if (!input.mailboxItemId) {
    return null;
  }
  const mailboxItemId = input.mailboxItemId;

  const handoffTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${input.source}.wake-handoff`,
    {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      responseReason: input.response.reason,
      userIdPresent: Boolean(input.userId),
      userIdSuffix: input.userId ? toHostedOnboardingLogIdSuffix(input.userId) : null,
    },
  );

  await recordHostedWebhookIngressLatencyAcceptedBestEffort({
    mailboxItemId,
    source: input.source,
  });

  let signal: Awaited<ReturnType<typeof signalHostedMailboxAppendRuntime>>;
  try {
    signal = await signalHostedMailboxAppendRuntime({
      expectedUserId: input.userId ?? null,
      mailboxItemId,
    });
  } catch (error) {
    const errorName = deriveHostedOnboardingTimingErrorName(error);
    finishHostedOnboardingTiming(handoffTiming, "failed", {
      errorName,
    });
    throw error;
  }

  await recordHostedWebhookIngressLatencyTemporalSignalBestEffort({
    mailboxItemId,
    source: input.source,
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

async function recordHostedWebhookIngressLatencyAcceptedBestEffort(input: {
  mailboxItemId: string;
  source: "linq" | "telegram" | "whatsapp";
}): Promise<void> {
  const source = input.source;
  if (source !== "linq") {
    return;
  }
  const mailboxItemId = input.mailboxItemId;

  try {
    await recordHostedIngressAcceptedFromMailboxItem({
      mailboxItemId,
      source: "linq",
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
  mailboxItemId: string;
  source: "linq" | "telegram" | "whatsapp";
  userId: string | null;
}): Promise<void> {
  const source = input.source;
  if (source !== "linq") {
    return;
  }
  const mailboxItemId = input.mailboxItemId;
  const userId = input.userId;

  try {
    await recordHostedIngressTemporalSignalAccepted({
      at: new Date(),
      expectedUserId: userId,
      mailboxItemId,
      source: "linq",
    });
  } catch (error) {
    console.warn("Hosted ingress latency temporal signal write failed.", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      source,
      stage: "temporal_signal",
    });
  }
}
