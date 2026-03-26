import {
  assistantDeliverResultSchema,
  type AssistantChannelDelivery,
  type AssistantDeliverResult,
  type AssistantSession,
} from './assistant-cli-contracts.js'
import {
  getAssistantChannelAdapter,
  resolveImessageDeliveryCandidates,
  sendEmailMessage,
  sendImessageMessage,
  sendLinqMessage,
  sendTelegramMessage,
  type AssistantDeliveryCandidate,
  type AssistantChannelDependencies,
} from './assistant/channel-adapters.js'
import {
  createAssistantBinding,
  mergeAssistantBinding,
} from './assistant/bindings.js'
import {
  classifyAssistantDeliveryFailure,
  type AssistantFallbackDecision,
} from './assistant/fallback-policy.js'
import type { ConversationRef } from './assistant/conversation-ref.js'
import {
  mergeConversationRefs,
  normalizeConversationRef,
} from './assistant/conversation-ref.js'
import {
  emitAssistantLifecycleEvent,
  runAssistantLifecycleMiddleware,
  type AssistantLifecycleHooks,
} from './assistant/hooks.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './assistant/store.js'
import { normalizeRequiredText } from './assistant/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

export {
  sendEmailMessage,
  resolveImessageDeliveryCandidates,
  sendImessageMessage,
  sendLinqMessage,
  sendTelegramMessage,
}

export interface DeliverAssistantMessageInput {
  actorId?: string | null
  alias?: string | null
  channel?: string | null
  conversation?: ConversationRef | null
  hooks?: AssistantLifecycleHooks
  identityId?: string | null
  message: string
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
  target?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
  onFallbackDecision?: ((decision: AssistantFallbackDecision) => void) | null
}

export interface DeliverAssistantMessageOverBindingResult {
  delivery: AssistantChannelDelivery
  session?: AssistantSession
}

export async function deliverAssistantMessage(
  input: DeliverAssistantMessageInput,
  dependencies: AssistantChannelDependencies = {},
): Promise<AssistantDeliverResult> {
  const normalizedMessage = normalizeRequiredText(input.message, 'message')
  const explicitTarget = input.target?.trim() ? input.target.trim() : null
  const conversation = normalizeConversationRef(
    mergeConversationRefs(input.conversation, {
      sessionId: input.sessionId,
      alias: input.alias,
      channel: input.channel,
      identityId: input.identityId,
      participantId: input.actorId ?? input.participantId,
      threadId: input.threadId ?? input.sourceThreadId,
      directness:
        input.threadIsDirect === true
          ? 'direct'
          : input.threadIsDirect === false
            ? 'group'
            : null,
    }),
  )
  const resolved = await resolveAssistantSession({
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    actorId: input.actorId ?? input.participantId,
    threadId: input.threadId ?? input.sourceThreadId,
    threadIsDirect: input.threadIsDirect,
    conversation,
  })

  const delivered = await deliverAssistantMessageOverBinding(
    {
      message: normalizedMessage,
      session: resolved.session,
      target: explicitTarget,
      onFallbackDecision: input.onFallbackDecision ?? null,
      hooks: input.hooks,
    },
    dependencies,
  )
  const delivery = delivered.delivery

  const updatedSession =
    delivered.session ??
    await saveAssistantSession(input.vault, {
      ...resolved.session,
      binding: resolvePersistedBinding(
        resolved.session.binding,
        delivery,
        explicitTarget,
      ),
      updatedAt: delivery.sentAt,
      lastTurnAt: delivery.sentAt,
    })

  return assistantDeliverResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    message: normalizedMessage,
    session: updatedSession,
    delivery,
  })
}

function resolvePersistedBinding(
  binding: AssistantSession['binding'],
  delivery: AssistantChannelDelivery,
  explicitTarget: string | null,
): AssistantSession['binding'] {
  if (explicitTarget) {
    return mergeAssistantBinding(binding, {
      channel: delivery.channel,
    })
  }

  if (
    binding.delivery?.kind === 'thread' &&
    delivery.targetKind === 'thread' &&
    (binding.threadId !== delivery.target || binding.delivery.target !== delivery.target)
  ) {
    return mergeAssistantBinding(binding, {
      channel: delivery.channel,
      threadId: delivery.target,
      deliveryKind: 'thread',
      deliveryTarget: delivery.target,
    })
  }

  if (
    binding.delivery?.kind === 'participant' &&
    delivery.targetKind === 'participant' &&
    binding.delivery.target !== delivery.target
  ) {
    return mergeAssistantBinding(binding, {
      channel: delivery.channel,
      deliveryKind: 'participant',
      deliveryTarget: delivery.target,
    })
  }

  return mergeAssistantBinding(binding, {
    channel: delivery.channel,
  })
}

export async function deliverAssistantMessageOverBinding(
  input: {
    actorId?: string | null
    channel?: string | null
    hooks?: AssistantLifecycleHooks
    identityId?: string | null
    message: string
    onFallbackDecision?: ((decision: AssistantFallbackDecision) => void) | null
    sessionId?: string | null
    session?: Pick<AssistantSession, 'binding'>
    target?: string | null
    targetKind?: AssistantDeliveryCandidate['kind'] | null
    threadId?: string | null
    threadIsDirect?: boolean | null
    vault?: string
  },
  dependencies: AssistantChannelDependencies = {},
): Promise<DeliverAssistantMessageOverBindingResult> {
  const binding =
    input.session?.binding ??
    createAssistantBinding({
      actorId: input.actorId,
      channel: input.channel,
      identityId: input.identityId,
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect,
    })
  const beforeOutboundDelivery = await runAssistantLifecycleMiddleware(
    input.hooks,
    'beforeOutboundDelivery',
    {
      binding,
      explicitTarget: input.target?.trim() ? input.target.trim() : null,
      message: input.message,
      sessionId: input.sessionId ?? null,
      vault: input.vault ?? null,
    },
  )
  const channel = beforeOutboundDelivery.binding.channel?.trim() || null
  if (!channel) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_REQUIRED',
      'Outbound delivery requires a mapped channel. Pass --channel or resume a session with channel metadata.',
    )
  }

  const adapter = getAssistantChannelAdapter(channel)
  if (!adapter) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_UNSUPPORTED',
      `Outbound delivery for channel "${channel}" is not supported in this build.`,
    )
  }

  await emitAssistantLifecycleEvent(input.hooks, {
    type: 'delivery.started',
    channel,
    explicitTarget: beforeOutboundDelivery.explicitTarget,
    message: beforeOutboundDelivery.message,
    occurredAt: new Date().toISOString(),
    sessionId: beforeOutboundDelivery.sessionId,
    vault: beforeOutboundDelivery.vault,
  })

  try {
    const delivery = await sendAssistantDeliveryWithFallback({
      adapter,
      binding: beforeOutboundDelivery.binding,
      dependencies,
      message: beforeOutboundDelivery.message,
      onFallbackDecision: input.onFallbackDecision ?? null,
      target: beforeOutboundDelivery.explicitTarget,
      targetKind: input.targetKind ?? null,
    })

    await emitAssistantLifecycleEvent(input.hooks, {
      type: 'delivery.completed',
      delivery,
      occurredAt: new Date().toISOString(),
      sessionId: beforeOutboundDelivery.sessionId,
      vault: beforeOutboundDelivery.vault,
    })

    return {
      delivery,
    }
  } catch (error) {
    await emitAssistantLifecycleEvent(input.hooks, {
      type: 'delivery.failed',
      channel,
      error: normalizeOutboundDeliveryError(error),
      explicitTarget: beforeOutboundDelivery.explicitTarget,
      message: beforeOutboundDelivery.message,
      occurredAt: new Date().toISOString(),
      sessionId: beforeOutboundDelivery.sessionId,
      vault: beforeOutboundDelivery.vault,
    })
    throw error
  }
}

function normalizeOutboundDeliveryError(error: unknown) {
  return {
    code:
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null,
    message:
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error),
  }
}

async function sendAssistantDeliveryWithFallback(input: {
  adapter: NonNullable<ReturnType<typeof getAssistantChannelAdapter>>
  binding: AssistantSession['binding']
  dependencies: AssistantChannelDependencies
  message: string
  onFallbackDecision?: ((decision: AssistantFallbackDecision) => void) | null
  target: string | null
  targetKind: AssistantDeliveryCandidate['kind'] | null
}): Promise<AssistantChannelDelivery> {
  try {
    return await input.adapter.send(
      {
        bindingDelivery: input.binding.delivery,
        explicitTarget: input.target,
        explicitTargetKind: input.targetKind,
        identityId: input.binding.identityId,
        message: input.message,
      },
      input.dependencies,
    )
  } catch (error) {
    const attemptedTarget =
      input.target ??
      (input.binding.delivery?.target ?? input.binding.threadId ?? null)
    const decision = classifyAssistantDeliveryFailure({
      binding: input.binding,
      channel: input.binding.channel,
      degradedDeliveryRetryUsed: input.targetKind === 'participant',
      error,
      explicitTarget: input.target,
      attemptedTarget,
    })
    if (decision.action !== 'retry-delivery-target') {
      throw error
    }

    input.onFallbackDecision?.(decision)
    return input.adapter.send(
      {
        bindingDelivery: input.binding.delivery,
        explicitTarget: decision.target.target,
        explicitTargetKind: decision.target.kind,
        identityId: input.binding.identityId,
        message: input.message,
      },
      input.dependencies,
    )
  }
}
