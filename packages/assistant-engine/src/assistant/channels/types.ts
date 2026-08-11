import type {
  AgentmailFetch,
} from '@murphai/operator-config/agentmail-runtime'
import type { LinqFetch } from '@murphai/operator-config/linq-runtime'
import type {
  AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import type { TelegramFetchImplementation } from '@murphai/operator-config/telegram-runtime'
import {
  assistantChannelDeliverySchema,
  type AssistantBindingDelivery,
  type AssistantBindingDeliveryKind,
  type AssistantChannelDeliveryTargetKind,
  type AssistantDeliverySource,
  type AssistantMessageReaction,
  type AssistantProviderMessageEffect,
  type AssistantResponseMedia,
  type AssistantResponseMediaKind,
  type AssistantVaultImageResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { ConversationRef } from '../conversation-ref.js'

type AssistantImageResponseMedia = Extract<
  AssistantResponseMedia,
  { kind: 'image' | 'vault_image' }
>
type AssistantVaultFileResponseMedia = Extract<
  AssistantResponseMedia,
  { kind: 'vault_file' }
>

export interface AssistantChannelActivityStopOptions {
  providerStop?: boolean
}

export interface AssistantChannelActivityHandle {
  refreshAfterMessage?: () => Promise<void>
  refreshNow?: () => Promise<void>
  stop: (options?: AssistantChannelActivityStopOptions) => Promise<void>
}

export interface TelegramRuntimeDependencies {
  authorityBoundTarget?: string | null
  env?: NodeJS.ProcessEnv
  fetchImplementation?: TelegramFetchImplementation
  loadVaultImage?: (
    media: AssistantVaultImageResponseMedia,
  ) => Promise<Uint8Array>
  maxDeliveryAttempts?: number
  signal?: AbortSignal
}

export interface EmailRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: AgentmailFetch
}

export interface AssistantEmailDeliverySummary {
  failedCount: number
  sentCount: number
  skippedCount: number
  status: 'failed' | 'partial_failure' | 'sent'
}

export interface LinqRuntimeDependencies {
  appCardCapabilityFetchImplementation?: LinqFetch
  appCardTextFallbackFetchImplementation?: LinqFetch
  env?: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
  publicFetchImplementation?: LinqFetch
  loadVaultImage?: (
    media: AssistantVaultImageResponseMedia,
  ) => Promise<Uint8Array>
  loadVaultFile?: (
    media: AssistantVaultFileResponseMedia,
  ) => Promise<Uint8Array>
  maxSessionMs?: number
  onAppCardFallbackError?: (input: {
    error: unknown
    reason: 'app_card_rejected' | 'capability_check_failed'
  }) => void
  persistAppCardTextFallback?: (input: {
    idempotencyKey: string
  }) => Promise<void>
  refreshMs?: number
  signal?: AbortSignal
}

export interface AssistantChannelDependencies {
  signal?: AbortSignal
  startLinqTyping?: (input: {
    target: string
    targetKind?: AssistantChannelDeliveryTargetKind | null
    replyToMessageId?: string | null
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
  sendTelegramImage?: (input: {
    idempotencyKey?: string | null
    media: readonly AssistantImageResponseMedia[]
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
  setTelegramMessageReaction?: (input: {
    reaction: AssistantMessageReaction
    signal?: AbortSignal
    target: string
    targetMessageId: string
  }) => Promise<
    | {
        reaction?: AssistantMessageReaction | null
        target?: string | null
        targetKind?: AssistantChannelDeliveryTargetKind | null
        targetMessageId?: string | null
      }
    | void
  >
  setLinqMessageReaction?: (input: {
    reaction: AssistantMessageReaction
    signal?: AbortSignal
    target: string
    targetMessageId: string
  }) => Promise<
    | {
        reaction?: AssistantMessageReaction | null
        target?: string | null
        targetKind?: AssistantChannelDeliveryTargetKind | null
        targetMessageId?: string | null
      }
    | void
  >
  telegramVoiceMemoRuntime?: TelegramRuntimeDependencies
  sendLinq?: (input: {
    acceptedAssistantInputIds?: readonly string[] | null
    answeredMailboxItemIds?: readonly string[] | null
    card?: AssistantResponseCard | null
    directRecipientPhoneNumber?: string | null
    fromPhoneNumber?: string | null
    homeRouteFallbackAllowed?: boolean | null
    idempotencyKey?: string | null
    media?: readonly AssistantResponseMedia[] | null
    message: string
    nativeReplyRequested?: true
    replyToMessageId?: string | null
    signal?: AbortSignal
    target: string
    targetKind?: AssistantDeliveryCandidate['kind']
    threadIsDirect?: boolean | null
    persistAppCardTextFallback?: (input: {
      idempotencyKey: string
    }) => Promise<void>
  }) => Promise<
    | {
        idempotencyKey?: string | null
        providerMessageId?: string | null
        providerMessageEffects?: AssistantProviderMessageEffect[] | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target?: string | null
        targetKind?: AssistantChannelDeliveryTargetKind | null
      }
    | void
  >
  persistLinqAppCardTextFallback?: (input: {
    idempotencyKey: string
  }) => Promise<void>
  sendLinqVoiceMemo?: (input: {
    answeredMailboxItemIds?: readonly string[] | null
    attachmentId: string
    homeRouteFallbackAllowed?: boolean | null
    replyToMessageId?: string | null
    signal?: AbortSignal
    target: string
    targetKind?: AssistantDeliveryCandidate['kind'] | null
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
        delivery?: AssistantEmailDeliverySummary | null
        fanoutRecipientMemberIds?: string[] | null
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target: string
      }
    | void
  >
}

export interface AssistantDeliveryCandidate {
  kind: AssistantChannelDeliveryTargetKind
  target: string
}

export interface AssistantChannelAutoReplyEligibility {
  externalThreadRouteAuthorityPresent?: boolean
  replyTargetThreadId?: string | null
  source: string | null
  threadIsDirect: boolean | null
}

export interface AssistantChannelAdapter {
  channel: 'telegram' | 'linq' | 'email'
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
      replyToMessageId?: string | null
    },
    dependencies: AssistantChannelDependencies,
  ) => Promise<AssistantChannelActivityHandle | null>
  supportsIdempotencyKey: boolean
  send: (
    input: {
      actorId: string | null
      answeredMailboxItemIds?: readonly string[] | null
      bindingDelivery: AssistantBindingDelivery | null
      card?: AssistantResponseCard | null
      deliverySource?: AssistantDeliverySource | null
      explicitTarget: string | null
      idempotencyKey?: string | null
      identityId: string | null
      media?: readonly AssistantResponseMedia[] | null
      message: string
      nativeReplyRequested?: true
      replyToMessageId?: string | null
      subject?: string | null
      threadIsDirect?: boolean | null
    },
    dependencies: AssistantChannelDependencies,
  ) => Promise<ReturnType<typeof assistantChannelDeliverySchema.parse>>
  setMessageReaction?: (
    input: {
      bindingDelivery: AssistantBindingDelivery | null
      explicitTarget: string | null
      idempotencyKey?: string | null
      reaction: AssistantMessageReaction
      targetMessageId: string
    },
    dependencies: AssistantChannelDependencies,
  ) => Promise<ReturnType<typeof assistantChannelDeliverySchema.parse>>
  resolveDeliveryTransportIdempotent: (input: {
    media?: readonly AssistantResponseMedia[] | null
    message: string
  }) => boolean
  supportedResponseMediaKinds: readonly AssistantResponseMediaKind[]
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
    replyToMessageId: string | null
  }) => Promise<AssistantChannelActivityHandle | null | void>
  supportsIdempotencyKey: boolean
  resolveDeliveryTransportIdempotent?: (input: {
    media: readonly AssistantResponseMedia[]
    message: string
  }) => boolean
  sendMessage: (input: {
    actorId: string | null
    answeredMailboxItemIds?: readonly string[] | null
    bindingDelivery: AssistantBindingDelivery | null
    candidate: AssistantDeliveryCandidate
    card: AssistantResponseCard | null
    deliverySource?: AssistantDeliverySource | null
    dependencies: AssistantChannelDependencies
    explicitTarget: string | null
    idempotencyKey?: string | null
    identityId: string | null
    media: readonly AssistantResponseMedia[]
    message: string
    nativeReplyRequested?: true
    replyToMessageId?: string | null
    subject?: string | null
    threadIsDirect: boolean | null
  }) => Promise<
    | {
        providerMessageId?: string | null
        providerMessageEffects?: AssistantProviderMessageEffect[] | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target?: string | null
        targetKind?: AssistantChannelDeliveryTargetKind | null
      }
    | void
  >
  setMessageReaction?: (input: {
    candidate: AssistantDeliveryCandidate
    dependencies: AssistantChannelDependencies
    idempotencyKey?: string | null
    reaction: AssistantMessageReaction
    targetMessageId: string
  }) => Promise<
    | {
        reaction?: AssistantMessageReaction | null
        target?: string | null
        targetKind?: AssistantChannelDeliveryTargetKind | null
        targetMessageId?: string | null
      }
    | void
  >
  supportedResponseMediaKinds: readonly AssistantResponseMediaKind[]
  targetRequiredMessage: string
}
