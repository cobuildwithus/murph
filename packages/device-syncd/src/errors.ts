import { sanitizeHostedRuntimeErrorText } from "./hosted-runtime.ts";

export interface DeviceSyncErrorOptions {
  code: string;
  message: string;
  retryable?: boolean;
  httpStatus?: number;
  accountStatus?: "reauthorization_required" | "disconnected" | null;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class DeviceSyncError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly accountStatus: "reauthorization_required" | "disconnected" | null;
  readonly details: Record<string, unknown> | undefined;

  constructor(options: DeviceSyncErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DeviceSyncError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? 500;
    this.accountStatus = options.accountStatus ?? null;
    this.details = options.details;
  }
}

export function deviceSyncError(options: DeviceSyncErrorOptions): DeviceSyncError {
  return new DeviceSyncError(options);
}

export function isDeviceSyncError(error: unknown): error is DeviceSyncError {
  return error instanceof DeviceSyncError;
}

export function formatDeviceSyncStartupError(error: unknown): string {
  if (isDeviceSyncError(error)) {
    const message = sanitizeHostedRuntimeErrorText(error.message) ?? "[redacted]";
    return `${error.name} ${error.code}: ${message}`;
  }

  if (error instanceof Error) {
    const message = sanitizeHostedRuntimeErrorText(error.message) ?? "[redacted]";
    const cause = summarizeStartupErrorCause(error);
    return `${error.name} UNEXPECTED_ERROR: ${cause ? `${message} | cause: ${cause}` : message}`;
  }

  return `NON_ERROR_THROW: ${sanitizeHostedRuntimeErrorText(String(error)) ?? "[redacted]"}`;
}

export function buildPublicDeviceSyncErrorPayload(error: DeviceSyncError): {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
} {
  return {
    error: {
      code: error.code,
      message: sanitizeHostedRuntimeErrorText(error.message) ?? "Request failed.",
      retryable: error.retryable,
      details: buildPublicDeviceSyncErrorDetails(error.details),
    },
  };
}

function buildPublicDeviceSyncErrorDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const status = readDeviceSyncErrorStatusDetail(details);
  return status === null ? undefined : { status };
}

function readDeviceSyncErrorStatusDetail(
  details: Record<string, unknown> | undefined,
): number | null {
  if (!details) {
    return null;
  }

  const statusValue = details.status;
  const status =
    typeof statusValue === "number"
      ? statusValue
      : typeof statusValue === "string" && statusValue.trim()
        ? Number(statusValue)
        : Number.NaN;

  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function summarizeStartupErrorCause(error: Error): string | null {
  const cause = error.cause;

  if (!(cause instanceof Error)) {
    return null;
  }

  const message = sanitizeHostedRuntimeErrorText(cause.message);
  if (!message) {
    return null;
  }

  const code = readErrorCode(cause);
  return code ? `${cause.name} ${code}: ${message}` : `${cause.name}: ${message}`;
}

function readErrorCode(error: Error): string | null {
  if (!("code" in error)) {
    return null;
  }

  const value = error.code;
  return typeof value === "string" && value.length > 0
    ? sanitizeHostedRuntimeErrorText(value)?.replace(/\s+/gu, "_") ?? null
    : null;
}
