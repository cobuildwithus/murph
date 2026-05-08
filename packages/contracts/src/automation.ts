import * as z from "zod";

import { CONTRACT_SCHEMA_VERSION, FRONTMATTER_DOC_TYPES } from "./constants.ts";
import {
  executableScheduleIntentAtSchema,
  executableScheduleIntentCronSchema,
  executableScheduleIntentDailyLocalSchema,
  executableScheduleIntentEverySchema,
  isValidExecutableCronExpression,
} from "./schedule-intent.ts";
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

export const MIN_AUTOMATION_EVERY_MS = 60_000;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function isoTimestampSchema() {
  return z.string().datetime({ offset: true });
}
export const isValidAutomationCronExpression = isValidExecutableCronExpression;
export const automationScheduleAtSchema = executableScheduleIntentAtSchema;
export const automationScheduleEverySchema = executableScheduleIntentEverySchema.extend({
  everyMs: z.number().int().min(MIN_AUTOMATION_EVERY_MS),
}).strict();
export const automationScheduleCronSchema = executableScheduleIntentCronSchema;
export const automationScheduleDailyLocalSchema = executableScheduleIntentDailyLocalSchema;

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
