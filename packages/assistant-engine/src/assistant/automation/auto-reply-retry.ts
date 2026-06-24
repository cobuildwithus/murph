import type { AssistantTurnReceipt } from '@murphai/operator-config/assistant-cli-contracts'
import {
  isAssistantProviderConnectionLostError,
  isAssistantProviderStalledError,
} from '../provider-failure-diagnostics.js'
import {
  compareAssistantTimestampsAscending,
  errorMessage,
} from '../shared.js'
import { computeAssistantAutomationRetryAt } from './shared.js'

export const AUTO_REPLY_RECEIPT_INPUT_ID_KEY = 'autoReplyInputId'
export const AUTO_REPLY_RECEIPT_INPUT_IDS_KEY = 'autoReplyInputIds'

const ASSISTANT_AUTO_REPLY_PROVIDER_RETRY_DELAY_MS = 30 * 1000
const ASSISTANT_AUTO_REPLY_PROVIDER_CAPACITY_RETRY_DELAY_MS = 5 * 60 * 1000
const ASSISTANT_AUTO_REPLY_CONFIG_RETRY_DELAY_MS = 5 * 60 * 1000

export interface AssistantAutoReplyReceiptMetadata {
  inputIds: readonly string[]
  primaryInputId: string
}

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

  if (isAssistantProviderUsageLimitError(error)) {
    return null
  }

  if (isAssistantProviderCapacityError(error)) {
    return computeAssistantAutomationRetryAt(
      ASSISTANT_AUTO_REPLY_PROVIDER_CAPACITY_RETRY_DELAY_MS,
      nowMs,
    )
  }

  if (isAssistantAutoReplyRepairableConfigError(error)) {
    return computeAssistantAutomationRetryAt(
      ASSISTANT_AUTO_REPLY_CONFIG_RETRY_DELAY_MS,
      nowMs,
    )
  }

  return null
}

export function compareAssistantAutoReplyReceiptRecency(
  left: AssistantTurnReceipt,
  right: AssistantTurnReceipt,
): number {
  const updatedAtComparison = compareAssistantTimestampsAscending(
    left.updatedAt,
    right.updatedAt,
  )
  if (updatedAtComparison !== 0) {
    return updatedAtComparison
  }

  return left.turnId.localeCompare(right.turnId)
}

export function readAssistantAutoReplyReceiptMetadata(
  receipt: AssistantTurnReceipt,
): AssistantAutoReplyReceiptMetadata | null {
  const inputIds: string[] = []
  let primaryInputId: string | null = null

  for (const event of receipt.timeline) {
    if (
      event.kind !== 'turn.started' &&
      event.kind !== 'turn.input.accepted'
    ) {
      continue
    }

    const groupedInputIds = event.metadata[AUTO_REPLY_RECEIPT_INPUT_IDS_KEY]
      ?.split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0) ?? []
    const eventPrimaryInputId =
      event.metadata[AUTO_REPLY_RECEIPT_INPUT_ID_KEY]?.trim() ||
      groupedInputIds[0] ||
      null
    if (eventPrimaryInputId && !inputIds.includes(eventPrimaryInputId)) {
      inputIds.push(eventPrimaryInputId)
    }
    for (const inputId of groupedInputIds) {
      if (!inputIds.includes(inputId)) {
        inputIds.push(inputId)
      }
    }
    if (primaryInputId === null && eventPrimaryInputId !== null) {
      primaryInputId = eventPrimaryInputId
    }
  }

  const resolvedPrimaryInputId = primaryInputId ?? inputIds[0] ?? null
  return resolvedPrimaryInputId
    ? {
        inputIds:
          inputIds.length > 0 ? inputIds : [resolvedPrimaryInputId],
        primaryInputId: resolvedPrimaryInputId,
      }
    : null
}

export function isAssistantProviderCapacityError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  const code = readAssistantProviderErrorCode(error)
  const hasCapacitySignal =
    code.includes('RATE') ||
    code.includes('LIMIT') ||
    code.includes('QUOTA') ||
    message.includes('rate limit') ||
    message.includes('usage limit') ||
    message.includes('quota') ||
    message.includes('too many requests') ||
    message.includes('purchase more credits') ||
    message.includes('out of credits') ||
    message.includes('credit balance') ||
    message.includes('please check your plan and billing details') ||
    message.includes('try again at ')

  if (!hasCapacitySignal) {
    return false
  }

  const providerFailure =
    code.startsWith('ASSISTANT_') ||
    message.includes('codex cli failed') ||
    message.includes('assistant provider')

  if (providerFailure) {
    return true
  }

  // Some hosted upstreams bubble raw quota/rate-limit text without Murph-specific
  // wrapping or error codes. Treat those as capacity failures so automation holds
  // the cursor and retries instead of silently dropping the capture.
  return (
    code.length === 0 ||
    code === 'UNKNOWN' ||
    message.includes('you exceeded your current quota')
  )
}

export function isAssistantProviderUsageLimitError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  const code = readAssistantProviderErrorCode(error)
  const context = readAssistantProviderErrorContext(error)

  if (context?.assistantDeliveryFailure === true) {
    return false
  }

  if (isAssistantDeliveryBoundaryErrorCode(code)) {
    return false
  }

  if (code === 'ASSISTANT_CODEX_USAGE_LIMIT') {
    return true
  }

  if (context?.providerUsageLimit === true) {
    return true
  }

  return hasAssistantProviderUsageLimitMessage(message)
}

export function isAssistantAutoReplyRepairableConfigError(
  error: unknown,
): boolean {
  const code = readAssistantProviderErrorCode(error)

  return code === 'ASSISTANT_CODEX_NOT_FOUND' ||
    code === 'HOSTED_ASSISTANT_CONFIG_INVALID' ||
    code === 'HOSTED_ASSISTANT_CONFIG_REQUIRED'
}

function readAssistantProviderErrorCode(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code.toUpperCase()
    : ''
}

function isAssistantDeliveryBoundaryErrorCode(code: string): boolean {
  return code.includes('DELIVERY') || code.includes('OUTBOX')
}

function readAssistantProviderErrorContext(
  error: unknown,
): Record<string, unknown> | null {
  if (
    !error ||
    typeof error !== 'object' ||
    !('context' in error) ||
    typeof (error as { context?: unknown }).context !== 'object' ||
    (error as { context?: unknown }).context === null ||
    Array.isArray((error as { context?: unknown }).context)
  ) {
    return null
  }

  return (error as { context: Record<string, unknown> }).context
}

function hasAssistantProviderUsageLimitMessage(message: string): boolean {
  return (
    message.includes('usage limit') ||
    message.includes('quota exceeded') ||
    message.includes('current quota') ||
    message.includes('insufficient quota') ||
    message.includes('purchase more credits') ||
    message.includes('out of credits') ||
    message.includes('credit balance') ||
    message.includes('plan and billing details')
  )
}
