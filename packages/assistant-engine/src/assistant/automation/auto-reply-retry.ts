import type { AssistantTurnReceipt } from '@murphai/operator-config/assistant-cli-contracts'
import {
  isAssistantProviderConnectionLostError,
  isAssistantProviderStalledError,
} from '../provider-turn-recovery.js'
import { errorMessage } from '../shared.js'
import {
  computeAssistantAutomationRetryAt,
  normalizeAssistantAutomationWakeAt,
} from './shared.js'

export const AUTO_REPLY_RECEIPT_RETRY_AT_KEY = 'autoReplyRetryAt'

const ASSISTANT_AUTO_REPLY_PROVIDER_RETRY_DELAY_MS = 30 * 1000
const ASSISTANT_AUTO_REPLY_PROVIDER_CAPACITY_RETRY_DELAY_MS = 5 * 60 * 1000

export function computeAssistantAutoReplyRetryAt(
  error: unknown,
  nowMs = Date.now(),
): string | null {
  if (
    isAssistantProviderStalledError(error) ||
    isAssistantProviderConnectionLostError(error)
  ) {
    return computeAssistantAutomationRetryAt(
      ASSISTANT_AUTO_REPLY_PROVIDER_RETRY_DELAY_MS,
      nowMs,
    )
  }

  if (isAssistantProviderCapacityError(error)) {
    return computeAssistantAutomationRetryAt(
      ASSISTANT_AUTO_REPLY_PROVIDER_CAPACITY_RETRY_DELAY_MS,
      nowMs,
    )
  }

  return null
}

export function readAssistantAutoReplyRetryAt(
  receipt: AssistantTurnReceipt,
): string | null {
  for (let index = receipt.timeline.length - 1; index >= 0; index -= 1) {
    const retryAt = receipt.timeline[index]?.metadata[AUTO_REPLY_RECEIPT_RETRY_AT_KEY]
    const normalizedRetryAt = normalizeAssistantAutomationWakeAt(
      typeof retryAt === 'string' ? retryAt : null,
    )
    if (normalizedRetryAt) {
      return normalizedRetryAt
    }
  }

  return null
}

export function isAssistantProviderCapacityError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code.toUpperCase()
      : ''
  const providerFailure =
    code.startsWith('ASSISTANT_') ||
    message.includes('codex cli failed') ||
    message.includes('assistant provider')

  return providerFailure && (
    code.includes('RATE') ||
    code.includes('LIMIT') ||
    code.includes('QUOTA') ||
    message.includes('rate limit') ||
    message.includes('usage limit') ||
    message.includes('quota') ||
    message.includes('too many requests') ||
    message.includes('purchase more credits') ||
    message.includes('try again at ')
  )
}
