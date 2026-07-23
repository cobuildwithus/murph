export interface OverviewWeeklyStat {
  currentWeekAvg: number | null;
  deltaPercent: number | null;
  previousWeekAvg: number | null;
  stream: string;
  unit: string | null;
}

export interface OverviewWeeklySampleSummary {
  date: string;
  numericSampleCount: number;
  sampleCount: number;
  stream: string;
  sumValue: number | null;
  unit: string | null;
}

export interface OverviewWeeklyStatDetails extends OverviewWeeklyStat {
  currentWeekObservedDates: string[];
}

interface OverviewWeeklySampleAccumulator {
  numericSampleCount: number;
  observedDates: Set<string>;
  stream: string;
  sumValue: number;
  unit: string | null;
}

export function buildOverviewWeeklyStatsFromDailySampleSummaries(
  summaries: readonly OverviewWeeklySampleSummary[],
  timeZone: string,
  referenceDate: Date | string = new Date(),
): OverviewWeeklyStat[] {
  return buildOverviewWeeklyStatDetailsFromDailySampleSummaries(
    summaries,
    timeZone,
    referenceDate,
  ).map((stat) => ({
    currentWeekAvg: stat.currentWeekAvg,
    deltaPercent: stat.deltaPercent,
    previousWeekAvg: stat.previousWeekAvg,
    stream: stat.stream,
    unit: stat.unit,
  }));
}

/**
 * Package-internal detail used by group reporting. Keep this out of public
 * barrels so overview consumers retain the existing stat shape.
 */
export function buildOverviewWeeklyStatDetailsFromDailySampleSummaries(
  summaries: readonly OverviewWeeklySampleSummary[],
  timeZone: string,
  referenceDate: Date | string = new Date(),
  options: { includeCurrentDay?: boolean } = {},
): OverviewWeeklyStatDetails[] {
  const today = formatOverviewDateTimeParts(resolveOverviewReferenceDate(referenceDate), timeZone);
  const mondayOffset = today.dayOfWeek === 0 ? 6 : today.dayOfWeek - 1;
  const thisWeekStart = addDaysToIsoDate(today.dayKey, -mondayOffset);
  const lastWeekStart = addDaysToIsoDate(thisWeekStart, -7);

  const thisWeekSamples = new Map<string, OverviewWeeklySampleAccumulator>();
  const lastWeekSamples = new Map<string, OverviewWeeklySampleAccumulator>();

  for (const summary of summaries) {
    if (summary.sumValue === null || summary.numericSampleCount <= 0) {
      continue;
    }

    let bucket: Map<string, OverviewWeeklySampleAccumulator> | null = null;

    if (
      summary.date >= thisWeekStart
      && (
        options.includeCurrentDay === false
          ? summary.date < today.dayKey
          : summary.date <= today.dayKey
      )
    ) {
      bucket = thisWeekSamples;
    } else if (summary.date >= lastWeekStart && summary.date < thisWeekStart) {
      bucket = lastWeekSamples;
    }

    if (!bucket) {
      continue;
    }

    const key = buildWeeklyStatKey(summary.stream, summary.unit);
    const existing = bucket.get(key);
    if (existing) {
      existing.numericSampleCount += summary.numericSampleCount;
      existing.observedDates.add(summary.date);
      existing.sumValue += summary.sumValue;
      continue;
    }

    bucket.set(key, {
      numericSampleCount: summary.numericSampleCount,
      observedDates: new Set([summary.date]),
      stream: summary.stream,
      sumValue: summary.sumValue,
      unit: summary.unit,
    });
  }

  const allKeys = new Set([...thisWeekSamples.keys(), ...lastWeekSamples.keys()]);
  const stats: OverviewWeeklyStatDetails[] = [];

  for (const key of allKeys) {
    const currentWeek = thisWeekSamples.get(key);
    const previousWeek = lastWeekSamples.get(key);
    const stream = currentWeek?.stream ?? previousWeek?.stream;

    if (!stream) {
      continue;
    }

    const currentWeekAvg = averageValues(currentWeek ?? null);
    const previousWeekAvg = averageValues(previousWeek ?? null);
    let deltaPercent: number | null = null;

    if (
      currentWeekAvg !== null &&
      previousWeekAvg !== null &&
      previousWeekAvg !== 0
    ) {
      deltaPercent = ((currentWeekAvg - previousWeekAvg) / Math.abs(previousWeekAvg)) * 100;
    }

    stats.push({
      currentWeekAvg,
      currentWeekObservedDates: [...(currentWeek?.observedDates ?? [])]
        .sort((left, right) => left.localeCompare(right)),
      deltaPercent,
      previousWeekAvg,
      stream,
      unit: currentWeek?.unit ?? previousWeek?.unit ?? null,
    });
  }

  return stats.sort((left, right) =>
    left.stream === right.stream
      ? (left.unit ?? "").localeCompare(right.unit ?? "")
      : left.stream.localeCompare(right.stream),
  );
}

function resolveOverviewReferenceDate(referenceDate: Date | string): Date {
  if (referenceDate instanceof Date) {
    return referenceDate;
  }

  const parsed = new Date(referenceDate);

  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError("Overview weekly stats referenceDate must be a valid datetime.");
  }

  return parsed;
}

function buildWeeklyStatKey(stream: string, unit: string | null): string {
  return `${stream}:${unit ?? ""}`;
}

function averageValues(
  value: { numericSampleCount: number; sumValue: number } | null,
): number | null {
  if (!value || value.numericSampleCount <= 0) {
    return null;
  }

  return value.sumValue / value.numericSampleCount;
}

function addDaysToIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatOverviewDateTimeParts(
  value: Date,
  timeZone: string,
): { dayKey: string; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";

  return {
    dayKey: `${year}-${month}-${day}`,
    dayOfWeek: mapWeekdayToIndex(weekday),
  };
}

function mapWeekdayToIndex(weekday: string): number {
  switch (weekday) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    case "Sat":
      return 6;
    default:
      return 1;
  }
}
