const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVITY_SERIES_DAYS = 30;

export interface HostedGrowthActivitySnapshot {
  activeUsersPriorDay: number | null;
  activeUsersTrailing7Days: number | null;
  snapshotDate: Date;
}

export interface HostedGrowthActivityPoint {
  activeUsersPerDay: number | null;
  activeUsersTrailing7Days: number | null;
  date: string;
}

export function buildHostedGrowthActivitySeries(input: {
  snapshots: HostedGrowthActivitySnapshot[];
  windowEnd: Date;
}): HostedGrowthActivityPoint[] {
  const lastSnapshotDate = startOfUtcDay(input.windowEnd);
  const firstSnapshotDate = addUtcDays(
    lastSnapshotDate,
    -(ACTIVITY_SERIES_DAYS - 1),
  );
  const snapshotsByDate = new Map(
    input.snapshots.map((snapshot) => [
      formatUtcDateKey(snapshot.snapshotDate),
      snapshot,
    ]),
  );

  return Array.from({ length: ACTIVITY_SERIES_DAYS }, (_, index) => {
    const snapshotDate = addUtcDays(firstSnapshotDate, index);
    const snapshot = snapshotsByDate.get(formatUtcDateKey(snapshotDate));

    return {
      activeUsersPerDay: snapshot?.activeUsersPriorDay ?? null,
      activeUsersTrailing7Days:
        snapshot?.activeUsersTrailing7Days ?? null,
      date: formatUtcDateKey(addUtcDays(snapshotDate, -1)),
    };
  });
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * MS_PER_DAY);
}

function formatUtcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}
