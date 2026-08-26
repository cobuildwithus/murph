const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface HostedGrowthResolvedGroupMessage {
  memberId: string | null;
  observedAt: Date;
}

export interface HostedGrowthMemberActivation {
  memberId: string;
  privateActivatedAt: Date | null;
}

export interface HostedGrowthGroupPrivateDailyPoint {
  conversions: number;
  date: string;
}

export function findHostedGrowthGroupPrivateConversions(input: {
  activations: readonly HostedGrowthMemberActivation[];
  messages: readonly HostedGrowthResolvedGroupMessage[];
}): string[] {
  const firstGroupMessageByMember = new Map<string, Date>();
  for (const message of input.messages) {
    if (message.memberId === null) {
      continue;
    }
    const current = firstGroupMessageByMember.get(message.memberId);
    if (current === undefined || message.observedAt < current) {
      firstGroupMessageByMember.set(message.memberId, message.observedAt);
    }
  }

  return input.activations.flatMap((activation) => {
    const firstGroupMessageAt = firstGroupMessageByMember.get(activation.memberId);
    if (
      firstGroupMessageAt === undefined
      || activation.privateActivatedAt === null
      || activation.privateActivatedAt <= firstGroupMessageAt
    ) {
      return [];
    }

    return [activation.memberId];
  });
}

export function buildHostedGrowthGroupPrivateDailySeries(input: {
  dayCount: number;
  trackingRows: ReadonlyArray<{
    groupPrivateConversionTrackedAt: Date | null;
  }>;
  windowEnd: Date;
}): HostedGrowthGroupPrivateDailyPoint[] {
  const todayStart = startOfUtcDay(input.windowEnd);
  const firstDay = addUtcDays(todayStart, -(input.dayCount - 1));
  const endExclusive = addUtcDays(todayStart, 1);
  const points = new Map<string, HostedGrowthGroupPrivateDailyPoint>();

  for (let dayIndex = 0; dayIndex < input.dayCount; dayIndex += 1) {
    const date = addUtcDays(firstDay, dayIndex);
    const key = formatUtcDateKey(date);
    points.set(key, {
      conversions: 0,
      date: key,
    });
  }

  for (const row of input.trackingRows) {
    const trackedAt = row.groupPrivateConversionTrackedAt;
    if (
      trackedAt === null
      || trackedAt < firstDay
      || trackedAt >= endExclusive
    ) {
      continue;
    }
    const point = points.get(formatUtcDateKey(trackedAt));
    if (point) {
      point.conversions += 1;
    }
  }

  return [...points.values()];
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

function formatUtcDateKey(value: Date): string {
  return startOfUtcDay(value).toISOString().slice(0, 10);
}
