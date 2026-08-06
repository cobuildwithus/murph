import * as z from "./zod-runtime.ts";

import { CONTRACT_SCHEMA_VERSION, FRONTMATTER_DOC_TYPES, ID_PREFIXES } from "./constants.ts";
import { idPattern } from "./ids.ts";
import {
  executableScheduleIntentSchema,
  type ExecutableScheduleIntent,
} from "./schedule-intent.ts";
import { withContractMetadata } from "./schema-metadata.ts";
import {
  mealNutritionSchema,
  measurementEntrySchema,
  workoutSessionSchema,
  type MealNutrition,
  type MeasurementEntry,
  type WorkoutSession,
} from "./zod.ts";

export {
  formatScheduleIntentIssues,
  executableScheduleIntentAtSchema,
  executableScheduleIntentCronSchema,
  executableScheduleIntentDailyLocalSchema,
  executableScheduleIntentEverySchema,
  executableScheduleIntentSchema,
  scheduleIntentAtSchema,
  scheduleIntentCronSchema,
  scheduleIntentDailyLocalSchema,
  scheduleIntentEverySchema,
  scheduleIntentKindValues,
  scheduleIntentSchema,
  type ExecutableScheduleIntent,
  type ScheduleIntent,
  type ScheduleIntentKind,
} from "./schedule-intent.ts";

export const SCHEDULED_LOG_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION.scheduledLogFrontmatter;
export const SCHEDULED_LOG_DOC_TYPE = FRONTMATTER_DOC_TYPES.scheduledLog;

export const scheduledLogStatusValues = Object.freeze(["active", "paused", "archived"] as const);
export const scheduledLogStatusSchema = z.enum(scheduledLogStatusValues);
export type ScheduledLogStatus = z.infer<typeof scheduledLogStatusSchema>;

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const titleSchema = z.string().min(1).max(160);
const noteSchema = z.string().min(1).max(4_000);
const tagListSchema = z.array(slugSchema).max(32);
const scheduledLogIdSchema = z.string().regex(new RegExp(idPattern(ID_PREFIXES.scheduledLog), "u"));

const scheduledActionBaseSchema = z.object({
  tags: tagListSchema.optional(),
});

const scheduledMealActionSchema = scheduledActionBaseSchema.extend({
  kind: z.literal("meal.add"),
  foodId: z.string().min(1).max(80).optional(),
  note: noteSchema.optional(),
  ingredients: z.array(z.string().min(1).max(4_000)).max(100).optional(),
  nutrition: mealNutritionSchema.optional(),
}).strict();

const scheduledActivitySessionActionSchema = scheduledActionBaseSchema.extend({
  kind: z.literal("activity_session.add"),
  title: titleSchema,
  activityType: slugSchema,
  durationMinutes: z.number().int().positive().max(24 * 60),
  distanceKm: z.number().positive().max(1_000).optional(),
  note: noteSchema.optional(),
  workout: workoutSessionSchema.optional(),
}).strict();

const scheduledInterventionSessionActionSchema = scheduledActionBaseSchema.extend({
  kind: z.literal("intervention_session.add"),
  title: titleSchema,
  interventionType: slugSchema,
  durationMinutes: z.number().int().positive().max(24 * 60).optional(),
  protocolId: z.string().min(1).max(80).optional(),
  note: noteSchema.optional(),
}).strict();

const scheduledMeasurementActionSchema = scheduledActionBaseSchema.extend({
  kind: z.literal("measurement.add"),
  title: titleSchema.optional(),
  note: noteSchema.optional(),
  measurements: z.array(measurementEntrySchema).min(1).max(25),
}).strict();

export const scheduledLogActionSchema = z.discriminatedUnion("kind", [
  scheduledMealActionSchema,
  scheduledActivitySessionActionSchema,
  scheduledInterventionSessionActionSchema,
  scheduledMeasurementActionSchema,
]).superRefine((value, context) => {
  if (
    value.kind !== "meal.add" ||
    value.foodId ||
    value.note ||
    value.ingredients?.length ||
    value.nutrition
  ) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: "meal.add scheduled logs require a foodId, note, ingredients, or nutrition template.",
    path: ["foodId"],
  });
});
export type ScheduledLogAction = z.infer<typeof scheduledLogActionSchema>;

export const scheduledLogFrontmatterSchema = withContractMetadata(
  z
    .object({
      schemaVersion: z.literal(SCHEDULED_LOG_SCHEMA_VERSION),
      docType: z.literal(SCHEDULED_LOG_DOC_TYPE),
      scheduledLogId: scheduledLogIdSchema,
      slug: slugSchema,
      title: titleSchema,
      status: scheduledLogStatusSchema,
      schedule: executableScheduleIntentSchema,
      action: scheduledLogActionSchema,
      summary: z.string().min(1).max(500).optional(),
      tags: tagListSchema.optional(),
      createdAt: z.string().min(1),
      updatedAt: z.string().min(1),
    })
    .strict(),
  "@murphai/contracts/frontmatter-scheduled-log.schema.json",
  "Murph Scheduled Log Frontmatter",
);

export const scheduledLogMarkdownDocumentSchema = z.object({
  frontmatter: scheduledLogFrontmatterSchema,
  body: z.string(),
}).strict();

export const scheduledLogScaffoldPayloadSchema = z.object({
  scheduledLogId: scheduledLogIdSchema.optional(),
  slug: slugSchema.optional(),
  title: titleSchema,
  status: scheduledLogStatusSchema.default("active"),
  schedule: executableScheduleIntentSchema,
  action: scheduledLogActionSchema,
  summary: z.string().min(1).max(500).optional(),
  tags: tagListSchema.optional(),
  body: z.string().max(40_000).optional(),
}).strict();

export type ScheduledLogFrontmatter = z.infer<typeof scheduledLogFrontmatterSchema>;
export type ScheduledLogMarkdownDocument = z.infer<typeof scheduledLogMarkdownDocumentSchema>;
export type ScheduledLogScaffoldPayload = z.infer<typeof scheduledLogScaffoldPayloadSchema>;
export type ScheduledLogSchedule = ExecutableScheduleIntent;
export type ScheduledLogMealAction = Extract<ScheduledLogAction, { kind: "meal.add" }> & {
  nutrition?: MealNutrition;
};
export type ScheduledLogActivitySessionAction = Extract<ScheduledLogAction, { kind: "activity_session.add" }> & {
  workout?: WorkoutSession;
};
export type ScheduledLogInterventionSessionAction = Extract<ScheduledLogAction, { kind: "intervention_session.add" }>;
export type ScheduledLogMeasurementAction = Extract<ScheduledLogAction, { kind: "measurement.add" }> & {
  measurements: MeasurementEntry[];
};
