import {
  addDaysToIsoDate,
  normalizeActivityKindToken,
  toLocalDayKey,
} from "@murphai/contracts";

import type { OverviewWeeklySampleSummary } from "./overview-weekly-stats.ts";

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
  unit: string | null;
  value: number;
}

interface SharedGroupWorkoutDayData {
  date: string;
  workoutCount: number;
  workoutMinutes: number;
}

interface SharedGroupWorkoutsDayData {
  calendarClosedThroughDate: string;
  date: string;
  timeSemantics: "canonical-event-zone-or-vault-zone.v0";
  workouts: readonly {
    kind: string;
    minutes: number;
  }[];
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
  completedDaysAvg: number;
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
 * Pure seven-completed-day summary over the bounded consented group projection.
 * The current local day stays open and is never included.
 */
export function buildSharedGroupWeeklyMembers(input: {
  members: readonly SharedGroupWeeklyMemberInput[];
  referenceAt: Date | string;
  timeZone: string;
}): SharedGroupWeeklyMember[] {
  return input.members.map((member) => ({
    displayName: member.displayName,
    memberId: member.memberId,
    weeklyStats: buildCompletedDayStats(
      readDailySampleSummaries(member),
      input.timeZone,
      input.referenceAt,
    ),
  }));
}

function buildCompletedDayStats(
  summaries: readonly OverviewWeeklySampleSummary[],
  timeZone: string,
  referenceAt: Date | string,
): SharedGroupWeeklyStat[] {
  const today = toLocalDayKey(referenceAt, timeZone);
  const from = addDaysToIsoDate(today, -7);
  const grouped = new Map<string, {
    numericSampleCount: number;
    observedDates: Set<string>;
    stream: string;
    sumValue: number;
    unit: string | null;
  }>();

  for (const summary of summaries) {
    if (
      summary.date < from
      || summary.date >= today
      || summary.sumValue === null
      || summary.numericSampleCount <= 0
    ) {
      continue;
    }
    const key = `${summary.stream}:${summary.unit ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.numericSampleCount += summary.numericSampleCount;
      existing.observedDates.add(summary.date);
      existing.sumValue += summary.sumValue;
      continue;
    }
    grouped.set(key, {
      numericSampleCount: summary.numericSampleCount,
      observedDates: new Set([summary.date]),
      stream: summary.stream,
      sumValue: summary.sumValue,
      unit: summary.unit,
    });
  }

  return [...grouped.values()]
    .map((stat) => {
      const observedDates = [...stat.observedDates]
        .sort((left, right) => left.localeCompare(right));
      return {
        completedDaysAvg: stat.sumValue / stat.numericSampleCount,
        observedDayCount: observedDates.length,
        observedDates,
        stream: stat.stream,
        throughDate: observedDates.at(-1) ?? from,
        unit: stat.unit,
      };
    })
    .sort((left, right) =>
      left.stream === right.stream
        ? (left.unit ?? "").localeCompare(right.unit ?? "")
        : left.stream.localeCompare(right.stream)
    );
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
    input.summaries.push(dailySummary({
      date: data.date,
      stream: data.metricKey,
      sumValue: data.value,
      unit: data.unit,
    }));
    return;
  }
  if (isWorkoutDayData(data)) {
    if (input.projectionScopeKey !== "workout-days.v0") {
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
  if (
    input.projectionScopeKey === "workouts.v0"
    && isWorkoutsDayData(data)
  ) {
    appendWorkoutKindDailySummaries(data, input.summaries);
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

function appendWorkoutKindDailySummaries(
  data: SharedGroupWorkoutsDayData,
  summaries: OverviewWeeklySampleSummary[],
): void {
  if (data.date > data.calendarClosedThroughDate) {
    return;
  }
  const byKind = new Map<string, { count: number; minutes: number }>();
  for (const workout of data.workouts) {
    const existing = byKind.get(workout.kind) ?? { count: 0, minutes: 0 };
    existing.count += 1;
    existing.minutes += workout.minutes;
    byKind.set(workout.kind, existing);
  }
  for (const [kind, totals] of byKind) {
    summaries.push(
      dailySummary({
        date: data.date,
        stream: `workout-kind-${kind}-count`,
        sumValue: totals.count,
        unit: "count",
      }),
      dailySummary({
        date: data.date,
        stream: `workout-kind-${kind}-minutes`,
        sumValue: totals.minutes,
        unit: "minutes",
      }),
    );
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
    && "workoutCount" in data
    && typeof data.workoutCount === "number"
    && "workoutMinutes" in data
    && typeof data.workoutMinutes === "number";
}

function isWorkoutsDayData(
  data: object,
): data is SharedGroupWorkoutsDayData {
  return "calendarClosedThroughDate" in data
    && typeof data.calendarClosedThroughDate === "string"
    && "date" in data
    && typeof data.date === "string"
    && "timeSemantics" in data
    && data.timeSemantics === "canonical-event-zone-or-vault-zone.v0"
    && "workouts" in data
    && Array.isArray(data.workouts)
    && data.workouts.every((workout) => (
      typeof workout === "object"
      && workout !== null
      && "kind" in workout
      && typeof workout.kind === "string"
      && workout.kind.length <= 80
      && normalizeActivityKindToken(workout.kind) === workout.kind
      && "minutes" in workout
      && typeof workout.minutes === "number"
      && Number.isFinite(workout.minutes)
      && workout.minutes > 0
      && workout.minutes <= 24 * 60
    ));
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
