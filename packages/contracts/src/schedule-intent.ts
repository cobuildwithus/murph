import * as z from "zod";

import { isValidIanaTimeZone } from "./time.ts";

export const scheduleIntentKindValues = Object.freeze(["at", "every", "cron", "dailyLocal"] as const);
export const experimentRunScheduleIntentKindValues = Object.freeze(["dailyLocal", "cron"] as const);

const dailyLocalTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const fiveFieldCronPattern = /^\S+(?:\s+\S+){4}$/u;

const timeZoneSchema = z
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

export const experimentRunScheduleIntentCronSchema = z.object({
  kind: z.literal("cron"),
  expression: z
    .string()
    .min(1)
    .max(400)
    .regex(fiveFieldCronPattern, "Expected a five-field cron expression."),
  timeZone: timeZoneSchema,
}).strict();

export const experimentRunScheduleIntentDailyLocalSchema = z.object({
  kind: z.literal("dailyLocal"),
  localTime: z.string().regex(dailyLocalTimePattern, "Expected a 24-hour HH:MM time."),
  timeZone: timeZoneSchema,
}).strict();

export const experimentRunScheduleIntentSchema = z.discriminatedUnion("kind", [
  experimentRunScheduleIntentDailyLocalSchema,
  experimentRunScheduleIntentCronSchema,
]);

function formatScheduleIntentIssue(issue: z.ZodIssue): string {
  if (issue.path.length === 0 && issue.code === "invalid_type") {
    return "schedule must be an object.";
  }

  const field = typeof issue.path[0] === "string" ? issue.path[0] : null;

  switch (field) {
    case "kind":
      return "schedule.kind must match a supported scheduled-log schedule.";
    case "at":
      return "schedule.at is required.";
    case "everyMs":
      return "schedule.everyMs must be a positive integer.";
    case "expression":
      return "schedule.expression is required.";
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
export type ExperimentRunScheduleIntentKind = (typeof experimentRunScheduleIntentKindValues)[number];
export type ExperimentRunScheduleIntent = z.infer<typeof experimentRunScheduleIntentSchema>;
