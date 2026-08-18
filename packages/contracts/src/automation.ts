import * as z from "./zod-runtime.ts";

import { CONTRACT_SCHEMA_VERSION, FRONTMATTER_DOC_TYPES } from "./constants.ts";
import {
  executableScheduleIntentAtSchema,
  executableScheduleIntentCronSchema,
  executableScheduleIntentDailyLocalSchema,
  executableScheduleIntentEverySchema,
  isValidExecutableCronExpression,
  MIN_EXECUTABLE_SCHEDULE_EVERY_MS,
  scheduleIntentTimeZoneSchema,
} from "./schedule-intent.ts";
import { assistantReasoningEffortValues } from "./assistant.ts";
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

/**
 * The exact member-authorized support purpose carried by a plan-owned
 * automation. The automation record itself is the persisted consent owner for
 * habit and supplement support; experiment support additionally rechecks the
 * matching `assistantSupport` switch on the experiment owner.
 */
export const automationSupportKindValues = [
  "reminder",
  "check_in",
  "review",
  "weekly_digest",
] as const;

export const automationScheduledReplySchema = z
  .object({
    kind: z.literal("workout_rollover"),
    routineId: z.string().regex(/^wfmt_[0-9A-Za-z]+$/u),
  })
  .strict();

export const automationPlannedOccurrenceOffsetMsSchema = z
  .number()
  .int()
  .safe()
  .nonnegative();

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
export const AUTOMATION_SUPPORT_SERIES_TAG_PREFIX = "system:support-series:";
/**
 * Durable ownership marker added only when support-series reconciliation
 * archives an otherwise-active automation because it is temporarily absent
 * from desired state. Cron consumption and user archive flows must not add it.
 */
export const AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG =
  "system:automation-support:reconciled-archive";
const automationSupportSeriesIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,199})$/u;
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
export const automationActiveUntilSchema = isoTimestampSchema();

export interface AutomationSupportSeriesTag {
  seriesId: string;
  tag: string;
}

export function buildAutomationSupportSeriesTag(seriesId: string): string {
  const normalized = seriesId.trim();
  if (!automationSupportSeriesIdPattern.test(normalized)) {
    throw new TypeError(
      "Automation support series id must be 1-200 characters using letters, numbers, colon, period, underscore, or hyphen.",
    );
  }

  return `${AUTOMATION_SUPPORT_SERIES_TAG_PREFIX}${normalized}`;
}

export function parseAutomationSupportSeriesTag(
  value: unknown,
): AutomationSupportSeriesTag | null {
  if (typeof value !== "string" || !value.startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX)) {
    return null;
  }

  const seriesId = value.slice(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX.length);
  if (!automationSupportSeriesIdPattern.test(seriesId)) {
    return null;
  }

  return {
    seriesId,
    tag: value,
  };
}

function validateAutomationLifecycleFields(
  value: {
    activeUntil?: string | null;
    schedule: AutomationSchedule;
    tags?: string[];
  },
  ctx: z.RefinementCtx,
): void {
  if (
    value.activeUntil &&
    value.schedule.kind === "at" &&
    Date.parse(value.activeUntil) <= Date.parse(value.schedule.at)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "activeUntil must be after schedule.at for a one-shot automation.",
      path: ["activeUntil"],
    });
  }

  const supportSeriesTags = (value.tags ?? []).filter((tag) =>
    tag.startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX)
  );
  if (supportSeriesTags.some((tag) => parseAutomationSupportSeriesTag(tag) === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Support series tags must use a valid canonical support series id.",
      path: ["tags"],
    });
  }
  if (supportSeriesTags.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An automation may belong to at most one support series.",
      path: ["tags"],
    });
  }
}
export const isValidAutomationCronExpression = isValidExecutableCronExpression;
export const automationScheduleAtSchema = executableScheduleIntentAtSchema;
export const automationScheduleEverySchema = executableScheduleIntentEverySchema;
export const automationScheduleCronSchema = executableScheduleIntentCronSchema
  .extend({
    timeZone: scheduleIntentTimeZoneSchema
      .optional()
      .describe(
        "Optional IANA timezone for these recurring wall-clock fields. Omit only to follow the vault timezone.",
      ),
  })
  .strict()
  .describe(
    "A five-field recurring cron evaluated as wall-clock fields in timeZone, or in the vault timezone when timeZone is omitted.",
  );
export const automationScheduleDailyLocalSchema = executableScheduleIntentDailyLocalSchema
  .extend({
    timeZone: scheduleIntentTimeZoneSchema
      .optional()
      .describe(
        "Optional IANA timezone for this recurring wall-clock time. Omit only to follow the vault timezone.",
      ),
  })
  .strict()
  .describe(
    "A recurring local wall-clock time in timeZone, or in the vault timezone when timeZone is omitted.",
  );

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
    threadIsDirect: z.boolean().nullable().optional(),
    // Read-only compatibility for existing automation and strict cron records.
    // Runtime authority ignores this marker and canonical writers omit it.
    currentRouteSnapshot: z.boolean().nullable().optional(),
  })
  .strict();

export const automationAssistantTargetOverrideSchema = z
  .object({
    model: z.string().min(1).max(200).nullable().optional(),
    modelProvider: z.string().min(1).max(120).nullable().optional(),
    reasoningEffort: z.enum(assistantReasoningEffortValues).nullable().optional(),
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
      activeUntil: automationActiveUntilSchema.optional(),
      schedule: automationScheduleSchema,
      route: automationRouteSchema,
      assistantTargetOverride: automationAssistantTargetOverrideSchema.optional(),
      scheduledReply: automationScheduledReplySchema.optional(),
      supportKind: z.enum(automationSupportKindValues).optional(),
      // Nonnegative lead from this notification to the event it supports.
      plannedOccurrenceOffsetMs: automationPlannedOccurrenceOffsetMsSchema.optional(),
      continuityPolicy: z.enum(automationContinuityPolicyValues),
      tags: z.array(z.string().min(1)).optional(),
      createdAt: isoTimestampSchema(),
      scheduleAnchorAt: isoTimestampSchema().optional(),
      updatedAt: isoTimestampSchema(),
    })
    .strict()
    .superRefine(validateAutomationLifecycleFields),
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
    activeUntil: automationActiveUntilSchema.nullable().optional(),
    continuityPolicy: z.enum(automationContinuityPolicyValues).default("preserve"),
    instructions: z.string().min(1),
    route: automationRouteSchema,
    assistantTargetOverride: automationAssistantTargetOverrideSchema.nullable().optional(),
    scheduledReply: automationScheduledReplySchema.nullable().optional(),
    supportKind: z.enum(automationSupportKindValues).nullable().optional(),
    plannedOccurrenceOffsetMs: automationPlannedOccurrenceOffsetMsSchema.nullable().optional(),
    schedule: automationScheduleSchema,
    slug: z.string().regex(slugPattern).optional(),
    status: z.enum(automationStatusValues).default("active"),
    summary: z.string().min(1).max(4000).nullable().optional(),
    tags: z.array(z.string().min(1)).optional(),
    title: z.string().min(1).max(160),
  })
  .strict()
  .superRefine(validateAutomationLifecycleFields);

export type AutomationStatus = (typeof automationStatusValues)[number];
export type AutomationContinuityPolicy = (typeof automationContinuityPolicyValues)[number];
export type AutomationScheduledReply = z.infer<typeof automationScheduledReplySchema>;
export type AutomationSupportKind = (typeof automationSupportKindValues)[number];
export type AutomationTimeScheduleKind = (typeof automationTimeScheduleKindValues)[number];
export type AutomationScheduleKind = (typeof automationScheduleKindValues)[number];
export type AutomationDeviceActivitySource = (typeof automationDeviceActivitySourceValues)[number];
export type AutomationDeviceActivityKind = z.infer<typeof automationDeviceActivityKindSchema>;
export type AutomationTimeSchedule = z.infer<typeof automationTimeScheduleSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationRoute = z.infer<typeof automationRouteSchema>;
export type AutomationAssistantTargetOverride = z.infer<
  typeof automationAssistantTargetOverrideSchema
>;
export type AutomationFrontmatter = z.infer<typeof automationFrontmatterSchema>;
export type AutomationMarkdownDocument = z.infer<typeof automationMarkdownDocumentSchema>;
export type AutomationScaffoldPayload = z.infer<typeof automationScaffoldPayloadSchema>;

// Product-facing aliases. The persisted frontmatter key remains `schedule` for now.
export const automationTriggerKindValues = automationScheduleKindValues;
export const automationTriggerSchema = automationScheduleSchema;
export type AutomationTrigger = AutomationSchedule;
