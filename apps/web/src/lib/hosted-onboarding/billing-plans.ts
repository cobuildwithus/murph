export const HOSTED_BILLING_PLAN_CODES = [
  "launch_monthly",
  "launch_annual",
] as const;

export type HostedBillingPlanCode = (typeof HOSTED_BILLING_PLAN_CODES)[number];
export type HostedBillingPlanInterval = "month" | "year";

export interface HostedBillingPlanDefinition {
  readonly badge: string | null;
  readonly code: HostedBillingPlanCode;
  readonly description: string;
  readonly displayName: string;
  readonly interval: HostedBillingPlanInterval;
  readonly priceIdEnvKey: string;
  readonly recurringAmountUsdCents: number;
}

export interface HostedBillingPlanPresentation {
  readonly badge: string | null;
  readonly code: HostedBillingPlanCode;
  readonly description: string;
  readonly displayName: string;
  readonly interval: HostedBillingPlanInterval;
  readonly recurringAmountUsdCents: number;
  readonly recurringAmountLabel: string;
  readonly recurringSummary: string;
}

const HOSTED_BILLING_PLAN_DEFINITIONS = {
  launch_annual: {
    badge: "Save $36",
    code: "launch_annual",
    description: "$12/month billed yearly. Save $36 each year.",
    displayName: "Annual",
    interval: "year",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_ANNUAL",
    recurringAmountUsdCents: 14_400,
  },
  launch_monthly: {
    badge: null,
    code: "launch_monthly",
    description: "Launch tier billed monthly. Cancel anytime.",
    displayName: "Monthly",
    interval: "month",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
    recurringAmountUsdCents: 1_500,
  },
} as const satisfies Record<HostedBillingPlanCode, HostedBillingPlanDefinition>;

export function getHostedBillingPlanDefinition(
  code: HostedBillingPlanCode
): HostedBillingPlanDefinition {
  return HOSTED_BILLING_PLAN_DEFINITIONS[code];
}

export function getHostedDefaultBillingPlanCode(): HostedBillingPlanCode {
  return "launch_monthly";
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
  stripePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
  stripeSecretKey: string | null;
}): boolean {
  if (!input.stripeSecretKey) {
    return false;
  }

  return HOSTED_BILLING_PLAN_CODES.some((code) =>
    Boolean(input.stripePriceIdsByPlan[code])
  );
}

export function resolveConfiguredHostedBillingPlanCodes(input: {
  stripePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
}): HostedBillingPlanCode[] {
  return HOSTED_BILLING_PLAN_CODES.filter((code) =>
    Boolean(input.stripePriceIdsByPlan[code])
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

export function formatHostedLandingAnnualEquivalentSummary(): string {
  const annualAmountUsdCents =
    getHostedBillingPlanDefinition("launch_annual").recurringAmountUsdCents;
  return `${formatUsdLong(
    Math.round(annualAmountUsdCents / 12)
  )}/month billed yearly`;
}

function buildHostedBillingPlanPresentation(
  code: HostedBillingPlanCode
): HostedBillingPlanPresentation {
  const definition = getHostedBillingPlanDefinition(code);

  return {
    badge: definition.badge,
    code: definition.code,
    description: definition.description,
    displayName: definition.displayName,
    interval: definition.interval,
    recurringAmountUsdCents: definition.recurringAmountUsdCents,
    recurringAmountLabel: formatUsdLong(definition.recurringAmountUsdCents),
    recurringSummary:
      definition.interval === "month"
        ? `${formatUsdCompact(definition.recurringAmountUsdCents)}/mo`
        : `${formatUsdCompact(definition.recurringAmountUsdCents)}/yr`,
  };
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
