import type {
  SafeToolCallValidationDigest,
} from '../assistant/tool-validation-digest.js'

const MAX_RESPONSE_CARD_REPAIR_HINTS = 4
const MAX_RESPONSE_CARD_VALIDATION_FEEDBACK_LENGTH = 1_600

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
        issue.expected,
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
