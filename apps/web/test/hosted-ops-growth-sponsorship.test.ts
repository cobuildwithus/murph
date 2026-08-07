import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GrowthSponsorships } from "../app/(dashboard)/ops/growth/growth-sponsorships";
import {
  readHostedGrowthSponsorshipMetrics,
  type HostedGrowthSponsorshipQueryClient,
} from "../src/lib/hosted-ops/growth-sponsorship-metrics";

vi.mock("server-only", () => ({}));

describe("hosted ops growth sponsorship metrics", () => {
  it("separates verified monthly charges from one-time contributions", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{
      activeMonthlySponsorships: 2n,
      monthlyPaidPurchasesThisMonth: 3n,
      monthlyPaidThisMonthUsdCents: 1_500n,
      oneTimePaidPurchasesThisMonth: 1n,
      oneTimePaidThisMonthUsdCents: 2_000n,
      paidPurchasesThisMonth: 4n,
      paidThisMonthUsdCents: 3_500n,
      remainingUsageUsdMicros: 11_750_000n,
      usageConsumedThisMonthUsdMicros: 4_250_000n,
    }]);
    const now = new Date("2026-08-07T19:43:59.000Z");

    const metrics = await readHostedGrowthSponsorshipMetrics(now, {
      $queryRaw: queryRaw,
    } as HostedGrowthSponsorshipQueryClient);

    expect(metrics).toEqual({
      activeMonthlySponsorships: 2,
      available: true,
      monthlyPaidPurchasesThisMonth: 3,
      monthlyPaidThisMonthUsdCents: 1_500,
      oneTimePaidPurchasesThisMonth: 1,
      oneTimePaidThisMonthUsdCents: 2_000,
      paidPurchasesThisMonth: 4,
      paidThisMonthUsdCents: 3_500,
      remainingUsageUsdMicros: 11_750_000,
      usageConsumedThisMonthUsdMicros: 4_250_000,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const queryParts = queryRaw.mock.calls[0]?.[0] as TemplateStringsArray;
    const queryText = queryParts.join("?");
    expect(queryText).toContain('"group_sponsorship_authorization_id"');
    expect(queryText).toContain('"hosted_group_sponsorship_moment"');
    expect(queryText).toContain("usage_entry.\"kind\" = 'usage_debit'");
    expect(queryText).toContain('sponsorship_purchase."paid_at"');

    const queryValues = queryRaw.mock.calls[0]?.slice(1) as Date[];
    expect(queryValues.map((value) => value.toISOString())).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-08-07T19:43:59.000Z",
    ]);
  });

  it("returns an explicit unavailable state instead of false zeroes", async () => {
    const error = new Error("database unavailable");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(readHostedGrowthSponsorshipMetrics(
      new Date("2026-08-07T19:43:59.000Z"),
      {
        $queryRaw: vi.fn().mockRejectedValue(error),
      } as HostedGrowthSponsorshipQueryClient,
    )).resolves.toEqual({ available: false });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to read hosted growth sponsorship metrics.",
      error,
    );

    errorSpy.mockRestore();
  });

  it("renders sponsorship cash and usage without presenting either as MRR", () => {
    const markup = renderToStaticMarkup(createElement(GrowthSponsorships, {
      metrics: {
        activeMonthlySponsorships: 2,
        available: true,
        monthlyPaidPurchasesThisMonth: 3,
        monthlyPaidThisMonthUsdCents: 1_500,
        oneTimePaidPurchasesThisMonth: 1,
        oneTimePaidThisMonthUsdCents: 2_000,
        paidPurchasesThisMonth: 4,
        paidThisMonthUsdCents: 3_500,
        remainingUsageUsdMicros: 11_750_000,
        usageConsumedThisMonthUsdMicros: 4_250_000,
      },
    }));

    expect(markup).toContain("Group sponsorships");
    expect(markup).toContain("not subscriptions");
    expect(markup).toContain("Sponsor payments MTD");
    expect(markup).toContain("$35");
    expect(markup).toContain("Sponsored usage MTD");
    expect(markup).toContain("$4.25");
    expect(markup).toContain("Remaining sponsored usage");
    expect(markup).toContain("$11.75");
    expect(markup).toContain("Monthly sponsorship charges");
    expect(markup).toContain("One-time contributions");
    expect(markup).not.toContain("Sponsorship MRR");
  });

  it("renders a visible unavailable state", () => {
    const markup = renderToStaticMarkup(createElement(GrowthSponsorships, {
      metrics: { available: false },
    }));

    expect(markup).toContain("Sponsorship metrics unavailable");
    expect(markup).toContain("Plan MRR");
  });
});
