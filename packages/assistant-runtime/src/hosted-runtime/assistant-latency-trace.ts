import type {
  HostedIngressLatencySource,
  HostedRuntimeAssistantMilestone,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedRuntimePlatform } from "./platform.ts";

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
      for (const delayMs of HOSTED_ASSISTANT_MILESTONE_TRACE_RETRY_DELAYS_MS) {
        if (delayMs > 0) await sleep(delayMs);
        try {
          const response = await latencyTracePort.record(request);
          if (response.unmatchedCount === 0) return;
        } catch {
          // Transport failures share the same finite retry budget as late staging.
        }
      }
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

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
