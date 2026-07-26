import { describe, expect, it } from "vitest";

import {
  estimateHostedUsageCreditMessages,
  getHostedUsageCreditOfferDefinition,
  HOSTED_USAGE_CREDIT_OFFER_CODES,
  parseHostedUsageCreditOfferCode,
} from "@/src/lib/hosted-onboarding/usage-credit-offers";

describe("hosted usage-credit offer catalog", () => {
  it("freezes the exact $5, $10, and $25 one-time offers", () => {
    expect(HOSTED_USAGE_CREDIT_OFFER_CODES.map((code) =>
      getHostedUsageCreditOfferDefinition(code)
    )).toEqual([
      expect.objectContaining({
        cashAmountMinor: 500,
        cashCurrency: "usd",
        code: "usage_5_usd",
        grantUsdMicros: 5_000_000n,
      }),
      expect.objectContaining({
        cashAmountMinor: 1_000,
        cashCurrency: "usd",
        code: "usage_10_usd",
        grantUsdMicros: 10_000_000n,
      }),
      expect.objectContaining({
        cashAmountMinor: 2_500,
        cashCurrency: "usd",
        code: "usage_25_usd",
        grantUsdMicros: 25_000_000n,
      }),
    ]);
  });

  it("quotes every offer's message estimate from one rate", () => {
    expect(
      HOSTED_USAGE_CREDIT_OFFER_CODES.map((code) =>
        estimateHostedUsageCreditMessages(
          getHostedUsageCreditOfferDefinition(code).cashAmountMinor,
        )
      ),
    ).toEqual([100, 200, 500]);
  });

  it("accepts only exact internal offer codes", () => {
    expect(parseHostedUsageCreditOfferCode("usage_10_usd")).toBe("usage_10_usd");
    expect(parseHostedUsageCreditOfferCode(" usage_10_usd ")).toBeNull();
    expect(parseHostedUsageCreditOfferCode("usage_100_usd")).toBeNull();
    expect(parseHostedUsageCreditOfferCode(10)).toBeNull();
  });
});
