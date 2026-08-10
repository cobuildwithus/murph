const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface HostedGrowthReferralLinkClaimRow {
  createdAt: Date;
  member: {
    hostedMailboxItems: {
      occurredAt: Date;
    }[];
  };
  referrerMemberId: string | null;
}

export interface HostedGrowthReferralLinkDailyPoint {
  activatedClaims: number;
  claims: number;
  date: string;
}

export interface HostedGrowthReferralLinkUsage {
  activatedClaims: number;
  activationRatePercent: number | null;
  activeReferrers: number;
  claims: number;
  dailySeries: HostedGrowthReferralLinkDailyPoint[];
}

export function buildHostedGrowthReferralLinkUsage(input: {
  claimRows: HostedGrowthReferralLinkClaimRow[];
  dayCount: number;
  windowEnd: Date;
}): HostedGrowthReferralLinkUsage {
  const todayStart = startOfUtcDay(input.windowEnd);
  const firstDay = addUtcDays(todayStart, -(input.dayCount - 1));
  const dailyPoints = new Map<string, HostedGrowthReferralLinkDailyPoint>();

  for (let dayIndex = 0; dayIndex < input.dayCount; dayIndex += 1) {
    const date = addUtcDays(firstDay, dayIndex).toISOString().slice(0, 10);
    dailyPoints.set(date, {
      activatedClaims: 0,
      claims: 0,
      date,
    });
  }

  const activeReferrers = new Set<string>();
  let activatedClaims = 0;
  let claims = 0;

  for (const row of input.claimRows) {
    if (
      row.referrerMemberId === null
      || row.createdAt < firstDay
      || row.createdAt > input.windowEnd
    ) {
      continue;
    }

    const date = startOfUtcDay(row.createdAt).toISOString().slice(0, 10);
    const point = dailyPoints.get(date);
    if (!point) {
      continue;
    }

    claims += 1;
    point.claims += 1;
    activeReferrers.add(row.referrerMemberId);

    const activated = row.member.hostedMailboxItems.some((activation) =>
      activation.occurredAt >= row.createdAt
      && activation.occurredAt <= input.windowEnd
    );
    if (activated) {
      activatedClaims += 1;
      point.activatedClaims += 1;
    }
  }

  return {
    activatedClaims,
    activationRatePercent: claims === 0
      ? null
      : (activatedClaims / claims) * 100,
    activeReferrers: activeReferrers.size,
    claims,
    dailySeries: [...dailyPoints.values()],
  };
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * MS_PER_DAY);
}
