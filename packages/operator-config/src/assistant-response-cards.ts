import { Buffer } from 'node:buffer'

import {
  IMESSAGE_APP_CARD_URL_MAX_LENGTH,
  IMESSAGE_APP_CARD_URL_PREFIX,
  MURPH_PRODUCT_ORIGIN,
  assistantResponseCardSchema,
  challengeStandingsResponseCardV1Schema,
  compactTableResponseCardV1Schema,
  dailyNutritionResponseCardV2Schema,
  type AssistantResponseCard,
  type ChallengeStandingsEntryV1,
  type ChallengeStandingsResponseCardV1,
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
const CHALLENGE_POINTS_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
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

export type AppCardEnvelopeV4 = {
  schemaVersion: 4
  card: ChallengeStandingsResponseCardV1
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
  challengeStandingsCardV1Bounds,
  challengeStandingsCoverageCountsV1Schema,
  challengeStandingsCoverageValues,
  challengeStandingsEntryV1Schema,
  challengeStandingsObjectiveV1Schema,
  challengeStandingsRankingObjectiveV1Schema,
  challengeStandingsResponseCardV1Schema,
  challengeStandingsTargetObjectiveV1Schema,
  collectiveChallengeStandingsResponseCardV1Schema,
  compactTableCardV1Bounds,
  compactTableResponseCardV1Schema,
  compactTableRowV1Schema,
  compactTableTrackingSourceV1Schema,
  dailyNutritionResponseCardV1Schema,
  dailyNutritionResponseCardV2Schema,
  dailyNutritionResponseCardSchema,
  nutritionCardGoalStatusValues,
  rankedChallengeStandingsResponseCardV1Schema,
  type AssistantResponseCard,
  type ChallengeStandingsCoverage,
  type ChallengeStandingsCoverageCountsV1,
  type ChallengeStandingsEntryV1,
  type ChallengeStandingsObjectiveV1,
  type ChallengeStandingsResponseCardV1,
  type CollectiveChallengeStandingsResponseCardV1,
  type CompactTableResponseCardV1,
  type CompactTableRowV1,
  type CompactTableTrackingSourceV1,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV1,
  type DailyNutritionResponseCardV2,
  type NutritionCardGoalSnapshot,
  type NutritionCardGoalStatus,
  type NutritionCardMetric,
  type RankedChallengeStandingsResponseCardV1,
} from '@murphai/contracts'

export const assistantResponseCardJsonSchema =
  createAssistantResponseCardJsonSchema()
export const challengeStandingsResponseCardJsonSchema =
  createChallengeStandingsResponseCardJsonSchema()

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
    case 'challenge_standings':
      return renderChallengeStandingsResponseCardText(parsed)
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
    case 'challenge_standings':
      return renderChallengeStandingsResponseCardText(parsed)
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
  if (parsed.kind === 'challenge_standings') {
    return buildChallengeStandingsLinqLayout(parsed)
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
  switch (parsed.kind) {
    case 'compact_table':
      return encodeCompactTableAppCardUrl(parsed)
    case 'challenge_standings':
      return encodeChallengeStandingsAppCardUrl(parsed)
    case 'daily_nutrition':
      return encodeDailyNutritionAppCardUrl(parsed)
  }
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

export function encodeChallengeStandingsAppCardUrl(
  card: ChallengeStandingsResponseCardV1,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  if (parsed.kind !== 'challenge_standings') {
    throw new TypeError('Expected a challenge standings response card.')
  }
  const envelope: AppCardEnvelopeV4 = {
    schemaVersion: 4,
    card: parsed,
  }
  return encodeAppCardEnvelope(envelope)
}

function encodeAppCardEnvelope(
  envelope:
    | AppCardEnvelopeV1
    | AppCardEnvelopeV2
    | AppCardEnvelopeV3
    | AppCardEnvelopeV4,
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

function renderChallengeStandingsResponseCardText(
  card: ChallengeStandingsResponseCardV1,
): string {
  const heading = card.subtitle === null
    ? card.title
    : `${card.title} — ${card.subtitle}`

  if (card.format === 'collective') {
    const points = card.collectivePoints
    const scoreLine = points === null
      ? `No verified score yet / ${formatChallengePoints(
          card.objective.targetPoints,
        )} points`
      : `${formatChallengePoints(points)}${
          card.coverage === 'partial' ? '+' : ''
        } / ${formatChallengePoints(card.objective.targetPoints)} points`
    const status = points === null
      ? 'Waiting for shared data.'
      : points >= card.objective.targetPoints
        ? 'Goal reached.'
        : card.coverage === 'partial'
          ? 'More progress may be pending.'
        : `${formatChallengePoints(
            card.objective.targetPoints - points,
          )} points to go.`
    const coverage = card.coverage === 'partial'
      ? ['Verified lower-bound progress.']
      : []
    const coverageCounts = card.coverageCounts
    const coverageLine = `Coverage: ${coverageCounts.completeParticipants} complete, ${
      coverageCounts.partialParticipants
    } partial, ${coverageCounts.unscoredParticipants} unscored (${
      coverageCounts.totalParticipants
    } total).`
    const footer = card.footer === null ? [] : ['', card.footer]
    return [
      heading,
      '',
      scoreLine,
      status,
      coverageLine,
      ...coverage,
      ...footer,
    ].join('\n')
  }

  const rows = card.entries.map((entry, index) => {
    const rank = challengeRankingComplete(card.entries)
      ? challengeRank(card.entries, index)
      : null
    const prefix = rank === null ? '—' : `${rank}.`
    const score = renderChallengeEntryScore(entry, card.objective)
    return `${prefix} ${entry.label}: ${score}`
  })
  const partial = card.entries.some((entry) => entry.coverage === 'partial')
    ? ['', 'Scores marked + are verified lower bounds.']
    : []
  const ranking = challengeRankingComplete(card.entries)
    ? []
    : ['', 'Ranks are withheld until every score is complete.']
  const footer = card.footer === null ? [] : ['', card.footer]
  return [heading, '', ...rows, ...partial, ...ranking, ...footer].join('\n')
}

function renderChallengeEntryScore(
  entry: ChallengeStandingsEntryV1,
  objective: Extract<
    ChallengeStandingsResponseCardV1,
    { format: 'individual' | 'teams' }
  >['objective'],
): string {
  if (entry.points === null) {
    return 'unscored'
  }
  const points = `${formatChallengePoints(entry.points)}${
    entry.coverage === 'partial' ? '+' : ''
  }`
  return objective.kind === 'target'
    ? `${points} / ${formatChallengePoints(objective.targetPoints)} points`
    : `${points} points`
}

function challengeRank(
  entries: readonly ChallengeStandingsEntryV1[],
  index: number,
): number | null {
  const entry = entries[index]
  if (entry?.points === null || entry === undefined) {
    return null
  }
  const firstMatchingIndex = entries.findIndex(
    (candidate) => candidate.points === entry.points,
  )
  return firstMatchingIndex + 1
}

function challengeRankingComplete(
  entries: readonly ChallengeStandingsEntryV1[],
): boolean {
  return entries.every((entry) => entry.coverage === 'complete')
}

function buildChallengeStandingsLinqLayout(
  card: ChallengeStandingsResponseCardV1,
): LinqIMessageAppLayout {
  const heading = card.subtitle === null
    ? card.title
    : `${card.title} — ${card.subtitle}`
  if (card.format === 'collective') {
    const score = card.collectivePoints === null
      ? 'Waiting for score'
      : `${formatChallengePoints(card.collectivePoints)}${
          card.coverage === 'partial' ? '+' : ''
        } / ${formatChallengePoints(card.objective.targetPoints)} pts`
    const status = card.collectivePoints === null
      ? 'Waiting for shared data.'
      : card.collectivePoints >= card.objective.targetPoints
        ? 'Goal reached.'
        : card.coverage === 'partial'
          ? 'More progress may be pending.'
          : `${formatChallengePoints(
              card.objective.targetPoints - card.collectivePoints,
            )} points to go.`
    const counts = card.coverageCounts
    const notes = [
      ...(card.coverage === 'partial'
        ? ['Verified lower-bound progress.']
        : []),
      ...(card.footer === null ? [] : [card.footer]),
    ]
    return {
      caption: heading,
      subcaption: `${score}\n${status}`,
      trailing_caption: `Coverage · ${counts.completeParticipants} complete · ${
        counts.partialParticipants
      } partial · ${counts.unscoredParticipants} unscored · ${
        counts.totalParticipants
      } total`,
      ...(notes.length === 0
        ? {}
        : { trailing_subcaption: notes.join(' · ') }),
    }
  }

  const rankingComplete = challengeRankingComplete(card.entries)
  const rows = card.entries.map((entry, index) => {
    const rank = rankingComplete ? challengeRank(card.entries, index) : null
    const prefix = rank === null ? '—' : `${rank}.`
    return `${prefix} ${entry.label}: ${renderChallengeEntryScore(
      entry,
      card.objective,
    )}`
  })
  const splitAt = Math.ceil(rows.length / 2)
  const firstRows = rows.slice(0, splitAt).join('\n')
  const remainingRows = rows.slice(splitAt).join('\n')
  const notes = [
    ...(card.entries.some((entry) => entry.coverage === 'partial')
      ? ['Scores marked + are verified lower bounds.']
      : []),
    ...(rankingComplete
      ? []
      : ['Ranks are withheld until every score is complete.']),
    ...(card.footer === null ? [] : [card.footer]),
  ]
  return {
    caption: heading,
    subcaption: firstRows,
    ...(remainingRows.length === 0
      ? {}
      : { trailing_caption: remainingRows }),
    ...(notes.length === 0
      ? {}
      : { trailing_subcaption: notes.join(' · ') }),
  }
}

function formatChallengePoints(points: number): string {
  return CHALLENGE_POINTS_NUMBER_FORMATTER.format(points)
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
  // Retained nutrition V1 cards remain valid at the runtime boundary. New
  // private tool calls author only the current nutrition or table contract.
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
      'Current private card authoring contract: daily_nutrition V2 or compact_table V1.',
  }
}

function createChallengeStandingsResponseCardJsonSchema() {
  const {
    $schema: _dialect,
    ...portableSchema
  } = z.toJSONSchema(challengeStandingsResponseCardV1Schema)
  return {
    ...portableSchema,
    description:
      'Current group challenge card authoring contract: challenge_standings V1.',
  }
}
