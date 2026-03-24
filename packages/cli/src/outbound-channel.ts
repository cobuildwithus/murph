import {
  assistantDeliverResultSchema,
  type AssistantChannelDelivery,
  type AssistantSession,
} from './assistant-cli-contracts.js'
import {
  getAssistantChannelAdapter,
  resolveImessageDeliveryCandidates,
  sendEmailMessage,
  sendImessageMessage,
  sendLinqMessage,
  sendTelegramMessage,
  type AssistantChannelDependencies,
} from './assistant/channel-adapters.js'
import {
  createAssistantBinding,
  mergeAssistantBinding,
} from './assistant/bindings.js'
import type { ConversationRef } from './assistant/conversation-ref.js'
import {
  mergeConversationRefs,
  normalizeConversationRef,
} from './assistant/conversation-ref.js'
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
  identityId?: string | null
  message: string
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
  target?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export async function deliverAssistantMessage(
  input: DeliverAssistantMessageInput,
  dependencies: AssistantChannelDependencies = {},
): Promise<ReturnType<typeof assistantDeliverResultSchema.parse>> {
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

  const delivery = await deliverAssistantMessageOverBinding(
    {
      message: normalizedMessage,
      session: resolved.session,
      target: explicitTarget,
    },
    dependencies,
  )

  const updatedSession = await saveAssistantSession(input.vault, {
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
    identityId?: string | null
    message: string
    sessionId?: string | null
    session?: Pick<AssistantSession, 'binding'>
    target?: string | null
    threadId?: string | null
    threadIsDirect?: boolean | null
    vault?: string
  },
  dependencies: AssistantChannelDependencies = {},
) {
  const binding =
    input.session?.binding ??
    createAssistantBinding({
      actorId: input.actorId,
      channel: input.channel,
      identityId: input.identityId,
      threadId: input.threadId,
      threadIsDirect: input.threadIsDirect,
    })
  const channel = binding.channel?.trim() || null
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

  return adapter.send(
    {
      bindingDelivery: binding.delivery,
      explicitTarget: input.target?.trim() ? input.target.trim() : null,
      identityId: binding.identityId,
      message: input.message,
    },
    dependencies,
  )
}
