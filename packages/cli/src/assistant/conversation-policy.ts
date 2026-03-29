import type {
  AssistantBindingDelivery,
  AssistantSession,
  AssistantTurnTrigger,
} from '../assistant-cli-contracts.js'
import type { AssistantMessageInput } from './service-contracts.js'
import type { ConversationRef } from './conversation-ref.js'
import { normalizeNullableString } from './shared.js'

export type AssistantConversationScopeStrategy =
  | 'alias'
  | 'conversation-key'
  | 'session-id'
  | 'unscoped'

export type AssistantConversationDeliveryPolicy =
  | 'binding-target-only'
  | 'explicit-target-override'
  | 'not-requested'

export interface AssistantConversationAudience {
  actorId: string | null
  bindingDelivery: AssistantBindingDelivery | null
  channel: string | null
  deliveryPolicy: AssistantConversationDeliveryPolicy
  explicitTarget: string | null
  identityId: string | null
  replyToMessageId: string | null
  threadId: string | null
  threadIsDirect: boolean | null
}

export interface AssistantConversationResetPolicy {
  maxSessionAgeMs: number | null
  recreateOnExpiry: boolean
}

export interface AssistantConversationPolicy {
  allowAutoReply: boolean
  allowDeliveryMirroring: boolean
  allowSensitiveHealthContext: boolean
  audience: AssistantConversationAudience
  conversationScopeKey: string | null
  rationale: readonly string[]
  reset: AssistantConversationResetPolicy
  scopeStrategy: AssistantConversationScopeStrategy
}

export function resolveAssistantConversationPolicy(input: {
  conversation?: ConversationRef | null
  message: Pick<
    AssistantMessageInput,
    | 'deliverResponse'
    | 'deliveryReplyToMessageId'
    | 'deliveryTarget'
    | 'maxSessionAgeMs'
    | 'sourceThreadId'
    | 'threadId'
    | 'threadIsDirect'
    | 'turnTrigger'
  >
  session: Pick<AssistantSession, 'binding'>
}): AssistantConversationPolicy {
  const scope = resolveConversationScope({
    conversation: input.conversation,
    session: input.session,
  })
  const audience = resolveAssistantConversationAudience({
    message: input.message,
    session: input.session,
  })
  const allowSensitiveHealthContext = shouldExposeSensitiveHealthContext(
    input.session.binding,
  )
  const allowAutoReply = resolveAssistantConversationAutoReplyEligibility({
    audience,
    turnTrigger: input.message.turnTrigger ?? 'manual-ask',
  })
  const rationale = buildAssistantConversationPolicyRationale({
    allowAutoReply,
    allowSensitiveHealthContext,
    audience,
    scope,
  })

  return {
    allowAutoReply,
    allowDeliveryMirroring: false,
    allowSensitiveHealthContext,
    audience,
    conversationScopeKey: scope.scopeKey,
    rationale,
    reset: {
      maxSessionAgeMs:
        typeof input.message.maxSessionAgeMs === 'number' &&
        Number.isFinite(input.message.maxSessionAgeMs)
          ? Math.max(0, Math.trunc(input.message.maxSessionAgeMs))
          : null,
      recreateOnExpiry: true,
    },
    scopeStrategy: scope.strategy,
  }
}

export function resolveAssistantConversationAudience(input: {
  message: Pick<
    AssistantMessageInput,
    | 'deliverResponse'
    | 'deliveryReplyToMessageId'
    | 'deliveryTarget'
    | 'sourceThreadId'
    | 'threadId'
    | 'threadIsDirect'
  >
  session: Pick<AssistantSession, 'binding'>
}): AssistantConversationAudience {
  const binding = input.session.binding
  const channel = normalizeNullableString(binding.channel)
  const identityId = normalizeNullableString(binding.identityId)
  const actorId = normalizeNullableString(binding.actorId)
  const threadId =
    normalizeNullableString(input.message.threadId) ??
    normalizeNullableString(input.message.sourceThreadId) ??
    normalizeNullableString(binding.threadId)
  const explicitTarget = normalizeNullableString(input.message.deliveryTarget)
  const replyToMessageId = normalizeNullableString(
    input.message.deliveryReplyToMessageId,
  )
  const bindingDelivery = binding.delivery ?? null

  return {
    actorId,
    bindingDelivery,
    channel,
    deliveryPolicy:
      input.message.deliverResponse !== true
        ? 'not-requested'
        : explicitTarget
          ? 'explicit-target-override'
          : 'binding-target-only',
    explicitTarget,
    identityId,
    replyToMessageId,
    threadId,
    threadIsDirect:
      typeof input.message.threadIsDirect === 'boolean'
        ? input.message.threadIsDirect
        : binding.threadIsDirect,
  }
}

export function resolveAssistantConversationAutoReplyEligibility(input: {
  audience: AssistantConversationAudience
  turnTrigger: AssistantTurnTrigger
}): boolean {
  if (input.turnTrigger !== 'automation-auto-reply') {
    return true
  }

  if (!input.audience.channel || !input.audience.identityId) {
    return false
  }

  if (input.audience.deliveryPolicy === 'not-requested') {
    return false
  }

  if (input.audience.threadIsDirect === false && !input.audience.bindingDelivery) {
    return false
  }

  return true
}

export function shouldExposeSensitiveHealthContext(binding: {
  channel?: string | null
  threadIsDirect?: boolean | null
}): boolean {
  const channel = normalizeNullableString(binding.channel)?.toLowerCase() ?? null
  if (channel === null) {
    return true
  }
  if (channel === 'local' || channel === 'null') {
    return true
  }
  return binding.threadIsDirect === true
}

function resolveConversationScope(input: {
  conversation?: ConversationRef | null
  session: Pick<AssistantSession, 'binding'>
}): {
  scopeKey: string | null
  strategy: AssistantConversationScopeStrategy
} {
  const sessionId = normalizeNullableString(input.conversation?.sessionId)
  if (sessionId) {
    return {
      scopeKey: sessionId,
      strategy: 'session-id',
    }
  }

  const alias = normalizeNullableString(input.conversation?.alias)
  if (alias) {
    return {
      scopeKey: alias,
      strategy: 'alias',
    }
  }

  const conversationKey = normalizeNullableString(
    input.session.binding.conversationKey,
  )
  if (conversationKey) {
    return {
      scopeKey: conversationKey,
      strategy: 'conversation-key',
    }
  }

  return {
    scopeKey: null,
    strategy: 'unscoped',
  }
}

function buildAssistantConversationPolicyRationale(input: {
  allowAutoReply: boolean
  allowSensitiveHealthContext: boolean
  audience: AssistantConversationAudience
  scope: {
    scopeKey: string | null
    strategy: AssistantConversationScopeStrategy
  }
}): readonly string[] {
  const reasons = [
    input.scope.scopeKey
      ? `session scope resolved via ${input.scope.strategy}`
      : 'session scope unresolved; runtime will fall back to ephemeral turn context',
    input.allowSensitiveHealthContext
      ? 'sensitive health context is allowed for this audience'
      : 'sensitive health context is withheld for this audience',
    input.audience.deliveryPolicy === 'explicit-target-override'
      ? 'outbound delivery targets an explicit operator-supplied audience'
      : input.audience.deliveryPolicy === 'binding-target-only'
        ? 'outbound delivery targets the bound conversation audience'
        : 'outbound delivery is not requested for this turn',
    input.allowAutoReply
      ? 'auto-reply is eligible for this audience'
      : 'auto-reply is not eligible for this audience',
    'delivery fan-out remains disabled; a turn can target only one audience',
  ]

  return reasons
}
