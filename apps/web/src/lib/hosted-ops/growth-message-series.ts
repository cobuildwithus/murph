const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MESSAGE_SERIES_DAYS = 30;

export interface HostedGrowthMessageSnapshot {
  activeUsersPriorDay: number | null;
  activeUsersTrailing7Days: number | null;
  inboundMessagesPriorDay: number | null;
  outboundMessagesPriorDay: number | null;
  snapshotDate: Date;
}

export interface HostedGrowthMessagePoint {
  activeUsersPerDay: number | null;
  activeUsersTrailing7Days: number | null;
  date: string;
  messagesPerDay: number | null;
  totalMessages: number | null;
}

export function buildHostedGrowthMessageSeries(input: {
  messagesBeforeSeries: number;
  snapshots: HostedGrowthMessageSnapshot[];
  trackingEstablishedBeforeSeries: boolean;
  windowEnd: Date;
}): HostedGrowthMessagePoint[] {
  const lastSnapshotDate = startOfUtcDay(input.windowEnd);
  const firstSnapshotDate = addUtcDays(
    lastSnapshotDate,
    -(MESSAGE_SERIES_DAYS - 1),
  );
  const snapshotsByDate = new Map(
    input.snapshots.map((snapshot) => [
      formatUtcDateKey(snapshot.snapshotDate),
      snapshot,
    ]),
  );
  let totalMessages = input.messagesBeforeSeries;
  let cumulativeAvailable = true;
  let cumulativeStarted = input.trackingEstablishedBeforeSeries;

  return Array.from({ length: MESSAGE_SERIES_DAYS }, (_, index) => {
    const snapshotDate = addUtcDays(firstSnapshotDate, index);
    const snapshot = snapshotsByDate.get(formatUtcDateKey(snapshotDate));
    const inboundMessages = snapshot?.inboundMessagesPriorDay ?? null;
    const outboundMessages = snapshot?.outboundMessagesPriorDay ?? null;
    const messagesPerDay = snapshot === undefined
      || inboundMessages === null
      || outboundMessages === null
      ? null
      : inboundMessages + outboundMessages;

    if (messagesPerDay === null) {
      if (cumulativeStarted) {
        cumulativeAvailable = false;
      }

      return {
        activeUsersPerDay: snapshot?.activeUsersPriorDay ?? null,
        activeUsersTrailing7Days:
          snapshot?.activeUsersTrailing7Days ?? null,
        date: formatUtcDateKey(addUtcDays(snapshotDate, -1)),
        messagesPerDay: null,
        totalMessages: null,
      };
    }

    if (!cumulativeStarted) {
      cumulativeStarted = true;
      cumulativeAvailable = true;
    }
    if (cumulativeAvailable) {
      totalMessages += messagesPerDay;
    }

    return {
      activeUsersPerDay: snapshot?.activeUsersPriorDay ?? null,
      activeUsersTrailing7Days: snapshot?.activeUsersTrailing7Days ?? null,
      date: formatUtcDateKey(addUtcDays(snapshotDate, -1)),
      messagesPerDay,
      totalMessages: cumulativeAvailable ? totalMessages : null,
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
