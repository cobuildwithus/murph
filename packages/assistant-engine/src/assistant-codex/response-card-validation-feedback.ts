import type {
  SafeToolCallValidationDigest,
} from '../assistant/tool-validation-digest.js'

const MAX_RESPONSE_CARD_REPAIR_HINTS = 4
const MAX_RESPONSE_CARD_VALIDATION_FEEDBACK_LENGTH = 1_600

const CUSTOM_EXPECTED_SHAPES: Readonly<Record<string, string>> = {
  card: 'compact_table.generic_or_workout_shape',
  'card.goals.calories.status': 'consistent_with_total_and_target',
  'card.goals.carbsGrams.status': 'consistent_with_total_and_target',
  'card.goals.fatGrams.status': 'consistent_with_total_and_target',
  'card.goals.fiberGrams.status': 'consistent_with_total_and_target',
  'card.goals.proteinGrams.status': 'consistent_with_total_and_target',
  'card.rows[].values': 'same_count_as_card.columns',
  'card.subtitle': 'null_for_workout_card',
  'card.totals.calories.mealCount': 'at_most_card.mealCount',
  'card.totals.carbsGrams.mealCount': 'at_most_card.mealCount',
  'card.totals.fatGrams.mealCount': 'at_most_card.mealCount',
  'card.totals.fiberGrams.mealCount': 'at_most_card.mealCount',
  'card.totals.proteinGrams.mealCount': 'at_most_card.mealCount',
}

export function buildResponseCardValidationFeedback(
  digest: SafeToolCallValidationDigest,
): string {
  const hints = (digest.pathIssues ?? [])
    .map((issue) => {
      const path = normalizeFeedbackToken(issue.path, 160)
      const code = normalizeFeedbackToken(issue.code, 64)
      if (!path || !code) {
        return null
      }
      const expected = normalizeFeedbackToken(
        issue.expected ?? (code === 'custom'
          ? CUSTOM_EXPECTED_SHAPES[issue.path]
          : undefined),
        96,
      )
      return {
        field: path,
        code,
        ...(expected ? { expected } : {}),
      }
    })
    .filter((hint): hint is {
      field: string
      code: string
      expected?: string
    } => hint !== null)
    .sort((left, right) =>
      validationHintRank(left.code) - validationHintRank(right.code) ||
      left.field.localeCompare(right.field)
    )

  const uniqueHints = [...new Map(hints.map((hint) => [
    `${hint.field}:${hint.code}:${hint.expected ?? ''}`,
    hint,
  ])).values()].slice(0, MAX_RESPONSE_CARD_REPAIR_HINTS)
  const genericFeedback = JSON.stringify({
    error: 'invalid_response_card_arguments',
  })
  if (uniqueHints.length === 0) {
    return genericFeedback
  }

  const feedback = JSON.stringify({
    error: 'invalid_response_card_arguments',
    hints: uniqueHints,
  })
  return feedback.length <= MAX_RESPONSE_CARD_VALIDATION_FEEDBACK_LENGTH
    ? feedback
    : genericFeedback
}

function validationHintRank(code: string): number {
  if (code === 'missing_required') {
    return 2
  }
  if (code === 'unrecognized_key') {
    return 3
  }
  return 1
}

function normalizeFeedbackToken(
  value: string | undefined,
  maxLength: number,
): string | null {
  if (!value || value.length > maxLength) {
    return null
  }
  return /^[a-z0-9_[\].-]+$/i.test(value) ? value : null
}
