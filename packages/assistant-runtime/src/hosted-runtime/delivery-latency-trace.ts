import {
  HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
  readHostedIngressLatencySource,
} from "@murphai/hosted-execution/runtime-control";
import type { AssistantOutboxIntent } from "@murphai/operator-config/assistant-cli-contracts";

import {
  HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
  HOSTED_ASSISTANT_TURN_TIMING_TYPE,
} from "@murphai/assistant-engine";

import type { HostedRuntimePlatform } from "./platform.ts";
import {
  buildHostedRuntimeLogContextFields,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import {
  recordLatencyTraceWithRetries,
  waitForHostedStagedLatencyTraceWrites,
} from "./assistant-latency-trace.ts";
import {
  resolveHostedRuntimeCheckpointPublicationExpectedByMs,
  resolveHostedRuntimeIdleCheckpointDelayMs,
} from "./checkpoint-publication.ts";

export interface HostedMemberChannelBarrierTiming {
  deliveryMemberChannelIntentLookupMs?: number;
  deliveryMemberChannelWatcherMs?: number;
  deliveryMemberChannelUpdateDrainMs?: number;
  deliveryMemberChannelNextWakeMs?: number;
  deliveryMemberChannelProcessedCount?: number;
  deliveryMemberChannelRecordedCount?: number;
}

export interface HostedDeliveryTraceContext {
  memberChannelBarrierTiming?: HostedMemberChannelBarrierTiming;
  latencyTracePort: HostedRuntimePlatform["latencyTracePort"];
  runtimeAttemptId: string;
  runnerIdleTtlMs?: number | null;
  commitTimeoutMs?: number | null;
  /** `performance.now()` when the foreground delivery phase started, if any. */
  foregroundDeliveryPhaseStartedAtMonotonicMs?: number | null;
  /**
   * Duration of the member-channel pre-dispatch barrier that preceded this
   * drain. Shared by every delivery in the batch, not per delivery.
   */
  memberChannelBarrierMs?: number | null;
  /** Configured waits already completed within this reply's bubble sequence. */
  replyBubblePacingMs?: number | null;
}

/**
 * One queued info row per Linq provider-dispatch boundary (primary or text
 * fallback), attributing pre-dispatch work with the monotonic clock. The
 * durations overlap and are not additive. Adds no request, await, or ordering
 * change; a log failure cannot reach dispatch.
 */
export function writeHostedLinqDispatchEnteredTiming(input: {
  context?: HostedDeliveryTraceContext | null;
  dispatchEnteredAtMonotonicMs: number;
  intentId?: string | null;
  platform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  providerEntryFenceStartedAtMonotonicMs: number;
  routeAuthorityCheckMs: number;
  sendStartedAtMonotonicMs: number;
}): void {
  const { context, intentId, platform } = input;
  if (!context || !intentId || !platform) {
    return;
  }
  const phaseStartedAt = context.foregroundDeliveryPhaseStartedAtMonotonicMs ?? null;
  const fields = {
    deliveryMemberChannelIntentLookupMs: readDurationMs(context.memberChannelBarrierTiming?.deliveryMemberChannelIntentLookupMs ?? null),
    deliveryMemberChannelWatcherMs: readDurationMs(context.memberChannelBarrierTiming?.deliveryMemberChannelWatcherMs ?? null),
    deliveryMemberChannelUpdateDrainMs: readDurationMs(context.memberChannelBarrierTiming?.deliveryMemberChannelUpdateDrainMs ?? null),
    deliveryMemberChannelNextWakeMs: readDurationMs(context.memberChannelBarrierTiming?.deliveryMemberChannelNextWakeMs ?? null),
    deliveryMemberChannelProcessedCount: readDurationMs(context.memberChannelBarrierTiming?.deliveryMemberChannelProcessedCount ?? null),
    deliveryMemberChannelRecordedCount: readDurationMs(context.memberChannelBarrierTiming?.deliveryMemberChannelRecordedCount ?? null),

    deliveryReplyBubblePacingMs: readDurationMs(context.replyBubblePacingMs ?? null),
    deliveryMemberChannelBarrierMs: readDurationMs(context.memberChannelBarrierMs ?? null),
    deliveryProviderEntryFenceMs: readDurationMs(
      input.dispatchEnteredAtMonotonicMs - input.providerEntryFenceStartedAtMonotonicMs,
    ),
    deliveryRouteAuthorityCheckMs: readDurationMs(input.routeAuthorityCheckMs),
    deliverySendPreparationMs: readDurationMs(
      input.dispatchEnteredAtMonotonicMs - input.sendStartedAtMonotonicMs,
    ),
    deliverySinceForegroundPhaseStartedMs: phaseStartedAt === null
      ? null
      : readDurationMs(input.dispatchEnteredAtMonotonicMs - phaseStartedAt),
  };
  void writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({ attemptId: context.runtimeAttemptId }),
      component: "assistant",
      eventCode: "assistant.automation_detail",
      level: "info",
      phase: "outbox",
      redactedJson: {
        detailLabel: "Hosted Linq dispatch entry timing captured.",
        schema: HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
        type: HOSTED_ASSISTANT_TURN_TIMING_TYPE,
        turnTimingDeliveryIntentId: intentId,
        turnTimingStage: "linq-dispatch-entered",
        ...Object.fromEntries(Object.entries(fields).filter((entry) => entry[1] !== null)),
      },
    },
    platform,
  }).catch(() => {
    // Diagnostic timing must never affect provider dispatch.
  });
}

/** Validates the raw monotonic difference before rounding; negative is invalid. */
function readDurationMs(rawMs: number | null): number | null {
  return rawMs !== null && Number.isFinite(rawMs) && rawMs >= 0
    ? Math.round(rawMs)
    : null;
}

export function recordHostedDeliveryCommittedBestEffort(input: {
  context?: HostedDeliveryTraceContext | null;
  intent: Pick<AssistantOutboxIntent, "answeredMailboxItemIds" | "delivery" | "status" | "sentAt">;
}): void {
  const context = input.context;
  const port = context?.latencyTracePort;
  if (!context || !port || input.intent.status !== "sent" || !input.intent.delivery) return;
  const source = readHostedIngressLatencySource(input.intent.delivery.channel);
  const sentAt = input.intent.sentAt;
  if (!source || !sentAt || !Number.isFinite(Date.parse(sentAt))) return;
  const ids = [...new Set(input.intent.answeredMailboxItemIds)];
  const checkpointPublicationExpectedBy = new Date(
    resolveHostedRuntimeCheckpointPublicationExpectedByMs({
      checkpointStartByMs: Date.parse(sentAt)
        + resolveHostedRuntimeIdleCheckpointDelayMs(context.runnerIdleTtlMs),
      commitTimeoutMs: context.commitTimeoutMs ?? null,
    }),
  ).toISOString();
  queueMicrotask(() => {
    void (async () => {
      await waitForHostedStagedLatencyTraceWrites();
      for (let offset = 0; offset < ids.length; offset += HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS) {
        await recordLatencyTraceWithRetries(port, {
          event: {
            type: "delivery_committed",
            mailboxItemIds: ids.slice(offset, offset + HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS),
            at: sentAt,
            checkpointPublicationExpectedBy,
            runtimeAttemptId: context.runtimeAttemptId,
            source,
          },
        });
      }
    })().catch(() => {
      // Completion telemetry must never change delivery or checkpoint ownership.
    });
  });
}
