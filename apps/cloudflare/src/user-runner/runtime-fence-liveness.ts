import type {
  HostedExecutionContainerNamespaceLike,
} from "../runner-container.js";
import type {
  WorkerActiveRuntimeUserFenceResult,
} from "../worker-contracts.js";
import {
  isRuntimeProcessingCommandBudgetTimeout,
  runRuntimeProcessingCommandStep,
  type RuntimeProcessingCommandBudget,
} from "./runtime-command-budget.js";

export type RuntimeFenceLivenessIdentity = {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
};

export type RuntimeFenceLivenessReadResult =
  | {
      outcome: "exact-active";
    }
  | {
      outcome: "inactive";
    }
  | {
      outcome: "mismatch";
    }
  | {
      error?: unknown;
      outcome: "indeterminate";
      reason:
        | "error"
        | "missing_container_binding"
        | "missing_container_name"
        | "timeout"
        | "unsupported";
    };

export function classifyRuntimeFenceLiveness(input: {
  activeRuntime: WorkerActiveRuntimeUserFenceResult;
  identity: RuntimeFenceLivenessIdentity;
}): RuntimeFenceLivenessReadResult {
  const { activeRuntime, identity } = input;
  if (!activeRuntime.active) {
    return { outcome: "inactive" };
  }
  return activeRuntime.attemptId === identity.attemptId
    && activeRuntime.leaseGeneration === identity.leaseGeneration
    && activeRuntime.userId === identity.userId
    ? { outcome: "exact-active" }
    : { outcome: "mismatch" };
}

export async function readRuntimeFenceLivenessBestEffort(input: {
  commandBudget?: RuntimeProcessingCommandBudget | null;
  identity: RuntimeFenceLivenessIdentity;
  runnerContainerName: string | null | undefined;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  stepTimeoutMs: number;
}): Promise<RuntimeFenceLivenessReadResult> {
  if (!input.runnerContainerNamespace) {
    return {
      outcome: "indeterminate",
      reason: "missing_container_binding",
    };
  }
  if (!input.runnerContainerName) {
    return {
      outcome: "indeterminate",
      reason: "missing_container_name",
    };
  }

  const container = input.runnerContainerNamespace.getByName(
    input.runnerContainerName,
  );
  if (!container.readActiveRuntimeUserFence) {
    return {
      outcome: "indeterminate",
      reason: "unsupported",
    };
  }

  try {
    const activeRuntime = input.commandBudget
      ? await runRuntimeProcessingCommandStep({
          budget: input.commandBudget,
          operation: async () => await container.readActiveRuntimeUserFence!(),
          stepTimeoutMs: input.stepTimeoutMs,
        })
      : await readRuntimeFenceLivenessWithTimeout({
          operation: async () => await container.readActiveRuntimeUserFence!(),
          timeoutMs: input.stepTimeoutMs,
        });
    if (!activeRuntime) {
      return {
        outcome: "indeterminate",
        reason: "timeout",
      };
    }
    return classifyRuntimeFenceLiveness({
      activeRuntime,
      identity: input.identity,
    });
  } catch (error) {
    return {
      error,
      outcome: "indeterminate",
      reason: isRuntimeProcessingCommandBudgetTimeout(error)
        ? "timeout"
        : "error",
    };
  }
}

async function readRuntimeFenceLivenessWithTimeout(input: {
  operation: () => Promise<WorkerActiveRuntimeUserFenceResult>;
  timeoutMs: number;
}): Promise<WorkerActiveRuntimeUserFenceResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.operation(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), input.timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
