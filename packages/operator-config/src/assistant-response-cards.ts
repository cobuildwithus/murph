import { Buffer } from 'node:buffer'

import {
  IMESSAGE_APP_CARD_URL_MAX_LENGTH,
  IMESSAGE_APP_CARD_URL_PREFIX,
  MURPH_PRODUCT_ORIGIN,
  assistantResponseCardV1Bounds,
  assistantResponseCardSchema,
  buildWorkoutSessionAppCardEnvelopeV4,
  compactTableCardV1Bounds,
  compactTableResponseCardV1Schema,
  nutritionCardGoalStatusValues,
  workoutSessionCardStateValues,
  workoutSessionCardV1Bounds,
  workoutSessionSetStatusValues,
  type AssistantResponseCard,
  type CompactTableResponseCardV1,
  type DailyNutritionResponseCard,
  type DailyNutritionResponseCardV1,
  type DailyNutritionResponseCardV2,
  type NutritionCardGoalSnapshot,
  type NutritionCardGoalStatus,
  type NutritionCardMetric,
  type WorkoutSessionDetailV1,
} from '@murphai/contracts'

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
  card: Omit<CompactTableResponseCardV1, 'tracking' | 'workout'>
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
  buildWorkoutSessionAppCardEnvelopeV4,
  compactTableCardV1Bounds,
  compactTableResponseCardV1Schema,
  compactTableRowV1Schema,
  compactTableTrackingSourceV1Schema,
  dailyNutritionResponseCardV1Schema,
  dailyNutritionResponseCardV2Schema,
  dailyNutritionResponseCardSchema,
  nutritionCardGoalStatusValues,
  workoutSessionCardStateValues,
  workoutSessionCardV1Bounds,
  workoutSessionDetailV1Schema,
  workoutSessionExerciseV1Schema,
  workoutSessionSetStatusValues,
  workoutSessionSetV1Schema,
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
  type WorkoutSessionAppCardEnvelopeV4,
  type WorkoutSessionCardState,
  type WorkoutSessionDetailV1,
  type WorkoutSessionExerciseV1,
  type WorkoutSessionSetStatus,
  type WorkoutSessionSetV1,
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
  }
}

export function buildLinqIMessageAppLayout(
  card: AssistantResponseCard,
): LinqIMessageAppLayout {
  const parsed = assistantResponseCardSchema.parse(card)
  if (parsed.kind === 'compact_table') {
    if (parsed.workout !== undefined) {
      const progress = countWorkoutSessionSets(parsed.workout)
      return {
        caption: parsed.title,
        subcaption: `${progress.completed}/${progress.total} sets · ${
          parsed.workout.state === 'active' ? 'ACTIVE' : 'COMPLETE'
        }`,
        trailing_caption: 'OPEN',
      }
    }

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
  switch (parsed.kind) {
    case 'daily_nutrition':
      return encodeDailyNutritionAppCardUrl(parsed)
    case 'compact_table':
      return encodeCompactTableAppCardUrl(parsed)
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
  if (parsed.workout !== undefined) {
    return encodeWorkoutSessionAppCardUrl(parsed)
  }

  const {
    tracking: _tracking,
    workout: _workout,
    ...presentationCard
  } = parsed
  const envelope: AppCardEnvelopeV3 = {
    schemaVersion: 3,
    card: presentationCard,
  }
  return encodeAppCardEnvelope(envelope)
}

export function encodeWorkoutSessionAppCardUrl(
  card: CompactTableResponseCardV1,
): string {
  const parsed = compactTableResponseCardV1Schema.parse(card)
  if (parsed.workout === undefined) {
    throw new TypeError(
      'Expected a compact table with workout session detail.',
    )
  }
  return encodeAppCardEnvelope(
    buildWorkoutSessionAppCardEnvelopeV4({
      title: parsed.title,
      subtitle: parsed.subtitle,
      footer: parsed.footer,
      workout: parsed.workout,
    }),
  )
}

function encodeAppCardEnvelope(
  envelope:
    | AppCardEnvelopeV1
    | AppCardEnvelopeV2
    | AppCardEnvelopeV3
    | ReturnType<typeof buildWorkoutSessionAppCardEnvelopeV4>,
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
  if (card.workout !== undefined) {
    return renderWorkoutSessionResponseCardText(
      card,
      card.workout,
      includeTracking,
    )
  }

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
  const tracking = renderWorkoutTrackingMarker(
    card.tracking,
    includeTracking,
  )
  return [heading, '', ...rows, ...footer, ...tracking].join('\n')
}

function renderWorkoutSessionResponseCardText(
  card: CompactTableResponseCardV1,
  workout: WorkoutSessionDetailV1,
  includeTracking: boolean,
): string {
  const progress = countWorkoutSessionSets(workout)
  const heading = card.subtitle === null
    ? card.title
    : `${card.title} — ${card.subtitle}`
  const state = workout.state === 'active'
    ? 'Active workout'
    : 'Completed workout'
  const exercises = workout.exercises.map((exercise) => {
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
  const footer = card.footer === null ? [] : ['', card.footer]
  const tracking = renderWorkoutTrackingMarker(
    card.tracking,
    includeTracking,
  )
  return [
    heading,
    `${state} · ${progress.completed}/${progress.total} sets complete`,
    '',
    ...exercises,
    ...footer,
    ...tracking,
  ].join('\n')
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
        propertyNames: {
          enum: [
            'calories',
            'proteinGrams',
            'carbsGrams',
            'fatGrams',
            'fiberGrams',
          ],
        },
        properties: {
          calories: metric(assistantResponseCardV1Bounds.calories, true),
        },
        additionalProperties: metric(
          assistantResponseCardV1Bounds.macroGrams,
          false,
        ),
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
        propertyNames: {
          enum: [
            'calories',
            'proteinGrams',
            'carbsGrams',
            'fatGrams',
            'fiberGrams',
          ],
        },
        properties: {
          calories: goal(assistantResponseCardV1Bounds.calories),
        },
        additionalProperties: goal(assistantResponseCardV1Bounds.macroGrams),
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
  const compactTable = {
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
      'rowHeader',
      'columns',
      'rows',
      'footer',
      'tracking',
    ],
  } as const

  return {
    description:
      'Author daily_nutrition V2 or compact_table V1; workout detail is optional.',
    anyOf: [nutrition, compactTable],
  } as const
}
