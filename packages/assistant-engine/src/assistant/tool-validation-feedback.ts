import type {
  SafeToolCallValidationDigest,
} from './tool-validation-digest.js'
import {
  readModelToolCallValidationReason,
} from './tool-validation-digest.js'

const MAX_TOOL_CALL_REPAIR_HINTS = 4
const MAX_TOOL_CALL_VALIDATION_FEEDBACK_LENGTH = 1_600
const MAX_MODEL_TOOL_CALL_VALIDATION_FEEDBACK_LENGTH = 60_000

export interface ToolCallValidationFeedbackOptions {
  error: string
}

interface ToolCallRepairHint {
  code: string
  expected?: string
  field: string
}

/**
 * Return the originating validator's complete reason to the model while it is
 * still available in memory. Persisted or reconstructed digests fall back to
 * bounded, value-free repair hints.
 */
export function buildToolCallValidationFeedback(
  digest: SafeToolCallValidationDigest,
  options: ToolCallValidationFeedbackOptions,
): string {
  const error = normalizeFeedbackToken(options.error, 96)
    ?? 'invalid_tool_arguments'
  const modelValidationReason = readModelToolCallValidationReason(digest)
  if (modelValidationReason) {
    const detailedFeedback = JSON.stringify({
      error,
      validationIssues: parseModelValidationReason(modelValidationReason),
    })
    if (Buffer.byteLength(detailedFeedback, 'utf8')
      <= MAX_MODEL_TOOL_CALL_VALIDATION_FEEDBACK_LENGTH) {
      return detailedFeedback
    }
    return buildBoundedTruncatedValidationFeedback({
      error,
      modelValidationReason,
    })
  }
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

function buildBoundedTruncatedValidationFeedback(input: {
  error: string
  modelValidationReason: string
}): string {
  const build = (end: number) => JSON.stringify({
    error: input.error,
    validationReason: input.modelValidationReason.slice(0, end),
    validationReasonTruncated: true,
  })
  let lower = 0
  let upper = input.modelValidationReason.length
  let result = build(0)
  while (lower <= upper) {
    const midpoint = Math.floor((lower + upper) / 2)
    const candidate = build(midpoint)
    if (Buffer.byteLength(candidate, 'utf8')
      <= MAX_MODEL_TOOL_CALL_VALIDATION_FEEDBACK_LENGTH) {
      result = candidate
      lower = midpoint + 1
    } else {
      upper = midpoint - 1
    }
  }
  return result
}

function parseModelValidationReason(reason: string): unknown {
  try {
    return JSON.parse(reason)
  } catch {
    return reason
  }
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
