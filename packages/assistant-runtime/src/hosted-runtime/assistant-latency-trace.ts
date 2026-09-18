import {
  HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
  readHostedIngressLatencySource,
  type HostedIngressLatencySource,
  type HostedRuntimeAssistantMilestone,
  type HostedRuntimeLatencyTraceRequest,
} from "@murphai/hosted-execution/runtime-control";

import type { AssistantOutboxIntent } from "@murphai/operator-config/assistant-cli-contracts";

import type { HostedRuntimePlatform } from "./platform.ts";
import {
  resolveHostedRuntimeCheckpointPublicationExpectedByMs,
  resolveHostedRuntimeIdleCheckpointDelayMs,
} from "./checkpoint-publication.ts";

const HOSTED_ASSISTANT_MILESTONE_TRACE_RETRY_DELAYS_MS = [0, 250, 1_000] as const;

export interface HostedAssistantMilestoneTraceContext {
  assistantInputIds: readonly string[];
  latencyTracePort: HostedRuntimePlatform["latencyTracePort"];
  runtimeAttemptId: string;
  source: HostedIngressLatencySource;
}

export function recordHostedAssistantMilestonesBestEffort(input: {
  context?: HostedAssistantMilestoneTraceContext | null;
  milestones: readonly {
    at: string;
    checkpointPublicationExpectedBy?: string | null;
    milestone: HostedRuntimeAssistantMilestone;
  }[];
}): void {
  const context = input.context;
  const latencyTracePort = context?.latencyTracePort ?? null;
  if (
    !context
    || !latencyTracePort
    || context.assistantInputIds.length === 0
    || input.milestones.length === 0
  ) {
    return;
  }

  const assistantInputIds = [...new Set(context.assistantInputIds)];
  queueMicrotask(() => {
    void Promise.all(input.milestones.map(async ({
      at,
      checkpointPublicationExpectedBy,
      milestone,
    }) => {
      const request = {
        event: {
          assistantInputIds,
          at,
          ...(checkpointPublicationExpectedBy === undefined
            ? {}
            : { checkpointPublicationExpectedBy }),
          milestone,
          runtimeAttemptId: context.runtimeAttemptId,
          source: context.source,
          type: "assistant_milestone" as const,
        },
      };
      if (await recordLatencyTraceWithRetries(latencyTracePort, request)) return;
      if (milestone === "linq_typing_accepted" || milestone === "telegram_typing_accepted") {
        console.warn("Hosted typing acceptance telemetry exhausted its retry budget.", {
          source: context.source,
          inputCount: assistantInputIds.length,
        });
      }
    })).catch(() => {
      // Latency traces are diagnostic-only and must not affect runtime progress.
    });
  });
}

export interface HostedDeliveryTraceContext {
  latencyTracePort: HostedRuntimePlatform["latencyTracePort"];
  runtimeAttemptId: string;
  runnerIdleTtlMs?: number | null;
  commitTimeoutMs?: number | null;
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

async function recordLatencyTraceWithRetries(
  port: NonNullable<HostedRuntimePlatform["latencyTracePort"]>,
  request: HostedRuntimeLatencyTraceRequest,
): Promise<boolean> {
  for (const delayMs of HOSTED_ASSISTANT_MILESTONE_TRACE_RETRY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const response = await port.record(request);
      if (response.unmatchedCount === 0) return true;
    } catch {
      // Transport failures share the same finite retry budget as late staging.
    }
  }
  return false;
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
