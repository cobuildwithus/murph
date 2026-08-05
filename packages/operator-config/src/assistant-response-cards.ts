import {
  assistantResponseCardSchema,
  type AssistantResponseCard,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV2,
  type NutritionCardMetric,
} from '@murphai/contracts'
import { z } from 'zod'

const NUTRITION_CARD_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const
const NUTRITION_CARD_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3,
  useGrouping: true,
})

export const LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT =
  'Open your Murph nutrition summary'
export const LINQ_IMESSAGE_APP_CARD_URL = 'https://murph.ai'

export type LinqIMessageAppLayout = {
  caption: string
  subcaption: string
  trailing_caption?: string
  trailing_subcaption?: string
}

export {
  assistantResponseCardSchema,
  assistantResponseCardV1Bounds,
  dailyNutritionResponseCardV1Schema,
  dailyNutritionResponseCardV2Schema,
  dailyNutritionResponseCardSchema,
  nutritionCardGoalStatusValues,
  type AssistantResponseCard,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV1,
  type DailyNutritionResponseCardV2,
  type NutritionCardGoalSnapshot,
  type NutritionCardGoalStatus,
  type NutritionCardMetric,
} from '@murphai/contracts'

export const assistantResponseCardJsonSchema =
  createAssistantResponseCardJsonSchema()

export function renderAssistantResponseCardText(
  card: AssistantResponseCard,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  switch (parsed.kind) {
    case 'daily_nutrition':
      return renderDailyNutritionResponseCardText(parsed)
  }
}

export function buildLinqIMessageAppLayout(
  card: AssistantResponseCard,
): LinqIMessageAppLayout {
  const parsed = assistantResponseCardSchema.parse(card)
  const mealLabel = parsed.mealCount === 1 ? 'meal' : 'meals'
  const calorieTotal = readRequiredCalorieTotal(parsed)
  const proteinTotal = parsed.totals.proteinGrams.total
  const trailingTotals = [
    renderNutritionMetric(parsed.totals.carbsGrams, 'g carbs'),
    renderNutritionMetric(parsed.totals.fatGrams, 'g fat'),
  ].filter((value): value is string => value !== null)
  const trailingDetails = [
    ...(isDailyNutritionResponseCardV2(parsed)
      ? [renderNutritionMetric(parsed.totals.fiberGrams, 'g fiber')]
      : []),
    ...(renderPartialNutritionLabel(parsed) === null
      ? []
      : ['PARTIAL TOTALS']),
  ].filter((value): value is string => value !== null)

  return {
    caption: `${formatNutritionCardDate(parsed.localDate)} · ${
      parsed.mealCount
    } ${mealLabel}`,
    subcaption: [
      `${formatNutritionCardNumber(calorieTotal)} cal`,
      ...(proteinTotal === null
        ? []
        : [`${formatNutritionCardNumber(proteinTotal)}g protein`]),
    ].join(' · '),
    ...(trailingTotals.length === 0
      ? {}
      : { trailing_caption: trailingTotals.join(' · ') }),
    ...(trailingDetails.length === 0
      ? {}
      : { trailing_subcaption: trailingDetails.join(' · ') }),
  }
}

function renderDailyNutritionResponseCardText(
  card: DailyNutritionResponseCard,
): string {
  const mealLabel = card.mealCount === 1 ? 'meal' : 'meals'
  const calorieTotal = readRequiredCalorieTotal(card)
  const metrics = [
    `about ${formatNutritionCardNumber(calorieTotal)} calories`,
    ...renderAvailableNutritionTotals(card),
  ]
  const summary = `${formatNutritionCardDate(card.localDate)}: ${
    metrics.join(' · ')
  } from ${card.mealCount} logged ${mealLabel}.`
  const partialLabel = renderPartialNutritionLabel(card)
  return partialLabel === null ? summary : `${summary} ${partialLabel}`
}

function renderAvailableNutritionTotals(
  card: DailyNutritionResponseCard,
): string[] {
  const metrics: Array<[NutritionCardMetric, string]> = [
    [card.totals.proteinGrams, 'g protein'],
    [card.totals.carbsGrams, 'g carbs'],
    [card.totals.fatGrams, 'g fat'],
  ]
  if (isDailyNutritionResponseCardV2(card)) {
    metrics.push([card.totals.fiberGrams, 'g fiber'])
  }
  return metrics.flatMap(([metric, unit]) => {
    const rendered = renderNutritionMetric(metric, unit)
    return rendered === null ? [] : [rendered]
  })
}

function renderNutritionMetric(
  metric: NutritionCardMetric,
  unit: string,
): string | null {
  return metric.total === null
    ? null
    : `${formatNutritionCardNumber(metric.total)}${unit}`
}

function readRequiredCalorieTotal(card: DailyNutritionResponseCard): number {
  const calorieTotal = card.totals.calories.total
  if (calorieTotal === null) {
    throw new TypeError(
      'A daily nutrition response card requires a calorie total.',
    )
  }
  return calorieTotal
}

function renderPartialNutritionLabel(
  card: DailyNutritionResponseCard,
): string | null {
  const caloriesPartial =
    card.totals.calories.mealCount < card.mealCount
  const nutritionMetrics = [
    card.totals.proteinGrams,
    card.totals.carbsGrams,
    card.totals.fatGrams,
    ...(isDailyNutritionResponseCardV2(card)
      ? [card.totals.fiberGrams]
      : []),
  ]
  const nonCalorieNutritionPartial = nutritionMetrics.some((metric) =>
    metric.total === null || metric.mealCount < card.mealCount
  )

  const metricFamily = isDailyNutritionResponseCardV2(card)
    ? 'nutrition'
    : 'macro'
  if (caloriesPartial && nonCalorieNutritionPartial) {
    return `Some calorie and ${metricFamily} estimates were partial.`
  }
  if (caloriesPartial) {
    return 'Some calorie estimates were partial.'
  }
  if (nonCalorieNutritionPartial) {
    return `Some ${metricFamily} estimates were partial.`
  }
  return null
}

function formatNutritionCardNumber(value: number): string {
  return NUTRITION_CARD_NUMBER_FORMATTER.format(value)
}

function formatNutritionCardDate(localDate: string): string {
  const [, monthText, dayText] = localDate.split('-')
  const month = Number(monthText)
  const day = Number(dayText)
  return `${NUTRITION_CARD_MONTHS[month - 1]} ${day}`
}

function isDailyNutritionResponseCardV2(
  card: DailyNutritionResponseCard,
): card is DailyNutritionResponseCardV2 {
  return 'version' in card && card.version === 2
}

function createAssistantResponseCardJsonSchema() {
  const {
    $schema: _dialect,
    ...portableSchema
  } = z.toJSONSchema(assistantResponseCardSchema)
  return portableSchema
}
