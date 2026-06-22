import type {
  ExperimentAdherenceEvidenceRule,
  ExperimentAdherenceTarget,
  ExperimentRunPlan,
  ExperimentRunScheduleIntent,
} from "@murphai/contracts";

export type ExperimentAdherenceCellStatus =
  | "scheduled"
  | "satisfied"
  | "partial"
  | "missed"
  | "failed"
  | "unknown";

export interface ExperimentAdherenceWindows {
  baselineEnd: string | null;
  baselineStart: string | null;
  interventionEnd: string | null;
  interventionStart: string | null;
}

export interface ExperimentAdherenceObservation {
  evidenceId: string;
  eventKind?: string | null;
  localDate: string;
  metricKey?: string | null;
  status?: "completed" | "partial" | "missed" | "skipped" | null;
  targetId?: string | null;
  value?: number | null;
}

export interface ExperimentAdherenceCell {
  targetId: string;
  label: string;
  localDate: string;
  localTime: string | null;
  planned: true;
  status: ExperimentAdherenceCellStatus;
  score: number | null;
  expectedCount: number | null;
  observedCount: number | null;
  evidenceIds: string[];
  reason: string;
}

export interface ExperimentAdherenceCalendarResult {
  timeZone: string;
  targets: Array<{
    targetId: string;
    label: string;
    rollup?: ExperimentAdherenceTarget["rollup"];
    plannedCount: number;
    satisfiedCount: number;
    partialCount: number;
    missedCount: number;
    failedCount: number;
    unknownCount: number;
    scheduledCount: number;
    score: number | null;
  }>;
  cells: ExperimentAdherenceCell[];
  summary: {
    status: "not_started" | "behind" | "on_track" | "met_minimum" | "met_target" | "unknown";
    plannedCount: number;
    satisfiedCount: number;
    partialCount: number;
    missedCount: number;
    failedCount: number;
    unknownCount: number;
    scheduledCount: number;
    score: number | null;
  };
}

export interface BuildExperimentAdherenceCalendarInput {
  asOf: Date | string;
  observations?: readonly ExperimentAdherenceObservation[];
  targets: readonly ExperimentAdherenceTarget[];
  windows: ExperimentAdherenceWindows;
}

interface AdherenceExpectation {
  expectedCount: number;
  label: string;
  localDate: string;
  localTime: string | null;
  target: ExperimentAdherenceTarget;
}

const ISO_LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const MAX_ADHERENCE_CELLS = 3660;

export function buildExperimentAdherenceCalendar(
  input: BuildExperimentAdherenceCalendarInput,
): ExperimentAdherenceCalendarResult {
  const targets = input.targets.slice();
  const timeZone = targets[0]?.calendar.timeZone ?? "UTC";
  const asOf = resolveAsOf(input.asOf, timeZone);
  const observations = input.observations ?? [];
  const expectationCount = targets.reduce(
    (total, target) => total + countExperimentAdherenceExpectations(target, input.windows),
    0,
  );
  if (expectationCount > MAX_ADHERENCE_CELLS) {
    throw new RangeError("Experiment adherence calendar expands beyond the supported cell limit.");
  }

  const expectations = targets.flatMap((target) =>
    expandExperimentAdherenceExpectations(target, input.windows)
  );

  const cells = expectations
    .map((expectation) =>
      evaluateExperimentAdherenceExpectation({
        asOf,
        expectation,
        observations: collectMatchingObservations(expectation.target, expectation.localDate, observations),
      }),
    )
    .sort(compareAdherenceCells);
  const targetSummaries = targets.map((target) => summarizeTargetCells(
    target,
    cells.filter((cell) => cell.targetId === target.targetId),
  ));
  const summary = summarizeCells(cells);

  return {
    timeZone,
    targets: targetSummaries,
    cells,
    summary,
  };
}

export function expandExperimentAdherenceExpectations(
  target: ExperimentAdherenceTarget,
  windows: ExperimentAdherenceWindows,
): AdherenceExpectation[] {
  const range = resolveTargetDateRange(target.phase, windows);
  if (!range) {
    return [];
  }

  switch (target.calendar.kind) {
    case "daily":
      const dailyCalendar = target.calendar;
      return dateRange(range.start, range.end).map((localDate) => ({
        expectedCount: dailyCalendar.targetCountPerDay ?? 1,
        label: target.label,
        localDate,
        localTime: dailyCalendar.localTime ?? null,
        target,
      }));
    case "weekdays":
      const weekdayCalendar = target.calendar;
      return weekdayDateRange(range.start, range.end, weekdayCalendar.weekdays)
        .map((localDate) => ({
          expectedCount: weekdayCalendar.targetCountPerDay ?? 1,
          label: target.label,
          localDate,
          localTime: weekdayCalendar.localTime ?? null,
          target,
        }));
    case "explicitDates":
      return target.calendar.dates
        .filter((entry) => entry.localDate >= range.start && entry.localDate <= range.end)
        .map((entry) => ({
          expectedCount: entry.targetCount ?? 1,
          label: entry.label ?? target.label,
          localDate: entry.localDate,
          localTime: entry.localTime ?? null,
          target,
        }));
  }
}

function countExperimentAdherenceExpectations(
  target: ExperimentAdherenceTarget,
  windows: ExperimentAdherenceWindows,
): number {
  const range = resolveTargetDateRange(target.phase, windows);
  if (!range) {
    return 0;
  }

  switch (target.calendar.kind) {
    case "daily":
      return countLocalDateRangeDays(range.start, range.end);
    case "weekdays":
      return countWeekdaysInRange(range.start, range.end, target.calendar.weekdays);
    case "explicitDates":
      return target.calendar.dates.filter((entry) =>
        entry.localDate >= range.start && entry.localDate <= range.end
      ).length;
  }
}

export function synthesizeLegacySessionAdherenceTargets(input: {
  runPlan: Pick<
    ExperimentRunPlan,
    "minimumUsefulSessions" | "modality" | "schedule" | "sessionsPerWeek" | "targetSessions"
  > | null | undefined;
}): ExperimentAdherenceTarget[] {
  const runPlan = input.runPlan;
  if (!runPlan) {
    return [];
  }

  const label = runPlan.modality?.trim() || "Session";
  const base = {
    targetId: slugifyTargetId(label) ?? "session",
    label,
    phase: "intervention" as const,
    evidence: {
      kind: "linkedEventCount" as const,
      eventKind: "intervention_session" as const,
      missing: "missed_after_grace" as const,
    },
    grace: { hours: 24 },
    rollup: {
      targetCompletions: runPlan.targetSessions,
      minimumUsefulCompletions: runPlan.minimumUsefulSessions,
    },
  };

  if (runPlan.schedule) {
    const calendar = calendarFromLegacySchedule(runPlan.schedule);
    if (calendar) {
      return [{ ...base, calendar }];
    }
  }

  return [];
}

export function resolveExperimentAdherenceRollupTarget<
  Target extends {
    rollup?: ExperimentAdherenceTarget["rollup"] | null;
    targetId: string;
  },
>(targets: readonly Target[]): Target | null {
  const rollupTargets = targets.filter((target) =>
    target.rollup !== undefined && target.rollup !== null
  );
  if (rollupTargets.length === 1) {
    return rollupTargets[0] ?? null;
  }

  if (rollupTargets.length > 1) {
    return null;
  }

  return targets.length === 1 ? targets[0] ?? null : null;
}

function evaluateExperimentAdherenceExpectation(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  const { expectation } = input;
  const { target } = expectation;

  switch (target.evidence.kind) {
    case "linkedEventCount":
      return evaluateLinkedEventCountExpectation(input);
    case "metricPresence":
      return evaluateMetricPresenceExpectation(input);
    case "metricThreshold":
      return evaluateMetricThresholdExpectation(input);
  }
}

function evaluateLinkedEventCountExpectation(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  const evidence = input.expectation.target.evidence;
  if (evidence.kind !== "linkedEventCount") {
    throw new TypeError("Linked-event adherence expectation received non-linked evidence.");
  }
  const partialCredit = evidence.partialCredit ?? 0.5;
  let observedScore = 0;
  for (const observation of input.observations) {
    if (observation.status === "partial") {
      observedScore += partialCredit;
    } else if (observation.status !== "missed" && observation.status !== "skipped") {
      observedScore += 1;
    }
  }

  if (observedScore >= input.expectation.expectedCount) {
    return cell(input.expectation, "satisfied", 1, observedScore, input.observations, "Evidence meets the planned target.");
  }

  if (observedScore > 0) {
    return cell(
      input.expectation,
      "partial",
      Math.max(0, Math.min(1, observedScore / input.expectation.expectedCount)),
      observedScore,
      input.observations,
      "Some evidence was logged, but not enough for the planned target.",
    );
  }

  const explicitMissed = input.observations.filter((observation) => observation.status === "missed");
  if (explicitMissed.length > 0) {
    return cell(
      input.expectation,
      "missed",
      0,
      0,
      explicitMissed,
      "Target evidence was marked missed.",
    );
  }

  const explicitSkipped = input.observations.filter((observation) => observation.status === "skipped");
  if (explicitSkipped.length > 0) {
    return cell(
      input.expectation,
      "missed",
      0,
      0,
      explicitSkipped,
      "Target evidence was marked missed.",
    );
  }

  return missingCell(input);
}

function evaluateMetricPresenceExpectation(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  if (input.observations.length > 0) {
    return cell(input.expectation, "satisfied", 1, 1, input.observations, "Metric evidence is present.");
  }

  return missingCell(input);
}

function evaluateMetricThresholdExpectation(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  const evidence = input.expectation.target.evidence;
  if (evidence.kind !== "metricThreshold") {
    throw new TypeError("Metric-threshold adherence expectation received non-threshold evidence.");
  }
  const observations = input.observations.filter((candidate) => typeof candidate.value === "number");
  if (observations.length === 0) {
    return missingCell(input);
  }

  const passingObservation = observations.find((observation) =>
    typeof observation.value === "number" && metricValueSatisfiesRule(observation.value, evidence)
  );
  if (passingObservation) {
    return cell(input.expectation, "satisfied", 1, 1, [passingObservation], "Metric value meets the target.");
  }

  return cell(input.expectation, "failed", 0, 1, observations, "Metric value did not meet the planned target.");
}

function missingCell(input: {
  asOf: Date;
  expectation: AdherenceExpectation;
  observations: readonly ExperimentAdherenceObservation[];
}): ExperimentAdherenceCell {
  const { expectation } = input;
  const statusWithinGrace = asOfWithinGrace(input.asOf, expectation);
  if (statusWithinGrace) {
    return cell(expectation, "scheduled", null, 0, input.observations, "The planned target is not due yet.");
  }

  const missingPolicy = expectation.target.evidence.missing;
  const status =
    missingPolicy === "missed_after_grace"
      ? "missed"
      : missingPolicy === "failed_after_grace"
        ? "failed"
        : "unknown";
  const score = status === "unknown" ? null : 0;
  const reason =
    status === "unknown"
      ? "No target evidence is available."
      : "No target evidence was logged after the grace window.";

  return cell(expectation, status, score, 0, input.observations, reason);
}

function cell(
  expectation: AdherenceExpectation,
  status: ExperimentAdherenceCellStatus,
  score: number | null,
  observedCount: number | null,
  observations: readonly ExperimentAdherenceObservation[],
  reason: string,
): ExperimentAdherenceCell {
  return {
    targetId: expectation.target.targetId,
    label: expectation.label,
    localDate: expectation.localDate,
    localTime: expectation.localTime,
    planned: true,
    status,
    score,
    expectedCount: expectation.expectedCount,
    observedCount,
    evidenceIds: observations.map((observation) => observation.evidenceId),
    reason,
  };
}

function collectMatchingObservations(
  target: ExperimentAdherenceTarget,
  localDate: string,
  observations: readonly ExperimentAdherenceObservation[],
): ExperimentAdherenceObservation[] {
  return observations.filter((observation) => {
    if (observation.localDate !== localDate) {
      return false;
    }
    if (observation.targetId && observation.targetId !== target.targetId) {
      return false;
    }

    switch (target.evidence.kind) {
      case "linkedEventCount":
        return observation.eventKind === target.evidence.eventKind;
      case "metricPresence":
      case "metricThreshold":
        return observation.metricKey === target.evidence.metricKey;
    }
  });
}

function metricValueSatisfiesRule(
  value: number,
  rule: Extract<ExperimentAdherenceEvidenceRule, { kind: "metricThreshold" }>,
): boolean {
  switch (rule.op) {
    case ">=":
      return value >= (rule.value ?? Number.POSITIVE_INFINITY);
    case "<=":
      return value <= (rule.value ?? Number.NEGATIVE_INFINITY);
    case "==":
      return value === rule.value;
    case "between":
      return value >= (rule.min ?? Number.POSITIVE_INFINITY) &&
        value <= (rule.max ?? Number.NEGATIVE_INFINITY);
  }
}

function asOfWithinGrace(asOf: Date, expectation: AdherenceExpectation): boolean {
  const plannedTime = expectation.localTime ?? "23:59";
  const plannedAtMs = zonedLocalDateTimeToEpochMs(
    expectation.localDate,
    plannedTime,
    expectation.target.calendar.timeZone,
  );
  const grace = expectation.target.grace ?? defaultGrace(expectation.target.evidence);
  const graceMs = "hours" in grace
    ? grace.hours * 60 * 60 * 1_000
    : grace.days * 24 * 60 * 60 * 1_000;

  return asOf.getTime() < plannedAtMs + graceMs;
}

function defaultGrace(evidence: ExperimentAdherenceEvidenceRule): { hours: number } {
  if (evidence.kind === "linkedEventCount") {
    return { hours: 24 };
  }

  return { hours: 0 };
}

function summarizeTargetCells(
  target: ExperimentAdherenceTarget,
  cells: readonly ExperimentAdherenceCell[],
): ExperimentAdherenceCalendarResult["targets"][number] {
  return {
    targetId: target.targetId,
    label: target.label,
    ...(target.rollup ? { rollup: target.rollup } : {}),
    ...countCellStatuses(cells),
    score: scoreCells(cells),
  };
}

function summarizeCells(
  cells: readonly ExperimentAdherenceCell[],
): ExperimentAdherenceCalendarResult["summary"] {
  const counts = countCellStatuses(cells);
  const score = scoreCells(cells);
  const numericCompleted = counts.satisfiedCount + counts.partialCount;
  let status: ExperimentAdherenceCalendarResult["summary"]["status"] = "unknown";

  if (counts.plannedCount === 0) {
    status = "unknown";
  } else if (numericCompleted === 0) {
    status = "not_started";
  } else if (counts.missedCount > 0 || counts.failedCount > 0) {
    status = "behind";
  } else if (counts.scheduledCount > 0 || counts.unknownCount > 0) {
    status = "on_track";
  } else {
    status = "met_target";
  }

  return {
    ...counts,
    score,
    status,
  };
}

function countCellStatuses(cells: readonly ExperimentAdherenceCell[]) {
  return {
    plannedCount: cells.length,
    satisfiedCount: countCells(cells, "satisfied"),
    partialCount: countCells(cells, "partial"),
    missedCount: countCells(cells, "missed"),
    failedCount: countCells(cells, "failed"),
    unknownCount: countCells(cells, "unknown"),
    scheduledCount: countCells(cells, "scheduled"),
  };
}

function countCells(
  cells: readonly ExperimentAdherenceCell[],
  status: ExperimentAdherenceCellStatus,
): number {
  return cells.filter((cell) => cell.status === status).length;
}

function scoreCells(cells: readonly ExperimentAdherenceCell[]): number | null {
  const scored = cells.filter((cell) => cell.score !== null);
  if (scored.length === 0) {
    return null;
  }

  return round(scored.reduce((sum, cell) => sum + (cell.score ?? 0), 0) / scored.length);
}

function resolveTargetDateRange(
  phase: ExperimentAdherenceTarget["phase"],
  windows: ExperimentAdherenceWindows,
): { end: string; start: string } | null {
  if (phase === "baseline") {
    return windows.baselineStart && windows.baselineEnd
      ? { start: windows.baselineStart, end: windows.baselineEnd }
      : null;
  }

  if (phase === "intervention") {
    return windows.interventionStart && windows.interventionEnd
      ? { start: windows.interventionStart, end: windows.interventionEnd }
      : null;
  }

  const start = windows.baselineStart ?? windows.interventionStart;
  const end = windows.interventionEnd ?? windows.baselineEnd;
  return start && end ? { start, end } : null;
}

function calendarFromLegacySchedule(
  schedule: ExperimentRunScheduleIntent,
): ExperimentAdherenceTarget["calendar"] | null {
  if (schedule.kind === "dailyLocal") {
    return {
      kind: "daily",
      timeZone: schedule.timeZone,
      localTime: schedule.localTime,
      targetCountPerDay: 1,
    };
  }

  const parsed = parseSimpleCron(schedule.expression);
  if (!parsed) {
    return null;
  }

  return {
    kind: "weekdays",
    timeZone: schedule.timeZone,
    localTime: parsed.localTime,
    weekdays: parsed.weekdays,
    targetCountPerDay: 1,
  };
}

function parseSimpleCron(expression: string): { localTime: string; weekdays: number[] } | null {
  const match = /^(?<minute>[0-5]?\d)\s+(?<hour>[01]?\d|2[0-3])\s+\*\s+\*\s+(?<weekdays>[0-7](?:,[0-7])*)$/u.exec(
    expression.trim(),
  );
  if (!match?.groups) {
    return null;
  }

  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const weekdays = [...new Set(match.groups.weekdays.split(",").map((value) => {
    const day = Number(value);
    return day === 7 ? 0 : day;
  }))].sort((left, right) => left - right);

  return {
    localTime: `${pad2(hour)}:${pad2(minute)}`,
    weekdays,
  };
}

function compareAdherenceCells(left: ExperimentAdherenceCell, right: ExperimentAdherenceCell): number {
  if (left.localDate !== right.localDate) {
    return left.localDate.localeCompare(right.localDate);
  }

  return left.targetId.localeCompare(right.targetId);
}

function dateRange(start: string, end: string): string[] {
  if (start > end) {
    return [];
  }
  if (countLocalDateRangeDays(start, end) > MAX_ADHERENCE_CELLS) {
    throw new RangeError("Experiment adherence calendar expands beyond the supported cell limit.");
  }

  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function weekdayDateRange(start: string, end: string, weekdays: readonly number[]): string[] {
  if (start > end || weekdays.length === 0) {
    return [];
  }

  if (countWeekdaysInRange(start, end, weekdays) > MAX_ADHERENCE_CELLS) {
    throw new RangeError("Experiment adherence calendar expands beyond the supported cell limit.");
  }

  const weekdaySet = new Set(weekdays);
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) {
    if (weekdaySet.has(localDateWeekday(cursor))) {
      dates.push(cursor);
    }
  }
  return dates;
}

function countLocalDateRangeDays(start: string, end: string): number {
  if (start > end) {
    return 0;
  }

  const startParts = parseIsoLocalDate(start);
  const endParts = parseIsoLocalDate(end);
  const startMs = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
  const endMs = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function countWeekdaysInRange(start: string, end: string, weekdays: readonly number[]): number {
  const totalDays = countLocalDateRangeDays(start, end);
  if (totalDays === 0 || weekdays.length === 0) {
    return 0;
  }

  const weekdaySet = new Set(weekdays);
  const fullWeeks = Math.floor(totalDays / 7);
  let count = fullWeeks * weekdaySet.size;
  const remainingDays = totalDays % 7;
  const startWeekday = localDateWeekday(start);

  for (let offset = 0; offset < remainingDays; offset += 1) {
    if (weekdaySet.has((startWeekday + offset) % 7)) {
      count += 1;
    }
  }

  return count;
}

function resolveAsOf(value: Date | string, timeZone: string): Date {
  if (typeof value === "string" && ISO_LOCAL_DATE_PATTERN.test(value)) {
    return new Date(zonedLocalDateTimeToEpochMs(value, "00:00", timeZone));
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("asOf must be a valid date or timestamp.");
  }
  return date;
}

function parseIsoLocalDate(value: string): { day: number; month: number; year: number } {
  return {
    day: Number(value.slice(8, 10)),
    month: Number(value.slice(5, 7)),
    year: Number(value.slice(0, 4)),
  };
}

function parseLocalTime(value: string): { hour: number; minute: number } {
  if (!LOCAL_TIME_PATTERN.test(value)) {
    throw new TypeError("localTime must use HH:MM format.");
  }

  return {
    hour: Number(value.slice(0, 2)),
    minute: Number(value.slice(3, 5)),
  };
}

function localDateWeekday(localDate: string): number {
  const parts = parseIsoLocalDate(localDate);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function addLocalDays(localDate: string, days: number): string {
  const parts = parseIsoLocalDate(localDate);
  return formatUtcLocalDate(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)),
  );
}

function formatUtcLocalDate(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join("-");
}

function zonedLocalDateTimeToEpochMs(
  localDate: string,
  localTime: string,
  timeZone: string,
): number {
  const dateParts = parseIsoLocalDate(localDate);
  const timeParts = parseLocalTime(localTime);
  const desiredAsUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
  );
  let guess = desiredAsUtc;

  for (let index = 0; index < 4; index += 1) {
    const actual = readZonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const diff = desiredAsUtc - actualAsUtc;

    if (diff === 0) {
      return guess;
    }

    guess += diff;
  }

  return guess;
}

function readZonedParts(
  date: Date,
  timeZone: string,
): { day: number; hour: number; minute: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return {
    day: readZonedPart(values, "day"),
    hour: readZonedPart(values, "hour"),
    minute: readZonedPart(values, "minute"),
    month: readZonedPart(values, "month"),
    year: readZonedPart(values, "year"),
  };
}

function readZonedPart(
  values: Partial<Record<Intl.DateTimeFormatPartTypes, string>>,
  key: Intl.DateTimeFormatPartTypes,
): number {
  const value = values[key];
  if (value === undefined) {
    throw new Error(`Could not read ${key} from time-zone formatter.`);
  }

  return Number(value);
}

function slugifyTargetId(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug.length > 0 ? slug : null;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
