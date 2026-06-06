import { Cli, z } from "incur";

import {
  NUTRITION_CONFIDENCE_LEVELS,
  NUTRITION_PROVENANCE_SOURCES,
  executableScheduleIntentSchema,
  formatScheduleIntentIssues,
  scheduleIntentKindValues,
  scheduledLogActionSchema,
  scheduledLogScaffoldPayloadSchema,
  scheduledLogStatusValues,
  workoutSessionSchema,
  type ExecutableScheduleIntent,
  type MeasurementEntry,
  type MealNutrition,
  type ScheduledLogAction,
  type ScheduledLogScaffoldPayload,
  type ScheduledLogStatus,
  type WorkoutSession,
} from "@murphai/contracts";
import {
  buildScheduledLogMarkdownPreview,
  scaffoldScheduledLogPayload,
  setScheduledLogStatus,
  upsertScheduledLog,
} from "@murphai/core";
import {
  listScheduledLogs,
  showScheduledLog,
} from "@murphai/query";
import { withBaseOptions } from "@murphai/operator-config/command-helpers";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  isoTimestampSchema,
  pathSchema,
} from "@murphai/operator-config/vault-cli-contracts";
import {
  loadJsonInputObject,
  normalizeRepeatableFlagOption,
  normalizeRepeatableTextFlagOption,
  textInputOptionSchema,
} from "@murphai/vault-usecases";

import {
  compactNumber,
  parseCompactFields,
  rejectUnsupportedCompactFields,
  requireCompactInteger,
  requireCompactString,
} from "./compact-field-spec.js";

const scheduledLogSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const scheduledLogActionKindValues = [
  "meal.add",
  "activity_session.add",
  "intervention_session.add",
  "measurement.add",
] as const;

export const scheduledLogRecordSchema = z
  .object({
    scheduledLogId: z.string().min(1),
    slug: z.string().regex(scheduledLogSlugPattern),
    title: z.string().min(1),
    status: z.enum(scheduledLogStatusValues),
    summary: z.string().min(1).nullable(),
    schedule: executableScheduleIntentSchema,
    action: scheduledLogActionSchema,
    tags: z.array(z.string().min(1)),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    body: z.string(),
    relativePath: pathSchema,
    markdown: z.string().min(1),
  })
  .strict();

export const scheduledLogListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: z.array(z.enum(scheduledLogStatusValues)).nullable(),
    text: z.string().nullable(),
    limit: z.number().int().positive().max(200),
  }),
  count: z.number().int().nonnegative(),
  items: z.array(scheduledLogRecordSchema),
});

export const scheduledLogShowResultSchema = z.object({
  vault: pathSchema,
  scheduledLog: scheduledLogRecordSchema.nullable(),
});

export const scheduledLogWriteResultSchema = z.object({
  vault: pathSchema,
  scheduledLogId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
});

export const scheduledLogScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal("scheduled-log"),
  payload: scheduledLogScaffoldPayloadSchema,
  markdown: z.string().min(1),
});

export const scheduledLogStatusResultSchema = z.object({
  vault: pathSchema,
  scheduledLogId: z.string().min(1),
  lookupId: z.string().min(1),
  status: z.enum(scheduledLogStatusValues),
});

export function createScheduledLogScaffoldPayload(): ScheduledLogScaffoldPayload {
  return scheduledLogScaffoldPayloadSchema.parse(scaffoldScheduledLogPayload());
}

function invalidScheduledLogOption(message: string): never {
  throw new VaultCliError("invalid_option", message);
}

function requireStringOption(value: string | undefined, optionName: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  return invalidScheduledLogOption(`--${optionName} is required for this scheduled-log save mode.`);
}

function requireNumberOption(value: number | undefined, optionName: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return invalidScheduledLogOption(`--${optionName} is required for this scheduled-log save mode.`);
}

function parseQualifierValue(rawValue: string): string | number | boolean {
  const trimmed = rawValue.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  const numeric = Number(trimmed);
  if (trimmed.length > 0 && Number.isFinite(numeric)) return numeric;

  return trimmed;
}

function parseMeasurementNoteEntries(
  value: readonly string[] | undefined,
  measurementCount: number,
): Map<number, string> {
  const entries = normalizeRepeatableTextFlagOption(value);
  const notes = new Map<number, string>();
  if (!entries) return notes;

  for (const entry of entries) {
    if (measurementCount === 1 && !/^\d+:/u.test(entry)) {
      notes.set(0, entry);
      continue;
    }

    const separatorIndex = entry.indexOf(":");
    const oneBasedIndex = Number(entry.slice(0, separatorIndex));
    const note = entry.slice(separatorIndex + 1).trim();
    if (
      separatorIndex <= 0 ||
      !Number.isInteger(oneBasedIndex) ||
      oneBasedIndex < 1 ||
      oneBasedIndex > measurementCount ||
      note.length === 0
    ) {
      invalidScheduledLogOption(
        "Each --measurement-note entry must use N:note form when multiple measurements are provided.",
      );
    }
    notes.set(oneBasedIndex - 1, note);
  }

  return notes;
}

function parseMeasurementQualifierEntries(
  value: readonly string[] | undefined,
  measurementCount: number,
): Array<Record<string, string | number | boolean>> {
  const entries = normalizeRepeatableFlagOption(value, "measurement-qualifier");
  const qualifiers = Array.from(
    { length: measurementCount },
    (): Record<string, string | number | boolean> => ({}),
  );
  if (!entries) return qualifiers;

  for (const entry of entries) {
    const targetSeparatorIndex = entry.indexOf(":");
    const hasExplicitTarget =
      targetSeparatorIndex > 0 && /^\d+$/u.test(entry.slice(0, targetSeparatorIndex));
    const targetIndex = hasExplicitTarget ? Number(entry.slice(0, targetSeparatorIndex)) - 1 : 0;
    const pair = hasExplicitTarget ? entry.slice(targetSeparatorIndex + 1) : entry;
    const pairSeparatorIndex = pair.indexOf("=");
    const key = pair.slice(0, pairSeparatorIndex).trim();
    const rawValue = pair.slice(pairSeparatorIndex + 1).trim();

    if (
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= measurementCount ||
      (measurementCount > 1 && !hasExplicitTarget) ||
      pairSeparatorIndex <= 0 ||
      pairSeparatorIndex === pair.length - 1 ||
      key.length === 0 ||
      rawValue.length === 0
    ) {
      invalidScheduledLogOption(
        "Each --measurement-qualifier entry must use key=value form for one measurement or N:key=value form for multiple measurements.",
      );
    }

    const targetQualifiers = qualifiers[targetIndex];
    if (!targetQualifiers) {
      invalidScheduledLogOption(
        "Each --measurement-qualifier entry must use key=value form for one measurement or N:key=value form for multiple measurements.",
      );
    }
    targetQualifiers[key] = parseQualifierValue(rawValue);
  }

  return qualifiers;
}

function buildScheduleIntentFromOptions(options: {
  scheduleAt?: string;
  scheduleCron?: string;
  scheduleEveryMs?: number;
  scheduleKind: (typeof scheduleIntentKindValues)[number];
  scheduleLocalTime?: string;
}): ExecutableScheduleIntent {
  switch (options.scheduleKind) {
    case "at":
      return parseScheduledLogScheduleIntent({
        kind: "at",
        at: requireStringOption(options.scheduleAt, "schedule-at"),
      });
    case "every":
      return parseScheduledLogScheduleIntent({
        kind: "every",
        everyMs: requireNumberOption(options.scheduleEveryMs, "schedule-every-ms"),
      });
    case "cron":
      return parseScheduledLogScheduleIntent({
        kind: "cron",
        expression: requireStringOption(options.scheduleCron, "schedule-cron"),
      });
    case "dailyLocal":
      return parseScheduledLogScheduleIntent({
        kind: "dailyLocal",
        localTime: requireStringOption(options.scheduleLocalTime, "schedule-local-time"),
      });
  }
}

function parseScheduledLogScheduleIntent(value: unknown): ExecutableScheduleIntent {
  const parsed = executableScheduleIntentSchema.safeParse(value);
  if (!parsed.success) {
    const message =
      formatScheduleIntentIssues(parsed.error) ||
      "schedule must match a supported scheduled-log schedule.";
    invalidScheduledLogOption(message);
  }
  return parsed.data;
}

function buildMealNutritionFromOptions(options: {
  nutritionCalories?: number;
  nutritionCarbsGrams?: number;
  nutritionConfidence?: (typeof NUTRITION_CONFIDENCE_LEVELS)[number];
  nutritionFatGrams?: number;
  nutritionFiberGrams?: number;
  nutritionProteinGrams?: number;
  nutritionSource?: (typeof NUTRITION_PROVENANCE_SOURCES)[number];
  nutritionSourceDetail?: string;
}): MealNutrition | undefined {
  const totals: NonNullable<MealNutrition["totals"]> = {};
  if (options.nutritionCalories !== undefined) totals.calories = options.nutritionCalories;
  if (options.nutritionProteinGrams !== undefined) totals.proteinGrams = options.nutritionProteinGrams;
  if (options.nutritionCarbsGrams !== undefined) totals.carbsGrams = options.nutritionCarbsGrams;
  if (options.nutritionFatGrams !== undefined) totals.fatGrams = options.nutritionFatGrams;
  if (options.nutritionFiberGrams !== undefined) totals.fiberGrams = options.nutritionFiberGrams;

  const hasTotals = Object.keys(totals).length > 0;
  const hasProvenance =
    options.nutritionSource !== undefined ||
    options.nutritionConfidence !== undefined ||
    options.nutritionSourceDetail !== undefined;
  if (!hasTotals && !hasProvenance) return undefined;
  if (hasProvenance && options.nutritionSource === undefined) {
    invalidScheduledLogOption(
      "--nutrition-source is required when nutrition provenance fields are provided.",
    );
  }

  const nutrition: MealNutrition = {};
  if (hasTotals) nutrition.totals = totals;
  if (options.nutritionSource !== undefined) {
    nutrition.provenance = {
      source: options.nutritionSource,
      ...(options.nutritionConfidence ? { confidence: options.nutritionConfidence } : {}),
      ...(options.nutritionSourceDetail ? { sourceDetail: options.nutritionSourceDetail } : {}),
    };
  }
  return nutrition;
}

function buildMeasurementsFromOptions(options: {
  measurementMetric?: string[];
  measurementNote?: string[];
  measurementQualifier?: string[];
  measurementUnit?: string[];
  measurementValue?: number[];
}): MeasurementEntry[] {
  const metrics = normalizeRepeatableFlagOption(options.measurementMetric, "measurement-metric");
  const units = normalizeRepeatableFlagOption(options.measurementUnit, "measurement-unit");
  const values = options.measurementValue;
  const count = metrics?.length ?? 0;

  if (!metrics || !units || !values || count === 0) {
    invalidScheduledLogOption(
      "measurement.add scheduled logs require repeated --measurement-metric, --measurement-value, and --measurement-unit fields.",
    );
  }

  if (values.length !== count || units.length !== count) {
    invalidScheduledLogOption(
      "Repeated --measurement-metric, --measurement-value, and --measurement-unit fields must have the same count.",
    );
  }

  const notes = parseMeasurementNoteEntries(options.measurementNote, count);
  const qualifiers = parseMeasurementQualifierEntries(options.measurementQualifier, count);

  return metrics.map((metric, index) => {
    const qualifierEntry = qualifiers[index] ?? {};
    const note = notes.get(index);
    return {
      metric,
      value: values[index] ?? 0,
      unit: units[index] ?? "",
      ...(Object.keys(qualifierEntry).length > 0 ? { qualifiers: qualifierEntry } : {}),
      ...(note !== undefined ? { note } : {}),
    };
  });
}

interface WorkoutExerciseDraft {
  groupId?: string;
  mode?: string;
  name: string;
  note?: string;
  order: number;
  sets: Array<Record<string, unknown>>;
  sourceExerciseId?: string;
  unitOverride?: string;
}

interface WorkoutOptions {
  workoutEndedAt?: string;
  workoutExercise?: string[];
  workoutMedia?: string[];
  workoutRoutineId?: string;
  workoutRoutineName?: string;
  workoutSessionNote?: string;
  workoutSet?: string[];
  workoutSourceApp?: string;
  workoutSourceWorkoutId?: string;
  workoutStartedAt?: string;
}

const workoutOptionKeys = [
  "workoutSourceApp",
  "workoutSourceWorkoutId",
  "workoutStartedAt",
  "workoutEndedAt",
  "workoutRoutineId",
  "workoutRoutineName",
  "workoutSessionNote",
  "workoutMedia",
  "workoutExercise",
  "workoutSet",
] as const satisfies ReadonlyArray<keyof WorkoutOptions>;

const workoutMediaFieldKeys = [
  "kind",
  "relativePath",
  "mediaType",
  "caption",
] as const;

const workoutExerciseFieldKeys = [
  "order",
  "name",
  "sourceExerciseId",
  "groupId",
  "mode",
  "unitOverride",
  "note",
] as const;

const workoutSetFieldKeys = [
  "exercise",
  "order",
  "type",
  "reps",
  "weight",
  "weightUnit",
  "durationSeconds",
  "distanceMeters",
  "rpe",
  "bodyweightKg",
  "assistanceKg",
  "addedWeightKg",
] as const;

function parseWorkoutMediaEntry(entry: string): Record<string, unknown> {
  const fields = parseCompactFields(entry, "workout-media", invalidScheduledLogOption);
  rejectUnsupportedCompactFields(
    fields,
    "workout-media",
    workoutMediaFieldKeys,
    invalidScheduledLogOption,
  );
  return {
    kind: requireCompactString(fields, "kind", "workout-media", invalidScheduledLogOption),
    relativePath: requireCompactString(
      fields,
      "relativePath",
      "workout-media",
      invalidScheduledLogOption,
    ),
    ...(fields.has("mediaType") ? { mediaType: fields.get("mediaType") } : {}),
    ...(fields.has("caption") ? { caption: fields.get("caption") } : {}),
  };
}

function parseWorkoutExerciseEntry(entry: string): WorkoutExerciseDraft {
  const fields = parseCompactFields(entry, "workout-exercise", invalidScheduledLogOption);
  rejectUnsupportedCompactFields(
    fields,
    "workout-exercise",
    workoutExerciseFieldKeys,
    invalidScheduledLogOption,
  );
  return {
    name: requireCompactString(fields, "name", "workout-exercise", invalidScheduledLogOption),
    order: requireCompactInteger(
      fields,
      "order",
      "workout-exercise",
      invalidScheduledLogOption,
    ),
    sets: [],
    ...(fields.has("sourceExerciseId")
      ? { sourceExerciseId: fields.get("sourceExerciseId") }
      : {}),
    ...(fields.has("groupId") ? { groupId: fields.get("groupId") } : {}),
    ...(fields.has("mode") ? { mode: fields.get("mode") } : {}),
    ...(fields.has("unitOverride") ? { unitOverride: fields.get("unitOverride") } : {}),
    ...(fields.has("note") ? { note: fields.get("note") } : {}),
  };
}

function parseWorkoutSetEntry(entry: string): {
  exerciseOrder: number;
  set: Record<string, unknown>;
} {
  const fields = parseCompactFields(entry, "workout-set", invalidScheduledLogOption);
  rejectUnsupportedCompactFields(
    fields,
    "workout-set",
    workoutSetFieldKeys,
    invalidScheduledLogOption,
  );
  const exerciseOrder = requireCompactInteger(
    fields,
    "exercise",
    "workout-set",
    invalidScheduledLogOption,
  );
  const set: Record<string, unknown> = {
    order: requireCompactInteger(fields, "order", "workout-set", invalidScheduledLogOption),
  };

  for (const key of [
    "type",
    "weightUnit",
  ]) {
    if (fields.has(key)) {
      set[key] = fields.get(key);
    }
  }

  for (const key of [
    "reps",
    "weight",
    "durationSeconds",
    "distanceMeters",
    "rpe",
    "bodyweightKg",
    "assistanceKg",
    "addedWeightKg",
  ]) {
    const value = compactNumber(fields, key, "workout-set", invalidScheduledLogOption);
    if (value !== undefined) {
      set[key] = value;
    }
  }

  return {
    exerciseOrder,
    set,
  };
}

function hasWorkoutOptions(options: WorkoutOptions): boolean {
  return workoutOptionKeys.some((key) => options[key] !== undefined);
}

function buildWorkoutFromOptions(options: WorkoutOptions): WorkoutSession | undefined {
  if (!hasWorkoutOptions(options)) {
    return undefined;
  }

  const workout: Record<string, unknown> = {
    exercises: [],
  };

  if (options.workoutSourceApp !== undefined) workout.sourceApp = options.workoutSourceApp;
  if (options.workoutSourceWorkoutId !== undefined) {
    workout.sourceWorkoutId = options.workoutSourceWorkoutId;
  }
  if (options.workoutStartedAt !== undefined) workout.startedAt = options.workoutStartedAt;
  if (options.workoutEndedAt !== undefined) workout.endedAt = options.workoutEndedAt;
  if (options.workoutRoutineId !== undefined) workout.routineId = options.workoutRoutineId;
  if (options.workoutRoutineName !== undefined) workout.routineName = options.workoutRoutineName;
  if (options.workoutSessionNote !== undefined) workout.sessionNote = options.workoutSessionNote;

  const mediaEntries = normalizeRepeatableFlagOption(options.workoutMedia, "workout-media");
  if (mediaEntries) {
    workout.media = mediaEntries.map(parseWorkoutMediaEntry);
  }

  const exercisesByOrder = new Map<number, WorkoutExerciseDraft>();
  const exerciseEntries = normalizeRepeatableFlagOption(
    options.workoutExercise,
    "workout-exercise",
  );
  for (const exercise of exerciseEntries?.map(parseWorkoutExerciseEntry) ?? []) {
    if (exercisesByOrder.has(exercise.order)) {
      invalidScheduledLogOption(
        `Duplicate --workout-exercise order ${exercise.order}.`,
      );
    }
    exercisesByOrder.set(exercise.order, exercise);
  }

  const setEntries = normalizeRepeatableFlagOption(options.workoutSet, "workout-set");
  for (const { exerciseOrder, set } of setEntries?.map(parseWorkoutSetEntry) ?? []) {
    const exercise = exercisesByOrder.get(exerciseOrder);
    if (!exercise) {
      invalidScheduledLogOption(
        `--workout-set references exercise ${exerciseOrder}, but no matching --workout-exercise was provided.`,
      );
    }
    exercise.sets.push(set);
  }

  workout.exercises = [...exercisesByOrder.values()].sort(
    (left, right) => left.order - right.order,
  );

  const parsed = workoutSessionSchema.safeParse(workout);
  if (!parsed.success) {
    throw new VaultCliError("invalid_option", "Invalid workout template fields.", {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

function buildScheduledLogActionFromOptions(options: {
  actionKind: (typeof scheduledLogActionKindValues)[number];
  actionNote?: string;
  actionTag?: string[];
  actionTitle?: string;
  activityType?: string;
  distanceKm?: number;
  durationMinutes?: number;
  foodId?: string;
  ingredient?: string[];
  interventionType?: string;
  measurementMetric?: string[];
  measurementNote?: string[];
  measurementQualifier?: string[];
  measurementUnit?: string[];
  measurementValue?: number[];
  nutritionCalories?: number;
  nutritionCarbsGrams?: number;
  nutritionConfidence?: (typeof NUTRITION_CONFIDENCE_LEVELS)[number];
  nutritionFatGrams?: number;
  nutritionFiberGrams?: number;
  nutritionProteinGrams?: number;
  nutritionSource?: (typeof NUTRITION_PROVENANCE_SOURCES)[number];
  nutritionSourceDetail?: string;
  protocolId?: string;
  workoutEndedAt?: string;
  workoutExercise?: string[];
  workoutMedia?: string[];
  workoutRoutineId?: string;
  workoutRoutineName?: string;
  workoutSessionNote?: string;
  workoutSet?: string[];
  workoutSourceApp?: string;
  workoutSourceWorkoutId?: string;
  workoutStartedAt?: string;
}): ScheduledLogAction {
  const actionTags = normalizeRepeatableFlagOption(options.actionTag, "action-tag");
  const commonFields = actionTags ? { tags: actionTags } : {};
  const workout = buildWorkoutFromOptions(options);

  if (workout && options.actionKind !== "activity_session.add") {
    invalidScheduledLogOption(
      "Workout template fields are only valid with --action-kind=activity_session.add.",
    );
  }

  switch (options.actionKind) {
    case "meal.add": {
      const ingredients = normalizeRepeatableFlagOption(options.ingredient, "ingredient");
      const nutrition = buildMealNutritionFromOptions(options);
      return scheduledLogActionSchema.parse({
        kind: "meal.add",
        ...commonFields,
        ...(options.foodId ? { foodId: options.foodId } : {}),
        ...(options.actionNote ? { note: options.actionNote } : {}),
        ...(ingredients ? { ingredients } : {}),
        ...(nutrition ? { nutrition } : {}),
      });
    }
    case "activity_session.add":
      return scheduledLogActionSchema.parse({
        kind: "activity_session.add",
        ...commonFields,
        title: requireStringOption(options.actionTitle, "action-title"),
        activityType: requireStringOption(options.activityType, "activity-type"),
        durationMinutes: requireNumberOption(options.durationMinutes, "duration-minutes"),
        ...(options.distanceKm !== undefined ? { distanceKm: options.distanceKm } : {}),
        ...(options.actionNote ? { note: options.actionNote } : {}),
        ...(workout ? { workout } : {}),
      });
    case "intervention_session.add":
      return scheduledLogActionSchema.parse({
        kind: "intervention_session.add",
        ...commonFields,
        title: requireStringOption(options.actionTitle, "action-title"),
        interventionType: requireStringOption(options.interventionType, "intervention-type"),
        ...(options.durationMinutes !== undefined
          ? { durationMinutes: options.durationMinutes }
          : {}),
        ...(options.protocolId ? { protocolId: options.protocolId } : {}),
        ...(options.actionNote ? { note: options.actionNote } : {}),
      });
    case "measurement.add":
      return scheduledLogActionSchema.parse({
        kind: "measurement.add",
        ...commonFields,
        ...(options.actionTitle ? { title: options.actionTitle } : {}),
        ...(options.actionNote ? { note: options.actionNote } : {}),
        measurements: buildMeasurementsFromOptions(options),
      });
  }
}

function defaultScheduledLogBody(title: string, summary: string | undefined): string {
  return summary ?? `Auto-log ${title}.`;
}

export function registerScheduledLogCommands(cli: Cli.Cli) {
  const scheduledLog = Cli.create("scheduled-log", {
    description: "Canonical scheduled auto-log registry commands.",
  });

  scheduledLog.command("scaffold", {
    args: z.object({}),
    description: "Emit an advanced scheduled-log JSON payload template for import fallback use.",
    options: withBaseOptions(),
    output: scheduledLogScaffoldResultSchema,
    run(context) {
      const payload = createScheduledLogScaffoldPayload();
      return {
        vault: context.options.vault,
        noun: "scheduled-log" as const,
        payload,
        markdown: buildScheduledLogMarkdownPreview(payload),
      };
    },
  });

  scheduledLog.command("save", {
    args: z.object({
      title: z.string().min(1).max(160).describe("Scheduled log title."),
    }),
    description: "Create or update one scheduled log from typed command fields.",
    examples: [
      {
        args: {
          title: "'Daily sauna'",
        },
        description: "Save a daily scheduled intervention log without a JSON payload.",
        options: {
          actionKind: "intervention_session.add",
          actionTitle: "Sauna",
          durationMinutes: 20,
          interventionType: "sauna",
          scheduleKind: "dailyLocal",
          scheduleLocalTime: "18:00",
          vault: "./vault",
        },
      },
      {
        args: {
          title: "'Weekly strength template'",
        },
        description: "Save an activity scheduled log with a compact workout template.",
        options: {
          actionKind: "activity_session.add",
          actionTitle: "'Strength session'",
          activityType: "strength",
          durationMinutes: 45,
          scheduleKind: "cron",
          scheduleCron: "'0 7 * * 1'",
          workoutExercise: ["'order=1;name=Goblet Squat;mode=weight_reps'"],
          workoutSet: ["'exercise=1;order=1;reps=10;weight=24;weightUnit=kg'"],
          vault: "./vault",
        },
      },
      {
        args: {
          title: "'Weekly weight check'",
        },
        description: "Save a measurement scheduled log with typed measurement entries.",
        options: {
          actionKind: "measurement.add",
          actionTitle: "'Weight check'",
          measurementMetric: ["weight"],
          measurementQualifier: ["fasting=true"],
          measurementUnit: ["kg"],
          measurementValue: [72.5],
          scheduleKind: "cron",
          scheduleCron: "'0 8 * * 1'",
          vault: "./vault",
        },
      },
    ],
    hint: "Use scheduled-log import-json only for advanced JSON imports or bulk edits.",
    options: withBaseOptions({
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Optional existing scheduled log id to update."),
      slug: z
        .string()
        .regex(scheduledLogSlugPattern)
        .optional()
        .describe("Optional stable lowercase kebab-case slug."),
      status: z.enum(scheduledLogStatusValues).optional().describe("Optional scheduled log status."),
      scheduleKind: z.enum(scheduleIntentKindValues).describe("Schedule discriminator."),
      scheduleAt: z
        .string()
        .min(1)
        .max(64)
        .optional()
        .describe("Required when --schedule-kind=at."),
      scheduleEveryMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Required positive millisecond interval when --schedule-kind=every."),
      scheduleCron: z
        .string()
        .min(1)
        .max(400)
        .optional()
        .describe("Required cron expression when --schedule-kind=cron."),
      scheduleLocalTime: z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "Expected a 24-hour HH:MM time.")
        .optional()
        .describe("Required HH:MM local time when --schedule-kind=dailyLocal."),
      actionKind: z.enum(scheduledLogActionKindValues).describe("Action discriminator."),
      actionTitle: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Action title for activity, intervention, or measurement actions."),
      actionNote: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("Optional action note."),
      actionTag: z
        .array(z.string().regex(scheduledLogSlugPattern))
        .optional()
        .describe("Optional action-local tag. Repeat --action-tag for multiple values. Do not comma-delimit multiple tags."),
      foodId: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe("Optional meal.add food id."),
      ingredient: z
        .array(z.string().min(1).max(4000))
        .optional()
        .describe("Optional meal.add ingredient. Repeat --ingredient for multiple values; shell-quote ingredients with spaces. Do not comma-delimit multiple ingredients."),
      nutritionCalories: z.number().nonnegative().optional().describe("Optional meal calorie total."),
      nutritionProteinGrams: z.number().nonnegative().optional().describe("Optional meal protein grams."),
      nutritionCarbsGrams: z.number().nonnegative().optional().describe("Optional meal carbohydrate grams."),
      nutritionFatGrams: z.number().nonnegative().optional().describe("Optional meal fat grams."),
      nutritionFiberGrams: z.number().nonnegative().optional().describe("Optional meal fiber grams."),
      nutritionSource: z
        .enum(NUTRITION_PROVENANCE_SOURCES)
        .optional()
        .describe("Optional meal nutrition provenance source."),
      nutritionConfidence: z
        .enum(NUTRITION_CONFIDENCE_LEVELS)
        .optional()
        .describe("Optional meal nutrition provenance confidence."),
      nutritionSourceDetail: z
        .string()
        .min(1)
        .max(240)
        .optional()
        .describe("Optional meal nutrition provenance detail."),
      activityType: z
        .string()
        .regex(scheduledLogSlugPattern)
        .optional()
        .describe("Required activity type slug when --action-kind=activity_session.add."),
      interventionType: z
        .string()
        .regex(scheduledLogSlugPattern)
        .optional()
        .describe("Required intervention type slug when --action-kind=intervention_session.add."),
      durationMinutes: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe("Action duration minutes for activity or intervention actions."),
      distanceKm: z
        .number()
        .positive()
        .max(1000)
        .optional()
        .describe("Optional activity distance in kilometers."),
      protocolId: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe("Optional intervention protocol id."),
      workoutSourceApp: z
        .string()
        .regex(scheduledLogSlugPattern)
        .optional()
        .describe("Optional workout template source app slug."),
      workoutSourceWorkoutId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Optional source workout id for the workout template."),
      workoutStartedAt: isoTimestampSchema
        .optional()
        .describe("Optional workout template started-at timestamp."),
      workoutEndedAt: isoTimestampSchema
        .optional()
        .describe("Optional workout template ended-at timestamp."),
      workoutRoutineId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Optional workout routine id."),
      workoutRoutineName: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("Optional workout routine name."),
      workoutSessionNote: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("Optional workout session note."),
      workoutMedia: z
        .array(z.string().min(1))
        .optional()
        .describe("Workout media as kind=...;relativePath=... with optional mediaType/caption. Shell-quote each semicolon-separated value. Repeat --workout-media for multiple entries."),
      workoutExercise: z
        .array(z.string().min(1))
        .optional()
        .describe("Workout exercise as order=...;name=... with optional sourceExerciseId/groupId/mode/unitOverride/note. Shell-quote each semicolon-separated value. Repeat --workout-exercise for multiple exercises."),
      workoutSet: z
        .array(z.string().min(1))
        .optional()
        .describe("Workout set as exercise=...;order=... plus optional type/reps/weight/weightUnit/durationSeconds/distanceMeters/rpe/bodyweightKg/assistanceKg/addedWeightKg. Shell-quote each semicolon-separated value. Repeat --workout-set for multiple sets."),
      measurementMetric: z
        .array(z.string().regex(scheduledLogSlugPattern))
        .optional()
        .describe("Measurement metric slug. Repeat --measurement-metric with --measurement-value and --measurement-unit for multiple measurements; keep the order aligned."),
      measurementValue: z
        .array(z.coerce.number())
        .optional()
        .describe("Measurement numeric value. Repeat --measurement-value with --measurement-metric and --measurement-unit for multiple measurements; keep the order aligned."),
      measurementUnit: z
        .array(z.string().min(1).max(64))
        .optional()
        .describe("Measurement unit. Repeat --measurement-unit with --measurement-metric and --measurement-value for multiple measurements; keep the order aligned. Do not comma-delimit multiple units."),
      measurementQualifier: z
        .array(z.string().min(1))
        .optional()
        .describe("Measurement qualifier as key=value, or N:key=value for multiple measurements."),
      measurementNote: z
        .array(z.string().min(1).max(4000))
        .optional()
        .describe("Measurement note, or N:note for multiple measurements."),
      summary: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe("Optional scheduled log summary."),
      tag: z
        .array(z.string().regex(scheduledLogSlugPattern))
        .optional()
        .describe("Optional top-level scheduled log tag. Repeat --tag for multiple values. Do not comma-delimit multiple tags."),
      body: z.string().max(40_000).optional().describe("Optional markdown body."),
    }),
    output: scheduledLogWriteResultSchema,
    async run(context) {
      const input = scheduledLogScaffoldPayloadSchema.parse({
        scheduledLogId: context.options.id,
        slug: context.options.slug,
        title: context.args.title,
        status: context.options.status,
        schedule: buildScheduleIntentFromOptions(context.options),
        action: buildScheduledLogActionFromOptions(context.options),
        summary: context.options.summary,
        tags: normalizeRepeatableFlagOption(context.options.tag, "tag"),
        body: context.options.body ?? defaultScheduledLogBody(context.args.title, context.options.summary),
      });
      const result = await upsertScheduledLog({
        ...input,
        vaultRoot: context.options.vault,
      });

      return {
        vault: context.options.vault,
        scheduledLogId: result.record.scheduledLogId,
        lookupId: result.record.slug,
        path: result.record.relativePath,
        created: result.created,
      };
    },
  });

  scheduledLog.command("show", {
    args: z.object({
      lookup: z.string().min(1).describe("Scheduled log id or slug to show."),
    }),
    description: "Show one scheduled log by id or slug.",
    options: withBaseOptions(),
    output: scheduledLogShowResultSchema,
    async run(context) {
      return {
        vault: context.options.vault,
        scheduledLog: await showScheduledLog(context.options.vault, context.args.lookup),
      };
    },
  });

  scheduledLog.command("list", {
    args: z.object({}),
    description: "List scheduled logs with optional filters.",
    options: withBaseOptions({
      status: z
        .array(z.enum(scheduledLogStatusValues))
        .optional()
        .describe("Optional repeated status filter."),
      text: z
        .string()
        .min(1)
        .optional()
        .describe("Optional lexical filter across title, action, schedule, and body."),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: scheduledLogListResultSchema,
    async run(context) {
      const items = await listScheduledLogs(context.options.vault, {
        limit: context.options.limit,
        status: context.options.status,
        text: context.options.text,
      });

      return {
        vault: context.options.vault,
        filters: {
          status: context.options.status ?? null,
          text: context.options.text ?? null,
          limit: context.options.limit,
        },
        count: items.length,
        items,
      };
    },
  });

  scheduledLog.command("import-json", {
    args: z.object({}),
    description: "Import or bulk-edit one scheduled log from an advanced JSON payload.",
    hint: "Prefer scheduled-log save for canonical typed create/update usage.",
    options: withBaseOptions({
      input: textInputOptionSchema.describe(
        "Advanced scheduled-log payload in @file.json form or - for stdin.",
      ),
    }),
    output: scheduledLogWriteResultSchema,
    async run(context) {
      const rawInput = await loadJsonInputObject(
        context.options.input,
        "scheduled-log payload",
      );
      const input = scheduledLogScaffoldPayloadSchema.parse(rawInput);
      const result = await upsertScheduledLog({
        ...input,
        vaultRoot: context.options.vault,
      });

      return {
        vault: context.options.vault,
        scheduledLogId: result.record.scheduledLogId,
        lookupId: result.record.slug,
        path: result.record.relativePath,
        created: result.created,
      };
    },
  });

  for (const [commandName, status] of [
    ["pause", "paused"],
    ["resume", "active"],
    ["archive", "archived"],
  ] as const satisfies ReadonlyArray<readonly [string, ScheduledLogStatus]>) {
    scheduledLog.command(commandName, {
      args: z.object({
        lookup: z.string().min(1).describe("Scheduled log id or slug to update."),
      }),
      description: `${commandName[0]?.toUpperCase() ?? ""}${commandName.slice(1)} a scheduled log.`,
      options: withBaseOptions(),
      output: scheduledLogStatusResultSchema,
      async run(context) {
        const existing = await showScheduledLog(context.options.vault, context.args.lookup);
        if (!existing) {
          throw new Error(`Scheduled log "${context.args.lookup}" was not found.`);
        }
        const result = await setScheduledLogStatus({
          vaultRoot: context.options.vault,
          scheduledLogId: existing.scheduledLogId,
          status,
        });

        return {
          vault: context.options.vault,
          scheduledLogId: result.record.scheduledLogId,
          lookupId: result.record.slug,
          status: result.record.status,
        };
      },
    });
  }

  cli.command(scheduledLog);
}
