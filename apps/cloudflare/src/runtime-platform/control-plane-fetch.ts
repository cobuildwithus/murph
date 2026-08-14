import {
  deriveHostedExecutionErrorCode,
  type HostedExecutionErrorCode,
} from "@murphai/hosted-execution";

import { isHostedRuntimeInternalAuthorityRejectedError } from "./authority-headers.ts";

export const HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS = 2;
const HOSTED_REPLAY_SAFE_READ_RETRY_DELAY_MS = 100;
const HOSTED_RUNTIME_CONTROL_PLANE_FETCH_FAILURE_MARKER =
  "hostedRuntimeControlPlaneFetchFailure";
const HOSTED_RUNTIME_FETCH_CAUSE_NAMES = new Set([
  "AbortError",
  "Error",
  "TimeoutError",
  "TypeError",
]);

export type HostedRuntimeControlPlaneFetchCauseKind =
  | "abort"
  | "cloudflare_rpc_destroy"
  | "fetch_failed"
  | "network"
  | "timeout"
  | "unknown";

export interface HostedRuntimeControlPlaneFetchFailureDiagnostics {
  fetchCallerSignalAborted: boolean;
  fetchCauseCode: HostedExecutionErrorCode;
  fetchCauseKind: HostedRuntimeControlPlaneFetchCauseKind;
  fetchCauseName?: string;
  fetchRequestSignalAborted: boolean;
  fetchTimeoutMs: number;
  fetchTimeoutSignalAborted: boolean;
}

interface HostedRuntimeControlPlaneFetchSignalState {
  callerSignalAborted: boolean;
  requestSignalAborted: boolean;
  timeoutMs: number;
  timeoutSignalAborted: boolean;
}

export class HostedRuntimeControlPlaneFetchError extends Error {
  readonly code: HostedExecutionErrorCode;
  readonly [HOSTED_RUNTIME_CONTROL_PLANE_FETCH_FAILURE_MARKER] = true;
  readonly hostedRuntimeFetchCallerSignalAborted: boolean;
  readonly hostedRuntimeFetchCauseCode: HostedExecutionErrorCode;
  readonly hostedRuntimeFetchCauseKind: HostedRuntimeControlPlaneFetchCauseKind;
  readonly hostedRuntimeFetchCauseName?: string;
  readonly hostedRuntimeFetchRequestSignalAborted: boolean;
  readonly hostedRuntimeFetchTimeoutMs: number;
  readonly hostedRuntimeFetchTimeoutSignalAborted: boolean;

  constructor(input: {
    cause: unknown;
    description: string;
    signalState: HostedRuntimeControlPlaneFetchSignalState;
  }) {
    super(`${input.description} request failed.`, { cause: input.cause });
    this.name = "Error";
    this.code = deriveHostedExecutionErrorCode(input.cause);
    this.hostedRuntimeFetchCauseCode = this.code;
    this.hostedRuntimeFetchCauseKind = classifyHostedRuntimeFetchCause(
      input.cause,
      input.signalState,
    );
    const causeName = readHostedRuntimeFetchCauseName(input.cause);
    if (causeName) {
      this.hostedRuntimeFetchCauseName = causeName;
    }
    this.hostedRuntimeFetchCallerSignalAborted =
      input.signalState.callerSignalAborted;
    this.hostedRuntimeFetchRequestSignalAborted =
      input.signalState.requestSignalAborted;
    this.hostedRuntimeFetchTimeoutMs = input.signalState.timeoutMs;
    this.hostedRuntimeFetchTimeoutSignalAborted =
      input.signalState.timeoutSignalAborted;
  }
}
export function readHostedRuntimeControlPlaneFetchFailureDiagnostics(
  error: unknown,
): HostedRuntimeControlPlaneFetchFailureDiagnostics | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (record[HOSTED_RUNTIME_CONTROL_PLANE_FETCH_FAILURE_MARKER] === true) {
      const fetchCauseKind = readHostedRuntimeFetchCauseKind(
        record.hostedRuntimeFetchCauseKind,
      );
      const fetchCauseCode = readHostedRuntimeFetchCauseCode(
        record.hostedRuntimeFetchCauseCode,
      );
      const fetchTimeoutMs = readHostedRuntimeFetchTimeoutMs(
        record.hostedRuntimeFetchTimeoutMs,
      );
      const fetchCallerSignalAborted =
        readHostedRuntimeFetchBoolean(record.hostedRuntimeFetchCallerSignalAborted);
      const fetchRequestSignalAborted =
        readHostedRuntimeFetchBoolean(record.hostedRuntimeFetchRequestSignalAborted);
      const fetchTimeoutSignalAborted =
        readHostedRuntimeFetchBoolean(record.hostedRuntimeFetchTimeoutSignalAborted);
      if (
        fetchCauseKind
        && fetchCauseCode
        && fetchTimeoutMs !== null
        && fetchCallerSignalAborted !== null
        && fetchRequestSignalAborted !== null
        && fetchTimeoutSignalAborted !== null
      ) {
        const fetchCauseName = readHostedRuntimeFetchCauseNameValue(
          record.hostedRuntimeFetchCauseName,
        );
        return {
          fetchCallerSignalAborted,
          fetchCauseCode,
          fetchCauseKind,
          ...(fetchCauseName ? { fetchCauseName } : {}),
          fetchRequestSignalAborted,
          fetchTimeoutMs,
          fetchTimeoutSignalAborted,
        };
      }
    }

    current = "cause" in record ? record.cause : null;
  }

  return null;
}
export function combineAbortSignalsWithCleanup(
  first: AbortSignal | null,
  second: AbortSignal,
): {
  dispose(): void;
  signal: AbortSignal;
} {
  if (!first) {
    return {
      dispose: () => undefined,
      signal: second,
    };
  }

  if (first.aborted) {
    return {
      dispose: () => undefined,
      signal: first,
    };
  }

  if (second.aborted) {
    return {
      dispose: () => undefined,
      signal: second,
    };
  }

  const controller = new AbortController();
  let disposed = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    first.removeEventListener("abort", abortFirst);
    second.removeEventListener("abort", abortSecond);
  };
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
    dispose();
  };
  const abortFirst = () => abort(first);
  const abortSecond = () => abort(second);
  first.addEventListener("abort", abortFirst, { once: true });
  second.addEventListener("abort", abortSecond, { once: true });
  return {
    dispose,
    signal: controller.signal,
  };
}

function classifyHostedRuntimeFetchCause(
  error: unknown,
  signalState: HostedRuntimeControlPlaneFetchSignalState,
): HostedRuntimeControlPlaneFetchCauseKind {
  const message = readHostedRuntimeFetchCauseMessage(error).toLowerCase();
  const causeName = error instanceof Error ? error.name : "";

  if (message === "the rpc call destroy() was called") {
    return "cloudflare_rpc_destroy";
  }

  if (
    signalState.timeoutSignalAborted
    || causeName === "TimeoutError"
    || message.includes("timed out")
    || message.includes("timeout")
  ) {
    return "timeout";
  }

  if (
    signalState.callerSignalAborted
    || causeName === "AbortError"
    || message.includes("abort")
  ) {
    return "abort";
  }

  if (
    message.includes("network")
    || message.includes("socket")
    || message.includes("connection reset")
  ) {
    return "network";
  }

  if (error instanceof TypeError || message.includes("fetch failed")) {
    return "fetch_failed";
  }

  return "unknown";
}

export function shouldPreserveHostedRuntimeFetchError(error: unknown): boolean {
  if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
    return true;
  }

  const message = readHostedRuntimeFetchCauseMessage(error).toLowerCase();
  return message.includes("missing a runtime write-fence authority")
    || message.includes("hosted web control-plane baseurl")
    || message.includes("must not include a path");
}

function readHostedRuntimeFetchCauseMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }

  if (typeof error === "string") {
    return error.trim();
  }

  return "";
}

function readHostedRuntimeFetchCauseName(error: unknown): string | null {
  return error instanceof Error
    ? readHostedRuntimeFetchCauseNameValue(error.name)
    : null;
}

function readHostedRuntimeFetchCauseNameValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return HOSTED_RUNTIME_FETCH_CAUSE_NAMES.has(normalized) ? normalized : null;
}

function readHostedRuntimeFetchCauseKind(
  value: unknown,
): HostedRuntimeControlPlaneFetchCauseKind | null {
  switch (value) {
    case "abort":
    case "cloudflare_rpc_destroy":
    case "fetch_failed":
    case "network":
    case "timeout":
    case "unknown":
      return value;
    default:
      return null;
  }
}

function readHostedRuntimeFetchCauseCode(
  value: unknown,
): HostedExecutionErrorCode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  switch (normalized) {
    case "authorization_error":
    case "bundle_archive_validation_error":
    case "checkpoint_error":
    case "configuration_error":
    case "invalid_request":
    case "outbox_error":
    case "range_error":
    case "reference_error":
    case "runner_http_error":
    case "runtime_error":
    case "syntax_error":
    case "timeout":
    case "type_error":
    case "uri_error":
      return normalized;
    default:
      return null;
  }
}

function readHostedRuntimeFetchBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readHostedRuntimeFetchTimeoutMs(value: unknown): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= 3_600_000
    ? value
    : null;
}

export function shouldRetryHostedRuntimeReplaySafeRead(input: {
  attempt: number;
  error: unknown;
}): boolean {
  if (input.attempt >= HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS) {
    return false;
  }

  return isRetryableHostedRuntimeReplaySafeReadTransportError(input.error);
}

export function isRetryableHostedRuntimeReplaySafeReadTransportError(
  error: unknown,
): boolean {
  if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
    return false;
  }

  // Once response headers establish an application status, a transport loss
  // while reading its optional body must not turn that known rejection into a
  // replay-safe request failure.
  if (readHostedWebControlErrorStatus(error) !== null) {
    return false;
  }

  const diagnostics = readHostedRuntimeControlPlaneFetchFailureDiagnostics(error);
  if (diagnostics) {
    if (
      diagnostics.fetchCallerSignalAborted
      || diagnostics.fetchRequestSignalAborted
      || diagnostics.fetchTimeoutSignalAborted
    ) {
      return false;
    }

    return diagnostics.fetchCauseKind === "cloudflare_rpc_destroy"
      || diagnostics.fetchCauseKind === "fetch_failed"
      || diagnostics.fetchCauseKind === "network";
  }

  if (isHostedWebControlAbortError(error) || isHostedWebControlTimeoutError(error)) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.trim().toLowerCase();
  return message === "fetch failed"
    || message === "the rpc call destroy() was called"
    || message.includes(" fetch failed")
    || message.includes("network")
    || message.includes("socket")
    || message.includes("connection reset");
}

export function isRetryableHostedWebControlReadError(error: unknown): boolean {
  if (isHostedRuntimeInternalAuthorityRejectedError(error)) {
    return false;
  }

  if (isHostedWebControlAbortError(error)) {
    return false;
  }

  const status = readHostedWebControlErrorStatus(error);
  if (status !== null) {
    return status === 408 || status === 429 || status === 500 || status === 502
      || status === 503 || status === 504;
  }

  if (isHostedWebControlTimeoutError(error)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.trim().toLowerCase();
  return message === "fetch failed"
    || message.includes(" fetch failed")
    || message.includes("request failed")
    || message.includes("network")
    || message.includes("socket")
    || message.includes("connection reset");
}

function isHostedWebControlAbortError(error: unknown): boolean {
  return hasHostedWebControlErrorName(error, "AbortError");
}

function isHostedWebControlTimeoutError(error: unknown): boolean {
  return hasHostedWebControlErrorName(error, "TimeoutError");
}

function hasHostedWebControlErrorName(error: unknown, name: "AbortError" | "TimeoutError"): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);

    if (current instanceof Error && current.name === name) {
      return true;
    }

    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }

  return false;
}

function readHostedWebControlErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  for (const property of ["status", "statusCode", "responseStatus"] as const) {
    const value = (error as Partial<Record<typeof property, unknown>>)[property];
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return value;
    }
  }

  return null;
}

export function sleepHostedReplaySafeReadRetryDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, HOSTED_REPLAY_SAFE_READ_RETRY_DELAY_MS);
  });
}
