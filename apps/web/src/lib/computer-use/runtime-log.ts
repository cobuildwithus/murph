import type {
  HostedComputerActRequest,
  HostedComputerOsControlRequest,
} from "@murphai/hosted-execution/computer-use";
import { after } from "next/server";
import {
  buildHostedExecutionSafeErrorDetails,
  normalizeHostedExecutionOperatorMessage,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { writeHostedRuntimeLogs } from "../hosted-runtime-log/write";
import { shortHash } from "./ids";

type HostedComputerToolOperation =
  | "act"
  | "finish"
  | "managed-login"
  | "open"
  | "os-control"
  | "pause-for-user";
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
  const startedAt = performance.now();
  try {
    return await input.run();
  } catch (error) {
    scheduleHostedComputerToolFailureRuntimeLog({
      action: input.action ?? null,
      error,
      elapsedMs: Math.round(performance.now() - startedAt),
      memberId: input.memberId,
      operation: input.operation,
    });
    throw error;
  }
}

function scheduleHostedComputerToolFailureRuntimeLog(input: {
  action: HostedComputerToolAction | null;
  error: unknown;
  elapsedMs: number;
  memberId: string;
  operation: HostedComputerToolOperation;
}): void {
  const task = async () => {
    await recordHostedComputerToolFailureBestEffort(input);
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

async function recordHostedComputerToolFailureBestEffort(input: {
  action: HostedComputerToolAction | null;
  error: unknown;
  elapsedMs: number;
  memberId: string;
  operation: HostedComputerToolOperation;
}): Promise<void> {
  try {
    const errorCode = readHostedComputerToolErrorCode(input.error);
    await writeHostedRuntimeLogs({
      entries: [{
        at: new Date().toISOString(),
        component: "assistant",
        errorCode,
        eventCode: HOSTED_COMPUTER_TOOL_FAILURE_EVENT_CODE,
        level: "warn",
        phase: "error",
        redactedJson: buildHostedComputerToolFailureRedactedJson({
          action: input.action,
          error: input.error,
          errorCode,
          elapsedMs: input.elapsedMs,
          operation: input.operation,
        }),
      }],
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
  elapsedMs: number;
  operation: HostedComputerToolOperation;
}): HostedRuntimeRedactedJson {
  const domainError = isHostedOnboardingError(input.error) ? input.error : null;
  const details = domainError?.details ?? {};
  const action = input.action;

  return {
    computerOperationKind: input.operation,
    computerOperationElapsedMs: input.elapsedMs,
    ...readHostedComputerToolActionDetail({
      action,
      operation: input.operation,
    }),
    ...readHostedComputerToolTiming({
      action,
      operation: input.operation,
    }),
    ...(domainError ? { httpStatus: domainError.httpStatus } : {}),
    ...(domainError ? { retryable: domainError.retryable } : {}),
    ...readHostedComputerManagedLoginDetail(details),
    ...readHostedComputerLiveViewValidationDetail(details),
    ...readHostedComputerToolFailureCategory(details, input.error instanceof Error ? input.error.message : null),
    ...readHostedComputerProviderDiagnostics(input.error, details),
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

function readHostedComputerManagedLoginDetail(
  details: Record<string, unknown>,
): HostedRuntimeRedactedJson {
  const causeCode = details.managedLoginCauseCode;
  const stage = details.managedLoginStage;
  return {
    ...(typeof causeCode === "string"
        && /^HOSTED_COMPUTER_[A-Z0-9_]+$/u.test(causeCode)
      ? { managedLoginCauseCode: causeCode }
      : {}),
    ...(stage === "live_view_fallback" || stage === "managed_auth_start"
      ? { managedLoginStage: stage }
      : {}),
  };
}

function readHostedComputerLiveViewValidationDetail(
  details: Record<string, unknown>,
): HostedRuntimeRedactedJson {
  const output: HostedRuntimeRedactedJson = {};
  for (const key of [
    "liveViewHostnameAllowed",
    "liveViewParsed",
    "liveViewPortAllowed",
    "liveViewProtocolAllowed",
  ] as const) {
    if (typeof details[key] === "boolean") {
      output[key] = details[key];
    }
  }
  return output;
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

function readHostedComputerToolActionDetail(input: {
  action: HostedComputerToolAction | null;
  operation: HostedComputerToolOperation;
}): HostedRuntimeRedactedJson {
  if (!input.action) {
    return {};
  }
  if (input.operation === "os-control" && "action" in input.action) {
    return { computerOsControlKind: input.action.action };
  }
  if ("code" in input.action) {
    return { playwrightCodeHash: shortHash(input.action.code) };
  }
  return {};
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
    return { computerFailureCategory: "unclassified" };
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

  // Only provider error channels supply new evidence, never stdout or page text.
  // Match diagnostic headers, not mentions in echoed source, DOM or call logs.
  const diagnostics = [details.kernelError, details.kernelStderr]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.slice(0, 4_000).trimStart().replace(/^Error(?::[ \t]*|\n)/u, ""));
  if (diagnostics.some((value) =>
    /^(?:page\.(?:goto|reload|goBack|goForward|waitForNavigation):[ \t]*)?net::ERR_[A-Z0-9_]+\b/u.test(value)
    || /^page\.(?:goto|reload|goBack|goForward|waitForNavigation): Navigation\b[^\n]*\binterrupted by another navigation\b/u.test(value)
    || /^TypeError(?::[ \t]*|\n)(?:Failed to fetch|fetch failed)(?:\n|$)/u.test(value)
  )) {
    return { computerFailureCategory: "navigation_network_error" };
  }
  if (diagnostics.some((value) =>
    /^(?:(?:page|frame|locator|jsHandle)\.evaluate(?:Handle)?:[ \t]*)?(?:SyntaxError|ReferenceError|TypeError|RangeError|EvalError|URIError|AggregateError)(?::|\n|$)/u.test(value)
  )) {
    return { computerFailureCategory: "javascript_error" };
  }

  return { computerFailureCategory: "unclassified" };
}

function readHostedComputerProviderDiagnostics(
  error: unknown,
  details: Record<string, unknown>,
): HostedRuntimeRedactedJson {
  const output: HostedRuntimeRedactedJson = {};
  for (const key of ["kernelExecutionTimeoutMs", "kernelExecutionElapsedMs"] as const) {
    const value = details[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      output[key] = value;
    }
  }
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
    output.providerHttpStatus = status;
  }
  return output;
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
