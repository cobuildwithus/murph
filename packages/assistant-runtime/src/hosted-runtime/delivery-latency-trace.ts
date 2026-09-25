import {
  HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
  readHostedIngressLatencySource,
} from "@murphai/hosted-execution/runtime-control";
import type { AssistantOutboxIntent } from "@murphai/operator-config/assistant-cli-contracts";

import type { HostedRuntimePlatform } from "./platform.ts";
import { recordLatencyTraceWithRetries } from "./assistant-latency-trace.ts";
import {
  resolveHostedRuntimeCheckpointPublicationExpectedByMs,
  resolveHostedRuntimeIdleCheckpointDelayMs,
} from "./checkpoint-publication.ts";

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
