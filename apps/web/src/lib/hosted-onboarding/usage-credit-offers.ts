export const HOSTED_USAGE_CREDIT_OFFER_CODES = [
  "usage_5_usd",
  "usage_10_usd",
  "usage_20_usd",
  "usage_25_usd",
] as const;

export type HostedUsageCreditOfferCode =
  (typeof HOSTED_USAGE_CREDIT_OFFER_CODES)[number];

export const HOSTED_GROUP_SPONSORSHIP_OFFER_CODES = [
  "usage_5_usd",
  "usage_10_usd",
  "usage_20_usd",
] as const satisfies readonly HostedUsageCreditOfferCode[];

export type HostedGroupSponsorshipOfferCode =
  (typeof HOSTED_GROUP_SPONSORSHIP_OFFER_CODES)[number];

export const HOSTED_NONGROUP_USAGE_CREDIT_OFFER_CODES = [
  "usage_5_usd",
  "usage_10_usd",
  "usage_25_usd",
] as const satisfies readonly HostedUsageCreditOfferCode[];

export const HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V1 =
  "hosted-usage-credit-checkout-v1" as const;
export const HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V2 =
  "hosted-usage-credit-checkout-v2" as const;
export const HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V3 =
  "hosted-usage-credit-checkout-v3" as const;
export const HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4 =
  "hosted-usage-credit-checkout-v4" as const;
export const HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION =
  "hosted-usage-credit-checkout-v5" as const;
export const HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSIONS = [
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V1,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V2,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V3,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4,
  HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION,
] as const;
export type HostedUsageCreditCheckoutRequestPolicyVersion =
  (typeof HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSIONS)[number];
export type HostedUsageCreditTargetKind = "family" | "group" | "personal";
export const HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE =
  "hosted_usage_credit" as const;
// Keep direct saved-card PaymentIntents distinct from Checkout-only events while
// both converge on the same purchase and usage-credit ledger.
export const HOSTED_USAGE_CREDIT_SAVED_CARD_PURPOSE =
  "hosted_usage_credit_saved_card" as const;

export function parseHostedUsageCreditCheckoutRequestPolicyVersion(
  value: string,
): HostedUsageCreditCheckoutRequestPolicyVersion | null {
  return value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V1 ||
      value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V2 ||
      value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V3 ||
      value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4 ||
      value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION
    ? value
    : null;
}

export function isHostedUsageCreditSavedCardPolicyVersion(
  value: HostedUsageCreditCheckoutRequestPolicyVersion,
): boolean {
  return value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V2 ||
    value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V3 ||
    value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4 ||
    value === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION;
}

export function hostedUsageCreditPolicySupportsSavedCardTarget(input: {
  policyVersion: HostedUsageCreditCheckoutRequestPolicyVersion;
  targetKind: HostedUsageCreditTargetKind;
}): boolean {
  return input.policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V3 ||
    input.policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V4 ||
    input.policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION ||
    (
      input.policyVersion === HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_V2 &&
      input.targetKind === "group"
    );
}

export interface HostedUsageCreditOfferDefinition {
  readonly cashAmountMinor: number;
  readonly cashCurrency: "usd";
  readonly code: HostedUsageCreditOfferCode;
  readonly grantUsdMicros: bigint;
  readonly priceIdEnvKey: string;
}

const HOSTED_USAGE_CREDIT_OFFER_DEFINITIONS = {
  usage_5_usd: {
    cashAmountMinor: 500,
    cashCurrency: "usd",
    grantUsdMicros: 5_000_000n,
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_5_USD",
  },
  usage_10_usd: {
    cashAmountMinor: 1_000,
    cashCurrency: "usd",
    grantUsdMicros: 10_000_000n,
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_10_USD",
  },
  usage_20_usd: {
    cashAmountMinor: 2_000,
    cashCurrency: "usd",
    grantUsdMicros: 20_000_000n,
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_20_USD",
  },
  usage_25_usd: {
    cashAmountMinor: 2_500,
    cashCurrency: "usd",
    grantUsdMicros: 25_000_000n,
    priceIdEnvKey: "HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_25_USD",
  },
} as const satisfies Record<
  HostedUsageCreditOfferCode,
  Omit<HostedUsageCreditOfferDefinition, "code">
>;

export function parseHostedUsageCreditOfferCode(
  value: unknown,
): HostedUsageCreditOfferCode | null {
  return typeof value === "string" &&
      HOSTED_USAGE_CREDIT_OFFER_CODES.includes(value as HostedUsageCreditOfferCode)
    ? value as HostedUsageCreditOfferCode
    : null;
}

export function parseHostedGroupSponsorshipOfferCode(
  value: unknown,
): HostedGroupSponsorshipOfferCode | null {
  const parsed = parseHostedUsageCreditOfferCode(value);
  return parsed &&
      HOSTED_GROUP_SPONSORSHIP_OFFER_CODES.includes(
        parsed as HostedGroupSponsorshipOfferCode,
      )
    ? parsed as HostedGroupSponsorshipOfferCode
    : null;
}

export function filterHostedNonGroupUsageCreditOfferCodes(
  offerCodes: readonly HostedUsageCreditOfferCode[],
): HostedUsageCreditOfferCode[] {
  return offerCodes.filter((offerCode) =>
    HOSTED_NONGROUP_USAGE_CREDIT_OFFER_CODES.includes(
      offerCode as (typeof HOSTED_NONGROUP_USAGE_CREDIT_OFFER_CODES)[number],
    )
  );
}

export function getHostedUsageCreditOfferDefinition(
  code: HostedUsageCreditOfferCode,
): HostedUsageCreditOfferDefinition {
  return {
    ...HOSTED_USAGE_CREDIT_OFFER_DEFINITIONS[code],
    code,
  };
}
