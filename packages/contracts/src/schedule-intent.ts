import * as z from "./zod-runtime.ts";

import { isValidIanaTimeZone } from "./time.ts";

export const scheduleIntentKindValues = Object.freeze(["at", "every", "cron", "dailyLocal"] as const);
export const experimentRunScheduleIntentKindValues = Object.freeze(["dailyLocal", "cron"] as const);
export const MIN_EXECUTABLE_SCHEDULE_EVERY_MS = 60_000;

const dailyLocalTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
export const experimentRunCronExpressionPattern =
  "^(?:[0-5]?\\d)\\s+(?:[01]?\\d|2[0-3])\\s+\\*\\s+\\*\\s+[0-7](?:,[0-7])*$";
const experimentRunCronExpressionRegex = new RegExp(experimentRunCronExpressionPattern, "u");

export const scheduleIntentTimeZoneSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => isValidIanaTimeZone(value), "Expected an IANA time zone.");

export const scheduleIntentAtSchema = z.object({
  kind: z.literal("at"),
  at: z.string().min(1).max(64),
}).strict();

export const scheduleIntentEverySchema = z.object({
  kind: z.literal("every"),
  everyMs: z.number().int().positive(),
}).strict();

export const scheduleIntentCronSchema = z.object({
  kind: z.literal("cron"),
  expression: z.string().min(1).max(400),
}).strict();

export const scheduleIntentDailyLocalSchema = z.object({
  kind: z.literal("dailyLocal"),
  localTime: z.string().regex(dailyLocalTimePattern, "Expected a 24-hour HH:MM time."),
}).strict();

export const scheduleIntentSchema = z.discriminatedUnion("kind", [
  scheduleIntentAtSchema,
  scheduleIntentEverySchema,
  scheduleIntentCronSchema,
  scheduleIntentDailyLocalSchema,
]);

function isValidCronField(
  field: string,
  minimum: number,
  maximum: number,
): boolean {
  if (field === "*") {
    return true;
  }

  return field.split(",").every((part) => {
    if (!part) {
      return false;
    }

    const segments = part.split("/");
    if (segments.length > 2) {
      return false;
    }

    const [base, stepText] = segments;
    if (!base) {
      return false;
    }

    if (stepText !== undefined && (!/^\d+$/u.test(stepText) || Number(stepText) <= 0)) {
      return false;
    }

    if (base === "*") {
      return true;
    }

    const range = base.split("-");
    if (range.length > 2 || range.some((entry) => !/^\d+$/u.test(entry))) {
      return false;
    }

    const start = Number(range[0]);
    const end = range.length === 2 ? Number(range[1]) : start;
    return Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= minimum &&
      end <= maximum &&
      start <= end;
  });
}

export function isValidExecutableCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/u);
  if (fields.length !== 5) {
    return false;
  }

  return isValidCronField(fields[0] ?? "", 0, 59) &&
    isValidCronField(fields[1] ?? "", 0, 23) &&
    isValidCronField(fields[2] ?? "", 1, 31) &&
    isValidCronField(fields[3] ?? "", 1, 12) &&
    isValidCronField(fields[4] ?? "", 0, 7);
}

export const executableScheduleIntentAtSchema = z.object({
  kind: z.literal("at"),
  at: z.string().datetime({ offset: true }),
}).strict();

export const executableScheduleIntentEverySchema = scheduleIntentEverySchema.extend({
  everyMs: z.number().int().min(MIN_EXECUTABLE_SCHEDULE_EVERY_MS),
}).strict();

export const executableScheduleIntentCronSchema = z.object({
  kind: z.literal("cron"),
  expression: z.string().min(1).max(400).refine(
    isValidExecutableCronExpression,
    "Expected a five-field cron expression.",
  ),
}).strict();

export const executableScheduleIntentDailyLocalSchema = scheduleIntentDailyLocalSchema;

export const executableScheduleIntentSchema = z.discriminatedUnion("kind", [
  executableScheduleIntentAtSchema,
  executableScheduleIntentEverySchema,
  executableScheduleIntentCronSchema,
  executableScheduleIntentDailyLocalSchema,
]);

export const experimentRunScheduleIntentCronSchema = z.object({
  kind: z.literal("cron"),
  expression: z
    .string()
    .min(1)
    .max(400)
    .regex(
      experimentRunCronExpressionRegex,
      "Expected simple cron: concrete minute/hour, * day/month, numeric weekday list.",
    ),
  timeZone: scheduleIntentTimeZoneSchema,
}).strict();

export const experimentRunScheduleIntentDailyLocalSchema = z.object({
  kind: z.literal("dailyLocal"),
  localTime: z.string().regex(dailyLocalTimePattern, "Expected a 24-hour HH:MM time."),
  timeZone: scheduleIntentTimeZoneSchema,
}).strict();

export const experimentRunScheduleIntentSchema = z.discriminatedUnion("kind", [
  experimentRunScheduleIntentDailyLocalSchema,
  experimentRunScheduleIntentCronSchema,
]);

function isMissingOrEmptyScheduleField(issue: z.ZodIssue): boolean {
  if (issue.code === "invalid_type") {
    return true;
  }

  return issue.code === "too_small" && issue.minimum === 1;
}

function formatScheduleIntentIssue(issue: z.ZodIssue): string {
  if (issue.path.length === 0 && issue.code === "invalid_type") {
    return "schedule must be an object.";
  }

  const field = typeof issue.path[0] === "string" ? issue.path[0] : null;

  switch (field) {
    case "kind":
      return "schedule.kind must match a supported scheduled-log schedule.";
    case "at":
      return isMissingOrEmptyScheduleField(issue) ? "schedule.at is required." : issue.message;
    case "everyMs":
      if (issue.code === "too_small" && issue.minimum === MIN_EXECUTABLE_SCHEDULE_EVERY_MS) {
        return `schedule.everyMs must be at least ${MIN_EXECUTABLE_SCHEDULE_EVERY_MS} ms.`;
      }
      return "schedule.everyMs must be a positive integer.";
    case "expression":
      return isMissingOrEmptyScheduleField(issue) ? "schedule.expression is required." : issue.message;
    case "localTime":
      return "schedule.localTime must use HH:MM format.";
    default:
      return issue.message;
  }
}

export function formatScheduleIntentIssues(error: z.ZodError): string {
  return error.issues.map((issue) => formatScheduleIntentIssue(issue)).join("; ");
}

export type ScheduleIntentKind = (typeof scheduleIntentKindValues)[number];
export type ScheduleIntent = z.infer<typeof scheduleIntentSchema>;
export type ExecutableScheduleIntent = z.infer<typeof executableScheduleIntentSchema>;
export type ExperimentRunScheduleIntentKind = (typeof experimentRunScheduleIntentKindValues)[number];
export type ExperimentRunScheduleIntent = z.infer<typeof experimentRunScheduleIntentSchema>;
