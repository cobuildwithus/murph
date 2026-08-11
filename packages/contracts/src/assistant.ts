import * as z from "./zod-runtime.ts";

import {
  challengeStandingsResponseCardV1Schema,
  type ChallengeStandingsResponseCardV1,
} from "./challenge-standings-card.ts";
import {
  compactTableResponseCardV1Schema,
  type CompactTableResponseCardV1,
} from "./compact-table-card.ts";

export const MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE = `Hey, I'm Murph.

Everyone's got something they want from their health. My job is to help you actually get there: figure out what matters, what actually works for you, and follow through. Everything you share stays private to you, and the more I learn, the better my help fits.

Ready to get started?`;

export const assistantReasoningEffortValues = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type AssistantReasoningEffort =
  (typeof assistantReasoningEffortValues)[number];

/** Conservative inline limits introduced with V1 and shared by later versions. */
export const assistantResponseCardV1Bounds = {
  calories: 20_000,
  macroGrams: 2_000,
  mealCount: 100,
} as const;

export const nutritionCardGoalStatusValues = [
  "far_under_target",
  "under_target",
  "on_target",
  "over_target",
  "far_over_target",
  "unavailable",
] as const;

export type NutritionCardGoalStatus =
  (typeof nutritionCardGoalStatusValues)[number];

export const nutritionCardGoalStatusLabels = {
  far_over_target: "far over target",
  far_under_target: "far under target",
  on_target: "on target",
  over_target: "over target",
  unavailable: "status unavailable",
  under_target: "under target",
} as const satisfies Record<NutritionCardGoalStatus, string>;

export type NutritionCardMetric = {
  total: number | null;
  mealCount: number;
};

export type NutritionCardGoalSnapshot = {
  target: number;
  status: NutritionCardGoalStatus;
};

export type DailyNutritionResponseCardV1 = {
  kind: "daily_nutrition";
  localDate: string;
  mealCount: number;
  totals: {
    calories: NutritionCardMetric;
    proteinGrams: NutritionCardMetric;
    carbsGrams: NutritionCardMetric;
    fatGrams: NutritionCardMetric;
  };
};

export type DailyNutritionResponseCardV2 = {
  kind: "daily_nutrition";
  version: 2;
  localDate: string;
  mealCount: number;
  totals: {
    calories: NutritionCardMetric;
    proteinGrams: NutritionCardMetric;
    carbsGrams: NutritionCardMetric;
    fatGrams: NutritionCardMetric;
    fiberGrams: NutritionCardMetric;
  };
  goals: {
    calories: NutritionCardGoalSnapshot | null;
    proteinGrams: NutritionCardGoalSnapshot | null;
    carbsGrams: NutritionCardGoalSnapshot | null;
    fatGrams: NutritionCardGoalSnapshot | null;
    fiberGrams: NutritionCardGoalSnapshot | null;
  };
};

export type DailyNutritionResponseCard =
  | DailyNutritionResponseCardV1
  | DailyNutritionResponseCardV2;

export type AssistantResponseCard =
  | DailyNutritionResponseCard
  | CompactTableResponseCardV1
  | ChallengeStandingsResponseCardV1;

const nutritionCardMealCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(assistantResponseCardV1Bounds.mealCount);
const supportedNutritionCardMealCountSchema = nutritionCardMealCountSchema
  .positive();

function createNutritionCardMetricSchema(
  maximumTotal: number,
  totalRequired: boolean,
) {
  const totalSchema = z.number().finite().nonnegative().max(maximumTotal);
  const supportedMetricSchema = z
    .object({
      total: totalSchema,
      mealCount: supportedNutritionCardMealCountSchema,
    })
    .strict();
  return totalRequired
    ? supportedMetricSchema
    : z.union([
        supportedMetricSchema,
        z
          .object({
            total: z.null(),
            mealCount: z.literal(0),
          })
          .strict(),
      ]);
}

const calorieMetricSchema = createNutritionCardMetricSchema(
  assistantResponseCardV1Bounds.calories,
  true,
);
const macroMetricSchema = createNutritionCardMetricSchema(
  assistantResponseCardV1Bounds.macroGrams,
  false,
);

function addNutritionCardMealCountIssues(
  card: {
    mealCount: number;
    totals: Record<string, NutritionCardMetric>;
  },
  context: z.RefinementCtx,
): void {
  for (const [metricName, metric] of Object.entries(card.totals)) {
    if (metric.mealCount > card.mealCount) {
      context.addIssue({
        code: "custom",
        message: "A metric cannot have more supporting meals than the card.",
        path: ["totals", metricName, "mealCount"],
      });
    }
  }
}

function addNutritionCardGoalConsistencyIssue(
  metricName: string,
  cardMealCount: number,
  metric: NutritionCardMetric,
  goal: NutritionCardGoalSnapshot | null,
  context: z.RefinementCtx,
): void {
  if (goal === null) {
    return;
  }

  if (metric.total === null || metric.mealCount < cardMealCount) {
    if (goal.status === "unavailable") {
      return;
    }
    context.addIssue({
      code: "custom",
      message:
        "A missing or partial metric can only have an unavailable goal status.",
      path: ["goals", metricName, "status"],
    });
    return;
  }

  if (goal.status === "unavailable" || goal.status === "on_target") {
    return;
  }

  const pointsOver =
    goal.status === "over_target" || goal.status === "far_over_target";
  const pointsUnder =
    goal.status === "under_target" || goal.status === "far_under_target";
  if (
    (metric.total < goal.target && pointsOver) ||
    (metric.total > goal.target && pointsUnder)
  ) {
    context.addIssue({
      code: "custom",
      message: "Goal status cannot point opposite the total and target.",
      path: ["goals", metricName, "status"],
    });
  }
}

export const dailyNutritionResponseCardV1Schema: z.ZodType<
  DailyNutritionResponseCardV1
> = z
  .object({
    kind: z.literal("daily_nutrition"),
    localDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .refine(isValidLocalCalendarDate, {
        message: "localDate must be a valid YYYY-MM-DD calendar date.",
      }),
    mealCount: supportedNutritionCardMealCountSchema,
    totals: z
      .object({
        calories: calorieMetricSchema,
        proteinGrams: macroMetricSchema,
        carbsGrams: macroMetricSchema,
        fatGrams: macroMetricSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine(addNutritionCardMealCountIssues);

const nutritionCardGoalStatusSchema = z.enum(nutritionCardGoalStatusValues);

function createNutritionCardGoalSnapshotSchema(maximumTarget: number) {
  return z
    .object({
      target: z.number().finite().positive().max(maximumTarget),
      status: nutritionCardGoalStatusSchema,
    })
    .strict();
}

const calorieGoalSnapshotSchema = createNutritionCardGoalSnapshotSchema(
  assistantResponseCardV1Bounds.calories,
);
const macroGoalSnapshotSchema = createNutritionCardGoalSnapshotSchema(
  assistantResponseCardV1Bounds.macroGrams,
);

const dailyNutritionResponseCardV2BaseSchema = z
  .object({
    kind: z.literal("daily_nutrition"),
    version: z.literal(2),
    localDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .refine(isValidLocalCalendarDate, {
        message: "localDate must be a valid YYYY-MM-DD calendar date.",
      }),
    mealCount: supportedNutritionCardMealCountSchema,
    totals: z
      .object({
        calories: calorieMetricSchema,
        proteinGrams: macroMetricSchema,
        carbsGrams: macroMetricSchema,
        fatGrams: macroMetricSchema,
        fiberGrams: macroMetricSchema,
      })
      .strict(),
    goals: z
      .object({
        calories: calorieGoalSnapshotSchema.nullable(),
        proteinGrams: macroGoalSnapshotSchema.nullable(),
        carbsGrams: macroGoalSnapshotSchema.nullable(),
        fatGrams: macroGoalSnapshotSchema.nullable(),
        fiberGrams: macroGoalSnapshotSchema.nullable(),
      })
      .strict(),
  })
  .strict();

function addDailyNutritionResponseCardV2Issues(
  card: DailyNutritionResponseCardV2,
  context: z.RefinementCtx,
): void {
  addNutritionCardMealCountIssues(card, context);
  addNutritionCardGoalConsistencyIssue(
    "calories",
    card.mealCount,
    card.totals.calories,
    card.goals.calories,
    context,
  );
  addNutritionCardGoalConsistencyIssue(
    "proteinGrams",
    card.mealCount,
    card.totals.proteinGrams,
    card.goals.proteinGrams,
    context,
  );
  addNutritionCardGoalConsistencyIssue(
    "carbsGrams",
    card.mealCount,
    card.totals.carbsGrams,
    card.goals.carbsGrams,
    context,
  );
  addNutritionCardGoalConsistencyIssue(
    "fatGrams",
    card.mealCount,
    card.totals.fatGrams,
    card.goals.fatGrams,
    context,
  );
  addNutritionCardGoalConsistencyIssue(
    "fiberGrams",
    card.mealCount,
    card.totals.fiberGrams,
    card.goals.fiberGrams,
    context,
  );
}

export const dailyNutritionResponseCardV2Schema: z.ZodType<
  DailyNutritionResponseCardV2
> = dailyNutritionResponseCardV2BaseSchema.superRefine(
  addDailyNutritionResponseCardV2Issues,
);

/** New tool calls require all goals; the nullable V2 schema remains replay-safe. */
export const dailyNutritionResponseCardV2AuthoringSchema: z.ZodType<
  DailyNutritionResponseCardV2
> = dailyNutritionResponseCardV2BaseSchema
  .extend({
    goals: z
      .object({
        calories: calorieGoalSnapshotSchema,
        proteinGrams: macroGoalSnapshotSchema,
        carbsGrams: macroGoalSnapshotSchema,
        fatGrams: macroGoalSnapshotSchema,
        fiberGrams: macroGoalSnapshotSchema,
      })
      .strict(),
  })
  .superRefine(addDailyNutritionResponseCardV2Issues);

export const dailyNutritionResponseCardSchema: z.ZodType<
  DailyNutritionResponseCard
> = z.union([
  dailyNutritionResponseCardV2Schema,
  dailyNutritionResponseCardV1Schema,
]);

export const assistantResponseCardSchema: z.ZodType<AssistantResponseCard> =
  z.union([
    dailyNutritionResponseCardSchema,
    compactTableResponseCardV1Schema,
    challengeStandingsResponseCardV1Schema,
  ]);

function isValidLocalCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
