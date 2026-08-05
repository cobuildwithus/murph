import { Buffer } from 'node:buffer'

import {
  assistantResponseCardSchema,
  type AssistantResponseCard,
  type CompactTableResponseCardV1,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV1,
  type DailyNutritionResponseCardV2,
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
  'Open your Murph card'

export type AppCardEnvelopeV1 = {
  schemaVersion: 1
  card: DailyNutritionResponseCardV1
}

export type AppCardEnvelopeV2 = {
  schemaVersion: 2
  card: DailyNutritionResponseCardV2
}

export type AppCardEnvelopeV3 = {
  schemaVersion: 3
  card: CompactTableResponseCardV1
}

export type LinqIMessageAppLayout = {
  caption: 'Murph'
  subcaption: 'Nutrition summary' | 'Table' | 'Workout table'
  trailing_caption: 'OPEN'
  trailing_subcaption?: 'PARTIAL TOTALS'
}

export {
  assistantResponseCardSchema,
  assistantResponseCardV1Bounds,
  compactTableCardV1Bounds,
  compactTableResponseCardV1Schema,
  compactTableRowV1Schema,
  compactTableTrackingSourceV1Schema,
  dailyNutritionResponseCardV1Schema,
  dailyNutritionResponseCardV2Schema,
  dailyNutritionResponseCardSchema,
  nutritionCardGoalStatusValues,
  type AssistantResponseCard,
  type CompactTableResponseCardV1,
  type CompactTableRowV1,
  type CompactTableTrackingSourceV1,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV1,
  type DailyNutritionResponseCardV2,
  type NutritionCardGoalSnapshot,
  type NutritionCardGoalStatus,
  type NutritionCardMetric,
} from '@murphai/contracts'

export const assistantResponseCardJsonSchema =
  createAssistantResponseCardJsonSchema()

/**
 * User-visible semantic text used by non-native routes and definitive native
 * card fallback. Internal tracking references must never appear here.
 */
export function renderAssistantResponseCardText(
  card: AssistantResponseCard,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  switch (parsed.kind) {
    case 'daily_nutrition':
      return renderDailyNutritionResponseCardText(parsed)
    case 'compact_table':
      return renderCompactTableResponseCardText(parsed, false)
  }
}

/**
 * Durable model-context representation. A tracked table keeps its exact
 * canonical source here so a later turn can reopen the workout without making
 * the user-facing text fallback expose an internal id.
 */
export function renderAssistantResponseCardTranscriptText(
  card: AssistantResponseCard,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  switch (parsed.kind) {
    case 'daily_nutrition':
      return renderDailyNutritionResponseCardText(parsed)
    case 'compact_table':
      return renderCompactTableResponseCardText(parsed, true)
  }
}

export function buildLinqIMessageAppLayout(
  card: AssistantResponseCard,
): LinqIMessageAppLayout {
  const parsed = assistantResponseCardSchema.parse(card)
  if (parsed.kind === 'compact_table') {
    return {
      caption: 'Murph',
      subcaption: parsed.tracking === null ? 'Table' : 'Workout table',
      trailing_caption: 'OPEN',
    }
  }

  return {
    caption: 'Murph',
    subcaption: 'Nutrition summary',
    trailing_caption: 'OPEN',
    ...(renderPartialNutritionLabel(parsed) === null
      ? {}
      : { trailing_subcaption: 'PARTIAL TOTALS' }),
  }
}

export function encodeAppCardDataUrl(card: AssistantResponseCard): string {
  const parsed = assistantResponseCardSchema.parse(card)
  const envelope: AppCardEnvelopeV1 | AppCardEnvelopeV2 | AppCardEnvelopeV3 =
    parsed.kind === 'compact_table'
      ? {
          schemaVersion: 3,
          card: parsed,
        }
      : isDailyNutritionResponseCardV2(parsed)
        ? {
            schemaVersion: 2,
            card: parsed,
          }
        : {
            schemaVersion: 1,
            card: parsed,
          }
  const encoded = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')
  const dataUrl = `${APP_CARD_DATA_URL_PREFIX}${encoded}`
  if (dataUrl.length >= APP_CARD_DATA_URL_MAX_LENGTH) {
    throw new TypeError('The encoded app card exceeds the inline size limit.')
  }
  return dataUrl
}

function renderCompactTableResponseCardText(
  card: CompactTableResponseCardV1,
  includeTracking: boolean,
): string {
  const heading = card.subtitle === null
    ? card.title
    : `${card.title} — ${card.subtitle}`
  const rows = card.rows.map((row) => {
    const values = row.values.map((value, index) =>
      `${card.columns[index]}: ${value}`
    )
    return `${row.label}: ${values.join(' · ')}`
  })
  const footer = card.footer === null ? [] : ['', card.footer]
  const tracking = !includeTracking || card.tracking === null
    ? []
    : [
        '',
        `[Murph tracked workout source: ${card.tracking.entityId}; snapshot: ${card.tracking.snapshotAt}]`,
      ]
  return [heading, '', ...rows, ...footer, ...tracking].join('\n')
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
  return {
    ...portableSchema,
    description:
      'One closed Murph response card: daily_nutrition for a canonical daily meal summary, or compact_table for a bounded one-off table or a refreshed snapshot backed by one canonical workout event.',
  }
}
