export const HOSTED_USAGE_CREDIT_OFFER_CODES = [
  "usage_5_usd",
  "usage_10_usd",
  "usage_25_usd",
] as const;

export type HostedUsageCreditOfferCode =
  (typeof HOSTED_USAGE_CREDIT_OFFER_CODES)[number];

export const HOSTED_USAGE_CREDIT_CHECKOUT_REQUEST_POLICY_VERSION =
  "hosted-usage-credit-checkout-v1" as const;
export const HOSTED_USAGE_CREDIT_CHECKOUT_PURPOSE =
  "hosted_usage_credit" as const;

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

// Credit is spent as real model cost, so a message count is an estimate, never
// an entitlement. Every surface quotes it from this one figure, and always as
// an approximation, so no two surfaces can promise different amounts.
export const HOSTED_USAGE_CREDIT_USD_PER_MESSAGE = 0.05;

export function estimateHostedUsageCreditMessages(
  cashAmountMinor: number,
): number {
  return Math.round(
    cashAmountMinor / 100 / HOSTED_USAGE_CREDIT_USD_PER_MESSAGE,
  );
}

export function parseHostedUsageCreditOfferCode(
  value: unknown,
): HostedUsageCreditOfferCode | null {
  return typeof value === "string" &&
      HOSTED_USAGE_CREDIT_OFFER_CODES.includes(value as HostedUsageCreditOfferCode)
    ? value as HostedUsageCreditOfferCode
    : null;
}

export function getHostedUsageCreditOfferDefinition(
  code: HostedUsageCreditOfferCode,
): HostedUsageCreditOfferDefinition {
  return {
    ...HOSTED_USAGE_CREDIT_OFFER_DEFINITIONS[code],
    code,
  };
}
