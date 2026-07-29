export type HostedLinqProjectedHealthStatus =
  | "degraded"
  | "healthy"
  | "unhealthy"
  | "unknown";

const HOSTED_LINQ_HEALTHY_PROVIDER_STATUSES = new Set([
  "active",
  "healthy",
  "ok",
  "ready",
]);
const HOSTED_LINQ_HARD_BLOCK_PROVIDER_STATUS_PATTERN =
  /critical|flagged|blocked|disabled|suspended|banned/u;
const HOSTED_LINQ_DEGRADED_PROVIDER_STATUS_PATTERN =
  /at_risk|degraded|warning|limited|throttled/u;

export function normalizeHostedLinqProviderStatus(
  value: string | null | undefined,
): string {
  return value?.trim().toLowerCase().replace(/[\s-]+/gu, "_") ?? "";
}

export function isHostedLinqProviderStatusAtRisk(
  value: string | null | undefined,
): boolean {
  return normalizeHostedLinqProviderStatus(value) === "at_risk";
}

export function isHostedLinqProviderStatusCritical(
  value: string | null | undefined,
): boolean {
  return normalizeHostedLinqProviderStatus(value) === "critical";
}

export function isHostedLinqProviderStatusHardBlocked(
  value: string | null | undefined,
): boolean {
  return HOSTED_LINQ_HARD_BLOCK_PROVIDER_STATUS_PATTERN.test(
    normalizeHostedLinqProviderStatus(value),
  );
}

export function classifyHostedLinqProviderStatus(
  value: string | null | undefined,
): HostedLinqProjectedHealthStatus {
  const normalized = normalizeHostedLinqProviderStatus(value);
  if (HOSTED_LINQ_HEALTHY_PROVIDER_STATUSES.has(normalized)) {
    return "healthy";
  }
  if (HOSTED_LINQ_HARD_BLOCK_PROVIDER_STATUS_PATTERN.test(normalized)) {
    return "unhealthy";
  }
  if (HOSTED_LINQ_DEGRADED_PROVIDER_STATUS_PATTERN.test(normalized)) {
    return "degraded";
  }
  return "unknown";
}

/**
 * Provider-event conflict ordering. Unknown < healthy < degraded < hard-blocked.
 * Keep this single ordering shared by event parsing and line projection.
 */
export function rankHostedLinqProviderStatus(
  value: string | null | undefined,
): number {
  const healthStatus = classifyHostedLinqProviderStatus(value);
  if (healthStatus === "unhealthy") {
    return 4;
  }
  if (healthStatus === "degraded") {
    return 3;
  }
  if (healthStatus === "healthy") {
    return 2;
  }
  return 1;
}
