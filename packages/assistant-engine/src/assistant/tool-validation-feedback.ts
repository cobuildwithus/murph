import type {
  SafeToolCallValidationDigest,
} from './tool-validation-digest.js'

const MAX_TOOL_CALL_REPAIR_HINTS = 4
const MAX_TOOL_CALL_VALIDATION_FEEDBACK_LENGTH = 1_600

export interface ToolCallValidationFeedbackOptions {
  error: string
}

interface ToolCallRepairHint {
  code: string
  expected?: string
  field: string
}

/**
 * Build bounded model-visible repair guidance from the value-free validation
 * digest. Submitted values, received shapes, and rejected key names are never
 * copied into the response.
 */
export function buildToolCallValidationFeedback(
  digest: SafeToolCallValidationDigest,
  options: ToolCallValidationFeedbackOptions,
): string {
  const error = normalizeFeedbackToken(options.error, 96)
    ?? 'invalid_tool_arguments'
  const hints = (digest.pathIssues ?? [])
    .map((issue): ToolCallRepairHint | null => {
      const field = normalizeFeedbackToken(issue.path, 160)
      const code = normalizeFeedbackToken(issue.code, 64)
      if (!field || !code) {
        return null
      }
      const expected = normalizeFeedbackToken(issue.expected, 96)
      return {
        field,
        code,
        ...(expected ? { expected } : {}),
      }
    })
    .filter((hint): hint is ToolCallRepairHint => hint !== null)
    .sort((left, right) =>
      validationHintRank(left.code) - validationHintRank(right.code)
      || left.field.localeCompare(right.field)
    )

  const uniqueHints = [...new Map(hints.map((hint) => [
    `${hint.field}:${hint.code}:${hint.expected ?? ''}`,
    hint,
  ])).values()].slice(0, MAX_TOOL_CALL_REPAIR_HINTS)
  const genericFeedback = JSON.stringify({ error })
  if (uniqueHints.length === 0) {
    return genericFeedback
  }

  const feedback = JSON.stringify({
    error,
    hints: uniqueHints,
  })
  return feedback.length <= MAX_TOOL_CALL_VALIDATION_FEEDBACK_LENGTH
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
