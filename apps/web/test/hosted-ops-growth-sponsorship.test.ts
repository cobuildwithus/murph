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
  it("separates live fulfilled charges and derives the active cap through lazy rollover", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{
      activeMonthlyCapUsdCents: 3_000n,
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
      activeMonthlyCapUsdCents: 3_000,
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
    expect(queryText).toContain('purchase."status" = \'fulfilled\'');
    expect(queryText).toContain('purchase."stripe_live_mode" = TRUE');
    expect(queryText).toContain(
      'purchase."paid_at" < bounds.captured_at',
    );
    expect(queryText).toContain('"hosted_thread_container"');
    expect(queryText).toContain(
      'sponsorship_authorization."monthly_cap_minor"',
    );
    expect(queryText).toContain(
      'sponsorship_authorization."period_ends_at" <= bounds.captured_at',
    );
    expect(queryText).toContain(
      'sponsorship_authorization."pending_monthly_cap_minor" IS NOT NULL',
    );
    expect(queryText).toContain(
      'activation_purchase."group_sponsorship_charge_ordinal" = 0',
    );
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

  it("fails soft when a database aggregate cannot be represented safely", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsafeValue = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

    await expect(readHostedGrowthSponsorshipMetrics(
      new Date("2026-08-07T19:43:59.000Z"),
      {
        $queryRaw: vi.fn().mockResolvedValue([{
          activeMonthlyCapUsdCents: unsafeValue,
          activeMonthlySponsorships: 0n,
          monthlyPaidPurchasesThisMonth: 0n,
          monthlyPaidThisMonthUsdCents: 0n,
          oneTimePaidPurchasesThisMonth: 0n,
          oneTimePaidThisMonthUsdCents: 0n,
          paidPurchasesThisMonth: 0n,
          paidThisMonthUsdCents: 0n,
          remainingUsageUsdMicros: 0n,
          usageConsumedThisMonthUsdMicros: 0n,
        }]),
      } as HostedGrowthSponsorshipQueryClient,
    )).resolves.toEqual({ available: false });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to read hosted growth sponsorship metrics.",
      expect.any(TypeError),
    );
    const loggedError = errorSpy.mock.calls[0]?.[1];
    expect(loggedError).toBeInstanceOf(TypeError);
    expect((loggedError as Error).message).toContain(
      "activeMonthlyCapUsdCents",
    );

    errorSpy.mockRestore();
  });

  it("renders sponsorship charges, usage, and active cap without calling them MRR", () => {
    const markup = renderToStaticMarkup(createElement(GrowthSponsorships, {
      metrics: {
        activeMonthlyCapUsdCents: 3_000,
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
      titleId: "test-growth-sponsorship-title",
    }));

    expect(markup).toContain('aria-labelledby="test-growth-sponsorship-title"');
    expect(markup).toContain("Group sponsorships");
    expect(markup).toContain("not subscriptions");
    expect(markup).toContain("retained sponsorship ledger");
    expect(markup).toContain("Gross sponsor charges MTD");
    expect(markup).toContain("$35");
    expect(markup).toContain("retained fulfilled payments");
    expect(markup).toContain("refunds not netted");
    expect(markup).toContain("Sponsored usage MTD");
    expect(markup).toContain("$4.25");
    expect(markup).toContain("Remaining sponsored usage");
    expect(markup).toContain("$11.75");
    expect(markup).toContain("Total active monthly cap");
    expect(markup).toContain("$30/mo");
    expect(markup).not.toContain("$30.00/mo");
    expect(markup).toContain("2 active capped authorizations");
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
