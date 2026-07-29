import { z } from "zod";

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

/** Conservative V1 limits keep inline response-card state bounded. */
export const assistantResponseCardV1Bounds = {
  calories: 20_000,
  macroGrams: 2_000,
  mealCount: 100,
} as const;

export type NutritionCardMetric = {
  total: number | null;
  mealCount: number;
};

export type DailyNutritionResponseCard = {
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

export type AssistantResponseCard = DailyNutritionResponseCard;

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

export const dailyNutritionResponseCardSchema: z.ZodType<
  DailyNutritionResponseCard
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
  .superRefine((card, context) => {
    for (const [metricName, metric] of Object.entries(card.totals)) {
      if (metric.mealCount > card.mealCount) {
        context.addIssue({
          code: "custom",
          message: "A metric cannot have more supporting meals than the card.",
          path: ["totals", metricName, "mealCount"],
        });
      }
    }
  });

export const assistantResponseCardSchema: z.ZodType<AssistantResponseCard> =
  dailyNutritionResponseCardSchema;

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
