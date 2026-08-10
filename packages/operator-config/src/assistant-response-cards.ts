import { Buffer } from 'node:buffer'

import {
  IMESSAGE_APP_CARD_URL_MAX_LENGTH,
  IMESSAGE_APP_CARD_URL_PREFIX,
  IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH,
  IMESSAGE_APP_CARD_IMAGE_PATH_PREFIX,
  IMESSAGE_APP_CARD_IMAGE_PATH_SUFFIX,
  MURPH_PRODUCT_ORIGIN,
  assistantResponseCardV1Bounds,
  assistantResponseCardSchema,
  buildWorkoutSessionAppCardEnvelopeV4,
  challengeStandingsResponseCardV1Schema,
  compactTableCardV1Bounds,
  compactTableResponseCardV1Schema,
  nutritionCardGoalStatusValues,
  workoutSessionCardStateValues,
  workoutSessionCardV1Bounds,
  workoutSessionSetStatusValues,
  type AssistantResponseCard,
  type ChallengeStandingsEntryV1,
  type ChallengeStandingsResponseCardV1,
  type CompactTableGenericResponseCardV1,
  type CompactTableResponseCardV1,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV1,
  type DailyNutritionResponseCardV2,
  type NutritionCardGoalSnapshot,
  type NutritionCardGoalStatus,
  type NutritionCardMetric,
  type WorkoutSessionDetailV1,
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
  far_over_target: 'far over',
  far_under_target: 'far under',
  on_target: 'on target',
  over_target: 'over',
  under_target: 'under',
} as const satisfies Record<Exclude<
  NutritionCardGoalStatus,
  'unavailable'
>, string>
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
  card: Omit<CompactTableGenericResponseCardV1, 'tracking'>
}

export type AppCardEnvelopeV5 = {
  schemaVersion: 5
  card: ChallengeStandingsResponseCardV1
}

export type LinqIMessageAppLayout = {
  caption: string
  image_url?: string
  subcaption?: string
  trailing_caption?: string
  trailing_subcaption?: string
}

export {
  assistantResponseCardSchema,
  assistantResponseCardV1Bounds,
  buildWorkoutSessionAppCardEnvelopeV4,
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
  type ChallengeStandingsCoverage,
  type ChallengeStandingsCoverageCountsV1,
  type ChallengeStandingsEntryV1,
  type ChallengeStandingsObjectiveV1,
  type ChallengeStandingsResponseCardV1,
  type CollectiveChallengeStandingsResponseCardV1,
  workoutSessionCardStateValues,
  workoutSessionCardV1Bounds,
  workoutSessionDetailV1Schema,
  workoutSessionExerciseV1Schema,
  workoutSessionSetStatusValues,
  workoutSessionSetV1Schema,
  type AssistantResponseCard,
  type CompactTableGenericResponseCardV1,
  type CompactTableResponseCardV1,
  type CompactTableWorkoutResponseCardV1,
  type CompactTableRowV1,
  type CompactTableTrackingSourceV1,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV1,
  type DailyNutritionResponseCardV2,
  type NutritionCardGoalSnapshot,
  type NutritionCardGoalStatus,
  type NutritionCardMetric,
  type RankedChallengeStandingsResponseCardV1,
  type WorkoutSessionAppCardEnvelopeV4,
  type WorkoutSessionCardState,
  type WorkoutSessionDetailV1,
  type WorkoutSessionExerciseV1,
  type WorkoutSessionSetStatus,
  type WorkoutSessionSetV1,
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
 * Durable model-context representation. A tracked card keeps its exact
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
    const semantic = renderCompactTableSemanticPresentation(parsed)
    return {
      caption: semantic.heading,
      image_url: buildLinqIMessageAppCardImageUrl(parsed),
      subcaption: semantic.detailLines.join('\n'),
      ...(semantic.footer === null
        ? {}
        : { trailing_caption: semantic.footer }),
    }
  }
  if (parsed.kind === 'challenge_standings') {
    return {
      ...buildChallengeStandingsLinqLayout(parsed),
      image_url: buildLinqIMessageAppCardImageUrl(parsed),
    }
  }

  const mealLabel = parsed.mealCount === 1 ? 'meal' : 'meals'
  const partialLabel = renderPartialNutritionLabel(parsed)
  const goalStatusLabel = renderLinqNutritionGoalStatuses(parsed)
  const detailLines = [partialLabel, goalStatusLabel].filter(
    (line): line is string => line !== null,
  )
  return {
    caption: `${formatNutritionCardDate(parsed.localDate)} · ${
      parsed.mealCount
    } ${mealLabel}`,
    image_url: buildLinqIMessageAppCardImageUrl(parsed),
    ...(detailLines.length === 0
      ? {}
      : { subcaption: detailLines.join('\n') }),
  }
}

export function buildLinqIMessageAppCardImageUrl(
  card: AssistantResponseCard,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  const encoded = parsed.kind === 'daily_nutrition'
    ? encodeDailyNutritionAppCardPayload(parsed)
    : parsed.kind === 'compact_table'
      ? encodeCompactTableAppCardPayload(parsed)
      : encodeChallengeStandingsAppCardPayload(parsed)
  if (encoded.length > IMESSAGE_APP_CARD_IMAGE_PAYLOAD_MAX_LENGTH) {
    throw new TypeError('The encoded app card image payload is too large.')
  }
  const url = `${MURPH_PRODUCT_ORIGIN}${
    IMESSAGE_APP_CARD_IMAGE_PATH_PREFIX
  }${encoded}${IMESSAGE_APP_CARD_IMAGE_PATH_SUFFIX}`
  if (url.length >= IMESSAGE_APP_CARD_URL_MAX_LENGTH) {
    throw new TypeError('The encoded app card image exceeds the inline size limit.')
  }
  return url
}

export function buildLinqIMessageAppCardUrl(
  card: AssistantResponseCard,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  switch (parsed.kind) {
    case 'daily_nutrition':
      return encodeDailyNutritionAppCardUrl(parsed)
    case 'compact_table':
      return encodeCompactTableAppCardUrl(parsed)
    case 'challenge_standings':
      return encodeChallengeStandingsAppCardUrl(parsed)
  }
}

export function encodeDailyNutritionAppCardUrl(
  card: DailyNutritionResponseCard,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  if (parsed.kind !== 'daily_nutrition') {
    throw new TypeError('Expected a daily nutrition response card.')
  }
  return encodeAppCardEnvelopeUrl(encodeDailyNutritionAppCardPayload(parsed))
}

function encodeDailyNutritionAppCardPayload(
  card: DailyNutritionResponseCard,
): string {
  const envelope: AppCardEnvelopeV1 | AppCardEnvelopeV2 =
    isDailyNutritionResponseCardV2(card)
      ? { schemaVersion: 2, card }
      : { schemaVersion: 1, card }
  return encodeAppCardEnvelopePayload(envelope)
}

export function encodeCompactTableAppCardUrl(
  card: CompactTableResponseCardV1,
): string {
  return encodeAppCardEnvelopeUrl(encodeCompactTableAppCardPayload(card))
}

export function encodeWorkoutSessionAppCardUrl(
  card: CompactTableResponseCardV1,
): string {
  const parsed = compactTableResponseCardV1Schema.parse(card)
  if (!('workout' in parsed)) {
    throw new TypeError(
      'Expected a compact table with workout session detail.',
    )
  }
  return encodeAppCardEnvelopeUrl(encodeWorkoutSessionAppCardPayload(parsed))
}

function encodeCompactTableAppCardPayload(
  card: CompactTableResponseCardV1,
): string {
  const parsed = compactTableResponseCardV1Schema.parse(card)
  if ('workout' in parsed) {
    return encodeWorkoutSessionAppCardPayload(parsed)
  }

  const { tracking: _tracking, ...presentationCard } = parsed
  const envelope: AppCardEnvelopeV3 = {
    schemaVersion: 3,
    card: presentationCard,
  }
  return encodeAppCardEnvelopePayload(envelope)
}

export function encodeChallengeStandingsAppCardUrl(
  card: ChallengeStandingsResponseCardV1,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  if (parsed.kind !== 'challenge_standings') {
    throw new TypeError('Expected a challenge standings response card.')
  }
  return encodeAppCardEnvelopeUrl(
    encodeChallengeStandingsAppCardPayload(parsed),
  )
}

function encodeChallengeStandingsAppCardPayload(
  card: ChallengeStandingsResponseCardV1,
): string {
  const parsed = challengeStandingsResponseCardV1Schema.parse(card)
  const envelope: AppCardEnvelopeV5 = {
    schemaVersion: 5,
    card: parsed,
  }
  return encodeAppCardEnvelopePayload(envelope)
}

function encodeWorkoutSessionAppCardPayload(
  card: Extract<CompactTableResponseCardV1, { workout: unknown }>,
): string {
  return encodeAppCardEnvelopePayload(
    buildWorkoutSessionAppCardEnvelopeV4({
      title: card.title,
      subtitle: card.subtitle,
      footer: card.footer,
      workout: card.workout,
    }),
  )
}

function encodeAppCardEnvelopePayload(
  envelope:
    | AppCardEnvelopeV1
    | AppCardEnvelopeV2
    | AppCardEnvelopeV3
    | AppCardEnvelopeV5
    | ReturnType<typeof buildWorkoutSessionAppCardEnvelopeV4>,
): string {
  return Buffer.from(JSON.stringify(envelope), 'utf8')
    .toString('base64url')
}

function encodeAppCardEnvelopeUrl(encoded: string): string {
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
  const semantic = renderCompactTableSemanticPresentation(card)
  const tracking = renderWorkoutTrackingMarker(
    card.tracking,
    includeTracking,
  )
  const details = 'workout' in card
    ? semantic.detailLines.flatMap((line, index) =>
        index === 1 ? ['', line] : [line]
      )
    : ['', ...semantic.detailLines]
  return [
    semantic.heading,
    ...details,
    ...(semantic.footer === null ? [] : ['', semantic.footer]),
    ...tracking,
  ].join('\n')
}

function renderCompactTableSemanticPresentation(
  card: CompactTableResponseCardV1,
): {
  heading: string
  detailLines: string[]
  footer: string | null
} {
  const heading = card.subtitle === null
    ? card.title
    : `${card.title} — ${card.subtitle}`
  if (!('workout' in card)) {
    return {
      heading,
      detailLines: card.rows.map((row) => {
        const values = row.values.map((value, index) =>
          `${card.columns[index]}: ${value}`
        )
        return `${row.label}: ${values.join(' · ')}`
      }),
      footer: card.footer,
    }
  }

  const progress = countWorkoutSessionSets(card.workout)
  const state = card.workout.state === 'active'
    ? 'Active workout'
    : 'Completed workout'
  const exercises = card.workout.exercises.map((exercise) => {
    const sets = exercise.sets.map((set, index) => {
      const label = `set ${index + 1}`
      switch (set.status) {
        case 'completed':
          return `${label}: ${set.actual}`
        case 'pending':
          return set.target === null
            ? `${label}: pending`
            : `${label}: target ${set.target}`
        case 'skipped':
          return set.target === null
            ? `${label}: skipped`
            : `${label}: skipped (target ${set.target})`
      }
    })
    return `${exercise.name}: ${sets.join(' · ')}`
  })
  return {
    heading,
    detailLines: [
      `${state} · ${progress.completed}/${progress.total} sets complete`,
      ...exercises,
    ],
    footer: card.footer,
  }
}

function renderWorkoutTrackingMarker(
  tracking: CompactTableResponseCardV1['tracking'],
  includeTracking: boolean,
): string[] {
  return !includeTracking || tracking === null
    ? []
    : [
        '',
        `[Murph tracked workout source: ${tracking.entityId}; snapshot: ${tracking.snapshotAt}]`,
      ]
}

function countWorkoutSessionSets(
  workout: WorkoutSessionDetailV1,
): { completed: number; total: number } {
  return workout.exercises.reduce(
    (counts, exercise) => ({
      completed:
        counts.completed +
        exercise.sets.filter((set) => set.status === 'completed').length,
      total: counts.total + exercise.sets.length,
    }),
    { completed: 0, total: 0 },
  )
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

function renderLinqNutritionGoalStatuses(
  card: DailyNutritionResponseCard,
): string | null {
  if (!isDailyNutritionResponseCardV2(card)) {
    return null
  }
  const statuses = [
    renderLinqNutritionGoalStatus('Calories', card.goals.calories),
    renderLinqNutritionGoalStatus('Protein', card.goals.proteinGrams),
    renderLinqNutritionGoalStatus('Carbs', card.goals.carbsGrams),
    renderLinqNutritionGoalStatus('Fat', card.goals.fatGrams),
    renderLinqNutritionGoalStatus('Fiber', card.goals.fiberGrams),
  ].filter((status): status is string => status !== null)
  return statuses.length === 0 ? null : `Goals: ${statuses.join(' · ')}`
}

function renderLinqNutritionGoalStatus(
  label: string,
  goal: NutritionCardGoalSnapshot | null,
): string | null {
  if (goal === null || goal.status === 'unavailable') {
    return null
  }
  return `${label} ${NUTRITION_CARD_GOAL_STATUS_LABELS[goal.status]}`
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

function responseCardTextSchema(maxLength: number) {
  return {
    type: 'string',
    minLength: 1,
    maxLength,
    pattern: '^\\S(?:.*\\S)?$',
  } as const
}

function responseCardNullableTextSchema(maxLength: number) {
  return {
    ...responseCardTextSchema(maxLength),
    type: ['string', 'null'],
  } as const
}

function createAssistantResponseCardJsonSchema() {
  // Runtime Zod schemas remain authoritative. This deliberately compact
  // authoring schema keeps the dynamic-tool prompt bounded and exposes only
  // current card versions without duplicating every refinement.
  const nutritionMealCount = {
    type: 'integer',
    minimum: 1,
    maximum: assistantResponseCardV1Bounds.mealCount,
  } as const
  const metricTotal = (maximum: number) => ({
    type: 'number',
    minimum: 0,
    maximum,
  } as const)
  const metric = (maximum: number, totalRequired: boolean) => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      total: totalRequired
        ? metricTotal(maximum)
        : { ...metricTotal(maximum), type: ['number', 'null'] },
      mealCount: {
        ...nutritionMealCount,
        minimum: totalRequired ? 1 : 0,
      },
    },
    required: ['total', 'mealCount'],
  } as const)
  const goal = (maximum: number) => ({
    type: ['object', 'null'],
    additionalProperties: false,
    properties: {
      target: {
        type: 'number',
        exclusiveMinimum: 0,
        maximum,
      },
      status: { enum: nutritionCardGoalStatusValues },
    },
    required: ['target', 'status'],
  } as const)
  const tracking = {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: {
      kind: { const: 'workout' },
      entityId: {
        type: 'string',
        maxLength: 30,
        pattern: '^evt_[0-9A-HJKMNP-TV-Z]{26}$',
      },
      snapshotAt: {
        type: 'string',
        minLength: 24,
        maxLength: 24,
        pattern:
          '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
      },
    },
    required: ['kind', 'entityId', 'snapshotAt'],
  } as const
  const workoutSet = {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { enum: workoutSessionSetStatusValues },
      target: responseCardNullableTextSchema(
        workoutSessionCardV1Bounds.setValue,
      ),
      actual: responseCardNullableTextSchema(
        workoutSessionCardV1Bounds.setValue,
      ),
    },
    required: ['status', 'target', 'actual'],
  } as const
  const workoutExercise = {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: responseCardTextSchema(
        workoutSessionCardV1Bounds.exerciseName,
      ),
      sets: {
        type: 'array',
        minItems: 1,
        maxItems: workoutSessionCardV1Bounds.setsPerExercise,
        items: workoutSet,
      },
    },
    required: ['name', 'sets'],
  } as const
  const workout = {
    type: 'object',
    additionalProperties: false,
    properties: {
      version: { const: 1 },
      state: { enum: workoutSessionCardStateValues },
      exercises: {
        type: 'array',
        minItems: 1,
        maxItems: workoutSessionCardV1Bounds.exercises,
        items: workoutExercise,
      },
    },
    required: ['version', 'state', 'exercises'],
  } as const
  const row = {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: responseCardTextSchema(
        compactTableCardV1Bounds.rowLabel,
      ),
      values: {
        type: 'array',
        minItems: 1,
        maxItems: compactTableCardV1Bounds.columns,
        items: responseCardTextSchema(
          compactTableCardV1Bounds.cellValue,
        ),
      },
    },
    required: ['label', 'values'],
  } as const
  const nutrition = {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { const: 'daily_nutrition' },
      version: { const: 2 },
      localDate: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      },
      mealCount: nutritionMealCount,
      totals: {
        type: 'object',
        additionalProperties: false,
        patternProperties: {
          '^(?:proteinGrams|carbsGrams|fatGrams|fiberGrams)$': metric(
            assistantResponseCardV1Bounds.macroGrams,
            false,
          ),
        },
        properties: {
          calories: metric(assistantResponseCardV1Bounds.calories, true),
          proteinGrams: metric(
            assistantResponseCardV1Bounds.macroGrams,
            false,
          ),
          carbsGrams: {},
          fatGrams: {},
          fiberGrams: {},
        },
        required: [
          'calories',
          'proteinGrams',
          'carbsGrams',
          'fatGrams',
          'fiberGrams',
        ],
      },
      goals: {
        type: 'object',
        additionalProperties: false,
        patternProperties: {
          '^(?:proteinGrams|carbsGrams|fatGrams|fiberGrams)$': goal(
            assistantResponseCardV1Bounds.macroGrams,
          ),
        },
        properties: {
          calories: goal(assistantResponseCardV1Bounds.calories),
          proteinGrams: goal(assistantResponseCardV1Bounds.macroGrams),
          carbsGrams: {},
          fatGrams: {},
          fiberGrams: {},
        },
        required: [
          'calories',
          'proteinGrams',
          'carbsGrams',
          'fatGrams',
          'fiberGrams',
        ],
      },
    },
    required: [
      'kind',
      'version',
      'localDate',
      'mealCount',
      'totals',
      'goals',
    ],
  } as const
  const compactTableFields = {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { const: 'compact_table' },
      version: { const: 1 },
      title: responseCardTextSchema(
        compactTableCardV1Bounds.title,
      ),
      subtitle: responseCardNullableTextSchema(
        compactTableCardV1Bounds.subtitle,
      ),
      rowHeader: responseCardTextSchema(
        compactTableCardV1Bounds.rowHeader,
      ),
      columns: {
        type: 'array',
        minItems: 1,
        maxItems: compactTableCardV1Bounds.columns,
        items: responseCardTextSchema(
          compactTableCardV1Bounds.columnHeader,
        ),
      },
      rows: {
        type: 'array',
        minItems: 1,
        maxItems: compactTableCardV1Bounds.rows,
        items: row,
      },
      footer: responseCardNullableTextSchema(
        compactTableCardV1Bounds.footer,
      ),
      tracking,
      workout,
    },
    required: [
      'kind',
      'version',
      'title',
      'subtitle',
      'footer',
      'tracking',
    ],
  } as const
  const compactTable = {
    allOf: [
      compactTableFields,
      {
        oneOf: [
          {
            required: ['rowHeader', 'columns', 'rows'],
          },
          {
            properties: {
              tracking: { type: 'object' },
            },
            required: ['workout'],
          },
        ],
      },
    ],
  } as const

  return {
    description:
      'Author daily_nutrition V2, generic compact_table V1, or compact_table workout V1.',
    anyOf: [nutrition, compactTable],
  } as const
}
