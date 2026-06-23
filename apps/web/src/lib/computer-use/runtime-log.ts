import type {
  HostedComputerActRequest,
  HostedComputerOsControlRequest,
} from "@murphai/hosted-execution/computer-use";
import type {
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { recordHostedRuntimeLog } from "../hosted-workspace/store";

type HostedComputerToolOperation =
  | "act"
  | "finish"
  | "observe"
  | "os-control"
  | "pause-for-user"
  | "start-run";
type HostedComputerToolAction =
  | HostedComputerActRequest
  | HostedComputerOsControlRequest;

const HOSTED_COMPUTER_TOOL_FAILURE_EVENT_CODE = "assistant.computer_tool_failed";
const HOSTED_COMPUTER_UNEXPECTED_FAILURE_CODE = "HOSTED_COMPUTER_UNEXPECTED_FAILURE";

export async function withHostedComputerToolFailureRuntimeLog<Result>(input: {
  action?: HostedComputerToolAction | null;
  memberId: string;
  operation: HostedComputerToolOperation;
  run: () => Promise<Result>;
}): Promise<Result> {
  try {
    return await input.run();
  } catch (error) {
    await recordHostedComputerToolFailureBestEffort({
      action: input.action ?? null,
      error,
      memberId: input.memberId,
      operation: input.operation,
    });
    throw error;
  }
}

async function recordHostedComputerToolFailureBestEffort(input: {
  action: HostedComputerToolAction | null;
  error: unknown;
  memberId: string;
  operation: HostedComputerToolOperation;
}): Promise<void> {
  try {
    const errorCode = readHostedComputerToolErrorCode(input.error);
    await recordHostedRuntimeLog({
      component: "assistant",
      errorCode,
      eventCode: HOSTED_COMPUTER_TOOL_FAILURE_EVENT_CODE,
      level: "warn",
      phase: "error",
      redacted: buildHostedComputerToolFailureRedactedJson({
        action: input.action,
        error: input.error,
        errorCode,
        operation: input.operation,
      }),
      userId: input.memberId,
    });
  } catch (logError) {
    console.warn("Hosted computer tool failure log write failed.", {
      errorName: logError instanceof Error ? logError.name : typeof logError,
      operation: input.operation,
    });
  }
}

function buildHostedComputerToolFailureRedactedJson(input: {
  action: HostedComputerToolAction | null;
  error: unknown;
  errorCode: string;
  operation: HostedComputerToolOperation;
}): HostedRuntimeRedactedJson {
  const domainError = isHostedOnboardingError(input.error) ? input.error : null;
  const details = domainError?.details ?? {};
  const action = input.action;

  return {
    computerOperationKind: input.operation,
    ...readHostedComputerToolActionKind({
      action,
      operation: input.operation,
    }),
    ...(action && "locator" in action && action.locator
      ? { computerLocatorType: action.locator.by }
      : {}),
    ...readHostedComputerToolTiming({
      action,
      operation: input.operation,
    }),
    ...(domainError ? { httpStatus: domainError.httpStatus } : {}),
    ...(domainError ? { retryable: domainError.retryable } : {}),
    ...readHostedComputerToolFailureCategory(details, domainError?.message ?? null),
    kernelErrorPresent: typeof details.kernelError === "string" && details.kernelError.length > 0,
    kernelStderrPresent: typeof details.kernelStderr === "string" && details.kernelStderr.length > 0,
    kernelStdoutPresent: typeof details.kernelStdout === "string" && details.kernelStdout.length > 0,
    safeErrorMessage: "Hosted computer tool failed.",
    unknownOutcome: isHostedComputerUnknownOutcomeFailure({
      errorCode: input.errorCode,
      httpStatus: domainError?.httpStatus ?? null,
    }),
  };
}

function readHostedComputerToolActionKind(input: {
  action: HostedComputerToolAction | null;
  operation: HostedComputerToolOperation;
}): HostedRuntimeRedactedJson {
  if (!input.action) {
    return {};
  }
  if (input.operation === "os-control") {
    return { computerOsControlKind: input.action.action };
  }
  return { browserActionKind: input.action.action };
}

function readHostedComputerToolTiming(input: {
  action: HostedComputerToolAction | null;
  operation: HostedComputerToolOperation;
}): HostedRuntimeRedactedJson {
  if (!input.action) {
    return {};
  }
  if (input.operation === "os-control") {
    return {};
  }
  if (input.action.action === "wait" && "ms" in input.action) {
    return { waitMs: input.action.ms };
  }
  if ("timeoutMs" in input.action) {
    return { timeoutMs: input.action.timeoutMs };
  }
  return {};
}

function readHostedComputerToolFailureCategory(
  details: Record<string, unknown>,
  message: string | null,
): HostedRuntimeRedactedJson {
  const text = [
    message,
    details.kernelError,
    details.kernelStderr,
    details.kernelStdout,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();
  if (text.length === 0) {
    return {};
  }

  if (text.includes("strict mode violation")) {
    return { computerFailureCategory: "strict_mode_violation" };
  }
  if (text.includes("timeout")) {
    return { computerFailureCategory: "timeout" };
  }
  if (
    text.includes("target closed")
    || text.includes("page context closed")
    || text.includes("browser context closed")
  ) {
    return { computerFailureCategory: "browser_closed" };
  }

  return {};
}

function readHostedComputerToolErrorCode(error: unknown): string {
  return isHostedOnboardingError(error)
    ? error.code
    : HOSTED_COMPUTER_UNEXPECTED_FAILURE_CODE;
}

function isHostedComputerUnknownOutcomeFailure(input: {
  errorCode: string;
  httpStatus: number | null;
}): boolean {
  if (
    input.errorCode === "HOSTED_COMPUTER_EVAL_FAILED"
    || input.errorCode === "HOSTED_COMPUTER_ACTION_STATE_INVALID"
  ) {
    return true;
  }
  return input.httpStatus !== null && input.httpStatus >= 500;
}
