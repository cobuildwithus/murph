import {
  DEFAULT_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS,
  HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
} from "@murphai/hosted-execution/contracts";

export const RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE =
  "Hosted runner runtime processing command budget timed out.";

export interface RuntimeProcessingCommandBudget {
  deadlineAtMs: number;
}

export function createRuntimeProcessingCommandBudget(input: {
  commandTimeoutMs: number | null;
  startedAtMs: number;
  webControlTimeoutMs: number;
}): RuntimeProcessingCommandBudget {
  const effectiveTimeoutMs = Math.min(
    input.webControlTimeoutMs,
    input.commandTimeoutMs ?? DEFAULT_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS,
  );
  return {
    deadlineAtMs:
      input.startedAtMs + effectiveTimeoutMs - HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
  };
}

export function readRuntimeProcessingCommandStepTimeoutMs(input: {
  budget: RuntimeProcessingCommandBudget;
  stepTimeoutMs: number;
}): number {
  const remainingMs = input.budget.deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    throw createRuntimeProcessingCommandBudgetTimeoutError();
  }
  return Math.max(1, Math.min(input.stepTimeoutMs, remainingMs));
}

export async function runRuntimeProcessingCommandStep<T>(input: {
  budget: RuntimeProcessingCommandBudget;
  operation: () => Promise<T>;
  stepTimeoutMs: number;
}): Promise<T> {
  const timeoutMs = readRuntimeProcessingCommandStepTimeoutMs({
    budget: input.budget,
    stepTimeoutMs: input.stepTimeoutMs,
  });
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(createRuntimeProcessingCommandBudgetTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([input.operation(), timeout]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export function isRuntimeProcessingCommandBudgetTimeout(error: unknown): boolean {
  return error instanceof Error
    && error.message === RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE;
}

function createRuntimeProcessingCommandBudgetTimeoutError(): Error {
  return new Error(RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE);
}
