import {
  inferGatewayReplyRouteForChannel,
  type GatewayResolvedReplyRoute,
} from '@murphai/gateway-core'
import {
  assistantBindingDeliverySchema,
  assistantChannelDeliverySchema,
  assistantProviderMessageEffectSchema,
  type AssistantBindingDelivery,
  type AssistantBindingDeliveryKind,
  type AssistantProviderMessageEffect,
  type AssistantResponseMedia,
  type AssistantResponseMediaKind,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantResponseCardSchema,
} from '@murphai/operator-config/assistant-response-cards'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  parseHostedEmailThreadTarget,
} from '@murphai/runtime-state'
import type { ConversationRef } from '../conversation-ref.js'
import type {
  AssistantChannelAdapter,
  AssistantChannelAdapterSpec,
  AssistantChannelActivityHandle,
  AssistantDeliveryCandidate,
} from './types.js'

export function createAssistantChannelAdapter(
  spec: AssistantChannelAdapterSpec,
): AssistantChannelAdapter {
  const inferBindingDelivery =
    spec.inferBindingDelivery ??
    ((input) =>
      inferBindingDeliveryForChannel({
        channel: spec.channel,
        conversation: input.conversation,
        deliveryKind: input.deliveryKind ?? null,
        deliveryTarget: input.deliveryTarget ?? null,
      }))
  const supportedResponseMediaKinds = spec.supportedResponseMediaKinds

  return {
    channel: spec.channel,
    canAutoReply: spec.canAutoReply,
    inferBindingDelivery,
    ...(spec.startTypingIndicator
      ? {
          async startTypingIndicator(input, dependencies) {
            const candidate = resolveDeliveryCandidates({
              bindingDelivery: input.bindingDelivery,
              explicitTarget: input.explicitTarget,
            })[0] ?? null
            if (!candidate) {
              return null
            }

            const startTypingIndicator = spec.startTypingIndicator
            if (!startTypingIndicator) {
              return null
            }

            const handle = await startTypingIndicator({
              candidate,
              dependencies,
              identityId: normalizeOptionalText(input.identityId),
              replyToMessageId: normalizeOptionalText(input.replyToMessageId),
            })
            return isAssistantChannelActivityHandle(handle) ? handle : null
          },
        }
      : {}),
    supportsIdempotencyKey: spec.supportsIdempotencyKey,
    resolveDeliveryTransportIdempotent(input) {
      return spec.resolveDeliveryTransportIdempotent?.({
        media: input.media ?? [],
        message: input.message,
      }) ?? spec.supportsIdempotencyKey
    },
    supportedResponseMediaKinds,
    async send(input, dependencies) {
      const candidate = resolveRequiredDeliveryCandidate(
        input,
        spec.targetRequiredMessage,
      )
      const idempotencyKey = normalizeOptionalText(input.idempotencyKey)
      const media = input.media ?? []
      const card = input.card == null
        ? null
        : assistantResponseCardSchema.parse(input.card)
      if (card !== null && media.length > 0) {
        throw new VaultCliError(
          'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
          'A response card cannot be combined with response media.',
        )
      }
      assertSupportedResponseMediaKinds({
        channel: spec.channel,
        media,
        supportedKinds: supportedResponseMediaKinds,
      })
      const delivered = await spec.sendMessage({
        actorId: normalizeOptionalText(input.actorId),
        answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
        bindingDelivery: input.bindingDelivery,
        candidate,
        card,
        deliverySource: input.deliverySource ?? null,
        dependencies,
        explicitTarget: normalizeOptionalText(input.explicitTarget),
        idempotencyKey,
        identityId: normalizeOptionalText(input.identityId),
        media,
        message: input.message,
        ...(input.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
        replyToMessageId: normalizeOptionalText(input.replyToMessageId),
        subject: normalizeOptionalText(input.subject),
        threadIsDirect: typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null,
      })
      const cleanupMessages = readDeliveredCleanupMessages(delivered)
      const providerMessageEffects = readDeliveredProviderMessageEffects(delivered)
      const providerMessageIds = readDeliveredProviderMessageIds(delivered)
      const cleanupTargetAliases = readDeliveredCleanupTargetAliases(delivered)

      return assistantChannelDeliverySchema.parse({
        channel: spec.channel,
        idempotencyKey:
          spec.channel === 'linq'
            ? readDeliveredIdempotencyKey(delivered) ?? idempotencyKey
            : idempotencyKey,
        target: readDeliveredTarget(delivered) ?? candidate.target,
        targetKind: readDeliveredTargetKind(delivered) ?? candidate.kind,
        sentAt: new Date().toISOString(),
        messageLength: input.message.length,
        providerMessageId: readDeliveredProviderMessageId(delivered),
        ...(providerMessageEffects ? { providerMessageEffects } : {}),
        ...(providerMessageIds ? { providerMessageIds } : {}),
        ...(cleanupMessages ? { cleanupMessages } : {}),
        ...(cleanupTargetAliases ? { cleanupTargetAliases } : {}),
        providerThreadId: readDeliveredProviderThreadId(delivered),
      })
    },
    ...(spec.setMessageReaction
      ? {
          async setMessageReaction(input, dependencies) {
            const candidate = resolveRequiredDeliveryCandidate(
              input,
              spec.targetRequiredMessage,
            )
            const idempotencyKey = normalizeOptionalText(input.idempotencyKey)
            const delivered = await spec.setMessageReaction!({
              candidate,
              dependencies,
              idempotencyKey,
              reaction: input.reaction,
              targetMessageId: input.targetMessageId,
            })

            return assistantChannelDeliverySchema.parse({
              kind: 'message-reaction',
              channel: spec.channel,
              idempotencyKey,
              reaction: input.reaction,
              sentAt: new Date().toISOString(),
              target: readDeliveredTarget(delivered) ?? candidate.target,
              targetKind: readDeliveredTargetKind(delivered) ?? candidate.kind,
              targetMessageId:
                readDeliveredTargetMessageId(delivered) ??
                input.targetMessageId,
            })
          },
        }
      : {}),
  }
}

export function supportsAssistantResponseMediaKind(input: {
  kind: AssistantResponseMediaKind
  supportedKinds: readonly AssistantResponseMediaKind[]
}): boolean {
  return input.supportedKinds.includes(input.kind)
}

export function assertSupportedResponseMediaKinds(input: {
  channel: string
  media: readonly AssistantResponseMedia[]
  supportedKinds: readonly AssistantResponseMediaKind[]
}): void {
  if (input.media.length === 0) {
    return
  }

  const unsupported = input.media.find((item) =>
    !supportsAssistantResponseMediaKind({
      kind: item.kind,
      supportedKinds: input.supportedKinds,
    }))
  if (!unsupported) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_CHANNEL_MEDIA_UNSUPPORTED',
    `Outbound ${unsupported.kind} media delivery is not supported for ${input.channel}.`,
  )
}

function isAssistantChannelActivityHandle(
  value: unknown,
): value is AssistantChannelActivityHandle {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'stop' in value &&
      typeof (value as { stop?: unknown }).stop === 'function',
  )
}

export function resolveRequiredDeliveryCandidate(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    explicitTarget: string | null
  },
  message: string,
): AssistantDeliveryCandidate {
  const candidate = resolveDeliveryCandidates(input)[0] ?? null
  if (candidate) {
    return candidate
  }

  throw new VaultCliError(
    'ASSISTANT_CHANNEL_TARGET_REQUIRED',
    message,
  )
}

export function resolveDeliveryCandidates(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): AssistantDeliveryCandidate[] {
  const explicitTarget = normalizeOptionalText(input.explicitTarget)
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

export function normalizeAssistantDeliverySubject(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  channel?: string | null
  explicitTarget?: string | null
  subject?: string | null
}): string | null {
  const subject = normalizeOptionalText(input.subject)
  if (!subject) {
    return null
  }

  const channel = normalizeOptionalText(input.channel)
  if (channel !== 'email') {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_SUBJECT_UNSUPPORTED',
      `Only email delivery supports a subject override. Received subject for ${channel ?? 'unknown channel'}.`,
    )
  }

  if (selectedAssistantEmailDeliveryIsThreadReply({
    bindingDelivery: input.bindingDelivery,
    explicitTarget: input.explicitTarget,
  })) {
    const candidate = resolveDeliveryCandidates({
      bindingDelivery: input.bindingDelivery,
      explicitTarget: input.explicitTarget,
    })[0] ?? null
    throw new VaultCliError(
      'ASSISTANT_EMAIL_THREAD_SUBJECT_UNSUPPORTED',
      'Email thread replies preserve the existing subject. Do not provide a subject override when replying to a thread.',
      candidate ? { threadId: candidate.target } : undefined,
    )
  }

  return subject
}

export function selectedAssistantEmailDeliveryIsThreadReply(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): boolean {
  return isEmailThreadDeliveryCandidate(
    resolveDeliveryCandidates(input)[0] ?? null,
  )
}

function isEmailThreadDeliveryCandidate(candidate: AssistantDeliveryCandidate | null): boolean {
  return (
    candidate?.kind === 'thread' ||
    (
      candidate?.kind === 'explicit' &&
      parseHostedEmailThreadTarget(candidate.target) !== null
    )
  )
}

export function createAssistantBindingDelivery(
  kind: AssistantBindingDelivery['kind'],
  target: string,
): AssistantBindingDelivery {
  return assistantBindingDeliverySchema.parse({
    kind,
    target,
  })
}

function assistantBindingDeliveryFromGatewayReply(
  reply: GatewayResolvedReplyRoute | null,
): AssistantBindingDelivery | null {
  if (!reply) {
    return null
  }

  return createAssistantBindingDelivery(reply.kind, reply.target)
}

export function inferBindingDeliveryForChannel(input: {
  channel?: string | null
  conversation: ConversationRef
  deliveryKind?: AssistantBindingDeliveryKind | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  return assistantBindingDeliveryFromGatewayReply(
    inferGatewayReplyRouteForChannel({
      channel: input.channel ?? input.conversation.channel ?? null,
      conversation: {
        directness: input.conversation.directness,
        participantId: input.conversation.participantId,
        threadId: input.conversation.threadId,
      },
      deliveryKind: input.deliveryKind ?? null,
      deliveryTarget: input.deliveryTarget ?? null,
    }),
  )
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null
}

export function readDeliveredTarget(
  delivered?: unknown,
): string | null {
  return delivered && typeof delivered === 'object'
    && 'target' in delivered
    ? normalizeOptionalText((delivered as { target?: string | null }).target)
    : null
}

export function readDeliveredIdempotencyKey(delivered: unknown): string | null {
  return delivered && typeof delivered === 'object'
    && 'idempotencyKey' in delivered
    && typeof delivered.idempotencyKey === 'string'
    ? normalizeOptionalText(delivered.idempotencyKey)
    : null
}

export function readDeliveredTargetKind(
  delivered: unknown,
): AssistantDeliveryCandidate['kind'] | null {
  if (!delivered || typeof delivered !== 'object') {
    return null
  }

  const targetKind = 'targetKind' in delivered
    ? (delivered as { targetKind?: unknown }).targetKind
    : null
  const value = typeof targetKind === 'string'
    ? normalizeOptionalText(targetKind)
    : null
  if (value === 'explicit' || value === 'participant' || value === 'thread') {
    return value
  }

  return null
}

export function readDeliveredProviderMessageId(
  delivered:
    | {
        providerMessageId?: string | null
      }
    | void,
): string | null {
  return delivered && typeof delivered === 'object'
    ? normalizeOptionalText(delivered.providerMessageId)
    : null
}

export function readDeliveredProviderMessageIds(
  delivered: unknown,
): string[] | null {
  if (
    !delivered ||
    typeof delivered !== 'object' ||
    !('providerMessageIds' in delivered) ||
    !Array.isArray(delivered.providerMessageIds)
  ) {
    return null
  }

  const ids = delivered.providerMessageIds
    .map((value) => normalizeOptionalText(value))
    .filter((value): value is string => value !== null)

  return ids.length > 0 ? ids : null
}

export function readDeliveredProviderMessageEffects(
  delivered: unknown,
): AssistantProviderMessageEffect[] | null {
  if (
    !delivered ||
    typeof delivered !== 'object' ||
    !('providerMessageEffects' in delivered) ||
    !Array.isArray(delivered.providerMessageEffects)
  ) {
    return null
  }

  const parsed = assistantProviderMessageEffectSchema
    .array()
    .min(1)
    .safeParse(delivered.providerMessageEffects)
  return parsed.success ? parsed.data : null
}

export function readDeliveredCleanupTargetAliases(
  delivered: unknown,
): string[] | null {
  if (
    !delivered ||
    typeof delivered !== 'object' ||
    !('cleanupTargetAliases' in delivered) ||
    !Array.isArray(delivered.cleanupTargetAliases)
  ) {
    return null
  }

  const cleanupTargetAliases = delivered.cleanupTargetAliases
  const aliases = Array.from(
    new Set(
      cleanupTargetAliases
        .map((value: unknown) => typeof value === 'string' ? normalizeOptionalText(value) : null)
        .filter((value): value is string => value !== null),
    ),
  )

  return aliases.length > 0 ? aliases : null
}

export function readDeliveredCleanupMessages(
  delivered: unknown,
): Array<{ messageId: string; target: string }> | null {
  if (
    !delivered ||
    typeof delivered !== 'object' ||
    !('cleanupMessages' in delivered) ||
    !Array.isArray(delivered.cleanupMessages)
  ) {
    return null
  }

  const cleanupMessages = Array.from(
    new Map(
      delivered.cleanupMessages.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== 'object') {
          return []
        }

        const messageId = 'messageId' in entry && typeof entry.messageId === 'string'
          ? normalizeOptionalText(entry.messageId)
          : null
        const target = 'target' in entry && typeof entry.target === 'string'
          ? normalizeOptionalText(entry.target)
          : null
        if (!messageId || !target) {
          return []
        }

        return [[`${target}\u0000${messageId}`, { messageId, target }] as const]
      }),
    ).values(),
  )

  return cleanupMessages.length > 0 ? cleanupMessages : null
}

export function readDeliveredProviderThreadId(
  delivered:
    | {
        providerThreadId?: string | null
      }
    | void,
): string | null {
  return delivered && typeof delivered === 'object'
    ? normalizeOptionalText(delivered.providerThreadId)
    : null
}

export function readDeliveredTargetMessageId(delivered: unknown): string | null {
  if (!delivered || typeof delivered !== 'object') {
    return null
  }

  const targetMessageId = 'targetMessageId' in delivered
    ? (delivered as { targetMessageId?: unknown }).targetMessageId
    : null
  return typeof targetMessageId === 'string'
    ? normalizeOptionalText(targetMessageId)
    : null
}
