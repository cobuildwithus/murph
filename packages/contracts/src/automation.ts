import * as z from "zod";

import { CONTRACT_SCHEMA_VERSION, FRONTMATTER_DOC_TYPES } from "./constants.ts";
import {
  executableScheduleIntentAtSchema,
  executableScheduleIntentCronSchema,
  executableScheduleIntentDailyLocalSchema,
  executableScheduleIntentEverySchema,
  isValidExecutableCronExpression,
  MIN_EXECUTABLE_SCHEDULE_EVERY_MS,
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

export const automationTimeScheduleKindValues = [
  "at",
  "every",
  "cron",
  "dailyLocal",
] as const;

export const automationDeviceActivitySourceValues = [
  "whoop",
  "whoop_v2",
] as const;

// Non-authoritative examples for help text and autocomplete surfaces. The
// schema accepts any normalized provider/importer activity kind.
export const automationDeviceActivityKindValues = [
  "activity",
  "activity-session",
  "workout",
  "basketball",
  "dance",
  "dancing",
  "walk",
  "running",
  "cycling",
  "surfing",
  "swimming",
  "hiking",
  "rowing",
  "yoga",
  "pilates",
  "strength-training",
  "sleep",
  "sleep-session",
  "sleep-cycle",
] as const;

export const automationScheduleKindValues = [
  ...automationTimeScheduleKindValues,
  "deviceActivity",
] as const;

export const MIN_AUTOMATION_EVERY_MS = MIN_EXECUTABLE_SCHEDULE_EVERY_MS;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const automationDeviceActivityKindPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const automationDeviceActivityKindSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(automationDeviceActivityKindPattern, "Expected a lowercase kebab-case device activity kind.");

function isoTimestampSchema() {
  return z.string().datetime({ offset: true });
}
export const isValidAutomationCronExpression = isValidExecutableCronExpression;
export const automationScheduleAtSchema = executableScheduleIntentAtSchema;
export const automationScheduleEverySchema = executableScheduleIntentEverySchema;
export const automationScheduleCronSchema = executableScheduleIntentCronSchema;
export const automationScheduleDailyLocalSchema = executableScheduleIntentDailyLocalSchema;

export const automationTimeScheduleSchema = z.discriminatedUnion("kind", [
  automationScheduleAtSchema,
  automationScheduleEverySchema,
  automationScheduleCronSchema,
  automationScheduleDailyLocalSchema,
]);

export const automationScheduleDeviceActivitySchema = z
  .object({
    kind: z.literal("deviceActivity"),
    after: isoTimestampSchema(),
    afterOccurredAt: isoTimestampSchema().optional(),
    afterEntityId: z.string().min(1).optional(),
    source: z.enum(automationDeviceActivitySourceValues).optional(),
    activityKind: automationDeviceActivityKindSchema.optional(),
  })
  .superRefine((schedule, ctx) => {
    const hasScalarOccurredAt = schedule.afterOccurredAt !== undefined;
    const hasScalarEntityId = schedule.afterEntityId !== undefined;
    if (hasScalarOccurredAt !== hasScalarEntityId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Device activity cursor must include afterOccurredAt and afterEntityId together.",
        path: hasScalarOccurredAt ? ["afterEntityId"] : ["afterOccurredAt"],
      });
    }
  })
  .strict();

export interface DeviceActivityCoverageCursor {
  after: string;
  afterOccurredAt?: string;
  afterEntityId?: string;
}

export interface DeviceActivityCoverageKey {
  entityId: string;
  occurredAt: string;
  triggeredAt: string;
}

export interface DeviceActivityCoverageCursorPosition {
  after: string;
  afterOccurredAt: string;
  afterEntityId: string;
}

export function compareDeviceActivityCoverageKeys(
  left: DeviceActivityCoverageKey,
  right: DeviceActivityCoverageKey,
): number {
  return compareIsoTimestamps(left.triggeredAt, right.triggeredAt)
    || compareIsoTimestamps(left.occurredAt, right.occurredAt)
    || left.entityId.localeCompare(right.entityId);
}

export function deviceActivityCoverageKeyIsAfterCursor(
  key: DeviceActivityCoverageKey,
  cursor: DeviceActivityCoverageCursor,
): boolean {
  const triggeredComparison = compareIsoTimestamps(key.triggeredAt, cursor.after);
  if (triggeredComparison > 0) {
    return true;
  }
  if (triggeredComparison < 0) {
    return false;
  }

  if (cursor.afterOccurredAt && cursor.afterEntityId) {
    return compareDeviceActivityCoverageKeys(key, {
      entityId: cursor.afterEntityId,
      occurredAt: cursor.afterOccurredAt,
      triggeredAt: cursor.after,
    }) > 0;
  }

  return false;
}

export function resolveNextDeviceActivityCoverageCursor(input: {
  cursor: DeviceActivityCoverageCursor;
  keys: readonly DeviceActivityCoverageKey[];
}): DeviceActivityCoverageCursorPosition | null {
  const latest = input.keys.reduce<DeviceActivityCoverageKey | null>((candidate, key) => {
    if (!deviceActivityCoverageKeyIsAfterCursor(key, input.cursor)) {
      return candidate;
    }
    if (!candidate || compareDeviceActivityCoverageKeys(key, candidate) > 0) {
      return key;
    }
    return candidate;
  }, null);
  if (!latest) {
    return null;
  }

  const next = {
    after: latest.triggeredAt,
    afterOccurredAt: latest.occurredAt,
    afterEntityId: latest.entityId,
  };

  if (
    latest.triggeredAt === input.cursor.after &&
    input.cursor.afterOccurredAt === latest.occurredAt &&
    input.cursor.afterEntityId === latest.entityId
  ) {
    return null;
  }

  return next;
}

function compareIsoTimestamps(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
    return leftMs - rightMs;
  }

  return left.localeCompare(right);
}

export const automationScheduleSchema = z.discriminatedUnion("kind", [
  ...automationTimeScheduleSchema.options,
  automationScheduleDeviceActivitySchema,
]);

const automationRouteDeliverySourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("linq"),
      fromPhoneNumber: z.string().min(1),
    })
    .strict(),
]);

export const automationRouteSchema = z
  .object({
    channel: z.string().min(1),
    deliverySource: automationRouteDeliverySourceSchema.nullable().optional(),
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
    summary: z.string().min(1).max(4000).nullable().optional(),
    tags: z.array(z.string().min(1)).optional(),
    title: z.string().min(1).max(160),
  })
  .strict();

export type AutomationStatus = (typeof automationStatusValues)[number];
export type AutomationContinuityPolicy = (typeof automationContinuityPolicyValues)[number];
export type AutomationTimeScheduleKind = (typeof automationTimeScheduleKindValues)[number];
export type AutomationScheduleKind = (typeof automationScheduleKindValues)[number];
export type AutomationDeviceActivitySource = (typeof automationDeviceActivitySourceValues)[number];
export type AutomationDeviceActivityKind = z.infer<typeof automationDeviceActivityKindSchema>;
export type AutomationTimeSchedule = z.infer<typeof automationTimeScheduleSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationRoute = z.infer<typeof automationRouteSchema>;
export type AutomationFrontmatter = z.infer<typeof automationFrontmatterSchema>;
export type AutomationMarkdownDocument = z.infer<typeof automationMarkdownDocumentSchema>;
export type AutomationScaffoldPayload = z.infer<typeof automationScaffoldPayloadSchema>;

// Product-facing aliases. The persisted frontmatter key remains `schedule` for now.
export const automationTriggerKindValues = automationScheduleKindValues;
export const automationTriggerSchema = automationScheduleSchema;
export type AutomationTrigger = AutomationSchedule;
