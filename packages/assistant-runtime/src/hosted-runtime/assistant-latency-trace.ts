import type {
  HostedIngressLatencySource,
  HostedRuntimeAssistantMilestone,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedRuntimePlatform } from "./platform.ts";

const HOSTED_ASSISTANT_MILESTONE_TRACE_RETRY_DELAYS_MS = [250, 1_000] as const;

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
    void Promise.all(input.milestones.map(async ({ at, milestone }) => {
      const request = {
        event: {
          assistantInputIds,
          at,
          milestone,
          runtimeAttemptId: context.runtimeAttemptId,
          source: context.source,
          type: "assistant_milestone" as const,
        },
      };
      let response = await latencyTracePort.record(request);
      for (const delayMs of HOSTED_ASSISTANT_MILESTONE_TRACE_RETRY_DELAYS_MS) {
        if (response.unmatchedCount === 0) {
          return;
        }
        await sleep(delayMs);
        response = await latencyTracePort.record(request);
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
