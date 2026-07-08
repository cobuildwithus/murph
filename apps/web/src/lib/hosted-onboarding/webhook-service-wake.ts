import { randomUUID } from "node:crypto";

import {
  readHostedIngressLatencySource,
  type HostedIngressLatencySource,
  type HostedRuntimeLatencyPhaseBreakdown,
} from "@murphai/hosted-execution/runtime-control";
import type {
  CloudflareHostedControlRuntimeEnsureProcessingTiming,
} from "@murphai/cloudflare-hosted-control/client";

import {
  readHostedExecutionControlClientIfConfigured,
} from "../hosted-execution/control";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  recordHostedIngressAcceptedFromMailboxItem,
  recordHostedIngressDirectEnsureTiming,
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
  HostedWebhookWakeHandoff,
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
  response: HostedWebhookServiceResponse;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
  wakeHandoff?: HostedWebhookWakeHandoff;
}): Promise<HostedWebhookWakeHandoffResult | null> {
  if (!input.wakeHandoff) {
    return null;
  }
  const {
    eventId,
    mailboxItemId,
    source,
    userId,
    wakeMailboxCheckpoint,
  } = input.wakeHandoff;
  // Guarded at runtime: a checkpoint missing lane facts falls back to the
  // legacy signal path (checkpoint re-read + workspace ensure) instead of
  // failing the wake on malformed planner data.
  const knownCheckpoint =
    typeof wakeMailboxCheckpoint?.lane === "string"
    && wakeMailboxCheckpoint.lane.length > 0
    && typeof wakeMailboxCheckpoint.laneSeq === "string"
    && wakeMailboxCheckpoint.laneSeq.length > 0
      ? {
          lane: wakeMailboxCheckpoint.lane,
          laneSeq: wakeMailboxCheckpoint.laneSeq,
          userId,
        }
      : undefined;
  const directEnsureEligible = Boolean(knownCheckpoint && source === "linq");

  const handoffTiming = startHostedOnboardingTiming(
    `hosted-onboarding.webhook.${source}.wake-handoff`,
    {
      directEnsureWakeEligible: directEnsureEligible,
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      plannerCheckpointPresent: Boolean(knownCheckpoint),
      responseReason: input.response.reason,
      userIdPresent: true,
      userIdSuffix: toHostedOnboardingLogIdSuffix(userId),
    },
  );

  let signal: Awaited<ReturnType<typeof signalHostedMailboxAppendRuntime>>;
  let temporalSignalAcceptedAt: Date | null = null;
  try {
    signal = await signalHostedMailboxAppendRuntime({
      expectedUserId: userId,
      ...(knownCheckpoint ? { knownCheckpoint } : {}),
      mailboxItemId,
    });
    temporalSignalAcceptedAt = new Date();
  } catch (error) {
    scheduleHostedWebhookIngressLatencyTraceWritesAfterResponse({
      mailboxItemId,
      scheduleAfterResponse: input.scheduleAfterResponse,
      source,
      temporalSignalAcceptedAt,
      userId,
    });
    const errorName = deriveHostedOnboardingTimingErrorName(error);
    finishHostedOnboardingTiming(handoffTiming, "failed", {
      directEnsureWakeStarted: false,
      errorName,
    });
    throw error;
  }

  // Linq-only latency fast path, after Temporal has accepted the durable wake.
  // With consumed_at live, a racing ensure is harmless: consumed mailbox items
  // restage with a null reply target, and a gap invocation that imports only
  // already-consumed work finds nothing replyable and exits.
  const directEnsureWake = directEnsureEligible
    ? startHostedDirectEnsureWakeBestEffort({
        mailboxItemId,
        source: "linq",
        userId,
      })
    : null;
  if (directEnsureWake) {
    if (input.scheduleAfterResponse) {
      // Keep the in-flight request alive past the response without ever
      // putting its latency on the provider success path.
      input.scheduleAfterResponse(() => directEnsureWake);
    } else {
      void directEnsureWake;
    }
  }

  scheduleHostedWebhookIngressLatencyTraceWritesAfterResponse({
    mailboxItemId,
    scheduleAfterResponse: input.scheduleAfterResponse,
    source,
    temporalSignalAcceptedAt,
    userId,
  });

  finishHostedOnboardingTiming(handoffTiming, "temporal-signaled", {
    directEnsureWakeStarted: Boolean(directEnsureWake),
    workflowIdSuffix: toHostedOnboardingLogIdSuffix(signal.workflowId),
  });
  return {
    reason: "temporal-signaled",
    signalAccepted: true,
    started: true,
    workflowId: signal.workflowId,
  };
}

// Starts the direct Cloudflare ensure request immediately and never throws or
// rejects, including on synchronous client-configuration errors. The returned
// promise exists only so callers can keep the request alive past the webhook
// response; the Temporal signal never waits on it.
function startHostedDirectEnsureWakeBestEffort(wake: {
  mailboxItemId: string;
  source: "linq";
  userId: string;
}): Promise<void> {
  const wakeSource = wake.source;
  let client: ReturnType<typeof readHostedExecutionControlClientIfConfigured>;
  try {
    client = readHostedExecutionControlClientIfConfigured();
  } catch (error) {
    console.warn("Hosted direct ensure wake client is misconfigured.", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
  if (!client) {
    return Promise.resolve();
  }

  try {
    let directEnsureTiming: CloudflareHostedControlRuntimeEnsureProcessingTiming | null = null;
    return client
      .ensureRuntimeProcessing({
        onTiming: (timing) => {
          directEnsureTiming = timing;
        },
        orchestrationAttemptId: `web-ingress-${randomUUID()}`,
        userId: wake.userId,
      })
      .then((ensureResult) => {
        if ("kind" in ensureResult) {
          console.info("Hosted direct ensure wake completed.", {
            kind: ensureResult.kind,
            ...(ensureResult.kind === "runtime_processing_accepted"
              ? { action: ensureResult.action }
              : {}),
            source: wakeSource,
          });
          return;
        }

        console.info("Hosted direct ensure wake accepted.", {
          accepted: ensureResult.accepted,
          source: wakeSource,
        });
      })
      .catch((error: unknown) => {
        console.warn("Hosted direct ensure wake failed.", {
          errorName: deriveHostedOnboardingTimingErrorName(error),
          source: wakeSource,
        });
      })
      .finally(async () => {
        if (!directEnsureTiming) {
          return;
        }
        await recordHostedDirectEnsureWakeTimingBestEffort({
          mailboxItemId: wake.mailboxItemId,
          source: wakeSource,
          timing: directEnsureTiming,
          userId: wake.userId,
        });
      });
  } catch (error) {
    console.warn("Hosted direct ensure wake failed.", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      source: wakeSource,
    });
    return Promise.resolve();
  }
}

async function recordHostedDirectEnsureWakeTimingBestEffort(timingRecord: {
  mailboxItemId: string;
  source: "linq";
  timing: CloudflareHostedControlRuntimeEnsureProcessingTiming;
  userId: string;
}): Promise<void> {
  const phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown = {
    schemaVersion: 1,
    orchestration: {
      tokenAcquireStartedAtEpochMs: timingRecord.timing.tokenAcquireStartedAtEpochMs,
      tokenAcquiredAtEpochMs: timingRecord.timing.tokenAcquiredAtEpochMs,
      directEnsureRequestStartedAtEpochMs:
        timingRecord.timing.directEnsureRequestStartedAtEpochMs,
      directEnsureResponseReceivedAtEpochMs:
        timingRecord.timing.directEnsureResponseReceivedAtEpochMs,
    },
  };

  try {
    await recordHostedIngressDirectEnsureTiming({
      expectedUserId: timingRecord.userId,
      mailboxItemId: timingRecord.mailboxItemId,
      phaseBreakdown,
      source: timingRecord.source,
    });
  } catch (error) {
    console.warn("Hosted direct ensure wake timing record failed.", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      source: timingRecord.source,
    });
  }
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
