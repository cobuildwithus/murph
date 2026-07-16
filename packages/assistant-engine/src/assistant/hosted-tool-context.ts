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
  AssistantHostedActionApprovalPort,
  AssistantHostedAutomationTool,
  AssistantHostedFamilyPlanTool,
  AssistantHostedAssistantConfigurationTool,
  AssistantHostedGroupTool,
  AssistantHostedNewsletterTool,
  AssistantHostedPersonalizationTool,
  AssistantHostedPlanUsageTool,
  AssistantHostedSubscriptionTool,
  AssistantHostedDeviceTool,
  AssistantPhoneCallPort,
} from './execution-context.js'
import {
  resolveAssistantHostedReturnContactKind,
} from './return-contact-kind.js'
import { createAssistantNewsletterOutboxTool } from './newsletter-outbox.js'
import type { AssistantConversationScope } from './conversation-policy.js'

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

export interface AssistantHostedUserActionScope
  extends AssistantHostedToolRequestKeyScope {
  conversationScope: AssistantConversationScope
  originSessionId: string
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
  readonly actionApprovalPort?: AssistantHostedActionApprovalPort | null
  readonly automationTool?: AssistantHostedAutomationTool | null
  readonly assistantConfigurationTool?: AssistantHostedAssistantConfigurationTool | null
  readonly connectedApps?: AssistantConnectedAppsPort | null
  readonly familyPlanTool?: AssistantHostedFamilyPlanTool | null
  readonly deviceTool?: AssistantHostedDeviceTool | null
  readonly groupTool?: AssistantHostedGroupTool | null
  readonly newsletterTool?: AssistantHostedNewsletterTool | null
  readonly personalizationTool?: AssistantHostedPersonalizationTool | null
  readonly planUsageTool?: AssistantHostedPlanUsageTool | null
  readonly subscriptionTool?: AssistantHostedSubscriptionTool | null
  readonly phoneCalls?: AssistantPhoneCallPort | null
  beforeToolExecution?(): Promise<void>
  currentHostedDeliveryContext(): AssistantHostedDeliveryContext | null
  currentAssistantTarget?(): {
    model: string | null
    reasoningEffort: string | null
  }
  currentHostedMailboxItemIds(): readonly string[]
  currentAssistantInputId?(): string | null
  claimSubscriptionAssistantInputId?(): string | null
  currentScheduledAutomationAuthority?(): HostedRuntimeNewsletterScheduledAuthority | null
  closeNewsletterCapability?(): void
  recordNewsletterSendResult?(
    result: Extract<HostedRuntimeNewsletterToolResponse, { action: 'send' }>,
  ): void
  currentUserActionScope?(): AssistantHostedUserActionScope | null
  currentProductFeedbackAcceptedInputIds?(): readonly string[]
  readonly computerToolsAvailable: boolean
  readonly vaultFileSendAvailable: boolean
  sendVaultFile(ref: string): Promise<AssistantHostedVaultFileSendResult>
}

type AssistantHostedToolDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}

export function createAssistantHostedToolContext(input: {
  actionApprovalPort?: AssistantHostedActionApprovalPort | null
  automationTool?: AssistantHostedAutomationTool | null
  assistantConfigurationTool?: AssistantHostedAssistantConfigurationTool | null
  connectedApps?: AssistantConnectedAppsPort | null
  familyPlanTool?: AssistantHostedFamilyPlanTool | null
  deviceTool?: AssistantHostedDeviceTool | null
  groupTool?: AssistantHostedGroupTool | null
  newsletterTool?: AssistantHostedNewsletterTool | null
  personalizationTool?: AssistantHostedPersonalizationTool | null
  planUsageTool?: AssistantHostedPlanUsageTool | null
  subscriptionTool?: AssistantHostedSubscriptionTool | null
  computerToolsAvailable?: boolean
  beforeToolExecution?: () => Promise<void>
  getAssistantInputId?: () => string | null
  getConversationScope?: () => AssistantConversationScope
  getDeliveryContext?: () => AssistantHostedToolDeliveryContext
  getUserActionAcceptedInputIds?: () => readonly string[]
  getProductFeedbackAcceptedInputIds?: () => readonly string[]
  messageInput: AssistantMessageInput
  newsletterOutbox?: {
    turnId: string
    vault: string
  } | null
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
  const newsletterOutboxTool = input.newsletterTool && input.newsletterOutbox
    ? createAssistantNewsletterOutboxTool({
        authority: input.messageInput.scheduledAutomationAuthority ?? null,
        newsletterTool: input.newsletterTool,
        sessionId: input.session.sessionId,
        turnId: input.newsletterOutbox.turnId,
        vault: input.newsletterOutbox.vault,
      })
    : null
  const newsletterTool = newsletterOutboxTool ?? input.newsletterTool ?? null
  const readCurrentUserActionAssistantInputId = () => {
    const currentAssistantInputId = input.getAssistantInputId?.() ?? null
    const userActionAcceptedInputIds =
      input.getUserActionAcceptedInputIds?.() ?? []
    return currentAssistantInputId !== null &&
      userActionAcceptedInputIds.at(-1) === currentAssistantInputId
      ? currentAssistantInputId
      : null
  }
  let subscriptionActionClaimed = false

  return {
    actionApprovalPort: input.actionApprovalPort ?? null,
    automationTool: input.automationTool ?? null,
    assistantConfigurationTool: input.assistantConfigurationTool ?? null,
    connectedApps: input.connectedApps ?? null,
    familyPlanTool: input.familyPlanTool ?? null,
    deviceTool: input.deviceTool ?? null,
    groupTool: input.groupTool ?? null,
    newsletterTool,
    personalizationTool: input.personalizationTool ?? null,
    planUsageTool: input.planUsageTool ?? null,
    subscriptionTool: input.subscriptionTool ?? null,
    phoneCalls: input.phoneCalls ?? null,
    ...(input.beforeToolExecution
      ? { beforeToolExecution: input.beforeToolExecution }
      : {}),
    computerToolsAvailable: input.computerToolsAvailable === true,
    currentAssistantInputId: () => input.getAssistantInputId?.() ?? null,
    claimSubscriptionAssistantInputId: () => {
      if (subscriptionActionClaimed) {
        return null
      }
      const assistantInputId = readCurrentUserActionAssistantInputId()
      if (assistantInputId === null) {
        return null
      }
      subscriptionActionClaimed = true
      return assistantInputId
    },
    currentAssistantTarget: () => {
      const session = readDeliveryContext().session
      return {
        model: session.providerOptions.model ?? null,
        reasoningEffort: session.providerOptions.reasoningEffort ?? null,
      }
    },
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
      return deliveryContext.messageInput.hostedDeliveryIdempotency
        ?.inboundMailboxItemIds ?? []
    },
    currentScheduledAutomationAuthority: () => {
      const deliveryContext = readDeliveryContext()
      return deliveryContext.messageInput.scheduledAutomationAuthority ?? null
    },
    closeNewsletterCapability: newsletterOutboxTool?.closeCapability,
    recordNewsletterSendResult: input.recordNewsletterSendResult,
    currentUserActionScope: () => {
      const acceptedInputIds = input.getUserActionAcceptedInputIds?.() ?? []
      if (acceptedInputIds.length === 0) {
        return null
      }
      const deliveryContext = readDeliveryContext()
      return {
        ...buildRequestKeyScope(acceptedInputIds),
        conversationScope:
          input.getConversationScope?.() ?? 'unverified-external',
        originSessionId: deliveryContext.session.sessionId,
      }
    },
    currentProductFeedbackAcceptedInputIds: () =>
      input.getProductFeedbackAcceptedInputIds?.() ?? [],
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
