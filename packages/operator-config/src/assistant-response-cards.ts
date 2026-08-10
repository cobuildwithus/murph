import { Buffer } from 'node:buffer'

import {
  IMESSAGE_APP_CARD_URL_MAX_LENGTH,
  IMESSAGE_APP_CARD_URL_PREFIX,
  MURPH_PRODUCT_ORIGIN,
  assistantResponseCardSchema,
  compactTableResponseCardV1Schema,
  dailyNutritionResponseCardV2Schema,
  type AssistantResponseCard,
  type CompactTableResponseCardV1,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV1,
  type DailyNutritionResponseCardV2,
  type NutritionCardGoalSnapshot,
  type NutritionCardGoalStatus,
  type NutritionCardMetric,
} from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'

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
const NUTRITION_CARD_GOAL_STATUS_LABELS = {
  far_over_target: 'FAR OVER TARGET',
  far_under_target: 'FAR UNDER TARGET',
  on_target: 'ON TARGET',
  over_target: 'OVER TARGET',
  unavailable: 'STATUS UNAVAILABLE',
  under_target: 'UNDER TARGET',
} as const satisfies Record<NutritionCardGoalStatus, string>

export const LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT =
  'Ask Murph for this card in text'
export const LINQ_IMESSAGE_APP_CARD_ORIGIN = MURPH_PRODUCT_ORIGIN

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
  card: Omit<CompactTableResponseCardV1, 'tracking'>
}

export type LinqIMessageAppLayout = {
  caption: string
  subcaption: string
  trailing_caption?: string
  trailing_subcaption?: string
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

  const mealLabel = parsed.mealCount === 1 ? 'meal' : 'meals'
  const calorieTotal = readRequiredCalorieTotal(parsed)
  const partial = renderPartialNutritionLabel(parsed) !== null
  const primaryGoal = isDailyNutritionResponseCardV2(parsed)
    ? renderPrimaryNutritionGoal(parsed)
    : null
  const trailingCaption = [
    renderNutritionMetric(parsed.totals.proteinGrams, 'g protein'),
    renderNutritionMetric(parsed.totals.carbsGrams, 'g carbs'),
  ].filter((value): value is string => value !== null)
  const trailingSubcaption = [
    renderNutritionMetric(parsed.totals.fatGrams, 'g fat'),
    ...(isDailyNutritionResponseCardV2(parsed)
      ? [renderNutritionMetric(parsed.totals.fiberGrams, 'g fiber')]
      : []),
  ].filter((value): value is string => value !== null)

  return {
    caption: [
      `${formatNutritionCardDate(parsed.localDate)} · ${
        parsed.mealCount
      } ${mealLabel}`,
      ...(partial ? ['PARTIAL TOTALS'] : []),
    ].join(' · '),
    subcaption: [
      `${formatNutritionCardNumber(calorieTotal)} cal`,
      ...(primaryGoal === null ? [] : [primaryGoal]),
    ].join(' · '),
    ...(trailingCaption.length === 0
      ? {}
      : { trailing_caption: trailingCaption.join(' · ') }),
    ...(trailingSubcaption.length === 0
      ? {}
      : { trailing_subcaption: trailingSubcaption.join(' · ') }),
  }
}

export function buildLinqIMessageAppCardUrl(
  card: AssistantResponseCard,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  return parsed.kind === 'compact_table'
    ? encodeCompactTableAppCardUrl(parsed)
    : encodeDailyNutritionAppCardUrl(parsed)
}

export function encodeDailyNutritionAppCardUrl(
  card: DailyNutritionResponseCard,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  if (parsed.kind !== 'daily_nutrition') {
    throw new TypeError('Expected a daily nutrition response card.')
  }
  const envelope: AppCardEnvelopeV1 | AppCardEnvelopeV2 =
    isDailyNutritionResponseCardV2(parsed)
      ? { schemaVersion: 2, card: parsed }
      : { schemaVersion: 1, card: parsed }
  return encodeAppCardEnvelope(envelope)
}

export function encodeCompactTableAppCardUrl(
  card: CompactTableResponseCardV1,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  if (parsed.kind !== 'compact_table') {
    throw new TypeError('Expected a compact table response card.')
  }
  const { tracking: _tracking, ...presentationCard } = parsed
  const envelope: AppCardEnvelopeV3 = {
    schemaVersion: 3,
    card: presentationCard,
  }
  return encodeAppCardEnvelope(envelope)
}

function encodeAppCardEnvelope(
  envelope: AppCardEnvelopeV1 | AppCardEnvelopeV2 | AppCardEnvelopeV3,
): string {
  const encoded = Buffer.from(JSON.stringify(envelope), 'utf8')
    .toString('base64url')
  const url = `${IMESSAGE_APP_CARD_URL_PREFIX}${encoded}`
  if (url.length >= IMESSAGE_APP_CARD_URL_MAX_LENGTH) {
    throw new TypeError('The encoded app card exceeds the inline size limit.')
  }
  return url
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
  const calorieTotal = readRequiredCalorieTotal(card)
  const metrics = [
    `about ${formatNutritionCardNumber(calorieTotal)} calories`,
    ...renderAvailableNutritionTotals(card),
  ]
  const summary = `${formatNutritionCardDate(card.localDate)}: ${
    metrics.join(' · ')
  } from ${card.mealCount} logged ${mealLabel}.`
  const goals = isDailyNutritionResponseCardV2(card)
    ? `Targets: ${renderDailyNutritionGoals(card).join(' · ')}.`
    : null
  const partialLabel = renderPartialNutritionLabel(card)
  return [summary, goals, partialLabel]
    .filter((value): value is string => value !== null)
    .join(' ')
}

function renderDailyNutritionGoals(
  card: DailyNutritionResponseCardV2,
): string[] {
  const candidates: ReadonlyArray<readonly [
    NutritionCardGoalSnapshot | null,
    string,
    string,
  ]> = [
    [card.goals.calories, 'calories', ' calories'],
    [card.goals.proteinGrams, 'protein', 'g protein'],
    [card.goals.carbsGrams, 'carbs', 'g carbs'],
    [card.goals.fatGrams, 'fat', 'g fat'],
    [card.goals.fiberGrams, 'fiber', 'g fiber'],
  ]

  return candidates.map(([goal, label, unit]) =>
    goal === null
      ? `${label} target unavailable`
      : `${formatNutritionCardNumber(goal.target)}${unit} (${
          NUTRITION_CARD_GOAL_STATUS_LABELS[goal.status]
        })`
  )
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

function renderPrimaryNutritionGoal(
  card: DailyNutritionResponseCardV2,
): string | null {
  const candidates: ReadonlyArray<readonly [
    NutritionCardGoalSnapshot | null,
    string,
  ]> = [
    [card.goals.calories, ' cal goal'],
    [card.goals.proteinGrams, 'g protein goal'],
    [card.goals.carbsGrams, 'g carbs goal'],
    [card.goals.fatGrams, 'g fat goal'],
    [card.goals.fiberGrams, 'g fiber goal'],
  ]
  const selected = candidates.find(([goal]) => goal !== null)
  if (selected === undefined) {
    return null
  }
  const [goal, unit] = selected
  if (goal === null) {
    return null
  }
  return `${formatNutritionCardNumber(goal.target)}${unit} · ${
    NUTRITION_CARD_GOAL_STATUS_LABELS[goal.status]
  }`
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
  // Retained nutrition V1 cards remain valid at the runtime boundary. New tool
  // calls author only the current nutrition version or a compact table.
  const authoringSchema = z.union([
    dailyNutritionResponseCardV2Schema,
    compactTableResponseCardV1Schema,
  ])
  const {
    $schema: _dialect,
    ...portableSchema
  } = z.toJSONSchema(authoringSchema)
  return {
    ...portableSchema,
    description:
      'Current card authoring contract: daily_nutrition V2 or compact_table V1.',
  }
}
