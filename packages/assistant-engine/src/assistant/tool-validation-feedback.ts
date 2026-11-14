import type {
  SafeToolCallValidationDigest,
} from './tool-validation-digest.js'
import {
  readModelToolCallValidationIssues,
} from './tool-validation-digest.js'

const MAX_TOOL_CALL_REPAIR_HINTS = 4
const MAX_TOOL_CALL_VALIDATION_FEEDBACK_LENGTH = 1_600
const MAX_MODEL_TOOL_CALL_VALIDATION_FEEDBACK_LENGTH = 60_000

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
  errorCode: string,
): string {
  const error = normalizeFeedbackToken(errorCode, 96)
    ?? 'invalid_tool_arguments'
  const modelValidationIssues = readModelToolCallValidationIssues(digest)
  if (modelValidationIssues) {
    const detailedFeedback = JSON.stringify({
      error,
      validationIssues: compactValidationIssues(modelValidationIssues),
    })
    if (Buffer.byteLength(detailedFeedback, 'utf8')
      <= MAX_MODEL_TOOL_CALL_VALIDATION_FEEDBACK_LENGTH) {
      return detailedFeedback
    }
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
  const genericFeedback = JSON.stringify({
    error,
  })
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

// Zod's built-in messages restate the issue's own path, code, expected type,
// allowed values or keys (a discriminator miss lists every option twice).
// Custom messages carry rules the fields cannot, so they always stay.
const DEFAULT_ISSUE_MESSAGE_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  invalid_element: ['Invalid value in '],
  invalid_format: ['Invalid string: must ', 'Invalid ISO '],
  invalid_key: ['Invalid key in '],
  invalid_type: ['Invalid input: expected '],
  invalid_union: ['Invalid input', 'Invalid discriminator value. Expected '],
  invalid_value: ['Invalid input: expected ', 'Invalid option: expected one of '],
  not_multiple_of: ['Invalid number: must be a multiple of '],
  too_big: ['Too big: expected '],
  too_small: ['Too small: expected '],
  unrecognized_keys: ['Unrecognized key'],
}

function compactValidationIssues(issues: unknown): unknown {
  return Array.isArray(issues) ? issues.map(compactValidationIssue) : issues
}

function compactValidationIssue(issue: unknown): unknown {
  if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
    return issue
  }
  const code = 'code' in issue && typeof issue.code === 'string' ? issue.code : ''
  const prefixes = DEFAULT_ISSUE_MESSAGE_PREFIXES[code] ?? []
  // Keep the validator's key order so an issue with nothing to drop is unchanged.
  return Object.fromEntries(Object.entries(issue).flatMap(([key, value]): [string, unknown][] => {
    if (key === 'message' && typeof value === 'string'
      && prefixes.some((prefix) => value.startsWith(prefix))) {
      return []
    }
    if (key === 'errors' && Array.isArray(value)) {
      const branches = uniqueUnionBranches(value)
      return branches.length > 0 ? [[key, branches]] : []
    }
    return [[key, value]]
  }))
}

// Identical union branches add nothing once their default messages are gone.
function uniqueUnionBranches(branches: readonly unknown[]): unknown[] {
  const unique = new Map<string, unknown>()
  for (const branch of branches) {
    const compacted = compactValidationIssues(branch)
    unique.set(JSON.stringify(compacted), compacted)
  }
  return [...unique.values()]
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
