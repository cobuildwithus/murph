import type {
  AgentmailFetch,
} from '../../agentmail-runtime.js'
import type { InboxShowResult } from '../../inbox-cli-contracts.js'
import type { LinqFetch } from '../../linq-runtime.js'
import type {
  AssistantBindingDelivery,
} from '../../assistant-cli-contracts.js'
import {
  assistantChannelDeliverySchema,
} from '../../assistant-cli-contracts.js'
import type { ConversationRef } from '../conversation-ref.js'

export interface ImessageSdkLike {
  close?: () => Promise<void> | void
  send?: (target: string, content: string) => Promise<unknown>
}

export interface ImessageRuntimeDependencies {
  createSdk?: () => ImessageSdkLike
  homeDirectory?: string | null
  platform?: NodeJS.Platform
  probeMessagesDb?: (targetPath: string) => Promise<void>
}

export interface FetchLikeResponse {
  json: () => Promise<unknown>
  ok: boolean
  status: number
}

export type FetchLike = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<FetchLikeResponse>

export interface TelegramRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: FetchLike
}

export interface EmailRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: AgentmailFetch
}

export interface LinqRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
}

export interface AssistantChannelDependencies {
  sendImessage?: (input: {
    idempotencyKey?: string | null
    message: string
    target: string
  }) => Promise<void>
  sendTelegram?: (input: {
    idempotencyKey?: string | null
    message: string
    replyToMessageId?: string | null
    target: string
  }) => Promise<
    | {
        providerMessageId?: string | null
        providerThreadId?: string | null
        target?: string | null
      }
    | void
  >
  sendLinq?: (input: {
    idempotencyKey?: string | null
    message: string
    replyToMessageId?: string | null
    target: string
  }) => Promise<
    | {
        providerMessageId?: string | null
      }
    | void
  >
  sendEmail?: (input: {
    idempotencyKey?: string | null
    identityId: string | null
    message: string
    replyToMessageId?: string | null
    target: string
    targetKind: AssistantDeliveryCandidate['kind']
  }) => Promise<
    | {
        providerMessageId?: string | null
        providerThreadId?: string | null
        target: string
      }
    | void
  >
}

export interface AssistantDeliveryCandidate {
  kind: 'explicit' | 'participant' | 'thread'
  target: string
}

export interface AssistantChannelAdapter {
  channel: 'imessage' | 'telegram' | 'linq' | 'email'
  canAutoReply: (capture: InboxShowResult['capture']) => string | null
  inferBindingDelivery: (input: {
    conversation: ConversationRef
    deliveryKind?: 'participant' | 'thread' | null
    deliveryTarget?: string | null
  }) => AssistantBindingDelivery | null
  isReadyForSetup: (env: NodeJS.ProcessEnv) => boolean
  supportsIdempotencyKey: boolean
  send: (
    input: {
      bindingDelivery: AssistantBindingDelivery | null
      explicitTarget: string | null
      idempotencyKey?: string | null
      identityId: string | null
      message: string
      replyToMessageId?: string | null
    },
    dependencies: AssistantChannelDependencies,
  ) => Promise<ReturnType<typeof assistantChannelDeliverySchema.parse>>
}

export type AssistantChannelName = AssistantChannelAdapter['channel']

export interface AssistantChannelAdapterSpec {
  canAutoReply: AssistantChannelAdapter['canAutoReply']
  channel: AssistantChannelName
  inferBindingDelivery: AssistantChannelAdapter['inferBindingDelivery']
  isReadyForSetup: AssistantChannelAdapter['isReadyForSetup']
  supportsIdempotencyKey: boolean
  sendMessage: (input: {
    candidate: AssistantDeliveryCandidate
    dependencies: AssistantChannelDependencies
    idempotencyKey?: string | null
    identityId: string | null
    message: string
    replyToMessageId?: string | null
  }) => Promise<
    | {
        providerMessageId?: string | null
        providerThreadId?: string | null
        target?: string | null
      }
    | void
  >
  targetRequiredMessage: string
}
