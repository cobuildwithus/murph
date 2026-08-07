import { Prisma } from "@prisma/client";

import {
  createJsonRouteHelpers,
  describeErrorForLog,
  mapDomainJsonError,
  readOptionalJsonObject as readBaseOptionalJsonObject,
  readJsonObject as readBaseJsonObject,
  readRawBodyBuffer,
  sanitizeJsonLogString,
} from "../http";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";

const HOSTED_ONBOARDING_DEFAULT_HEADERS = {
  "Cache-Control": "no-store",
} as const;
const HOSTED_ONBOARDING_SAFE_PRISMA_META_KEYS = new Set([
  "column",
  "constraint",
  "field_name",
  "modelName",
  "table",
  "target",
]);
const HOSTED_ONBOARDING_LOG_STRING_MAX_LENGTH = 240;
const HOSTED_ONBOARDING_DEVELOPMENT_LOG_STRING_MAX_LENGTH = 2_000;
const HOSTED_ONBOARDING_DEVELOPMENT_STACK_MAX_LENGTH = 6_000;
const HOSTED_ONBOARDING_DEVELOPMENT_LOG_MAX_DEPTH = 3;
const HOSTED_ONBOARDING_DEVELOPMENT_LOG_MAX_ENTRIES = 20;
const HOSTED_ONBOARDING_PERSISTED_ERROR_TOKEN_MAX_LENGTH = 128;
const HOSTED_ONBOARDING_PROVIDER_REASON_MAX_LENGTH = 256;
const HOSTED_ONBOARDING_SENSITIVE_LOG_KEY_PATTERN =
  /authorization|secret|token|password|cookie|set-cookie|api[-_]?key/iu;
const HOSTED_ONBOARDING_SAFE_DOMAIN_ERROR_DETAIL_KEYS = new Set([
  "code",
  "operationName",
  "providerErrorCode",
  "providerErrorMessage",
  "providerErrorType",
  "providerRequestIdPresent",
  "requestIdPresent",
  "stripeParam",
  "statusCode",
  "type",
]);

export const HOSTED_ONBOARDING_REDACTED_ERROR_MESSAGE = "[redacted]";

export const readJsonObject = readBaseJsonObject;
export const readOptionalJsonObject = readBaseOptionalJsonObject;

export function logHostedOnboardingRouteFailure(input: {
  error: unknown;
  operationName: string;
  requestMethod: string;
}): void {
  const errorType = input.error instanceof Error
    ? sanitizeHostedOnboardingLogString(input.error.name) ?? "Error"
    : Array.isArray(input.error)
      ? "array"
      : input.error === null
        ? "null"
        : typeof input.error;
  console.error("Hosted onboarding route failed.", {
    errorType,
    internalMessage: "Hosted onboarding route failed unexpectedly.",
    operationName:
      sanitizeHostedOnboardingLogString(input.operationName) ?? "unknown",
    requestMethod:
      sanitizeHostedOnboardingLogString(input.requestMethod) ?? "unknown",
    ...(describeErrorForLog(
      input.error,
      sanitizeHostedOnboardingLogString,
    ) ?? {}),
    ...(describeHostedOnboardingErrorForLog(input.error) ?? {}),
  });
}

export interface HostedOnboardingBoundedBodyOptions {
  limitBytes: number;
  tooLargeErrorCode: string;
  tooLargeErrorMessage: string;
}

export async function readHostedOnboardingJsonObject(
  request: Request,
  options: HostedOnboardingBoundedBodyOptions,
): Promise<Record<string, unknown>> {
  try {
    return await readBaseJsonObject(request, {
      limitBytes: options.limitBytes,
    });
  } catch (error) {
    throw mapHostedOnboardingBodyReadError(error, options);
  }
}

export async function readHostedOnboardingRawBodyText(
  request: Request,
  options: HostedOnboardingBoundedBodyOptions,
): Promise<string> {
  try {
    return (await readRawBodyBuffer(request, {
      limitBytes: options.limitBytes,
    })).toString("utf8");
  } catch (error) {
    throw mapHostedOnboardingBodyReadError(error, options);
  }
}

function mapHostedOnboardingError(error: unknown) {
  if (!isHostedOnboardingError(error)) {
    return null;
  }

  const mapping = mapDomainJsonError(error);
  const logDetails = describeHostedOnboardingDomainErrorDetailsForLog(error.details);

  return logDetails
    ? {
        ...mapping,
        log: {
          details: logDetails,
        },
      }
    : mapping;
}

function mapHostedOnboardingBodyReadError(
  error: unknown,
  options: HostedOnboardingBoundedBodyOptions,
): unknown {
  if (!(error instanceof RangeError)) {
    return error;
  }

  return hostedOnboardingError({
    code: options.tooLargeErrorCode,
    httpStatus: 413,
    message: options.tooLargeErrorMessage,
  });
}

function describeHostedOnboardingErrorForLog(error: unknown): Record<string, unknown> | null {
  const prismaDetails = describeHostedOnboardingPrismaErrorForLog(error);
  const developmentDetails = isHostedOnboardingDevelopmentLoggingEnabled()
    ? describeHostedOnboardingDevelopmentErrorForLog(error)
    : null;

  if (prismaDetails || developmentDetails) {
    return {
      ...(prismaDetails ?? {}),
      ...(developmentDetails ?? {}),
    };
  }

  return null;
}

function describeHostedOnboardingDomainErrorDetailsForLog(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!details) {
    return null;
  }

  const safeDetails = Object.entries(details).flatMap(([key, value]) => {
    if (!HOSTED_ONBOARDING_SAFE_DOMAIN_ERROR_DETAIL_KEYS.has(key)) {
      return [];
    }

    const safeValue = sanitizeHostedOnboardingDomainErrorDetailValue(value);
    return safeValue === null ? [] : [[key, safeValue] as const];
  });

  return safeDetails.length > 0
    ? { errorDetails: Object.fromEntries(safeDetails) }
    : null;
}

function sanitizeHostedOnboardingDomainErrorDetailValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeHostedOnboardingLogString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function describeHostedOnboardingPrismaErrorForLog(error: unknown): Record<string, unknown> | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaMeta = sanitizeHostedOnboardingPrismaMeta(error.meta);
    const prismaMessage = sanitizeHostedOnboardingLogString(error.message);

    return {
      prismaClientVersion: error.clientVersion,
      prismaCode: error.code,
      ...(prismaMessage ? { prismaMessage } : {}),
      ...(prismaMeta ? { prismaMeta } : {}),
    };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    const prismaMessage = sanitizeHostedOnboardingLogString(error.message);

    return {
      ...(typeof error.clientVersion === "string" && error.clientVersion
        ? { prismaClientVersion: error.clientVersion }
        : {}),
      ...(typeof error.errorCode === "string" && error.errorCode
        ? { prismaCode: error.errorCode }
        : {}),
      ...(prismaMessage ? { prismaMessage } : {}),
    };
  }

  return null;
}

function describeHostedOnboardingDevelopmentErrorForLog(
  error: unknown,
): Record<string, unknown> | null {
  if (!(error instanceof Error)) {
    const errorValue = sanitizeHostedOnboardingDevelopmentLogValue(error);

    return errorValue === null ? null : { errorValue };
  }

  const errorMessage = sanitizeHostedOnboardingLogString(
    error.message,
    HOSTED_ONBOARDING_DEVELOPMENT_LOG_STRING_MAX_LENGTH,
  );
  const errorStack = sanitizeHostedOnboardingLogString(
    error.stack,
    HOSTED_ONBOARDING_DEVELOPMENT_STACK_MAX_LENGTH,
  );
  const errorCause = sanitizeHostedOnboardingDevelopmentLogValue(error.cause);
  const errorDetails = sanitizeHostedOnboardingDevelopmentObjectEntries(error);

  return {
    ...(errorMessage ? { errorMessage } : {}),
    ...(errorStack ? { errorStack } : {}),
    ...(errorCause !== null ? { errorCause } : {}),
    ...(errorDetails ? { errorDetails } : {}),
  };
}

function sanitizeHostedOnboardingPrismaMeta(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }

  const sanitizedEntries = Object.entries(meta).flatMap(([key, value]) => {
    if (!HOSTED_ONBOARDING_SAFE_PRISMA_META_KEYS.has(key)) {
      return [];
    }

    const sanitizedValue = sanitizeHostedOnboardingPrismaMetaValue(value);
    return sanitizedValue === null ? [] : [[key, sanitizedValue] as const];
  });

  return sanitizedEntries.length > 0 ? Object.fromEntries(sanitizedEntries) : null;
}

function sanitizeHostedOnboardingPrismaMetaValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeHostedOnboardingLogString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => sanitizeHostedOnboardingPrismaMetaValue(entry))
      .filter((entry) => entry !== null);
    return sanitized.length > 0 ? sanitized : null;
  }

  return null;
}

export function sanitizeHostedOnboardingLogString(
  value: string | null | undefined,
  maxLength = HOSTED_ONBOARDING_LOG_STRING_MAX_LENGTH,
): string | null {
  return sanitizeJsonLogString(value, maxLength);
}

export function sanitizeHostedOnboardingPersistedErrorCode(
  value: string | null | undefined,
): string | null {
  return sanitizeHostedOnboardingLogString(
    value,
    HOSTED_ONBOARDING_PERSISTED_ERROR_TOKEN_MAX_LENGTH,
  );
}

export function sanitizeHostedOnboardingPersistedErrorName(
  value: string | null | undefined,
): string | null {
  return sanitizeHostedOnboardingLogString(
    value,
    HOSTED_ONBOARDING_PERSISTED_ERROR_TOKEN_MAX_LENGTH,
  );
}

export function sanitizeHostedOnboardingPersistedErrorMessage(
  value: string | null | undefined,
): string | null {
  return sanitizeHostedOnboardingLogString(value, 1)
    ? HOSTED_ONBOARDING_REDACTED_ERROR_MESSAGE
    : null;
}

// The boundary between this and `sanitizeHostedOnboardingPersistedErrorMessage`
// is who authored the string. Our own exception text can carry anything the
// runtime touched, so it keeps presence only. A reason lifted from a provider's
// webhook payload is a bounded diagnostic and the operator's only evidence for
// why a send failed, so it keeps its wording; collapsing it to `[redacted]`
// made every message_failed alert unactionable. Value patterns are still
// scrubbed: secrets, URLs, emails, phone numbers, and paths.
export function sanitizeHostedOnboardingProviderReason(
  value: string | null | undefined,
): string | null {
  return sanitizeHostedOnboardingLogString(
    value,
    HOSTED_ONBOARDING_PROVIDER_REASON_MAX_LENGTH,
  );
}

function isHostedOnboardingDevelopmentLoggingEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

function sanitizeHostedOnboardingDevelopmentObjectEntries(
  value: Error,
): Record<string, unknown> | null {
  const entries = Object.entries(value).flatMap(([key, entryValue]) => {
    if (HOSTED_ONBOARDING_SENSITIVE_LOG_KEY_PATTERN.test(key)) {
      return [[key, HOSTED_ONBOARDING_REDACTED_ERROR_MESSAGE] as const];
    }

    const sanitizedValue = sanitizeHostedOnboardingDevelopmentLogValue(entryValue);

    return sanitizedValue === null ? [] : [[key, sanitizedValue] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function sanitizeHostedOnboardingDevelopmentLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return sanitizeHostedOnboardingLogString(
      value,
      HOSTED_ONBOARDING_DEVELOPMENT_LOG_STRING_MAX_LENGTH,
    );
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value !== "object") {
    return null;
  }

  if (seen.has(value)) {
    return "[circular]";
  }

  if (depth >= HOSTED_ONBOARDING_DEVELOPMENT_LOG_MAX_DEPTH) {
    return Array.isArray(value) ? `[truncated-array:${value.length}]` : "[truncated-object]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, HOSTED_ONBOARDING_DEVELOPMENT_LOG_MAX_ENTRIES)
      .map((entry) => sanitizeHostedOnboardingDevelopmentLogValue(entry, depth + 1, seen))
      .filter((entry) => entry !== null);

    seen.delete(value);
    return sanitized;
  }

  const entries = Object.entries(value)
    .slice(0, HOSTED_ONBOARDING_DEVELOPMENT_LOG_MAX_ENTRIES)
    .flatMap(([key, entryValue]) => {
      if (HOSTED_ONBOARDING_SENSITIVE_LOG_KEY_PATTERN.test(key)) {
        return [[key, HOSTED_ONBOARDING_REDACTED_ERROR_MESSAGE] as const];
      }

      const sanitizedValue = sanitizeHostedOnboardingDevelopmentLogValue(
        entryValue,
        depth + 1,
        seen,
      );

      return sanitizedValue === null ? [] : [[key, sanitizedValue] as const];
    });

  seen.delete(value);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

const hostedOnboardingJsonRouteHelpers = createJsonRouteHelpers({
  defaultHeaders: HOSTED_ONBOARDING_DEFAULT_HEADERS,
  internalMessage: "Hosted onboarding route failed unexpectedly.",
  logMessage: "Hosted onboarding route failed.",
  logDetails: describeHostedOnboardingErrorForLog,
  matchers: [mapHostedOnboardingError],
  sanitizeLogString: sanitizeHostedOnboardingLogString,
});

export const jsonOk = hostedOnboardingJsonRouteHelpers.jsonOk;
export const jsonError = hostedOnboardingJsonRouteHelpers.jsonError;
export const withJsonError = hostedOnboardingJsonRouteHelpers.withJsonError;
