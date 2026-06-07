import type {
  AgentmailFetch,
} from '@murphai/operator-config/agentmail-runtime'
import type { LinqFetch } from '@murphai/operator-config/linq-runtime'
import type { TelegramFetchImplementation } from '@murphai/operator-config/telegram-runtime'
import type { WhatsAppFetch } from '@murphai/operator-config/whatsapp-runtime'
import {
  assistantChannelDeliverySchema,
  type AssistantBindingDelivery,
  type AssistantBindingDeliveryKind,
  type AssistantChannelDeliveryTargetKind,
  type AssistantDeliverySource,
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { ConversationRef } from '../conversation-ref.js'

export interface AssistantChannelActivityHandle {
  stop: () => Promise<void>
}

export interface TelegramRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: TelegramFetchImplementation
  signal?: AbortSignal
}

export interface EmailRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: AgentmailFetch
}

export interface LinqRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
  refreshMs?: number
  signal?: AbortSignal
}

export interface WhatsAppRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: WhatsAppFetch
  signal?: AbortSignal
}

export interface AssistantChannelDependencies {
  signal?: AbortSignal
  startLinqTyping?: (input: {
    target: string
  }) => Promise<AssistantChannelActivityHandle | void>
  startTelegramTyping?: (input: {
    target: string
  }) => Promise<AssistantChannelActivityHandle | void>
  sendTelegram?: (input: {
    idempotencyKey?: string | null
    message: string
    replyToMessageId?: string | null
    signal?: AbortSignal
    target: string
  }) => Promise<
    | {
        cleanupMessages?: Array<{ messageId: string; target: string }> | null
        cleanupTargetAliases?: string[] | null
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target?: string | null
        targetKind?: AssistantChannelDeliveryTargetKind | null
      }
    | void
  >
  sendLinq?: (input: {
    directRecipientPhoneNumber?: string | null
    fromPhoneNumber?: string | null
    idempotencyKey?: string | null
    media?: readonly AssistantResponseMedia[] | null
    message: string
    replyToMessageId?: string | null
    signal?: AbortSignal
    target: string
    targetKind?: AssistantDeliveryCandidate['kind']
  }) => Promise<
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target?: string | null
        targetKind?: AssistantChannelDeliveryTargetKind | null
      }
    | void
  >
  sendEmail?: (input: {
    idempotencyKey?: string | null
    identityId: string | null
    message: string
    replyToMessageId?: string | null
    subject?: string | null
    target: string
    targetKind: AssistantDeliveryCandidate['kind']
  }) => Promise<
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target: string
      }
    | void
  >
  sendWhatsApp?: (input: {
    message: string
    replyToMessageId?: string | null
    signal?: AbortSignal
    target: string
  }) => Promise<
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target?: string | null
        targetKind?: AssistantChannelDeliveryTargetKind | null
      }
    | void
  >
}

export interface AssistantDeliveryCandidate {
  kind: AssistantChannelDeliveryTargetKind
  target: string
}

export interface AssistantChannelAutoReplyEligibility {
  source: string | null
  threadIsDirect: boolean | null
}

export interface AssistantChannelAdapter {
  channel: 'telegram' | 'linq' | 'email' | 'whatsapp'
  canAutoReply: (input: AssistantChannelAutoReplyEligibility) => string | null
  inferBindingDelivery: (input: {
    conversation: ConversationRef
    deliveryKind?: AssistantBindingDeliveryKind | null
    deliveryTarget?: string | null
  }) => AssistantBindingDelivery | null
  isReadyForSetup: (env: NodeJS.ProcessEnv) => boolean
  startTypingIndicator?: (
    input: {
      bindingDelivery: AssistantBindingDelivery | null
      explicitTarget: string | null
      identityId: string | null
    },
    dependencies: AssistantChannelDependencies,
  ) => Promise<AssistantChannelActivityHandle | null>
  supportsIdempotencyKey: boolean
  send: (
    input: {
      actorId: string | null
      bindingDelivery: AssistantBindingDelivery | null
      deliverySource?: AssistantDeliverySource | null
      explicitTarget: string | null
      idempotencyKey?: string | null
      identityId: string | null
      media?: readonly AssistantResponseMedia[] | null
      message: string
      replyToMessageId?: string | null
      subject?: string | null
    },
    dependencies: AssistantChannelDependencies,
  ) => Promise<ReturnType<typeof assistantChannelDeliverySchema.parse>>
  supportsResponseMedia: boolean
}

export type AssistantChannelName = AssistantChannelAdapter['channel']

export interface AssistantChannelAdapterSpec {
  canAutoReply: AssistantChannelAdapter['canAutoReply']
  channel: AssistantChannelName
  inferBindingDelivery?: AssistantChannelAdapter['inferBindingDelivery']
  isReadyForSetup: AssistantChannelAdapter['isReadyForSetup']
  startTypingIndicator?: (input: {
    candidate: AssistantDeliveryCandidate
    dependencies: AssistantChannelDependencies
    identityId: string | null
  }) => Promise<AssistantChannelActivityHandle | null | void>
  supportsIdempotencyKey: boolean
  sendMessage: (input: {
    actorId: string | null
    candidate: AssistantDeliveryCandidate
    deliverySource?: AssistantDeliverySource | null
    dependencies: AssistantChannelDependencies
    idempotencyKey?: string | null
    identityId: string | null
    media: readonly AssistantResponseMedia[]
    message: string
    replyToMessageId?: string | null
    subject?: string | null
  }) => Promise<
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target?: string | null
        targetKind?: AssistantChannelDeliveryTargetKind | null
      }
    | void
  >
  supportsResponseMedia?: boolean
  targetRequiredMessage: string
}
