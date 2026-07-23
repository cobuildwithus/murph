import {
  addDaysToIsoDate,
  formatTimeZoneDateTimeParts,
} from "@murphai/contracts";

import {
  buildOverviewWeeklyStatsFromDailySampleSummaries,
  type OverviewWeeklySampleSummary,
} from "./overview-weekly-stats.ts";

const BROAD_ACTIVITY_MINUTES_SEMANTICS = "broad-movement";
const CANONICAL_WORKOUT_DAY_SEMANTICS = "canonical-workout-day";

interface SharedGroupWeeklyMemberInput {
  displayName: string | null;
  memberId: string;
  shares: readonly {
    projectionScopeKey: string;
    records: readonly { data: object }[];
  }[];
}

interface SharedGroupDailyMetricData {
  date: string;
  metricKey: string;
  metricSemantics?: string;
  unit: string | null;
  value: number;
}

interface SharedGroupWorkoutDayData {
  date: string;
  metricSemantics?: string;
  workoutCount: number;
  workoutMinutes: number;
}

interface SharedGroupActivityMinutesDayData {
  date: string;
  sessionMinutes: number;
}

interface SharedGroupActivityDistanceDayData {
  date: string;
  sessionDistanceMeters: number;
}

interface SharedGroupActivitySessionCountDayData {
  date: string;
  sessionCount: number;
}

interface SharedGroupHeartRateZoneDayData {
  date: string;
  zones: readonly {
    durationMinutes: number;
    label?: string;
    zone?: number;
  }[];
}

export interface SharedGroupWeeklyStat {
  currentWeekAvg: number;
  observedDayCount: number;
  observedDates: string[];
  stream: string;
  throughDate: string;
  unit: string | null;
}

export interface SharedGroupWeeklyMember {
  displayName: string | null;
  memberId: string;
  weeklyStats: SharedGroupWeeklyStat[];
}

/**
 * Pure current-calendar-week summary over the bounded consented group projection.
 * The projection currently retains seven records per scope, so this reader does not
 * claim a complete prior-week comparison.
 */
export function buildSharedGroupWeeklyMembers(input: {
  members: readonly SharedGroupWeeklyMemberInput[];
  referenceAt: Date | string;
  timeZone: string;
}): SharedGroupWeeklyMember[] {
  const window = resolveSharedGroupWeeklyWindow(
    input.referenceAt,
    input.timeZone,
  );

  return input.members.map((member) => {
    const completedDailySummaries = readDailySampleSummaries(member)
      .filter((summary) => summary.date < window.currentDay);
    const coverageByStat = buildSharedGroupWeeklyCoverage(
      completedDailySummaries,
      window.currentWeekStart,
      window.currentDay,
    );

    return {
      displayName: member.displayName,
      memberId: member.memberId,
      weeklyStats: buildOverviewWeeklyStatsFromDailySampleSummaries(
        completedDailySummaries,
        input.timeZone,
        input.referenceAt,
      ).flatMap((stat) => {
        if (stat.currentWeekAvg === null) {
          return [];
        }
        const coverage = coverageByStat.get(
          buildSharedGroupWeeklyStatKey(stat.stream, stat.unit),
        );
        if (!coverage) {
          return [];
        }
        const observedDates = [...coverage]
          .sort((left, right) => left.localeCompare(right));
        const throughDate = observedDates.at(-1);
        return throughDate
          ? [{
              currentWeekAvg: stat.currentWeekAvg,
              observedDayCount: observedDates.length,
              observedDates,
              stream: stat.stream,
              throughDate,
              unit: stat.unit,
            }]
          : [];
      }),
    };
  });
}

function buildSharedGroupWeeklyCoverage(
  summaries: readonly OverviewWeeklySampleSummary[],
  currentWeekStart: string,
  currentDay: string,
): Map<string, Set<string>> {
  const coverageByStat = new Map<string, Set<string>>();

  for (const summary of summaries) {
    if (
      summary.sumValue === null
      || summary.numericSampleCount <= 0
      || summary.date < currentWeekStart
      || summary.date >= currentDay
    ) {
      continue;
    }

    const key = buildSharedGroupWeeklyStatKey(summary.stream, summary.unit);
    const existing = coverageByStat.get(key);
    if (existing) {
      existing.add(summary.date);
      continue;
    }

    coverageByStat.set(key, new Set([summary.date]));
  }

  return coverageByStat;
}

function resolveSharedGroupWeeklyWindow(
  referenceAt: Date | string,
  timeZone: string,
): { currentDay: string; currentWeekStart: string } {
  const referenceDate = referenceAt instanceof Date
    ? referenceAt
    : new Date(referenceAt);
  if (Number.isNaN(referenceDate.valueOf())) {
    throw new TypeError(
      "Shared group weekly referenceAt must be a valid datetime.",
    );
  }

  const currentDay = formatTimeZoneDateTimeParts(
    referenceDate,
    timeZone,
  );
  const mondayOffset = currentDay.dayOfWeek === 0
    ? 6
    : currentDay.dayOfWeek - 1;

  return {
    currentDay: currentDay.dayKey,
    currentWeekStart: addDaysToIsoDate(currentDay.dayKey, -mondayOffset),
  };
}

function buildSharedGroupWeeklyStatKey(
  stream: string,
  unit: string | null,
): string {
  return `${stream}:${unit ?? ""}`;
}

function readDailySampleSummaries(
  member: SharedGroupWeeklyMemberInput,
): OverviewWeeklySampleSummary[] {
  const summaries: OverviewWeeklySampleSummary[] = [];
  for (const share of member.shares) {
    for (const record of share.records) {
      appendDailySampleSummaries({
        projectionScopeKey: share.projectionScopeKey,
        record,
        summaries,
      });
    }
  }
  return summaries.sort(compareDailySampleSummaries);
}

function appendDailySampleSummaries(input: {
  projectionScopeKey: string;
  record: { data: object };
  summaries: OverviewWeeklySampleSummary[];
}): void {
  const data = input.record.data;
  if (isDailyMetricData(data)) {
    if (
      input.projectionScopeKey === "activity-days.v0"
      && data.metricKey === "activity-minutes"
      && data.metricSemantics !== BROAD_ACTIVITY_MINUTES_SEMANTICS
    ) {
      return;
    }
    input.summaries.push(dailySummary({
      date: data.date,
      stream: data.metricKey,
      sumValue: data.value,
      unit: data.unit,
    }));
    return;
  }
  if (isWorkoutDayData(data)) {
    if (
      input.projectionScopeKey !== "workout-days.v0"
      || data.metricSemantics !== CANONICAL_WORKOUT_DAY_SEMANTICS
    ) {
      return;
    }
    input.summaries.push(
      dailySummary({
        date: data.date,
        stream: "workout-count",
        sumValue: data.workoutCount,
        unit: "count",
      }),
      dailySummary({
        date: data.date,
        stream: "workout-minutes",
        sumValue: data.workoutMinutes,
        unit: "minutes",
      }),
    );
    return;
  }
  if (isActivityMinutesDayData(data)) {
    input.summaries.push(dailySummary({
      date: data.date,
      stream: input.projectionScopeKey,
      sumValue: data.sessionMinutes,
      unit: "minutes",
    }));
    return;
  }
  if (isActivityDistanceDayData(data)) {
    input.summaries.push(dailySummary({
      date: data.date,
      stream: input.projectionScopeKey,
      sumValue: data.sessionDistanceMeters,
      unit: "meters",
    }));
    return;
  }
  if (isActivitySessionCountDayData(data)) {
    input.summaries.push(dailySummary({
      date: data.date,
      stream: input.projectionScopeKey,
      sumValue: data.sessionCount,
      unit: "count",
    }));
    return;
  }
  if (isHeartRateZoneDayData(data)) {
    for (const zone of data.zones) {
      const stream = typeof zone.zone === "number"
        ? `heart-rate-zone-${zone.zone}-minutes`
        : zone.label?.trim()
          ? `heart-rate-zone-${zone.label.trim().toLowerCase().replace(/\s+/gu, "-")}-minutes`
          : null;
      if (stream) {
        input.summaries.push(dailySummary({
          date: data.date,
          stream,
          sumValue: zone.durationMinutes,
          unit: "minutes",
        }));
      }
    }
  }
}

function dailySummary(input: {
  date: string;
  stream: string;
  sumValue: number;
  unit: string | null;
}): OverviewWeeklySampleSummary {
  return {
    date: input.date,
    numericSampleCount: 1,
    sampleCount: 1,
    stream: input.stream,
    sumValue: input.sumValue,
    unit: input.unit,
  };
}

function compareDailySampleSummaries(
  left: OverviewWeeklySampleSummary,
  right: OverviewWeeklySampleSummary,
): number {
  return left.date === right.date
    ? left.stream.localeCompare(right.stream)
    : left.date.localeCompare(right.date);
}

function isDailyMetricData(
  data: object,
): data is SharedGroupDailyMetricData {
  return "date" in data
    && typeof data.date === "string"
    && "metricKey" in data
    && typeof data.metricKey === "string"
    && (
      !("metricSemantics" in data)
      || typeof data.metricSemantics === "string"
    )
    && "unit" in data
    && (typeof data.unit === "string" || data.unit === null)
    && "value" in data
    && typeof data.value === "number";
}

function isWorkoutDayData(
  data: object,
): data is SharedGroupWorkoutDayData {
  return "date" in data
    && typeof data.date === "string"
    && (
      !("metricSemantics" in data)
      || typeof data.metricSemantics === "string"
    )
    && "workoutCount" in data
    && typeof data.workoutCount === "number"
    && "workoutMinutes" in data
    && typeof data.workoutMinutes === "number";
}

function isActivityMinutesDayData(
  data: object,
): data is SharedGroupActivityMinutesDayData {
  return "date" in data
    && typeof data.date === "string"
    && "sessionMinutes" in data
    && typeof data.sessionMinutes === "number";
}

function isActivityDistanceDayData(
  data: object,
): data is SharedGroupActivityDistanceDayData {
  return "date" in data
    && typeof data.date === "string"
    && "sessionDistanceMeters" in data
    && typeof data.sessionDistanceMeters === "number";
}

function isActivitySessionCountDayData(
  data: object,
): data is SharedGroupActivitySessionCountDayData {
  return "date" in data
    && typeof data.date === "string"
    && "sessionCount" in data
    && typeof data.sessionCount === "number";
}

function isHeartRateZoneDayData(
  data: object,
): data is SharedGroupHeartRateZoneDayData {
  return "date" in data
    && typeof data.date === "string"
    && "zones" in data
    && Array.isArray(data.zones)
    && data.zones.every((zone) => (
      typeof zone === "object"
      && zone !== null
      && "durationMinutes" in zone
      && typeof zone.durationMinutes === "number"
      && (!("label" in zone) || typeof zone.label === "string")
      && (!("zone" in zone) || typeof zone.zone === "number")
    ));
}
