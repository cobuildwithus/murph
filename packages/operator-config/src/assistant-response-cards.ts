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
  buildWorkoutSessionAppCardEnvelopeV6,
  challengeStandingsResponseCardV1Schema,
  compactTableCardV1Bounds,
  compactTableResponseCardAuthoringV1Schema,
  compactTableResponseCardV1Schema,
  dailyNutritionResponseCardV2AuthoringSchema,
  dailyNutritionResponseCardV2Schema,
  exerciseRoutineResponseCardV1Schema,
  renderExerciseRoutineResponseCardTextV1,
  renderTelegramRichContentResponseCardTextV1,
  telegramRichContentCardV1Bounds,
  telegramRichContentResponseCardV1Schema,
  nutritionCardGoalStatusLabels,
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
  type ExerciseRoutineCardExerciseV1,
  type ExerciseRoutineCardImageV1,
  type ExerciseRoutineResponseCardV1,
  type TelegramRichContentResponseCardV1,
  type NutritionCardGoalSnapshot,
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
  dailyNutritionResponseCardV2AuthoringSchema,
  dailyNutritionResponseCardV2Schema,
  dailyNutritionResponseCardSchema,
  exerciseRoutineCardV1Bounds,
  exerciseRoutineResponseCardV1Schema,
  telegramRichContentCardV1Bounds,
  telegramRichContentResponseCardV1Schema,
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
  type ExerciseRoutineCardExerciseV1,
  type ExerciseRoutineCardImageV1,
  type ExerciseRoutineResponseCardV1,
  type TelegramRichContentResponseCardV1,
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

export const assistantResponseCardAuthoringSchema: z.ZodType<
  AssistantResponseCard
> = z.union([
  dailyNutritionResponseCardV2AuthoringSchema,
  compactTableResponseCardAuthoringV1Schema,
])

export const assistantResponseCardJsonSchema =
  createAssistantResponseCardJsonSchema()
export const exerciseRoutineResponseCardJsonSchema =
  createExerciseRoutineResponseCardJsonSchema()
export const telegramRichContentResponseCardJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { const: 'telegram_rich_content' },
    version: { const: 1 },
    html: {
      type: 'string',
      minLength: 1,
      maxLength: telegramRichContentCardV1Bounds.htmlLength,
    },
  },
  required: ['kind', 'version', 'html'],
} as const
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
    case 'exercise_routine':
      return renderExerciseRoutineResponseCardTextV1(parsed)
    case 'telegram_rich_content':
      return renderTelegramRichContentResponseCardTextV1(parsed)
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
    case 'exercise_routine':
      return renderExerciseRoutineResponseCardTextV1(parsed)
    case 'telegram_rich_content':
      return renderTelegramRichContentResponseCardTextV1(parsed)
    case 'challenge_standings':
      return renderChallengeStandingsResponseCardText(parsed)
  }
}

export type TelegramRichMessage = {
  html: string
  skip_entity_detection?: true
}

/** Build one Telegram-native rich message from a frozen response card. */
export function buildTelegramRichMessage(
  card: AssistantResponseCard,
): TelegramRichMessage {
  const parsed = assistantResponseCardSchema.parse(card)
  switch (parsed.kind) {
    case 'daily_nutrition':
      return { html: renderTelegramNutritionCardHtml(parsed) }
    case 'compact_table':
      return { html: renderTelegramCompactTableCardHtml(parsed) }
    case 'exercise_routine':
      return { html: renderTelegramExerciseRoutineCardHtml(parsed) }
    case 'telegram_rich_content':
      return { html: parsed.html, skip_entity_detection: true }
    case 'challenge_standings':
      return { html: renderTelegramChallengeStandingsCardHtml(parsed) }
  }
}

export function buildLinqIMessageAppFallbackText(
  card: AssistantResponseCard,
):
  | 'Challenge standings. Ask Murph for this card in text'
  | 'Exercise routine. Ask Murph for this card in text'
  | 'Your Murph guide. Ask Murph for this card in text'
  | 'Your daily nutrition. Ask Murph for this card in text'
  | 'Your Murph summary. Ask Murph for this card in text'
  | 'Your workout. Ask Murph for this card in text' {
  const parsed = assistantResponseCardSchema.parse(card)
  switch (parsed.kind) {
    case 'daily_nutrition':
      return 'Your daily nutrition. Ask Murph for this card in text'
    case 'compact_table': {
      if (parsed.tracking === null) {
        return 'Your Murph summary. Ask Murph for this card in text'
      }
      switch (parsed.tracking.kind) {
        case 'workout':
          return 'Your workout. Ask Murph for this card in text'
      }
    }
    case 'challenge_standings':
      return 'Challenge standings. Ask Murph for this card in text'
    case 'exercise_routine':
      return 'Exercise routine. Ask Murph for this card in text'
    case 'telegram_rich_content':
      return 'Your Murph guide. Ask Murph for this card in text'
  }
}

export function buildLinqIMessageAppLayout(
  card: AssistantResponseCard,
): LinqIMessageAppLayout {
  const parsed = assistantResponseCardSchema.parse(card)
  if (parsed.kind === 'exercise_routine') {
    throw new TypeError(
      'Exercise routine response cards do not have a native iMessage layout.',
    )
  }
  if (parsed.kind === 'telegram_rich_content') {
    throw new TypeError(
      'Telegram rich content cards do not have a native iMessage layout.',
    )
  }
  if (parsed.kind === 'compact_table') {
    const imageUrl = buildLinqIMessageAppCardImageUrl(parsed)
    if ('workout' in parsed) {
      const progress = countWorkoutSessionSets(parsed.workout)
      return {
        caption: parsed.title,
        image_url: imageUrl,
        subcaption: `${progress.completed}/${progress.total} sets complete`,
      }
    }
    const semantic = renderCompactTableSemanticPresentation(parsed)
    return {
      caption: semantic.heading,
      image_url: imageUrl,
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
  return {
    caption: `${formatNutritionCardDate(parsed.localDate)} · ${
      parsed.mealCount
    } ${mealLabel}`,
    image_url: buildLinqIMessageAppCardImageUrl(parsed),
    ...(partialLabel === null ? {} : { subcaption: partialLabel }),
  }
}

export function buildLinqIMessageAppCardImageUrl(
  card: AssistantResponseCard,
): string {
  const parsed = assistantResponseCardSchema.parse(card)
  if (parsed.kind === 'exercise_routine') {
    throw new TypeError(
      'Exercise routine response cards do not have a native iMessage image URL.',
    )
  }
  if (parsed.kind === 'telegram_rich_content') {
    throw new TypeError(
      'Telegram rich content cards do not have a native iMessage image URL.',
    )
  }
  const encoded = parsed.kind === 'daily_nutrition'
    ? encodeDailyNutritionAppCardPayload(parsed)
    : parsed.kind === 'compact_table'
      ? encodeCompactTableAppCardPayload(parsed, false)
      : encodeChallengeStandingsAppCardPayload(
          buildIdentityFreeChallengeStandingsImageCard(parsed),
        )
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
    case 'exercise_routine':
      throw new TypeError(
        'Exercise routine response cards do not have a native iMessage app URL.',
      )
    case 'telegram_rich_content':
      throw new TypeError(
        'Telegram rich content cards do not have a native iMessage app URL.',
      )
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
  return encodeAppCardEnvelopeUrl(encodeCompactTableAppCardPayload(card, true))
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
  return encodeAppCardEnvelopeUrl(encodeWorkoutSessionAppCardPayload(parsed, true))
}

function encodeCompactTableAppCardPayload(
  card: CompactTableResponseCardV1,
  includeActionBinding: boolean,
): string {
  const parsed = compactTableResponseCardV1Schema.parse(card)
  if ('workout' in parsed) {
    return encodeWorkoutSessionAppCardPayload(parsed, includeActionBinding)
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

function buildIdentityFreeChallengeStandingsImageCard(
  card: ChallengeStandingsResponseCardV1,
): ChallengeStandingsResponseCardV1 {
  if (card.format === 'collective') {
    return {
      ...card,
      title: 'Challenge standings',
      subtitle: null,
      footer: null,
    }
  }

  const labelPrefix = card.format === 'teams' ? 'Team' : 'Participant'
  return {
    ...card,
    title: 'Challenge standings',
    subtitle: null,
    footer: null,
    entries: card.entries.map((entry, index) => ({
      ...entry,
      label: `${labelPrefix} ${index + 1}`,
    })),
  }
}

function encodeWorkoutSessionAppCardPayload(
  card: Extract<CompactTableResponseCardV1, { workout: unknown }>,
  includeActionBinding: boolean,
): string {
  return encodeAppCardEnvelopePayload(
    includeActionBinding
      && card.editor !== undefined
      ? buildWorkoutSessionAppCardEnvelopeV6({
          editor: card.editor,
          title: card.title,
          subtitle: card.subtitle,
          footer: card.footer,
          workout: card.workout,
        })
      : buildWorkoutSessionAppCardEnvelopeV4({
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
    | ReturnType<typeof buildWorkoutSessionAppCardEnvelopeV4>
    | ReturnType<typeof buildWorkoutSessionAppCardEnvelopeV6>,
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
  if (!('workout' in card)) {
    const heading = card.subtitle === null
      ? card.title
      : `${card.title} — ${card.subtitle}`
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
          return set.target === null
            ? `${label}: completed; actual ${set.actual}`
            : `${label}: completed; actual ${set.actual}; target ${set.target}`
        case 'pending':
          return set.target === null
            ? `${label}: pending`
            : `${label}: pending; target ${set.target}`
        case 'skipped':
          return set.target === null
            ? `${label}: skipped`
            : `${label}: skipped; target ${set.target}`
      }
    })
    return `${exercise.name}: ${sets.join(' · ')}`
  })
  return {
    heading: card.title,
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

function renderTelegramChallengeStandingsCardHtml(
  card: ChallengeStandingsResponseCardV1,
): string {
  const subtitle = card.subtitle === null
    ? ''
    : `<p>${escapeTelegramRichHtml(card.subtitle)}</p>`
  const footer = card.footer === null
    ? ''
    : `<footer>${escapeTelegramRichHtml(card.footer)}</footer>`

  if (card.format === 'collective') {
    const score = card.collectivePoints === null
      ? 'No verified score yet'
      : `${formatChallengePoints(card.collectivePoints)}${
          card.coverage === 'partial' ? '+' : ''
        }`
    const counts = card.coverageCounts
    return [
      `<h2>${escapeTelegramRichHtml(card.title)}</h2>`,
      subtitle,
      '<table bordered striped>',
      `<tr><td><b>Score</b></td><td align="right">${escapeTelegramRichHtml(score)} / ${escapeTelegramRichHtml(formatChallengePoints(card.objective.targetPoints))} points</td></tr>`,
      `<tr><td><b>Coverage</b></td><td align="right">${counts.completeParticipants} complete · ${counts.partialParticipants} partial · ${counts.unscoredParticipants} unscored</td></tr>`,
      '</table>',
      footer,
    ].join('')
  }

  const rankingComplete = challengeRankingComplete(card.entries)
  const rows = card.entries.map((entry, index) => {
    const rank = rankingComplete ? challengeRank(card.entries, index) : null
    const rankText = rank === null ? '—' : String(rank)
    return `<tr><td align="right">${rankText}</td><td><b>${escapeTelegramRichHtml(entry.label)}</b></td><td align="right">${escapeTelegramRichHtml(renderChallengeEntryScore(entry, card.objective))}</td></tr>`
  }).join('')
  const note = rankingComplete
    ? ''
    : '<blockquote>Ranks are withheld until every score is complete.</blockquote>'
  return [
    `<h2>${escapeTelegramRichHtml(card.title)}</h2>`,
    subtitle,
    `<table bordered striped><tr><th>#</th><th>Participant</th><th>Score</th></tr>${rows}</table>`,
    note,
    footer,
  ].join('')
}

function renderTelegramExerciseRoutineCardHtml(
  card: ExerciseRoutineResponseCardV1,
): string {
  const subtitle = card.subtitle === null
    ? ''
    : `<p>${escapeTelegramRichHtml(card.subtitle)}</p>`
  const details = card.exercises.map((exercise) => {
    const slideshow = exercise.images.length === 0
      ? ''
      : `<tg-slideshow>${exercise.images.map(renderTelegramRoutineImage).join('')}</tg-slideshow>`
    return `<details><summary>${escapeTelegramRichHtml(exercise.name)}</summary><p><b>${escapeTelegramRichHtml(card.labels.dose)}:</b> ${escapeTelegramRichHtml(exercise.dose)} · <b>${escapeTelegramRichHtml(card.labels.time)}:</b> ${escapeTelegramRichHtml(formatRoutineDuration(exercise.estimatedSeconds))}</p><ol>${exercise.instructions.map((instruction) => `<li>${escapeTelegramRichHtml(instruction)}</li>`).join('')}</ol>${slideshow}</details>`
  }).join('')
  const footer = card.footer === null
    ? ''
    : `<footer>${escapeTelegramRichHtml(card.footer)}</footer>`

  return [
    `<h2>${escapeTelegramRichHtml(card.title)}</h2>`,
    subtitle,
    `<p><b>${escapeTelegramRichHtml(card.intensity)}</b> · ${escapeTelegramRichHtml(formatRoutineDuration(card.totalSeconds))}</p>`,
    details,
    `<blockquote>⚠️ ${escapeTelegramRichHtml(card.safety)}</blockquote>`,
    footer,
  ].join('')
}

function renderTelegramRoutineImage(
  image: ExerciseRoutineCardImageV1,
): string {
  return `<img src="${escapeTelegramRichHtmlAttribute(image.url)}"/>`
}

function renderTelegramCompactTableCardHtml(
  card: CompactTableResponseCardV1,
): string {
  const subtitle = card.subtitle === null
    ? ''
    : `<p>${escapeTelegramRichHtml(card.subtitle)}</p>`
  if ('workout' in card) {
    const presentation = renderCompactTableSemanticPresentation(card)
    const [status, ...exercises] = presentation.detailLines
    const rows = exercises.map((exercise) =>
      `<tr><td>${escapeTelegramRichHtml(exercise)}</td></tr>`
    ).join('')
    const footer = card.footer === null
      ? ''
      : `<footer>${escapeTelegramRichHtml(card.footer)}</footer>`
    return `<h2>${escapeTelegramRichHtml(card.title)}</h2><p>${escapeTelegramRichHtml(status ?? '')}</p><table bordered striped>${rows}</table>${footer}`
  }
  const heading = `<tr><th></th>${card.columns.map((column) => `<th>${escapeTelegramRichHtml(column)}</th>`).join('')}</tr>`
  const rows = card.rows.map((row) =>
    `<tr><td><b>${escapeTelegramRichHtml(row.label)}</b></td>${row.values.map((value) => `<td>${escapeTelegramRichHtml(value)}</td>`).join('')}</tr>`
  ).join('')
  const footer = card.footer === null
    ? ''
    : `<footer>${escapeTelegramRichHtml(card.footer)}</footer>`
  return `<h2>${escapeTelegramRichHtml(card.title)}</h2>${subtitle}<table bordered striped>${heading}${rows}</table>${footer}`
}

function renderTelegramNutritionCardHtml(
  card: DailyNutritionResponseCard,
): string {
  const rows = [
    ['Calories', `${formatNutritionCardNumber(readRequiredCalorieTotal(card))} cal`],
    ...renderAvailableNutritionTotals(card).map((value) => {
      const [amount, ...label] = value.split(' ')
      return [label.join(' '), amount]
    }),
  ]
  const partial = renderPartialNutritionLabel(card)
  const partialHtml = partial === null
    ? ''
    : `<blockquote>${escapeTelegramRichHtml(partial)}</blockquote>`
  const goalsHtml = !isDailyNutritionResponseCardV2(card)
    ? ''
    : `<details><summary>Daily goals</summary><table bordered><tr><th>Nutrient</th><th>Target</th><th>Status</th></tr>${[
        renderTelegramNutritionGoalRow('Calories', card.goals.calories, ' cal'),
        renderTelegramNutritionGoalRow('Protein', card.goals.proteinGrams, 'g'),
        renderTelegramNutritionGoalRow('Carbs', card.goals.carbsGrams, 'g'),
        renderTelegramNutritionGoalRow('Fat', card.goals.fatGrams, 'g'),
        renderTelegramNutritionGoalRow('Fiber', card.goals.fiberGrams, 'g'),
      ].join('')}</table></details>`
  return [
    `<h2>${escapeTelegramRichHtml(formatNutritionCardDate(card.localDate))}</h2>`,
    `<p>${card.mealCount} ${card.mealCount === 1 ? 'meal' : 'meals'}</p>`,
    `<figure><img src="${escapeTelegramRichHtmlAttribute(buildLinqIMessageAppCardImageUrl(card))}"/></figure>`,
    `<table bordered striped>${rows.map(([label, value]) => `<tr><td>${escapeTelegramRichHtml(label ?? '')}</td><td align="right"><b>${escapeTelegramRichHtml(value ?? '')}</b></td></tr>`).join('')}</table>`,
    goalsHtml,
    partialHtml,
  ].join('')
}

function formatRoutineDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds === 0
    ? `${minutes} min`
    : `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function escapeTelegramRichHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeTelegramRichHtmlAttribute(value: string): string {
  return escapeTelegramRichHtml(value).replaceAll('"', '&quot;')
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
          nutritionCardGoalStatusLabels[goal.status]
        })`
  )
}

function renderTelegramNutritionGoalRow(
  label: string,
  goal: NutritionCardGoalSnapshot | null,
  unit: string,
): string {
  if (goal === null) {
    return `<tr><td>${escapeTelegramRichHtml(label)}</td><td align="right">—</td><td>⚪ Not available</td></tr>`
  }
  return `<tr><td>${escapeTelegramRichHtml(label)}</td><td align="right">${escapeTelegramRichHtml(`${formatNutritionCardNumber(goal.target)}${unit}`)}</td><td>${escapeTelegramRichHtml(renderTelegramNutritionGoalStatus(goal.status))}</td></tr>`
}

function renderTelegramNutritionGoalStatus(
  status: keyof typeof nutritionCardGoalStatusLabels,
): string {
  switch (status) {
    case 'far_under_target':
      return '🟠 Well below target'
    case 'under_target':
      return '🟠 Below target'
    case 'on_target':
      return '🟢 On target'
    case 'over_target':
      return '🟠 Above target'
    case 'far_over_target':
      return '🟠 Well above target'
    case 'unavailable':
      return '⚪ Not available'
  }
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

function createExerciseRoutineResponseCardJsonSchema() {
  const {
    $schema: _dialect,
    ...portableSchema
  } = z.toJSONSchema(exerciseRoutineResponseCardV1Schema)
  return {
    ...portableSchema,
    description:
      'Exercise routine card V1 with honest timing and catalog-backed images.',
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
    type: 'object',
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
              subtitle: { type: 'null' },
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
