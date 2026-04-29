import type { ExperimentRunScheduleIntent } from "@murphai/contracts";

export const DEFAULT_EXPERIMENT_RUN_SCHEDULE_GRACE_HOURS = 24;

export type BrowserVaultRunScheduleCellKind =
  | "completed"
  | "partial"
  | "missed"
  | "skipped"
  | "scheduled";

export type BrowserVaultRunScheduleEventStatus = Exclude<
  BrowserVaultRunScheduleCellKind,
  "scheduled"
>;

export interface BrowserVaultRunScheduleExpansionWindow {
  endLocalDate: string;
  startLocalDate: string;
}

export interface BrowserVaultRunScheduleExpansionEvent {
  occurredAt?: Date | string | null;
  localDate?: string | null;
  status: BrowserVaultRunScheduleEventStatus;
}

export interface BrowserVaultRunScheduleCell {
  kind: BrowserVaultRunScheduleCellKind;
  localDate: string;
  localTime: string;
  planned: boolean;
  source: "event" | "planned";
  timeZone: string;
}

export interface ExpandBrowserVaultRunScheduleInput {
  asOf: Date | string;
  events?: readonly BrowserVaultRunScheduleExpansionEvent[];
  gracePeriodHours?: number;
  schedule: ExperimentRunScheduleIntent;
  window: BrowserVaultRunScheduleExpansionWindow;
}

interface SchedulePlan {
  localTime: string;
  weekdays: ReadonlySet<number> | null;
}

interface ResolvedScheduleEvent {
  kind: BrowserVaultRunScheduleEventStatus;
  localDate: string;
  localTime: string | null;
  rank: number;
}

const ISO_LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const CRON_NUMBER_PATTERN = /^\d+$/u;

const EVENT_STATUS_RANK: Record<BrowserVaultRunScheduleEventStatus, number> = {
  missed: 1,
  skipped: 2,
  partial: 3,
  completed: 4,
};

export function expandBrowserVaultRunSchedule(
  input: ExpandBrowserVaultRunScheduleInput,
): BrowserVaultRunScheduleCell[] {
  const timeZone = requireScheduleTimeZone(input.schedule);
  const plan = readSchedulePlan(input.schedule);
  const startLocalDate = requireIsoLocalDate(input.window.startLocalDate, "window.startLocalDate");
  const endLocalDate = requireIsoLocalDate(input.window.endLocalDate, "window.endLocalDate");

  if (startLocalDate > endLocalDate) {
    throw new RangeError("window.startLocalDate must be on or before window.endLocalDate.");
  }

  const asOf = resolveAsOf(input.asOf, timeZone);
  const asOfMs = asOf.getTime();
  const asOfLocalDate = formatZonedLocalDate(asOf, timeZone);
  const gracePeriodHours =
    input.gracePeriodHours ?? DEFAULT_EXPERIMENT_RUN_SCHEDULE_GRACE_HOURS;

  if (!Number.isFinite(gracePeriodHours) || gracePeriodHours < 0) {
    throw new RangeError("gracePeriodHours must be a non-negative finite number.");
  }

  const eventsByLocalDate = resolveEventsByLocalDate(
    input.events ?? [],
    timeZone,
    startLocalDate,
    endLocalDate,
  );
  const cells: BrowserVaultRunScheduleCell[] = [];
  const plannedLocalDates = new Set<string>();

  for (
    let localDate = startLocalDate;
    localDate <= endLocalDate;
    localDate = addLocalDays(localDate, 1)
  ) {
    if (!matchesSchedulePlan(plan, localDate)) {
      continue;
    }

    plannedLocalDates.add(localDate);
    const event = eventsByLocalDate.get(localDate);

    if (event) {
      cells.push({
        kind: event.kind,
        localDate,
        localTime: plan.localTime,
        planned: true,
        source: "event",
        timeZone,
      });
      continue;
    }

    cells.push({
      kind: inferPlannedCellKind({
        asOfLocalDate,
        asOfMs,
        gracePeriodHours,
        localDate,
        localTime: plan.localTime,
        timeZone,
      }),
      localDate,
      localTime: plan.localTime,
      planned: true,
      source: "planned",
      timeZone,
    });
  }

  for (const [localDate, event] of eventsByLocalDate) {
    if (plannedLocalDates.has(localDate)) {
      continue;
    }

    cells.push({
      kind: event.kind,
      localDate,
      localTime: event.localTime ?? plan.localTime,
      planned: false,
      source: "event",
      timeZone,
    });
  }

  return cells.sort((left, right) => {
    if (left.localDate !== right.localDate) {
      return left.localDate.localeCompare(right.localDate);
    }

    return left.localTime.localeCompare(right.localTime);
  });
}

function requireScheduleTimeZone(schedule: ExperimentRunScheduleIntent): string {
  const { timeZone } = schedule;

  if (timeZone.trim().length === 0) {
    throw new TypeError("schedule.timeZone is required.");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new RangeError(`schedule.timeZone is not supported: ${timeZone}`);
  }

  return timeZone;
}

function readSchedulePlan(schedule: ExperimentRunScheduleIntent): SchedulePlan {
  switch (schedule.kind) {
    case "dailyLocal":
      return {
        localTime: requireLocalTime(schedule.localTime, "schedule.localTime"),
        weekdays: null,
      };
    case "cron":
      return readCronSchedulePlan(schedule.expression);
  }
}

function readCronSchedulePlan(expression: string): SchedulePlan {
  const fields = expression.trim().split(/\s+/u);

  if (fields.length !== 5) {
    throw new Error("schedule.expression must be a five-field cron expression.");
  }

  const minute = readConcreteCronNumber(fields[0] ?? "", "minute", 0, 59);
  const hour = readConcreteCronNumber(fields[1] ?? "", "hour", 0, 23);

  if (fields[2] !== "*") {
    throw new Error("schedule.expression day-of-month must be '*'.");
  }

  if (fields[3] !== "*") {
    throw new Error("schedule.expression month must be '*'.");
  }

  return {
    localTime: `${pad2(hour)}:${pad2(minute)}`,
    weekdays: readCronWeekdayList(fields[4] ?? ""),
  };
}

function readConcreteCronNumber(
  field: string,
  label: string,
  min: number,
  max: number,
): number {
  if (!CRON_NUMBER_PATTERN.test(field)) {
    throw new Error(`schedule.expression ${label} must be a concrete number.`);
  }

  const value = Number(field);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`schedule.expression ${label} is out of range.`);
  }

  return value;
}

function readCronWeekdayList(field: string): ReadonlySet<number> {
  const values = field.split(",");

  if (values.length === 0) {
    throw new Error("schedule.expression day-of-week must list weekdays.");
  }

  const weekdays = new Set<number>();

  for (const value of values) {
    if (!/^[0-7]$/u.test(value)) {
      throw new Error("schedule.expression day-of-week must be a numeric weekday list.");
    }

    const weekday = Number(value);
    weekdays.add(weekday === 7 ? 0 : weekday);
  }

  return weekdays;
}

function matchesSchedulePlan(plan: SchedulePlan, localDate: string): boolean {
  if (plan.weekdays === null) {
    return true;
  }

  return plan.weekdays.has(localDateWeekday(localDate));
}

function inferPlannedCellKind(input: {
  asOfLocalDate: string;
  asOfMs: number;
  gracePeriodHours: number;
  localDate: string;
  localTime: string;
  timeZone: string;
}): BrowserVaultRunScheduleCellKind {
  if (input.localDate >= input.asOfLocalDate) {
    return "scheduled";
  }

  const plannedAtMs = zonedLocalDateTimeToEpochMs(
    input.localDate,
    input.localTime,
    input.timeZone,
  );
  const graceEndsAtMs = plannedAtMs + input.gracePeriodHours * 60 * 60 * 1_000;

  return input.asOfMs >= graceEndsAtMs ? "missed" : "scheduled";
}

function resolveEventsByLocalDate(
  events: readonly BrowserVaultRunScheduleExpansionEvent[],
  timeZone: string,
  startLocalDate: string,
  endLocalDate: string,
): Map<string, ResolvedScheduleEvent> {
  const eventsByLocalDate = new Map<string, ResolvedScheduleEvent>();

  for (const event of events) {
    const resolved = resolveScheduleEvent(event, timeZone);

    if (resolved.localDate < startLocalDate || resolved.localDate > endLocalDate) {
      continue;
    }

    const existing = eventsByLocalDate.get(resolved.localDate);

    if (!existing || resolved.rank >= existing.rank) {
      eventsByLocalDate.set(resolved.localDate, resolved);
    }
  }

  return eventsByLocalDate;
}

function resolveScheduleEvent(
  event: BrowserVaultRunScheduleExpansionEvent,
  timeZone: string,
): ResolvedScheduleEvent {
  const rank = EVENT_STATUS_RANK[event.status];

  if (rank === undefined) {
    throw new Error("event.status must be completed, partial, missed, or skipped.");
  }

  if (event.localDate) {
    return {
      kind: event.status,
      localDate: requireIsoLocalDate(event.localDate, "event.localDate"),
      localTime: null,
      rank,
    };
  }

  if (!event.occurredAt) {
    throw new Error("event.localDate or event.occurredAt is required.");
  }

  const occurredAt = requireDate(event.occurredAt, "event.occurredAt");
  const parts = formatZonedLocalDateTime(occurredAt, timeZone);

  return {
    kind: event.status,
    localDate: parts.localDate,
    localTime: parts.localTime,
    rank,
  };
}

function resolveAsOf(value: Date | string, timeZone: string): Date {
  if (typeof value === "string" && ISO_LOCAL_DATE_PATTERN.test(value)) {
    return new Date(zonedLocalDateTimeToEpochMs(value, "00:00", timeZone));
  }

  return requireDate(value, "asOf");
}

function requireDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be a valid date or timestamp.`);
  }

  return date;
}

function requireIsoLocalDate(value: string, label: string): string {
  if (!ISO_LOCAL_DATE_PATTERN.test(value)) {
    throw new TypeError(`${label} must use YYYY-MM-DD format.`);
  }

  const parts = parseIsoLocalDate(value);
  const roundTrip = formatUtcLocalDate(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
  );

  if (roundTrip !== value) {
    throw new TypeError(`${label} must be a valid local date.`);
  }

  return value;
}

function requireLocalTime(value: string, label: string): string {
  if (!LOCAL_TIME_PATTERN.test(value)) {
    throw new TypeError(`${label} must use HH:MM format.`);
  }

  return value;
}

function parseIsoLocalDate(value: string): { day: number; month: number; year: number } {
  return {
    day: Number(value.slice(8, 10)),
    month: Number(value.slice(5, 7)),
    year: Number(value.slice(0, 4)),
  };
}

function parseLocalTime(value: string): { hour: number; minute: number } {
  requireLocalTime(value, "localTime");

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

function formatZonedLocalDate(date: Date, timeZone: string): string {
  return formatZonedLocalDateTime(date, timeZone).localDate;
}

function formatZonedLocalDateTime(
  date: Date,
  timeZone: string,
): { localDate: string; localTime: string } {
  const parts = readZonedParts(date, timeZone);

  return {
    localDate: `${String(parts.year).padStart(4, "0")}-${pad2(parts.month)}-${pad2(parts.day)}`,
    localTime: `${pad2(parts.hour)}:${pad2(parts.minute)}`,
  };
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

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
