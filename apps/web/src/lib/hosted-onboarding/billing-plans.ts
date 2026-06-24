export const HOSTED_BILLING_PLAN_CODES = [
  "launch_monthly",
  "launch_edge_monthly",
] as const;

export type HostedBillingPlanCode = (typeof HOSTED_BILLING_PLAN_CODES)[number];
export type HostedBillingPlanInterval = "month";

export const HOSTED_PUBLIC_BILLING_CHECKOUT_OFFERS = [
  "pulse_trial_7d",
] as const;

export type HostedPublicBillingCheckoutOffer =
  (typeof HOSTED_PUBLIC_BILLING_CHECKOUT_OFFERS)[number];

export const HOSTED_INTERNAL_BILLING_CHECKOUT_OFFERS = [
  "standard",
  "pulse_trial_7d",
] as const;

export type HostedBillingCheckoutOffer =
  (typeof HOSTED_INTERNAL_BILLING_CHECKOUT_OFFERS)[number];

export const HOSTED_BILLING_PHASES = [
  "trial",
  "paid",
] as const;

export type HostedBillingPhase = (typeof HOSTED_BILLING_PHASES)[number];

export const HOSTED_STANDARD_CHECKOUT_OFFER = "standard" as const;
export const HOSTED_PULSE_TRIAL_OFFER = "pulse_trial_7d" as const;
export const HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED_ENV =
  "HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED";
export const HOSTED_AUTO_PULSE_TRIAL_ENABLED_ENV =
  "HOSTED_AUTO_PULSE_TRIAL_ENABLED";
export const HOSTED_PULSE_TRIAL_DAYS = 7;
export const HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS = 4_500_000n;
export const HOSTED_PULSE_TRIAL_POLICY_VERSION =
  "pulse-trial-2026-05-05-v1";

export const HOSTED_PULSE_TRIAL_POLICIES = {
  [HOSTED_PULSE_TRIAL_POLICY_VERSION]: {
    durationDays: HOSTED_PULSE_TRIAL_DAYS,
    usageLimitUsdMicros: HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  },
} as const;

export type HostedPulseTrialPolicyVersion =
  keyof typeof HOSTED_PULSE_TRIAL_POLICIES;

export interface HostedPulseTrialPolicy {
  durationDays: number;
  usageLimitUsdMicros: bigint;
}

export interface HostedBillingPlanDefinition {
  readonly badge: string | null;
  readonly code: HostedBillingPlanCode;
  readonly displayName: string;
  readonly interval: HostedBillingPlanInterval;
  readonly priceIdEnvKey: string;
  readonly recurringAmountUsdCents: number;
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
  },
  launch_edge_monthly: {
    badge: null,
    code: "launch_edge_monthly",
    displayName: "Edge",
    interval: "month",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
    recurringAmountUsdCents: 2_000,
  },
} as const satisfies Record<HostedBillingPlanCode, HostedBillingPlanDefinition>;

export const HOSTED_AI_USAGE_MONTHLY_ALLOWANCE_USD_MICROS = {
  launch_edge_monthly: 25_000_000n,
  launch_monthly: 10_000_000n,
} as const satisfies Record<HostedBillingPlanCode, bigint>;

export const HOSTED_FAMILY_PLAN_DISPLAY = {
  displayName: "Family",
  recurringAmountUsdCents: 2_500,
  seats: 4,
} as const;

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

export function isHostedPulseTrialCheckoutEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return source[HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED_ENV] === "1";
}

export function isHostedAutoPulseTrialEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  const value = source[HOSTED_AUTO_PULSE_TRIAL_ENABLED_ENV]?.trim().toLowerCase();

  return value !== "0" && value !== "false";
}

export function parseHostedBillingPlanCode(
  value: unknown
): HostedBillingPlanCode | null {
  return typeof value === "string" && hasHostedBillingPlanCode(value)
    ? value
    : null;
}

export function parseHostedPublicBillingCheckoutOffer(
  value: unknown,
): HostedPublicBillingCheckoutOffer | null {
  return typeof value === "string" &&
    HOSTED_PUBLIC_BILLING_CHECKOUT_OFFERS.includes(value as HostedPublicBillingCheckoutOffer)
    ? value as HostedPublicBillingCheckoutOffer
    : null;
}

export function parseHostedBillingCheckoutOffer(
  value: unknown,
): HostedBillingCheckoutOffer | null {
  return typeof value === "string" &&
    HOSTED_INTERNAL_BILLING_CHECKOUT_OFFERS.includes(value as HostedBillingCheckoutOffer)
    ? value as HostedBillingCheckoutOffer
    : null;
}

export function parseHostedBillingPhase(value: unknown): HostedBillingPhase | null {
  return typeof value === "string" &&
    HOSTED_BILLING_PHASES.includes(value as HostedBillingPhase)
    ? value as HostedBillingPhase
    : null;
}

export function isHostedPulseTrialBillingState(input: {
  currentBillingPhase?: unknown;
  currentCheckoutOffer?: unknown;
}): boolean {
  const phase = parseHostedBillingPhase(input.currentBillingPhase);
  const offer = parseHostedBillingCheckoutOffer(input.currentCheckoutOffer);

  return phase === "trial" ||
    (offer === HOSTED_PULSE_TRIAL_OFFER && phase !== "paid");
}

export function canUpgradeHostedBillingPlanToEdge(input: {
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentCheckoutOffer?: unknown;
}): boolean {
  const phase = parseHostedBillingPhase(input.currentBillingPhase);

  return parseHostedBillingPlanCode(input.currentBillingPlanCode) === "launch_monthly" &&
    phase === "paid" &&
    !isHostedPulseTrialBillingState(input);
}

export function canSwitchHostedBillingPlanToPulse(input: {
  billingStatus?: unknown;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  stripeCustomerId?: unknown;
  stripeSubscriptionId?: unknown;
  suspendedAt?: unknown;
}): boolean {
  return parseHostedBillingPlanCode(input.currentBillingPlanCode) === "launch_edge_monthly" &&
    parseHostedBillingPhase(input.currentBillingPhase) === "paid" &&
    input.billingStatus === "active" &&
    !(input.suspendedAt instanceof Date) &&
    typeof input.stripeCustomerId === "string" &&
    input.stripeCustomerId.length > 0 &&
    typeof input.stripeSubscriptionId === "string" &&
    input.stripeSubscriptionId.length > 0;
}

export function canStartHostedPulseTrialPaidPlan(input: {
  billingStatus?: unknown;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentCheckoutOffer?: unknown;
  stripeCustomerId?: unknown;
  stripeSubscriptionId?: unknown;
  suspendedAt?: unknown;
}): boolean {
  const phase = parseHostedBillingPhase(input.currentBillingPhase);
  const canStartActiveTrial =
    input.billingStatus === "active" &&
    phase === "trial";
  const canRecoverPausedTrial =
    input.billingStatus === "paused" &&
    isHostedPulseTrialBillingState(input);

  return parseHostedBillingPlanCode(input.currentBillingPlanCode) === "launch_monthly" &&
    parseHostedBillingCheckoutOffer(input.currentCheckoutOffer) === HOSTED_PULSE_TRIAL_OFFER &&
    (canStartActiveTrial || canRecoverPausedTrial) &&
    !(input.suspendedAt instanceof Date) &&
    typeof input.stripeCustomerId === "string" &&
    input.stripeCustomerId.length > 0 &&
    typeof input.stripeSubscriptionId === "string" &&
    input.stripeSubscriptionId.length > 0;
}

export function requireHostedPulseTrialPolicy(
  policyVersion: string | null | undefined,
): HostedPulseTrialPolicy | null {
  if (
    typeof policyVersion !== "string" ||
    !Object.prototype.hasOwnProperty.call(HOSTED_PULSE_TRIAL_POLICIES, policyVersion)
  ) {
    return null;
  }

  return HOSTED_PULSE_TRIAL_POLICIES[policyVersion as HostedPulseTrialPolicyVersion];
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
    hasHostedBillingPlanStripePrice(input, code)
  );
}

export function resolveConfiguredHostedBillingPlanCodes(input: {
  stripePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
}): HostedBillingPlanCode[] {
  return HOSTED_BILLING_PLAN_CODES.filter((code) =>
    hasHostedBillingPlanStripePrice(input, code)
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

function hasHostedBillingPlanStripePrice(
  input: {
    stripePriceIdsByPlan: Readonly<Record<HostedBillingPlanCode, string | null>>;
  },
  code: HostedBillingPlanCode,
): boolean {
  return Boolean(input.stripePriceIdsByPlan[code]);
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
