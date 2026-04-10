import { Prisma } from "@prisma/client";

import {
  createJsonRouteHelpers,
  mapDomainJsonError,
  readOptionalJsonObject,
  readJsonObject,
} from "../http";
import { isHostedWebConfigurationError } from "../hosted-web/encryption";
import { isHostedOnboardingError } from "./errors";

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
const HOSTED_ONBOARDING_PERSISTED_ERROR_TOKEN_MAX_LENGTH = 128;

export const HOSTED_ONBOARDING_REDACTED_ERROR_MESSAGE = "[redacted]";

export { readJsonObject, readOptionalJsonObject };

function mapHostedOnboardingError(error: unknown) {
  return isHostedOnboardingError(error) ? mapDomainJsonError(error) : null;
}

function mapHostedWebConfigurationError(error: unknown) {
  return isHostedWebConfigurationError(error) ? mapDomainJsonError(error) : null;
}

function describeHostedOnboardingErrorForLog(error: unknown): Record<string, unknown> | null {
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
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\bhttps?:\/\/\S+/giu, "<redacted-url>")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "<redacted-email>")
    .replace(/\+\d[\d().\s-]{7,}\d/gu, "<redacted-phone>")
    .replace(/(^|[\s(])\/[^\s)]+/gu, "$1<redacted-path>")
    .replace(/\b[A-Z]:\\[^\s]+/gu, "<redacted-path>");

  return normalized ? normalized.slice(0, maxLength) : null;
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

const hostedOnboardingJsonRouteHelpers = createJsonRouteHelpers({
  defaultHeaders: HOSTED_ONBOARDING_DEFAULT_HEADERS,
  internalMessage: "Hosted onboarding route failed unexpectedly.",
  logMessage: "Hosted onboarding route failed.",
  logDetails: describeHostedOnboardingErrorForLog,
  matchers: [mapHostedOnboardingError, mapHostedWebConfigurationError],
});

export const jsonOk = hostedOnboardingJsonRouteHelpers.jsonOk;
export const jsonError = hostedOnboardingJsonRouteHelpers.jsonError;
export const withJsonError = hostedOnboardingJsonRouteHelpers.withJsonError;
