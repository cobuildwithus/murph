import { HostedBillingStatus } from "@prisma/client";

export const HOSTED_STARTER_USAGE_GRANT_USD_MICROS = 4_500_000n;
export const HOSTED_STARTER_USAGE_POLICY_VERSION =
  "starter-usage-2026-08-07-v1" as const;

export const HOSTED_STARTER_USAGE_SOURCES = [
  "web_onboarding",
  "companion_onboarding",
  "linq_instant_start",
  "legacy_trial_migration",
] as const;

export type HostedStarterUsageSource =
  (typeof HOSTED_STARTER_USAGE_SOURCES)[number];

export function canGrantHostedStarterUsageForLegacyTrial(input: {
  billingStatus: HostedBillingStatus;
  suspendedAt: Date | null;
}): boolean {
  if (input.suspendedAt) {
    return false;
  }
  return input.billingStatus === HostedBillingStatus.not_started
    || input.billingStatus === HostedBillingStatus.incomplete
    || input.billingStatus === HostedBillingStatus.active
    || input.billingStatus === HostedBillingStatus.paused;
}

const HOSTED_STARTER_USAGE_PERIOD_START_MS = 0;
const HOSTED_STARTER_USAGE_PERIOD_END_MS = Date.parse(
  "2099-12-31T23:59:59.999Z",
);

/**
 * Stable persistence window for non-expiring Starter capacity. This is an
 * internal storage/retry sentinel, not an entitlement deadline: access remains
 * governed only by the credit ledger and can be extended by changing this
 * projection without mutating grant history.
 */
export function buildHostedStarterUsageLifetimePeriod(): {
  periodEnd: Date;
  periodStart: Date;
} {
  return {
    periodEnd: new Date(HOSTED_STARTER_USAGE_PERIOD_END_MS),
    periodStart: new Date(HOSTED_STARTER_USAGE_PERIOD_START_MS),
  };
}

export const HOSTED_STARTER_USAGE_SEMANTIC_SOURCE_PREFIX =
  "hosted-starter-usage";
const HOSTED_STARTER_USAGE_SOURCE_REFERENCE_PREFIX =
  "starter-usage-source";

export function buildHostedStarterUsageSemanticSourceKey(
  memberId: string,
): string {
  return [
    HOSTED_STARTER_USAGE_SEMANTIC_SOURCE_PREFIX,
    memberId,
    HOSTED_STARTER_USAGE_POLICY_VERSION,
  ].join(":");
}

export function buildHostedStarterUsageSourceReferenceLookupKey(
  source: HostedStarterUsageSource,
): string {
  return `${HOSTED_STARTER_USAGE_SOURCE_REFERENCE_PREFIX}:${source}`;
}

export function parseHostedStarterUsageSourceReferenceLookupKey(
  value: string | null | undefined,
): HostedStarterUsageSource | null {
  if (typeof value !== "string") {
    return null;
  }
  const prefix = `${HOSTED_STARTER_USAGE_SOURCE_REFERENCE_PREFIX}:`;
  if (!value.startsWith(prefix)) {
    return null;
  }
  const source = value.slice(prefix.length);
  return HOSTED_STARTER_USAGE_SOURCES.find((candidate) => candidate === source)
    ?? null;
}
