import {
  assistantChannelDeliverySchema,
  assistantDeliverResultSchema,
  type AssistantBindingDelivery,
} from './assistant-cli-contracts.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './assistant/store.js'
import { normalizeRequiredText, summarizeAssistantTurn } from './assistant/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

export interface DeliverAssistantMessageInput {
  actorId?: string | null
  alias?: string | null
  channel?: string | null
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

export interface AssistantChannelDependencies {
  sendImessage?: (input: { message: string; target: string }) => Promise<void>
}

export async function deliverAssistantMessage(
  input: DeliverAssistantMessageInput,
  dependencies: AssistantChannelDependencies = {},
): Promise<ReturnType<typeof assistantDeliverResultSchema.parse>> {
  const normalizedMessage = normalizeRequiredText(input.message, 'message')
  const explicitTarget = input.target?.trim() ? input.target.trim() : null
  const resolved = await resolveAssistantSession({
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    actorId: input.actorId ?? input.participantId,
    threadId: input.threadId ?? input.sourceThreadId,
    threadIsDirect: input.threadIsDirect,
  })

  const channel = input.channel?.trim() || resolved.session.binding.channel
  if (!channel) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_REQUIRED',
      'Outbound delivery requires a mapped channel. Pass --channel or resume a session with channel metadata.',
    )
  }

  const delivery = await deliverOverChannel(
    {
      bindingDelivery: resolved.session.binding.delivery,
      channel,
      explicitTarget,
      message: normalizedMessage,
    },
    dependencies,
  )

  const updatedSession = await saveAssistantSession(input.vault, {
    ...resolved.session,
    binding: {
      ...resolved.session.binding,
      channel,
    },
    updatedAt: delivery.sentAt,
    lastTurnAt: delivery.sentAt,
    lastAssistantMessage: summarizeAssistantTurn(normalizedMessage),
  })

  return assistantDeliverResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    message: normalizedMessage,
    session: updatedSession,
    delivery,
  })
}

export function resolveImessageDeliveryCandidates(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): Array<{ kind: 'explicit' | 'participant' | 'thread'; target: string }> {
  const explicitTarget = input.explicitTarget?.trim() ? input.explicitTarget.trim() : null
  if (explicitTarget) {
    return [
      {
        kind: 'explicit',
        target: explicitTarget,
      },
    ]
  }

  if (!input.bindingDelivery) {
    return []
  }

  return [
    {
      kind: input.bindingDelivery.kind,
      target: input.bindingDelivery.target,
    },
  ]
}

async function deliverOverChannel(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    channel: string
    explicitTarget: string | null
    message: string
  },
  dependencies: AssistantChannelDependencies,
) {
  switch (input.channel) {
    case 'imessage':
      return deliverImessage(input, dependencies)
    default:
      throw new VaultCliError(
        'ASSISTANT_CHANNEL_UNSUPPORTED',
        `Outbound delivery for channel "${input.channel}" is not supported in this build.`,
      )
  }
}

async function deliverImessage(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    explicitTarget: string | null
    message: string
  },
  dependencies: AssistantChannelDependencies,
) {
  const sendImessage = dependencies.sendImessage ?? sendImessageMessage
  const candidates = resolveImessageDeliveryCandidates({
    explicitTarget: input.explicitTarget,
    bindingDelivery: input.bindingDelivery,
  })

  if (candidates.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'iMessage delivery requires an explicit target or a stored delivery binding.',
    )
  }

  const candidate = candidates[0]
  await sendImessage({
    target: candidate.target,
    message: input.message,
  })

  return assistantChannelDeliverySchema.parse({
    channel: 'imessage',
    target: candidate.target,
    targetKind: candidate.kind,
    sentAt: new Date().toISOString(),
    messageLength: input.message.length,
  })
}

export async function sendImessageMessage(input: {
  message: string
  target: string
}): Promise<void> {
  const specifier = '@photon-ai/imessage-kit'
  let module: Record<string, unknown>

  try {
    module = (await import(specifier)) as Record<string, unknown>
  } catch (error) {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      'Outbound iMessage delivery requires @photon-ai/imessage-kit to be installed where vault-cli runs.',
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }

  const IMessageSDK = module.IMessageSDK
  if (typeof IMessageSDK !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      '@photon-ai/imessage-kit did not expose the expected IMessageSDK constructor.',
    )
  }

  const sdk = new (IMessageSDK as new () => {
    close?: () => Promise<void> | void
    send?: (target: string, content: string) => Promise<unknown>
  })()

  if (typeof sdk.send !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      '@photon-ai/imessage-kit did not expose the expected send() method on IMessageSDK.',
    )
  }

  try {
    await sdk.send(input.target, input.message)
  } finally {
    await sdk.close?.()
  }
}
