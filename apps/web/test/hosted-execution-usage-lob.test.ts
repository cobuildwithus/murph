import { describe, expect, it } from "vitest";

import {
  buildHostedLobPhysicalNoteUsageRecord,
  HOSTED_LOB_USAGE_PRICING_VERSION,
  matchHostedLobPhysicalNoteUsageRecord,
} from "../src/lib/hosted-execution/usage-lob";
import { priceHostedAiUsageForAllowance } from "../src/lib/hosted-execution/usage-allowance";

describe("Lob physical-note usage", () => {
  it("accounts the exact configured provider cost through the existing usage owner", () => {
    const record = buildHostedLobPhysicalNoteUsageRecord({
      memberId: "member_1",
      occurredAt: new Date("2026-07-30T18:00:00.000Z"),
      physicalNoteId: "hpn_1",
      providerCostUsdMicros: 1_389_000,
      providerLetterId: "ltr_123",
      providerPricingVersion: "lob-account-rate-2026-07",
    });

    expect(matchHostedLobPhysicalNoteUsageRecord(record)).toEqual({
      providerCostUsdMicros: 1_389_000n,
      providerPricingVersion: "lob-account-rate-2026-07",
    });
    expect(priceHostedAiUsageForAllowance(record)).toMatchObject({
      costUsdMicros: 1_389_000n,
      counted: true,
      pricingVersion: HOSTED_LOB_USAGE_PRICING_VERSION,
    });
  });

  it("rejects provider-shaped rows that do not carry the exact Lob contract", () => {
    const record = buildHostedLobPhysicalNoteUsageRecord({
      memberId: "member_1",
      occurredAt: new Date("2026-07-30T18:00:00.000Z"),
      physicalNoteId: "hpn_1",
      providerCostUsdMicros: 1_389_000,
      providerLetterId: "ltr_123",
      providerPricingVersion: "lob-account-rate-2026-07",
    });

    expect(matchHostedLobPhysicalNoteUsageRecord({
      ...record,
      usageExtractionSourcePath: "lob.other",
    })).toBeNull();
  });
});
