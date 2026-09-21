import {
  HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS,
  HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedIngressLatencySource,
  HostedRuntimeAssistantMilestone,
  HostedRuntimeLatencyTraceAssistantMilestoneEvent,
  HostedRuntimeLatencyTraceRequest,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedRuntimePlatform } from "./platform.ts";

// Keep completion/deadline dependencies in the delivery-only module so shared
// channel tracing does not add chunks to the runner boot graph.
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
  const events: HostedRuntimeLatencyTraceAssistantMilestoneEvent[] = input.milestones.map(({ at, checkpointPublicationExpectedBy, milestone }) => ({
    at,
    ...(checkpointPublicationExpectedBy === undefined ? {} : { checkpointPublicationExpectedBy }),
    milestone,
    assistantInputIds,
    runtimeAttemptId: context.runtimeAttemptId,
    source: context.source,
    type: "assistant_milestone",
  }));
  queueMicrotask(() => {
    void recordMilestoneEvents(latencyTracePort, events).catch(() => {
      // Latency traces are diagnostic-only and must not affect runtime progress.
    });
  });
}

async function recordMilestoneEvents(
  port: NonNullable<HostedRuntimePlatform["latencyTracePort"]>,
  events: HostedRuntimeLatencyTraceAssistantMilestoneEvent[],
): Promise<void> {
  if (!port.recordBatch || events.length === 1) {
    await Promise.all(events.map(async event => {
      if (!await recordLatencyTraceWithRetries(port, { event })) warnExhaustedTyping(event);
    }));
    return;
  }
  // Only coalesce this already-available array: no timer, queue or shutdown buffer.
  const batches: HostedRuntimeLatencyTraceAssistantMilestoneEvent[][] = [];
  for (const event of events) {
    const batch = batches.at(-1);
    if (!batch || batch.length >= HOSTED_RUNTIME_LATENCY_TRACE_BATCH_MAX_EVENTS
      || new TextEncoder().encode(JSON.stringify({ events: [...batch, event] })).byteLength
        > HOSTED_RUNTIME_LATENCY_TRACE_BODY_LIMIT_BYTES) {
      batches.push([event]);
    } else {
      batch.push(event);
    }
  }
  await Promise.all(batches.map(async batch => {
    let pending = batch;
    for (const delayMs of HOSTED_ASSISTANT_MILESTONE_TRACE_RETRY_DELAYS_MS) {
      if (pending.length === 0) return;
      if (delayMs > 0) await sleep(delayMs);
      try {
        const results = pending.length === 1
          ? [await port.record({ event: pending[0]! })]
          : (await port.recordBatch!({ events: pending })).results;
        if (results.length !== pending.length) continue;
        pending = pending.filter((_event, index) => results[index]?.unmatchedCount !== 0);
      } catch {
        // Preserve the current per-event retry budget on transport/persistence failure.
      }
    }
    pending.forEach(warnExhaustedTyping);
  }));
}

function warnExhaustedTyping(event: HostedRuntimeLatencyTraceAssistantMilestoneEvent): void {
  if (event.milestone === "linq_typing_accepted" || event.milestone === "telegram_typing_accepted") {
    console.warn("Hosted typing acceptance telemetry exhausted its retry budget.", {
      source: event.source,
      inputCount: event.assistantInputIds.length,
    });
  }
}

export async function recordLatencyTraceWithRetries(
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

export function guardHostedRuntimeLatencyTracePort(
  port: NonNullable<HostedRuntimePlatform["latencyTracePort"]>,
  guard: <T>(run: () => Promise<T>) => Promise<T>,
): NonNullable<HostedRuntimePlatform["latencyTracePort"]> {
  return {
    record: request => guard(() => port.record(request)),
    ...(port.recordBatch ? {
      recordBatch: request => guard(() => port.recordBatch!(request)),
    } : {}),
  };
}
