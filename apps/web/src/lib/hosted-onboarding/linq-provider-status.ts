import { normalizeNullableString } from "./shared";

export const HOSTED_LINQ_LINE_SERVICE_STATUSES = [
  "ACTIVE",
  "FLAGGED",
] as const;

export type HostedLinqLineServiceStatus =
  typeof HOSTED_LINQ_LINE_SERVICE_STATUSES[number];

export const HOSTED_LINQ_LINE_REPUTATION_STATUSES = [
  "HEALTHY",
  "AT_RISK",
  "CRITICAL",
] as const;

export type HostedLinqLineReputationStatus =
  typeof HOSTED_LINQ_LINE_REPUTATION_STATUSES[number];

export const HOSTED_LINQ_CHAT_HEALTH_STATUSES = [
  "HEALTHY",
  "AT_RISK",
  "CRITICAL",
  "OPTED_OUT",
] as const;

export type HostedLinqChatHealthStatus =
  typeof HOSTED_LINQ_CHAT_HEALTH_STATUSES[number];

export function parseHostedLinqLineServiceStatus(
  value: unknown,
): HostedLinqLineServiceStatus | null {
  return parseHostedLinqProviderStatus(value, HOSTED_LINQ_LINE_SERVICE_STATUSES);
}

export function parseHostedLinqLineReputationStatus(
  value: unknown,
): HostedLinqLineReputationStatus | null {
  return parseHostedLinqProviderStatus(value, HOSTED_LINQ_LINE_REPUTATION_STATUSES);
}

export function parseHostedLinqChatHealthStatus(
  value: unknown,
): HostedLinqChatHealthStatus | null {
  return parseHostedLinqProviderStatus(value, HOSTED_LINQ_CHAT_HEALTH_STATUSES);
}

function parseHostedLinqProviderStatus<TStatus extends string>(
  value: unknown,
  allowed: readonly TStatus[],
): TStatus | null {
  const normalized = normalizeNullableString(
    typeof value === "string" ? value : null,
  )?.toUpperCase();
  if (!normalized) {
    return null;
  }

  for (const status of allowed) {
    if (status === normalized) {
      return status;
    }
  }
  return null;
}
