import * as z from "zod";

import { CONTRACT_SCHEMA_VERSION, FRONTMATTER_DOC_TYPES } from "./constants.ts";
import { withContractMetadata } from "./schema-metadata.ts";

export const AUTOMATION_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.automationFrontmatter;
export const AUTOMATION_DOC_TYPE = FRONTMATTER_DOC_TYPES.automation;

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

export function isValidAutomationCronExpression(expression: string): boolean {
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

function isoTimestampSchema() {
  return z.string().datetime({ offset: true });
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
    expression: z.string().min(1).refine(
      isValidAutomationCronExpression,
      "Expected a five-field cron expression.",
    ),
  })
  .strict();

export const automationScheduleDailyLocalSchema = z
  .object({
    kind: z.literal("dailyLocal"),
    localTime: z.string().regex(dailyLocalTimePattern, "Expected a 24-hour HH:MM time."),
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
    deliveryTarget: z.string().min(1).nullable(),
    identityId: z.string().min(1).nullable(),
    participantId: z.string().min(1).nullable(),
    threadId: z.string().min(1).nullable(),
  })
  .strict();

export const automationFrontmatterSchema = withContractMetadata(
  z
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
    .strict(),
  "@murphai/contracts/frontmatter-automation.schema.json",
  "Murph Automation Frontmatter",
);

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
    instructions: z.string().min(1),
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
