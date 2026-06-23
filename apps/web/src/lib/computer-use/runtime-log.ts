import type {
  HostedComputerActRequest,
} from "@murphai/hosted-execution/computer-use";
import {
  buildHostedExecutionSafeErrorDetails,
  normalizeHostedExecutionOperatorMessage,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { recordHostedRuntimeLog } from "../hosted-workspace/store";
import { shortHash } from "./ids";

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
    ...(action ? { playwrightCodeHash: shortHash(action.code) } : {}),
    ...readHostedComputerToolTiming(action),
    ...(domainError ? { httpStatus: domainError.httpStatus } : {}),
    ...(domainError ? { retryable: domainError.retryable } : {}),
    kernelErrorPresent: details.kernelErrorPresent === true,
    kernelStderrPresent: details.kernelStderrPresent === true,
    kernelStdoutPresent: details.kernelStdoutPresent === true,
    ...readSafeComputerErrorSummary(input.error),
    unknownOutcome: isHostedComputerUnknownOutcomeFailure({
      errorCode: input.errorCode,
      httpStatus: domainError?.httpStatus ?? null,
    }),
  };
}

function readSafeComputerErrorSummary(error: unknown): HostedRuntimeRedactedJson {
  const safeMessage = normalizeHostedExecutionOperatorMessage(
    error instanceof Error ? error.message : String(error),
  );
  const details = buildHostedExecutionSafeErrorDetails(error);
  const detail = readSafeComputerErrorDetail(details, "errorDetail");
  const cause = readSafeComputerErrorDetail(details, "errorCause");

  return {
    safeErrorMessage: safeMessage,
    ...(detail && detail !== safeMessage ? { computerErrorDetail: detail } : {}),
    ...(cause && cause !== safeMessage && cause !== detail
      ? { computerErrorCause: cause }
      : {}),
  };
}

function readSafeComputerErrorDetail(
  details: Record<string, unknown> | null,
  key: "errorCause" | "errorDetail",
): string | null {
  const value = details?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function readHostedComputerToolTiming(
  action: HostedComputerActRequest | null,
): HostedRuntimeRedactedJson {
  if (!action) {
    return {};
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
