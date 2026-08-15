import {
  buildToolCallValidationFeedback,
} from '../assistant/tool-validation-feedback.js'
import type {
  SafeToolCallValidationDigest,
} from '../assistant/tool-validation-digest.js'

export function buildResponseCardValidationFeedback(
  digest: SafeToolCallValidationDigest,
): string {
  return buildToolCallValidationFeedback(digest, {
    error: 'invalid_response_card_arguments',
  })
}
