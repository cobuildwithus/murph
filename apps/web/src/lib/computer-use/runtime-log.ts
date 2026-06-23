import type {
  HostedComputerActRequest,
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
  | "pause-for-user"
  | "start-run";

const HOSTED_COMPUTER_TOOL_FAILURE_EVENT_CODE = "assistant.computer_tool_failed";
const HOSTED_COMPUTER_UNEXPECTED_FAILURE_CODE = "HOSTED_COMPUTER_UNEXPECTED_FAILURE";

export async function withHostedComputerToolFailureRuntimeLog<Result>(input: {
  action?: HostedComputerActRequest | null;
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
  action: HostedComputerActRequest | null;
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
  action: HostedComputerActRequest | null;
  error: unknown;
  errorCode: string;
  operation: HostedComputerToolOperation;
}): HostedRuntimeRedactedJson {
  const domainError = isHostedOnboardingError(input.error) ? input.error : null;
  const details = domainError?.details ?? {};
  const action = input.action;

  return {
    computerOperationKind: input.operation,
    ...(action ? { browserActionKind: action.action } : {}),
    ...(action && "locator" in action && action.locator
      ? { computerLocatorType: action.locator.by }
      : {}),
    ...readHostedComputerToolTiming(action),
    ...(domainError ? { httpStatus: domainError.httpStatus } : {}),
    ...(domainError ? { retryable: domainError.retryable } : {}),
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

function readHostedComputerToolTiming(
  action: HostedComputerActRequest | null,
): HostedRuntimeRedactedJson {
  if (!action) {
    return {};
  }
  if (action.action === "wait") {
    return { waitMs: action.ms };
  }
  return { timeoutMs: action.timeoutMs };
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
