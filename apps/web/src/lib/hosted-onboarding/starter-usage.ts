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

const HOSTED_STARTER_USAGE_SEMANTIC_SOURCE_PREFIX =
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
