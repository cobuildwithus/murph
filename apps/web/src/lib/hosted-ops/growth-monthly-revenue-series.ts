export const MONTHLY_REVENUE_MONTHS = 6;

export interface HostedGrowthRevenueSnapshotInput {
  familyMrrUsdCents: number | null;
  individualMrrUsdCents: number | null;
  mrrUsdCents: number;
  snapshotDate: Date;
}

export interface HostedGrowthRevenuePurchaseInput {
  cashAmountMinor: number;
  isGroupSponsorship: boolean;
  paidAt: Date;
}

export interface HostedGrowthMonthlyRevenuePoint {
  familySubscriptionsUsdCents: number | null;
  groupSponsorshipUsdCents: number;
  individualSubscriptionsUsdCents: number | null;
  month: string;
  subscriptionsUnsplitUsdCents: number | null;
  totalUsdCents: number;
  usageTopUpsUsdCents: number;
}

/**
 * Subscription revenue per month is the MRR recorded by that month's latest
 * daily snapshot; there is no local subscription invoice ledger to sum.
 * Snapshot rows written before the split columns existed only carry the MRR
 * total, so those months report one unsplit subscription value instead of the
 * individual/family split. Top-up and sponsorship revenue sums fulfilled
 * purchase cash by the UTC month of payment. Months before the first snapshot
 * or purchase are trimmed; the window-end month always renders.
 */
export function buildHostedGrowthMonthlyRevenueSeries(input: {
  monthCount: number;
  purchases: HostedGrowthRevenuePurchaseInput[];
  snapshots: HostedGrowthRevenueSnapshotInput[];
  windowEnd: Date;
}): HostedGrowthMonthlyRevenuePoint[] {
  const endMonthStart = startOfUtcMonth(input.windowEnd);
  const latestSnapshotByMonth = new Map<
    string,
    HostedGrowthRevenueSnapshotInput
  >();
  for (const snapshot of input.snapshots) {
    const month = formatUtcMonthKey(snapshot.snapshotDate);
    const existing = latestSnapshotByMonth.get(month);
    if (existing === undefined || existing.snapshotDate < snapshot.snapshotDate) {
      latestSnapshotByMonth.set(month, snapshot);
    }
  }

  const purchaseTotalsByMonth = new Map<string, {
    groupSponsorshipUsdCents: number;
    usageTopUpsUsdCents: number;
  }>();
  for (const purchase of input.purchases) {
    const month = formatUtcMonthKey(purchase.paidAt);
    const totals = purchaseTotalsByMonth.get(month) ?? {
      groupSponsorshipUsdCents: 0,
      usageTopUpsUsdCents: 0,
    };
    if (purchase.isGroupSponsorship) {
      totals.groupSponsorshipUsdCents += purchase.cashAmountMinor;
    } else {
      totals.usageTopUpsUsdCents += purchase.cashAmountMinor;
    }
    purchaseTotalsByMonth.set(month, totals);
  }

  const months = Array.from({ length: input.monthCount }, (_, index) => {
    const month = formatUtcMonthKey(
      addUtcMonths(endMonthStart, index - (input.monthCount - 1)),
    );
    return {
      hasData: latestSnapshotByMonth.has(month)
        || purchaseTotalsByMonth.has(month),
      month,
    };
  });
  const firstMonthWithData = months.findIndex((candidate) => candidate.hasData);
  const renderedMonths = firstMonthWithData === -1
    ? months.slice(-1)
    : months.slice(firstMonthWithData);

  return renderedMonths.map(({ month }) => {
    const subscriptions = readMonthSubscriptions(
      latestSnapshotByMonth.get(month),
    );
    const purchases = purchaseTotalsByMonth.get(month);
    const groupSponsorshipUsdCents = purchases?.groupSponsorshipUsdCents ?? 0;
    const usageTopUpsUsdCents = purchases?.usageTopUpsUsdCents ?? 0;

    return {
      familySubscriptionsUsdCents: subscriptions.familyUsdCents,
      groupSponsorshipUsdCents,
      individualSubscriptionsUsdCents: subscriptions.individualUsdCents,
      month,
      subscriptionsUnsplitUsdCents: subscriptions.unsplitUsdCents,
      totalUsdCents: (subscriptions.individualUsdCents ?? 0)
        + (subscriptions.familyUsdCents ?? 0)
        + (subscriptions.unsplitUsdCents ?? 0)
        + groupSponsorshipUsdCents
        + usageTopUpsUsdCents,
      usageTopUpsUsdCents,
    };
  });
}

function readMonthSubscriptions(
  snapshot: HostedGrowthRevenueSnapshotInput | undefined,
): {
  familyUsdCents: number | null;
  individualUsdCents: number | null;
  unsplitUsdCents: number | null;
} {
  if (snapshot === undefined) {
    return {
      familyUsdCents: null,
      individualUsdCents: null,
      unsplitUsdCents: null,
    };
  }

  if (
    snapshot.individualMrrUsdCents !== null
    && snapshot.familyMrrUsdCents !== null
  ) {
    return {
      familyUsdCents: snapshot.familyMrrUsdCents,
      individualUsdCents: snapshot.individualMrrUsdCents,
      unsplitUsdCents: null,
    };
  }

  return {
    familyUsdCents: null,
    individualUsdCents: null,
    unsplitUsdCents: snapshot.mrrUsdCents,
  };
}

function addUtcMonths(value: Date, months: number): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth() + months,
    1,
  ));
}

function formatUtcMonthKey(value: Date): string {
  return value.toISOString().slice(0, 7);
}

function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function startOfUtcMonthsAgo(value: Date, monthsAgo: number): Date {
  return addUtcMonths(startOfUtcMonth(value), -monthsAgo);
}
