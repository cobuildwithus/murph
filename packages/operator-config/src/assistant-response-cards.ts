import { Buffer } from 'node:buffer'

import {
  assistantResponseCardSchema,
  type AssistantResponseCard,
  type DailyNutritionResponseCard,
  type NutritionCardMetric,
} from '@murphai/contracts'
import { z } from 'zod'

const APP_CARD_DATA_URL_PREFIX = 'data:application/json;base64,'
const APP_CARD_DATA_URL_MAX_LENGTH = 4_096
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

export type AppCardEnvelopeV1 = {
  schemaVersion: 1
  card: AssistantResponseCard
}

export type LinqIMessageAppLayout = {
  caption: 'Murph'
  subcaption: 'Nutrition summary'
  trailing_caption: 'OPEN'
}

export {
  assistantResponseCardSchema,
  assistantResponseCardV1Bounds,
  dailyNutritionResponseCardSchema,
  type AssistantResponseCard,
  type DailyNutritionResponseCard,
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
  assistantResponseCardSchema.parse(card)
  return {
    caption: 'Murph',
    subcaption: 'Nutrition summary',
    trailing_caption: 'OPEN',
  }
}

export function encodeAppCardDataUrl(card: AssistantResponseCard): string {
  const parsed = assistantResponseCardSchema.parse(card)
  const envelope: AppCardEnvelopeV1 = {
    schemaVersion: 1,
    card: parsed,
  }
  const encoded = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')
  const dataUrl = `${APP_CARD_DATA_URL_PREFIX}${encoded}`
  if (dataUrl.length >= APP_CARD_DATA_URL_MAX_LENGTH) {
    throw new TypeError('The encoded app card exceeds the inline V1 size limit.')
  }
  return dataUrl
}

function renderDailyNutritionResponseCardText(
  card: DailyNutritionResponseCard,
): string {
  const mealLabel = card.mealCount === 1 ? 'meal' : 'meals'
  const calorieTotal = card.totals.calories.total
  if (calorieTotal === null) {
    throw new TypeError('A daily nutrition response card requires a calorie total.')
  }
  const metrics = [
    `about ${formatNutritionCardNumber(calorieTotal)} calories`,
    ...renderAvailableMacroTotals(card),
  ]
  const summary = `${formatNutritionCardDate(card.localDate)}: ${
    metrics.join(' · ')
  } from ${card.mealCount} logged ${mealLabel}.`
  const partialLabel = renderPartialNutritionLabel(card)
  return partialLabel === null ? summary : `${summary} ${partialLabel}`
}

function renderAvailableMacroTotals(
  card: DailyNutritionResponseCard,
): string[] {
  const metrics: Array<[NutritionCardMetric, string]> = [
    [card.totals.proteinGrams, 'g protein'],
    [card.totals.carbsGrams, 'g carbs'],
    [card.totals.fatGrams, 'g fat'],
  ]
  return metrics.flatMap(([metric, unit]) =>
    metric.total === null
      ? []
      : [`${formatNutritionCardNumber(metric.total)}${unit}`],
  )
}

function renderPartialNutritionLabel(
  card: DailyNutritionResponseCard,
): string | null {
  const caloriesPartial =
    card.totals.calories.mealCount < card.mealCount
  const macrosPartial = [
    card.totals.proteinGrams,
    card.totals.carbsGrams,
    card.totals.fatGrams,
  ].some((metric) =>
    metric.total === null || metric.mealCount < card.mealCount
  )

  if (caloriesPartial && macrosPartial) {
    return 'Some calorie and macro estimates were partial.'
  }
  if (caloriesPartial) {
    return 'Some calorie estimates were partial.'
  }
  if (macrosPartial) {
    return 'Some macro estimates were partial.'
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

function createAssistantResponseCardJsonSchema() {
  const {
    $schema: _dialect,
    ...portableSchema
  } = z.toJSONSchema(assistantResponseCardSchema)
  return portableSchema
}
