import type {
  HostedReturnContactKind,
} from '@murphai/hosted-execution/return-contact'
import type {
  HostedRuntimeNewsletterToolResponse,
  HostedRuntimeNewsletterScheduledAuthority,
} from '@murphai/hosted-execution/runtime-control'
import type {
  AssistantSession,
  AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'

import type {
  AssistantMessageInput,
} from './service-contracts.js'
import type {
  AssistantConnectedAppsPort,
} from './connected-apps-port.js'
import type {
  AssistantHostedFamilyPlanTool,
  AssistantHostedGroupTool,
  AssistantHostedNewsletterTool,
  AssistantCallCirclePort,
  AssistantPhoneCallPort,
} from './execution-context.js'
import {
  resolveAssistantHostedReturnContactKind,
} from './return-contact-kind.js'

export interface AssistantHostedDeliveryContext {
  conversationId: string | null
  recipientKey: string | null
  returnContactKind: HostedReturnContactKind | null
}

export interface AssistantHostedToolRequestKeyScope {
  acceptedInputIds: readonly string[]
  conversationId: string | null
  inboundMailboxItemIds: readonly string[]
  recipientKey: string | null
}

export type AssistantHostedVaultFileSendResult =
  | {
      approvalUrl: string
      filename: string
      status: 'pending'
    }
  | {
      file: AssistantVaultFileResponseMedia
      filename: string
      status: 'approved'
    }
  | {
      filename: string
      status: 'denied' | 'expired'
    }

export interface AssistantHostedToolContext {
  readonly callCircle?: AssistantCallCirclePort | null
  readonly connectedApps?: AssistantConnectedAppsPort | null
  readonly familyPlanTool?: AssistantHostedFamilyPlanTool | null
  readonly groupTool?: AssistantHostedGroupTool | null
  readonly newsletterTool?: AssistantHostedNewsletterTool | null
  readonly phoneCalls?: AssistantPhoneCallPort | null
  currentHostedDeliveryContext(): AssistantHostedDeliveryContext | null
  currentHostedMailboxItemIds(): readonly string[]
  currentScheduledAutomationAuthority?(): HostedRuntimeNewsletterScheduledAuthority | null
  recordNewsletterSendResult?(
    result: Extract<HostedRuntimeNewsletterToolResponse, { action: 'send' }>,
  ): void
  currentPhoneCallToolRequestKeyScope?(): AssistantHostedToolRequestKeyScope | null
  readonly computerToolsAvailable: boolean
  readonly vaultFileSendAvailable: boolean
  sendVaultFile(ref: string): Promise<AssistantHostedVaultFileSendResult>
}

type AssistantHostedToolDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}

export function createAssistantHostedToolContext(input: {
  callCircle?: AssistantCallCirclePort | null
  connectedApps?: AssistantConnectedAppsPort | null
  familyPlanTool?: AssistantHostedFamilyPlanTool | null
  groupTool?: AssistantHostedGroupTool | null
  newsletterTool?: AssistantHostedNewsletterTool | null
  computerToolsAvailable?: boolean
  getDeliveryContext?: () => AssistantHostedToolDeliveryContext
  getPhoneCallAcceptedInputIds?: () => readonly string[]
  messageInput: AssistantMessageInput
  phoneCalls?: AssistantPhoneCallPort | null
  recordNewsletterSendResult?: (
    result: Extract<HostedRuntimeNewsletterToolResponse, { action: 'send' }>,
  ) => void
  sendVaultFile?: (ref: string) => Promise<AssistantHostedVaultFileSendResult>
  session: AssistantSession
}): AssistantHostedToolContext {
  const readDeliveryContext = () => input.getDeliveryContext?.() ?? {
    messageInput: input.messageInput,
    session: input.session,
  }
  const buildRequestKeyScope = (
    acceptedInputIds: readonly string[],
  ): AssistantHostedToolRequestKeyScope => {
    const deliveryContext = readDeliveryContext()
    const context = deliveryContext.messageInput.hostedDeliveryIdempotency
    return {
      acceptedInputIds: [...acceptedInputIds],
      conversationId: context?.conversationId ?? null,
      inboundMailboxItemIds: context?.inboundMailboxItemIds ?? [],
      recipientKey: context?.recipientKey ?? null,
    }
  }

  return {
    callCircle: input.callCircle ?? null,
    connectedApps: input.connectedApps ?? null,
    familyPlanTool: input.familyPlanTool ?? null,
    groupTool: input.groupTool ?? null,
    newsletterTool: input.newsletterTool ?? null,
    phoneCalls: input.phoneCalls ?? null,
    computerToolsAvailable: input.computerToolsAvailable === true,
    currentHostedDeliveryContext: () => {
      const deliveryContext = readDeliveryContext()
      const context = deliveryContext.messageInput.hostedDeliveryIdempotency
      const channel = normalizeHostedDeliveryChannel(
        deliveryContext.messageInput.channel,
      )
      const conversationId = scopeHostedDeliveryContextPart({
        channel,
        value: context?.conversationId ?? null,
      })
      const recipientKey = scopeHostedDeliveryContextPart({
        channel,
        value: context?.recipientKey ?? null,
      })
      if (!conversationId && !recipientKey) {
        return null
      }
      const returnContactKind = resolveAssistantHostedReturnContactKind(
        deliveryContext.messageInput.channel,
      )
      return { conversationId, recipientKey, returnContactKind }
    },
    currentHostedMailboxItemIds: () => {
      const deliveryContext = readDeliveryContext()
      const context = deliveryContext.messageInput.hostedDeliveryIdempotency
      return context?.contextMailboxItemIds
        ?? context?.inboundMailboxItemIds
        ?? []
    },
    currentScheduledAutomationAuthority: () => {
      const deliveryContext = readDeliveryContext()
      return deliveryContext.messageInput.scheduledAutomationAuthority ?? null
    },
    recordNewsletterSendResult: input.recordNewsletterSendResult,
    currentPhoneCallToolRequestKeyScope: () => {
      const acceptedInputIds = input.getPhoneCallAcceptedInputIds?.() ?? []
      return acceptedInputIds.length > 0
        ? buildRequestKeyScope(acceptedInputIds)
        : null
    },
    sendVaultFile: input.sendVaultFile ?? (async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: typeof input.sendVaultFile === 'function',
  }
}

function scopeHostedDeliveryContextPart(input: {
  channel: string | null
  value: string | null | undefined
}): string | null {
  const value = normalizeHostedDeliveryContextValue(input.value)
  if (!value || !input.channel) {
    return value
  }
  if (readScopedHostedDeliveryContextChannel(value) === input.channel) {
    return value
  }
  return JSON.stringify([input.channel, value])
}

function readScopedHostedDeliveryContextChannel(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? normalizeHostedDeliveryChannel(parsed[0])
      : null
  } catch {
    return null
  }
}

function normalizeHostedDeliveryChannel(value: unknown): string | null {
  const normalized = normalizeHostedDeliveryContextValue(value)
  return normalized ? normalized.toLowerCase() : null
}

function normalizeHostedDeliveryContextValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}
