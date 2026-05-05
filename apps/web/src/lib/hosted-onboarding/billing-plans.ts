import type { HostedAiUsageBillingMode } from "@murphai/hosted-execution";

export const HOSTED_BILLING_PLAN_CODES = [
  "launch_monthly",
  "launch_edge_monthly",
] as const;

export type HostedBillingPlanCode = (typeof HOSTED_BILLING_PLAN_CODES)[number];
export type HostedBillingPlanInterval = "month";

export interface HostedBillingPlanDefinition {
  readonly badge: string | null;
  readonly code: HostedBillingPlanCode;
  readonly displayName: string;
  readonly interval: HostedBillingPlanInterval;
  readonly priceIdEnvKey: string;
  readonly recurringAmountUsdCents: number;
  readonly usagePriceIdEnvKey: string;
}

export interface HostedBillingPlanPresentation {
  readonly badge: string | null;
  readonly code: HostedBillingPlanCode;
  readonly displayName: string;
  readonly interval: HostedBillingPlanInterval;
  readonly recurringAmountUsdCents: number;
  readonly recurringAmountLabel: string;
  readonly recurringSummary: string;
}

const HOSTED_BILLING_PLAN_DEFINITIONS = {
  launch_monthly: {
    badge: null,
    code: "launch_monthly",
    displayName: "Pulse",
    interval: "month",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
    recurringAmountUsdCents: 800,
    usagePriceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_MONTHLY",
  },
  launch_edge_monthly: {
    badge: null,
    code: "launch_edge_monthly",
    displayName: "Edge",
    interval: "month",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
    recurringAmountUsdCents: 2_000,
    usagePriceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_USAGE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
  },
} as const satisfies Record<HostedBillingPlanCode, HostedBillingPlanDefinition>;

export const HOSTED_AI_USAGE_MONTHLY_ALLOWANCE_USD_MICROS = {
  launch_edge_monthly: 25_000_000n,
  launch_monthly: 10_000_000n,
} as const satisfies Record<HostedBillingPlanCode, bigint>;

export function getHostedBillingPlanDefinition(
  code: HostedBillingPlanCode
): HostedBillingPlanDefinition {
  return HOSTED_BILLING_PLAN_DEFINITIONS[code];
}

export function getHostedDefaultBillingPlanCode(): HostedBillingPlanCode {
  return "launch_monthly";
}

export function getHostedAiUsageMonthlyAllowanceUsdMicros(
  code: HostedBillingPlanCode,
): bigint {
  return HOSTED_AI_USAGE_MONTHLY_ALLOWANCE_USD_MICROS[code];
}

export function parseHostedBillingPlanCode(
  value: unknown
): HostedBillingPlanCode | null {
  return typeof value === "string" && hasHostedBillingPlanCode(value)
    ? value
    : null;
}

export function listHostedBillingPlanPresentations(input?: {
  configuredPlanCodes?: readonly HostedBillingPlanCode[] | null;
}): readonly HostedBillingPlanPresentation[] {
  const configuredPlanCodes = new Set(
    input?.configuredPlanCodes ?? HOSTED_BILLING_PLAN_CODES
  );

  return HOSTED_BILLING_PLAN_CODES.filter((code) =>
    configuredPlanCodes.has(code)
  ).map((code) => buildHostedBillingPlanPresentation(code));
}

export function resolveHostedBillingReady(input: {
  aiUsageBillingMode: HostedAiUsageBillingMode;
  stripePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
  stripeSecretKey: string | null;
  stripeUsageMeterEventName: string | null;
  stripeUsagePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
}): boolean {
  if (!input.stripeSecretKey) {
    return false;
  }

  if (input.aiUsageBillingMode === "stripe_meter" && !input.stripeUsageMeterEventName) {
    return false;
  }

  return HOSTED_BILLING_PLAN_CODES.some((code) =>
    hasHostedBillingPlanStripePrices(input, code, input.aiUsageBillingMode)
  );
}

export function resolveConfiguredHostedBillingPlanCodes(input: {
  aiUsageBillingMode: HostedAiUsageBillingMode;
  stripePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
  stripeUsagePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
}): HostedBillingPlanCode[] {
  return HOSTED_BILLING_PLAN_CODES.filter((code) =>
    hasHostedBillingPlanStripePrices(input, code, input.aiUsageBillingMode)
  );
}

export function formatHostedLandingPricingShortSummary(): string {
  return `${formatUsdCompact(
    getHostedBillingPlanDefinition("launch_monthly").recurringAmountUsdCents
  )}/mo`;
}

export function formatHostedLandingPricingLongSummary(): string {
  return `${formatUsdLong(
    getHostedBillingPlanDefinition("launch_monthly").recurringAmountUsdCents
  )}/month`;
}

function buildHostedBillingPlanPresentation(
  code: HostedBillingPlanCode
): HostedBillingPlanPresentation {
  const definition = getHostedBillingPlanDefinition(code);

  return {
    badge: definition.badge,
    code: definition.code,
    displayName: definition.displayName,
    interval: definition.interval,
    recurringAmountUsdCents: definition.recurringAmountUsdCents,
    recurringAmountLabel: formatUsdLong(definition.recurringAmountUsdCents),
    recurringSummary: `${formatUsdCompact(definition.recurringAmountUsdCents)}/mo`,
  };
}

function hasHostedBillingPlanStripePrices(
  input: {
    stripePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
    stripeUsagePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
  },
  code: HostedBillingPlanCode,
  aiUsageBillingMode: HostedAiUsageBillingMode,
): boolean {
  if (!input.stripePriceIdsByPlan[code]) {
    return false;
  }

  return aiUsageBillingMode === "stripe_meter"
    ? Boolean(input.stripeUsagePriceIdsByPlan[code])
    : true;
}

function hasHostedBillingPlanCode(
  value: string
): value is HostedBillingPlanCode {
  return HOSTED_BILLING_PLAN_CODES.includes(value as HostedBillingPlanCode);
}

function formatUsdCompact(amountUsdCents: number): string {
  return `$${(amountUsdCents / 100).toFixed(0)}`;
}

function formatUsdLong(amountUsdCents: number): string {
  return `$${(amountUsdCents / 100).toFixed(0)}`;
}
