import type { InboxModelInputMode } from '../inbox-model-contracts.js'
import type { AssistantSession } from '../assistant-cli-contracts.js'
import { normalizeNullableString, errorMessage } from './shared.js'
import {
  isAssistantProviderConnectionLostError,
  isAssistantProviderStalledError,
} from './provider-turn-recovery.js'

export type AssistantFallbackCategory =
  | 'cron'
  | 'delivery'
  | 'parser'
  | 'provider'
  | 'routing'
  | 'transcript'

export type AssistantFallbackReason =
  | 'cron-execution-failed'
  | 'cron-provider-deferred'
  | 'email-thread-reply-unavailable'
  | 'malformed-continuation'
  | 'multimodal-unavailable'
  | 'oversized-context'
  | 'parser-pending'
  | 'provider-connection-lost'
  | 'provider-stalled'
  | 'unclassified'

export type AssistantFallbackRetryContextMode =
  | 'reduced-provider-context'
  | 'text-only-routing'

export type AssistantFallbackRetryTrigger =
  | 'parser-completed'
  | 'provider-reconnect'
  | 'scheduler-backoff'

export interface AssistantDeliveryFallbackTarget {
  kind: 'participant'
  target: string
}

export type AssistantFallbackDecision =
  | {
      action: 'defer'
      category: AssistantFallbackCategory
      detail: string
      preserveProviderSession: boolean
      reason: AssistantFallbackReason
      retryTrigger: AssistantFallbackRetryTrigger
    }
  | {
      action: 'hard-fail'
      category: AssistantFallbackCategory
      detail: string
      reason: AssistantFallbackReason
    }
  | {
      action: 'retry-context'
      category: AssistantFallbackCategory
      detail: string
      mode: AssistantFallbackRetryContextMode
      reason: AssistantFallbackReason
    }
  | {
      action: 'retry-delivery-target'
      category: AssistantFallbackCategory
      detail: string
      reason: AssistantFallbackReason
      target: AssistantDeliveryFallbackTarget
    }
  | {
      action: 'skip'
      category: AssistantFallbackCategory
      detail: string
      reason: AssistantFallbackReason
    }

export function classifyAssistantTranscriptContinuationFailure(): AssistantFallbackDecision {
  return {
    action: 'skip',
    category: 'transcript',
    reason: 'malformed-continuation',
    detail:
      'Assistant transcript continuation sidecar was malformed; continuing without continuation context.',
  }
}

export function classifyAssistantProviderFailure(input: {
  degradedContextRetryUsed: boolean
  error: unknown
}): AssistantFallbackDecision {
  if (isAssistantProviderStalledError(input.error)) {
    return {
      action: 'defer',
      category: 'provider',
      reason: 'provider-stalled',
      detail: 'assistant provider stalled without progress; will retry this capture.',
      preserveProviderSession: true,
      retryTrigger: 'provider-reconnect',
    }
  }

  if (isAssistantProviderConnectionLostError(input.error)) {
    return {
      action: 'defer',
      category: 'provider',
      reason: 'provider-connection-lost',
      detail: `${errorMessage(input.error)} Will retry this capture after the provider reconnects.`,
      preserveProviderSession: true,
      retryTrigger: 'provider-reconnect',
    }
  }

  if (!input.degradedContextRetryUsed && isAssistantOversizedContextError(input.error)) {
    return {
      action: 'retry-context',
      category: 'provider',
      reason: 'oversized-context',
      mode: 'reduced-provider-context',
      detail:
        'Assistant context exceeded the provider limit; retrying once with reduced transcript context.',
    }
  }

  return {
    action: 'hard-fail',
    category: 'provider',
    reason: 'unclassified',
    detail: errorMessage(input.error),
  }
}

export function createAssistantParserPendingDecision(): AssistantFallbackDecision {
  return {
    action: 'defer',
    category: 'parser',
    reason: 'parser-pending',
    detail: 'waiting for parser completion',
    preserveProviderSession: false,
    retryTrigger: 'parser-completed',
  }
}

export function classifyAssistantRoutingFailure(input: {
  degradedContextRetryUsed: boolean
  error: unknown
  inputMode: InboxModelInputMode
}): AssistantFallbackDecision {
  if (
    input.inputMode === 'multimodal' &&
    !input.degradedContextRetryUsed &&
    isAssistantMultimodalUnavailableError(input.error)
  ) {
    return {
      action: 'retry-context',
      category: 'routing',
      reason: 'multimodal-unavailable',
      mode: 'text-only-routing',
      detail:
        'Routing model rejected multimodal evidence; retrying once in text-only mode.',
    }
  }

  return {
    action: 'hard-fail',
    category: 'routing',
    reason: 'unclassified',
    detail: errorMessage(input.error),
  }
}

export function classifyAssistantDeliveryFailure(input: {
  binding: AssistantSession['binding']
  channel: string | null
  degradedDeliveryRetryUsed: boolean
  error: unknown
  explicitTarget: string | null
  attemptedTarget: string | null
}): AssistantFallbackDecision {
  const safeEmailFallback =
    !input.degradedDeliveryRetryUsed &&
    isAssistantEmailThreadReplyUnavailableError(input.error)
      ? resolveSafeEmailParticipantFallback({
          binding: input.binding,
          attemptedTarget: input.attemptedTarget,
          channel: input.channel,
          explicitTarget: input.explicitTarget,
        })
      : null
  if (safeEmailFallback) {
    return {
      action: 'retry-delivery-target',
      category: 'delivery',
      reason: 'email-thread-reply-unavailable',
      target: safeEmailFallback,
      detail:
        'Email thread reply target was unavailable; retrying once with the known-safe participant address.',
    }
  }

  return {
    action: 'hard-fail',
    category: 'delivery',
    reason: 'unclassified',
    detail: errorMessage(input.error),
  }
}

export function classifyAssistantCronFailure(error: unknown): AssistantFallbackDecision {
  const providerDecision = classifyAssistantProviderFailure({
    error,
    degradedContextRetryUsed: true,
  })
  if (providerDecision.action === 'defer') {
    return {
      action: 'defer',
      category: 'cron',
      reason: 'cron-provider-deferred',
      detail: providerDecision.detail,
      preserveProviderSession: providerDecision.preserveProviderSession,
      retryTrigger: 'scheduler-backoff',
    }
  }

  return {
    action: 'hard-fail',
    category: 'cron',
    reason: 'cron-execution-failed',
    detail: errorMessage(error),
  }
}

function isAssistantEmailThreadReplyUnavailableError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ASSISTANT_EMAIL_THREAD_REPLY_UNAVAILABLE',
  )
}

function resolveSafeEmailParticipantFallback(input: {
  attemptedTarget: string | null
  binding: AssistantSession['binding']
  channel: string | null
  explicitTarget: string | null
}): AssistantDeliveryFallbackTarget | null {
  const channel = normalizeNullableString(input.channel ?? input.binding.channel)
  if (channel !== 'email' || input.binding.threadIsDirect !== true) {
    return null
  }

  const directParticipant = normalizeNullableString(input.binding.actorId)
  if (!directParticipant || !looksLikeEmailAddress(directParticipant)) {
    return null
  }

  const threadTarget =
    input.binding.delivery?.kind === 'thread'
      ? input.binding.delivery.target
      : normalizeNullableString(input.binding.threadId)
  if (!threadTarget) {
    return null
  }

  const attemptedTarget = normalizeNullableString(input.attemptedTarget)
  if (attemptedTarget !== threadTarget) {
    return null
  }

  const explicitTarget = normalizeNullableString(input.explicitTarget)
  if (explicitTarget && explicitTarget !== threadTarget) {
    return null
  }

  return {
    kind: 'participant',
    target: directParticipant,
  }
}

function looksLikeEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
}

function isAssistantOversizedContextError(error: unknown): boolean {
  const detail = buildAssistantErrorSearchText(error)
  const mentionsContext = [
    'context length',
    'context window',
    'max context',
    'maximum context',
    'maximum length',
    'too many input tokens',
    'too many tokens',
    'input token',
    'prompt is too long',
    'request too large',
  ].some((token) => detail.includes(token))
  const mentionsLimit = [
    'exceed',
    'exceeded',
    'too many',
    'too large',
    'too long',
    'limit',
    'overflow',
  ].some((token) => detail.includes(token))

  return mentionsContext && mentionsLimit
}

function isAssistantMultimodalUnavailableError(error: unknown): boolean {
  const detail = buildAssistantErrorSearchText(error)
  const mentionsImageInput = [
    'image',
    'vision',
    'multimodal',
    'multi-modal',
    'media type',
    'mime type',
    'input_image',
    'image_url',
  ].some((token) => detail.includes(token))
  const signalsUnsupported = [
    'unsupported',
    'not support',
    'does not support',
    'invalid',
    'reject',
    'unknown',
  ].some((token) => detail.includes(token))

  return mentionsImageInput && signalsUnsupported
}

function buildAssistantErrorSearchText(error: unknown): string {
  const parts = [
    errorMessage(error),
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? ((error as { code: string }).code ?? null)
      : null,
  ]

  const contextRecord =
    error && typeof error === 'object'
      ? (error as { context?: unknown }).context
      : null
  const context =
    contextRecord &&
    typeof contextRecord === 'object' &&
    !Array.isArray(contextRecord)
      ? contextRecord
      : null
  if (context) {
    for (const value of Object.values(context as Record<string, unknown>)) {
      if (typeof value === 'string') {
        parts.push(value)
      }
    }
  }

  return parts
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .toLowerCase()
}
