import {
  normalizeHostedExecutionErrorMessage,
  normalizeHostedExecutionOperatorMessage,
} from "@murphai/hosted-execution";

const HOSTED_EXECUTION_WORKFLOW_ID_PATTERN = /\bhosted-user-runtime:[A-Za-z0-9._:-]+/gu;
const HOSTED_EXECUTION_DIRECT_ID_PATTERN = /\b(?:member|user)_[A-Za-z0-9._:-]+/gu;

export interface HostedExecutionSafeLogErrorDetails {
  errorCode: string;
  errorMessage: string;
  errorType: string;
  errorCauseMessage?: string;
  errorCauseType?: string;
}

export function formatHostedExecutionSafeLogError(error: unknown): string {
  return redactHostedExecutionSafeLogIdentifiers(
    normalizeHostedExecutionOperatorMessage(
      normalizeHostedExecutionErrorMessage(error),
    ),
  );
}

export function formatHostedExecutionSafeLogErrorDetails(
  error: unknown,
  options: {
    code?: string | null;
  } = {},
): HostedExecutionSafeLogErrorDetails {
  const cause = error instanceof Error ? error.cause : undefined;

  return {
    errorCode: normalizeHostedExecutionSafeLogCode(options.code)
      ?? describeHostedExecutionSafeLogErrorCode(error),
    errorMessage: formatHostedExecutionSafeLogError(error),
    errorType: describeHostedExecutionSafeLogErrorType(error),
    ...(cause === undefined
      ? {}
      : {
          errorCauseMessage: formatHostedExecutionSafeLogError(cause),
          errorCauseType: describeHostedExecutionSafeLogErrorType(cause),
        }),
  };
}

export function describeHostedExecutionSafeLogErrorCode(error: unknown): string {
  if (error instanceof Error) {
    return normalizeHostedExecutionSafeLogCode(error.name) ?? "UnknownError";
  }

  return normalizeHostedExecutionSafeLogCode(describeHostedExecutionSafeLogErrorType(error))
    ?? "UnknownError";
}

function describeHostedExecutionSafeLogErrorType(error: unknown): string {
  if (error instanceof Error) {
    const constructorName = error.constructor?.name;
    return normalizeHostedExecutionSafeLogCode(constructorName)
      ?? normalizeHostedExecutionSafeLogCode(error.name)
      ?? "Error";
  }

  if (Array.isArray(error)) {
    return "array";
  }

  return error === null ? "null" : typeof error;
}

function normalizeHostedExecutionSafeLogCode(value: string | null | undefined): string | null {
  const normalized = value?.trim();

  return normalized
    && normalized.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)
    ? normalized
    : null;
}

function redactHostedExecutionSafeLogIdentifiers(value: string): string {
  return value
    .replace(HOSTED_EXECUTION_WORKFLOW_ID_PATTERN, "hosted-user-runtime:<redacted-id>")
    .replace(HOSTED_EXECUTION_DIRECT_ID_PATTERN, (match) => {
      const prefix = match.startsWith("member_") ? "member" : "user";
      return `${prefix}_<redacted-id>`;
    });
}
