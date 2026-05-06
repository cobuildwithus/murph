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
export const AUTO_REPLY_RECEIPT_INPUT_ID_KEY = 'autoReplyInputId'
export const AUTO_REPLY_RECEIPT_INPUT_IDS_KEY = 'autoReplyInputIds'
export const ASSISTANT_AUTO_REPLY_MAX_FAILED_ATTEMPTS = 3

const ASSISTANT_AUTO_REPLY_PROVIDER_RETRY_DELAY_MS = 30 * 1000
const ASSISTANT_AUTO_REPLY_PROVIDER_CAPACITY_RETRY_DELAY_MS = 5 * 60 * 1000
const ASSISTANT_AUTO_REPLY_CONFIG_RETRY_DELAY_MS = 5 * 60 * 1000

export interface AssistantAutoReplyReceiptMetadata {
  inputIds: readonly string[]
  primaryInputId: string
}

export interface AssistantAutoReplyRetryBudget {
  allowed: boolean
  failedAttempts: number
  maxFailedAttempts: number
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

export function resolveAssistantAutoReplyRetryBudget(input: {
  inputIds: readonly string[]
  maxFailedAttempts?: number
  receipts: readonly AssistantTurnReceipt[]
}): AssistantAutoReplyRetryBudget {
  const maxFailedAttempts = normalizeAssistantAutoReplyMaxFailedAttempts(
    input.maxFailedAttempts,
  )
  const targetInputIds = new Set(input.inputIds)
  const failedAttempts = input.receipts.filter((receipt) => {
    if (receipt.status !== 'failed') {
      return false
    }

    const metadata = readAssistantAutoReplyReceiptMetadata(receipt)
    return metadata?.inputIds.some((inputId) => targetInputIds.has(inputId)) === true
  }).length

  return {
    allowed: failedAttempts < maxFailedAttempts,
    failedAttempts,
    maxFailedAttempts,
  }
}

function normalizeAssistantAutoReplyMaxFailedAttempts(
  value: number | null | undefined,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.trunc(value))
    : ASSISTANT_AUTO_REPLY_MAX_FAILED_ATTEMPTS
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

export function isAssistantAutoReplyRepairableConfigError(
  error: unknown,
): boolean {
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null

  return code === 'ASSISTANT_CODEX_NOT_FOUND' ||
    code === 'HOSTED_ASSISTANT_CONFIG_INVALID' ||
    code === 'HOSTED_ASSISTANT_CONFIG_REQUIRED'
}
