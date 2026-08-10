import {
  HOSTED_FAMILY_PLAN_CODES,
  HOSTED_PLAN_CODES,
  type HostedFamilyPlanCode,
  type HostedPlanCode,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME,
} from "@murphai/hosted-execution/plan-usage";

export {
  HOSTED_FAMILY_PLAN_CODES,
  HOSTED_PLAN_CODES,
  type HostedFamilyPlanCode,
  type HostedPlanCode,
};

export const HOSTED_BILLING_PLAN_CODES = [
  "launch_monthly",
  "launch_edge_monthly",
  "launch_max_monthly",
  "launch_group_monthly",
] as const;

export type HostedBillingPlanCode = (typeof HOSTED_BILLING_PLAN_CODES)[number];

export const HOSTED_PUBLIC_BILLING_PLAN_CODES = [
  "launch_monthly",
  "launch_edge_monthly",
] as const satisfies readonly HostedBillingPlanCode[];

export type HostedPublicBillingPlanCode =
  (typeof HOSTED_PUBLIC_BILLING_PLAN_CODES)[number];
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
export const HOSTED_PULSE_TRIAL_DAYS = 14;
export const HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS = 4_500_000n;
export const HOSTED_PULSE_TRIAL_STARTED_AT_OVERRIDE_METADATA_KEY =
  "trialStartedAtOverride";
export const HOSTED_PULSE_TRIAL_LEGACY_POLICY_VERSION =
  "pulse-trial-2026-05-05-v1";
export const HOSTED_PULSE_TRIAL_TEN_DAY_POLICY_VERSION =
  "pulse-trial-2026-06-30-v2";
export const HOSTED_PULSE_TRIAL_POLICY_VERSION =
  "pulse-trial-2026-07-15-v3";

export const HOSTED_PULSE_TRIAL_POLICIES = {
  [HOSTED_PULSE_TRIAL_LEGACY_POLICY_VERSION]: {
    durationDays: 7,
    usageLimitUsdMicros: HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  },
  [HOSTED_PULSE_TRIAL_TEN_DAY_POLICY_VERSION]: {
    durationDays: 10,
    usageLimitUsdMicros: HOSTED_PULSE_TRIAL_USAGE_LIMIT_USD_MICROS,
  },
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
  readonly planChangePortalConfigurationIdEnvKey: string | null;
  readonly planCode: HostedPlanCode;
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
  launch_group_monthly: {
    badge: null,
    code: "launch_group_monthly",
    displayName: HOSTED_GROUP_MEMBER_PLAN_DISPLAY_NAME,
    interval: "month",
    planChangePortalConfigurationIdEnvKey: null,
    planCode: "pulse",
    priceIdEnvKey:
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_GROUP_MONTHLY",
    recurringAmountUsdCents: 350,
  },
  launch_monthly: {
    badge: null,
    code: "launch_monthly",
    displayName: "Pulse",
    interval: "month",
    planChangePortalConfigurationIdEnvKey:
      "HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_MONTHLY",
    planCode: "pulse",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY",
    recurringAmountUsdCents: 800,
  },
  launch_edge_monthly: {
    badge: null,
    code: "launch_edge_monthly",
    displayName: "Edge",
    interval: "month",
    planChangePortalConfigurationIdEnvKey:
      "HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_EDGE_MONTHLY",
    planCode: "edge",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY",
    recurringAmountUsdCents: 2_000,
  },
  launch_max_monthly: {
    badge: "New",
    code: "launch_max_monthly",
    displayName: "Max",
    interval: "month",
    planChangePortalConfigurationIdEnvKey:
      "HOSTED_ONBOARDING_STRIPE_PLAN_CHANGE_PORTAL_CONFIGURATION_ID_LAUNCH_MAX_MONTHLY",
    planCode: "edge",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MAX_MONTHLY",
    recurringAmountUsdCents: 5_000,
  },
} as const satisfies Record<HostedBillingPlanCode, HostedBillingPlanDefinition>;

const HOSTED_DEFAULT_BILLING_PLAN_CODE_BY_PLAN = {
  edge: "launch_edge_monthly",
  pulse: "launch_monthly",
} as const satisfies Record<HostedPlanCode, HostedBillingPlanCode>;

const HOSTED_DIRECT_BILLING_PLAN_RANK = {
  launch_group_monthly: 0,
  launch_monthly: 1,
  launch_edge_monthly: 2,
  launch_max_monthly: 3,
} as const satisfies Record<HostedBillingPlanCode, number>;

export interface HostedPlanDefinition {
  readonly code: HostedPlanCode;
  readonly displayName: string;
}

const HOSTED_PLAN_DEFINITIONS = {
  pulse: {
    displayName: "Pulse",
  },
  edge: {
    displayName: "Edge",
  },
} as const satisfies Record<
  HostedPlanCode,
  Omit<HostedPlanDefinition, "code">
>;

export interface HostedFamilyBillingOfferDefinition {
  readonly billingPlanCode: HostedBillingPlanCode;
  readonly displayName: string;
  readonly planCode: HostedFamilyPlanCode;
  readonly priceIdEnvKey: string;
  readonly recurringAmountUsdCents: number;
  readonly runtimePlanCode: HostedPlanCode;
}

const HOSTED_FAMILY_BILLING_OFFERS = {
  pulse: {
    billingPlanCode: "launch_monthly",
    displayName: "Pulse",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
    recurringAmountUsdCents: 700,
    runtimePlanCode: "pulse",
  },
  edge: {
    billingPlanCode: "launch_edge_monthly",
    displayName: "Edge",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_EDGE_SEAT_MONTHLY",
    recurringAmountUsdCents: 1_900,
    runtimePlanCode: "edge",
  },
  max: {
    billingPlanCode: "launch_max_monthly",
    displayName: "Max",
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_MAX_SEAT_MONTHLY",
    recurringAmountUsdCents: 4_900,
    runtimePlanCode: "edge",
  },
} as const satisfies Record<
  HostedFamilyPlanCode,
  Omit<HostedFamilyBillingOfferDefinition, "planCode">
>;

export const HOSTED_FAMILY_MIN_SEATS = 2;
export const HOSTED_FAMILY_MAX_SEATS = 6;

export const HOSTED_FAMILY_PLAN_DISPLAY = {
  displayName: "Family",
  maxSeats: HOSTED_FAMILY_MAX_SEATS,
  minSeats: HOSTED_FAMILY_MIN_SEATS,
  recurringAmountUsdCentsPerSeat:
    HOSTED_FAMILY_BILLING_OFFERS.pulse.recurringAmountUsdCents,
  plans: HOSTED_FAMILY_PLAN_CODES.map((code) => ({
    code,
    displayName: HOSTED_FAMILY_BILLING_OFFERS[code].displayName,
    recurringAmountUsdCents:
      HOSTED_FAMILY_BILLING_OFFERS[code].recurringAmountUsdCents,
  })),
} as const;

export function getHostedPlanDefinition(code: HostedPlanCode): HostedPlanDefinition {
  return {
    ...HOSTED_PLAN_DEFINITIONS[code],
    code,
  };
}

export function getHostedFamilyBillingOfferDefinition(
  code: HostedFamilyPlanCode,
): HostedFamilyBillingOfferDefinition {
  return {
    ...HOSTED_FAMILY_BILLING_OFFERS[code],
    planCode: code,
  };
}

export function getHostedFamilyBillingPlanCode(
  code: HostedFamilyPlanCode,
): HostedBillingPlanCode {
  return HOSTED_FAMILY_BILLING_OFFERS[code].billingPlanCode;
}

export function getHostedFamilyRuntimePlanCode(
  code: HostedFamilyPlanCode,
): HostedPlanCode {
  return HOSTED_FAMILY_BILLING_OFFERS[code].runtimePlanCode;
}

export function getHostedPlanCodeForBillingPlan(
  code: HostedBillingPlanCode,
): HostedPlanCode {
  return HOSTED_BILLING_PLAN_DEFINITIONS[code].planCode;
}

export function getHostedBillingPlanCodeForPlan(
  planCode: HostedPlanCode,
): HostedBillingPlanCode {
  return HOSTED_DEFAULT_BILLING_PLAN_CODE_BY_PLAN[planCode];
}

export function getHostedDirectBillingPlanRank(
  code: HostedBillingPlanCode,
): number {
  return HOSTED_DIRECT_BILLING_PLAN_RANK[code];
}

export function parseHostedPlanCode(value: unknown): HostedPlanCode | null {
  return typeof value === "string" &&
    HOSTED_PLAN_CODES.includes(value as HostedPlanCode)
    ? value as HostedPlanCode
    : null;
}

export function parseHostedFamilyPlanCode(
  value: unknown,
): HostedFamilyPlanCode | null {
  return typeof value === "string" &&
    HOSTED_FAMILY_PLAN_CODES.includes(value as HostedFamilyPlanCode)
    ? value as HostedFamilyPlanCode
    : null;
}

export function getHostedFamilyAiUsageMonthlyAllowanceForPlan(
  code: HostedFamilyPlanCode,
): bigint {
  return calculateHostedPaidAiUsageAllowanceUsdMicros(
    HOSTED_FAMILY_BILLING_OFFERS[code].recurringAmountUsdCents,
  );
}

export function getHostedBillingPlanDefinition(
  code: HostedBillingPlanCode
): HostedBillingPlanDefinition {
  return HOSTED_BILLING_PLAN_DEFINITIONS[code];
}

export function readHostedBillingPlanChangePortalConfigurationId(
  code: HostedBillingPlanCode,
  source: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const environmentKey = getHostedBillingPlanDefinition(code)
    .planChangePortalConfigurationIdEnvKey;
  if (!environmentKey) {
    return null;
  }

  const value = source[environmentKey]?.trim();
  return value ? value : null;
}

export function isHostedBillingPlanChangePortalConfigured(
  code: HostedBillingPlanCode,
  source?: Readonly<Record<string, string | undefined>>,
): boolean {
  return readHostedBillingPlanChangePortalConfigurationId(code, source) !== null;
}

export function getHostedDefaultBillingPlanCode(): HostedBillingPlanCode {
  return "launch_monthly";
}

export function getHostedAiUsageMonthlyAllowanceUsdMicros(
  code: HostedBillingPlanCode,
): bigint {
  return calculateHostedPaidAiUsageAllowanceUsdMicros(
    HOSTED_BILLING_PLAN_DEFINITIONS[code].recurringAmountUsdCents,
  );
}

const USD_MICROS_PER_CENT = 10_000n;
const HOSTED_PAID_AI_USAGE_ALLOWANCE_NUMERATOR = 4n;
const HOSTED_PAID_AI_USAGE_ALLOWANCE_DENOMINATOR = 5n;

function calculateHostedPaidAiUsageAllowanceUsdMicros(
  recurringAmountUsdCents: number,
): bigint {
  return (
    BigInt(recurringAmountUsdCents)
    * USD_MICROS_PER_CENT
    * HOSTED_PAID_AI_USAGE_ALLOWANCE_NUMERATOR
  ) / HOSTED_PAID_AI_USAGE_ALLOWANCE_DENOMINATOR;
}

export function isHostedBillingPlanImmediateUpgrade(input: {
  currentPlanCode: HostedBillingPlanCode;
  targetPlanCode: HostedBillingPlanCode;
}): boolean {
  return getHostedDirectBillingPlanRank(input.targetPlanCode) >
    getHostedDirectBillingPlanRank(input.currentPlanCode);
}

export function isHostedBillingPlanScheduledDowngrade(input: {
  currentPlanCode: HostedBillingPlanCode;
  targetPlanCode: HostedBillingPlanCode;
}): boolean {
  return getHostedDirectBillingPlanRank(input.targetPlanCode) <
    getHostedDirectBillingPlanRank(input.currentPlanCode);
}

export function canUpgradeHostedBillingPlan(input: {
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentCheckoutOffer?: unknown;
  targetPlanCode?: unknown;
}): boolean {
  const currentPlanCode = parseHostedBillingPlanCode(
    input.currentBillingPlanCode,
  );
  const targetPlanCode = parseHostedBillingPlanCode(input.targetPlanCode);

  return currentPlanCode !== null &&
    targetPlanCode !== null &&
    parseHostedBillingPhase(input.currentBillingPhase) === "paid" &&
    !isHostedPulseTrialBillingState(input) &&
    isHostedBillingPlanImmediateUpgrade({
      currentPlanCode,
      targetPlanCode,
    });
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

export function parseHostedPublicBillingPlanCode(
  value: unknown,
): HostedPublicBillingPlanCode | null {
  return typeof value === "string" &&
      HOSTED_PUBLIC_BILLING_PLAN_CODES.includes(
        value as HostedPublicBillingPlanCode,
      )
    ? value as HostedPublicBillingPlanCode
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
  return canUpgradeHostedBillingPlan({
    ...input,
    targetPlanCode: "launch_edge_monthly",
  });
}

export function canScheduleHostedBillingPlanChange(input: {
  billingStatus?: unknown;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentCheckoutOffer?: unknown;
  stripeCustomerId?: unknown;
  stripeSubscriptionId?: unknown;
  suspendedAt?: unknown;
  targetPlanCode?: unknown;
}): boolean {
  const currentPlanCode = parseHostedBillingPlanCode(
    input.currentBillingPlanCode,
  );
  const targetPlanCode = parseHostedBillingPlanCode(input.targetPlanCode);
  if (
    !currentPlanCode ||
    !targetPlanCode ||
    input.billingStatus !== "active" ||
    input.suspendedAt instanceof Date ||
    typeof input.stripeCustomerId !== "string" ||
    input.stripeCustomerId.length === 0 ||
    typeof input.stripeSubscriptionId !== "string" ||
    input.stripeSubscriptionId.length === 0
  ) {
    return false;
  }

  if (
    parseHostedBillingPhase(input.currentBillingPhase) === "paid" &&
    isHostedBillingPlanScheduledDowngrade({
      currentPlanCode,
      targetPlanCode,
    })
  ) {
    return true;
  }

  return currentPlanCode === "launch_monthly" &&
    targetPlanCode === "launch_group_monthly" &&
    isHostedPulseTrialBillingState(input);
}

export function canSwitchHostedBillingPlanToPulse(input: {
  billingStatus?: unknown;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  stripeCustomerId?: unknown;
  stripeSubscriptionId?: unknown;
  suspendedAt?: unknown;
}): boolean {
  return canScheduleHostedBillingPlanChange({
    ...input,
    targetPlanCode: "launch_monthly",
  });
}

export function canStartHostedPulseTrialPaidPlan(input: {
  billingStatus?: unknown;
  currentBillingPhase?: unknown;
  currentBillingPlanCode?: unknown;
  currentCheckoutOffer?: unknown;
  hasStripeCustomerId?: unknown;
  hasStripeSubscriptionId?: unknown;
  suspendedAt?: unknown;
}): boolean {
  const phase = parseHostedBillingPhase(input.currentBillingPhase);
  const currentPlanCode = parseHostedBillingPlanCode(
    input.currentBillingPlanCode,
  );
  const canStartActiveTrial =
    input.billingStatus === "active" &&
    phase === "trial" &&
    currentPlanCode === "launch_monthly";
  const canRecoverLapsedTrial =
    input.billingStatus === "paused" &&
    currentPlanCode === "launch_monthly" &&
    isHostedPulseTrialBillingState(input);
  const canRecoverPendingTrial =
    input.billingStatus === "incomplete" &&
    (
      currentPlanCode === "launch_group_monthly" ||
      currentPlanCode === "launch_monthly"
    ) &&
    isHostedPulseTrialBillingState(input);

  return parseHostedBillingCheckoutOffer(input.currentCheckoutOffer) === HOSTED_PULSE_TRIAL_OFFER &&
    (canStartActiveTrial || canRecoverLapsedTrial || canRecoverPendingTrial) &&
    !(input.suspendedAt instanceof Date) &&
    input.hasStripeCustomerId === true &&
    input.hasStripeSubscriptionId === true;
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

export function parseHostedPulseTrialPolicyVersion(
  policyVersion: unknown,
): HostedPulseTrialPolicyVersion | null {
  return typeof policyVersion === "string" &&
    Object.prototype.hasOwnProperty.call(HOSTED_PULSE_TRIAL_POLICIES, policyVersion)
    ? policyVersion as HostedPulseTrialPolicyVersion
    : null;
}

export function listHostedBillingPlanPresentations(input?: {
  configuredPlanCodes?: readonly HostedBillingPlanCode[] | null;
}): readonly HostedBillingPlanPresentation[] {
  const configuredPlanCodes = new Set(
    input?.configuredPlanCodes ?? HOSTED_PUBLIC_BILLING_PLAN_CODES
  );

  return HOSTED_PUBLIC_BILLING_PLAN_CODES.filter((code) =>
    configuredPlanCodes.has(code)
  ).map((code) => buildHostedBillingPlanPresentation(code));
}

export function resolveHostedBillingReady(input: {
  stripePriceIdsByPlan: Readonly<
    Partial<Record<HostedBillingPlanCode, string | null>>
  >;
  stripeSecretKey: string | null;
}): boolean {
  if (!input.stripeSecretKey) {
    return false;
  }

  return HOSTED_PUBLIC_BILLING_PLAN_CODES.some((code) =>
    hasHostedBillingPlanStripePrice(input, code)
  );
}

export function resolveConfiguredHostedBillingPlanCodes(input: {
  stripePriceIdsByPlan: Readonly<
    Partial<Record<HostedBillingPlanCode, string | null>>
  >;
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
    stripePriceIdsByPlan: Readonly<
      Partial<Record<HostedBillingPlanCode, string | null>>
    >;
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

export function formatHostedBillingPrice(amountUsdCents: number): string {
  const wholeDollars = Math.floor(amountUsdCents / 100);
  const cents = amountUsdCents % 100;

  return cents === 0
    ? `$${wholeDollars}`
    : `$${wholeDollars}.${String(cents).padStart(2, "0")}`;
}

function formatUsdCompact(amountUsdCents: number): string {
  return formatHostedBillingPrice(amountUsdCents);
}

function formatUsdLong(amountUsdCents: number): string {
  return formatHostedBillingPrice(amountUsdCents);
}
