import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import type { HostedWebhookServiceResponse } from "./webhook-service-types";

export type HostedWebhookWakeHandoffResult =
  | {
      reason: "temporal-signaled";
      signalAccepted: true;
      started: true;
      workflowId: string;
    }
  | {
      errorName?: string | null;
      reason: "missing-mailbox-item" | "temporal-signal-failed";
      signalAccepted: false;
      started: false;
    };

export async function maybeHandoffHostedExecutionWebhookWake(input: {
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
      signalAccepted: false,
      started: false,
    };
  }
  const mailboxItemId = input.mailboxItemId;

  let signal: Awaited<ReturnType<typeof signalHostedMailboxAppendRuntime>>;
  try {
    signal = await signalHostedMailboxAppendRuntime({
      expectedUserId: input.userId ?? null,
      mailboxItemId,
      source: input.source,
    });
  } catch (error) {
    const errorName = deriveHostedOnboardingTimingErrorName(error);
    finishHostedOnboardingTiming(handoffTiming, "failed", {
      errorName,
    });
    return {
      errorName,
      reason: "temporal-signal-failed",
      signalAccepted: false,
      started: false,
    };
  }

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
