import * as z from "zod";

import { isValidIanaTimeZone } from "./time.ts";

export const AUTOMATION_SCHEMA_VERSION = "vault-automation.v1" as const;
export const AUTOMATION_DOC_TYPE = "automation" as const;

export const automationStatusValues = [
  "active",
  "paused",
  "archived",
] as const;

export const automationContinuityPolicyValues = [
  "fresh",
  "preserve",
] as const;

export const automationScheduleKindValues = [
  "at",
  "every",
  "cron",
  "dailyLocal",
] as const;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const dailyLocalTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function isoTimestampSchema() {
  return z.string().min(1);
}

function timeZoneSchema() {
  return z
    .string()
    .min(3)
    .refine((value) => isValidIanaTimeZone(value), "Expected a valid IANA timezone.");
}

export const automationScheduleAtSchema = z
  .object({
    kind: z.literal("at"),
    at: isoTimestampSchema(),
  })
  .strict();

export const automationScheduleEverySchema = z
  .object({
    kind: z.literal("every"),
    everyMs: z.number().int().positive(),
  })
  .strict();

export const automationScheduleCronSchema = z
  .object({
    kind: z.literal("cron"),
    expression: z.string().min(1),
    timeZone: timeZoneSchema(),
  })
  .strict();

export const automationScheduleDailyLocalSchema = z
  .object({
    kind: z.literal("dailyLocal"),
    localTime: z.string().regex(dailyLocalTimePattern, "Expected a 24-hour HH:MM time."),
    timeZone: timeZoneSchema(),
  })
  .strict();

export const automationScheduleSchema = z.discriminatedUnion("kind", [
  automationScheduleAtSchema,
  automationScheduleEverySchema,
  automationScheduleCronSchema,
  automationScheduleDailyLocalSchema,
]);

export const automationRouteSchema = z
  .object({
    channel: z.string().min(1),
    deliverResponse: z.boolean(),
    deliveryTarget: z.string().min(1).nullable(),
    identityId: z.string().min(1).nullable(),
    participantId: z.string().min(1).nullable(),
    sourceThreadId: z.string().min(1).nullable(),
  })
  .strict();

export const automationFrontmatterSchema = z
  .object({
    schemaVersion: z.literal(AUTOMATION_SCHEMA_VERSION),
    docType: z.literal(AUTOMATION_DOC_TYPE),
    automationId: z.string().min(1),
    slug: z.string().regex(slugPattern),
    title: z.string().min(1).max(160),
    status: z.enum(automationStatusValues),
    summary: z.string().min(1).max(4000).optional(),
    schedule: automationScheduleSchema,
    route: automationRouteSchema,
    continuityPolicy: z.enum(automationContinuityPolicyValues),
    tags: z.array(z.string().min(1)).optional(),
    createdAt: isoTimestampSchema(),
    updatedAt: isoTimestampSchema(),
  })
  .strict();

export const automationMarkdownDocumentSchema = z
  .object({
    frontmatter: automationFrontmatterSchema,
    body: z.string().min(1),
  })
  .strict();

export const automationScaffoldPayloadSchema = z
  .object({
    automationId: z.string().min(1).optional(),
    continuityPolicy: z.enum(automationContinuityPolicyValues).default("preserve"),
    prompt: z.string().min(1),
    route: automationRouteSchema,
    schedule: automationScheduleSchema,
    slug: z.string().regex(slugPattern).optional(),
    status: z.enum(automationStatusValues).default("active"),
    summary: z.string().min(1).max(4000).optional(),
    tags: z.array(z.string().min(1)).optional(),
    title: z.string().min(1).max(160),
  })
  .strict();

export type AutomationStatus = (typeof automationStatusValues)[number];
export type AutomationContinuityPolicy = (typeof automationContinuityPolicyValues)[number];
export type AutomationScheduleKind = (typeof automationScheduleKindValues)[number];
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationRoute = z.infer<typeof automationRouteSchema>;
export type AutomationFrontmatter = z.infer<typeof automationFrontmatterSchema>;
export type AutomationMarkdownDocument = z.infer<typeof automationMarkdownDocumentSchema>;
export type AutomationScaffoldPayload = z.infer<typeof automationScaffoldPayloadSchema>;
