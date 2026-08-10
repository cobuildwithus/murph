import { describe, expect, it } from "vitest";

import {
  filterHostedNonGroupUsageCreditOfferCodes,
  getHostedUsageCreditOfferDefinition,
  HOSTED_GROUP_SPONSORSHIP_OFFER_CODES,
  HOSTED_USAGE_CREDIT_OFFER_CODES,
  parseHostedGroupSponsorshipOfferCode,
  parseHostedUsageCreditOfferCode,
} from "@/src/lib/hosted-onboarding/usage-credit-offers";

describe("hosted usage-credit offer catalog", () => {
  it("freezes the historical catalog while giving groups a distinct $20 offer", () => {
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
        cashAmountMinor: 2_000,
        cashCurrency: "usd",
        code: "usage_20_usd",
        grantUsdMicros: 20_000_000n,
      }),
      expect.objectContaining({
        cashAmountMinor: 2_500,
        cashCurrency: "usd",
        code: "usage_25_usd",
        grantUsdMicros: 25_000_000n,
      }),
    ]);
  });

  it("keeps dollar amounts exact without a message conversion", () => {
    const source = String.raw`${getHostedUsageCreditOfferDefinition}`;
    expect(source).not.toContain("message");
    expect(source).not.toContain("0.05");
  });

  it("accepts only exact internal offer codes", () => {
    expect(parseHostedUsageCreditOfferCode("usage_10_usd")).toBe("usage_10_usd");
    expect(parseHostedUsageCreditOfferCode(" usage_10_usd ")).toBeNull();
    expect(parseHostedUsageCreditOfferCode("usage_100_usd")).toBeNull();
    expect(parseHostedUsageCreditOfferCode(10)).toBeNull();
  });

  it("keeps group and non-group offer surfaces disjoint", () => {
    expect(HOSTED_GROUP_SPONSORSHIP_OFFER_CODES).toEqual([
      "usage_5_usd",
      "usage_10_usd",
      "usage_20_usd",
    ]);
    expect(parseHostedGroupSponsorshipOfferCode("usage_20_usd")).toBe(
      "usage_20_usd",
    );
    expect(parseHostedGroupSponsorshipOfferCode("usage_25_usd")).toBeNull();
    expect(filterHostedNonGroupUsageCreditOfferCodes(
      HOSTED_USAGE_CREDIT_OFFER_CODES,
    )).toEqual(["usage_5_usd", "usage_10_usd", "usage_25_usd"]);
  });
});
