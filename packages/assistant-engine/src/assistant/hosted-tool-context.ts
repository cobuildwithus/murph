import type {
  HostedReturnContactKind,
} from '@murphai/hosted-execution/return-contact'
import type {
  HostedRuntimeNewsletterToolResponse,
  HostedRuntimeNewsletterScheduledAuthority,
} from '@murphai/hosted-execution/runtime-control'
import type {
  HostedExecutionAssistantAskOrigin,
} from '@murphai/hosted-execution/contracts'
import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

import type { CodexThreadIdentity } from './codex-thread-route.js'
import type { AssistantProviderUsageDraft } from './providers/types.js'
import { recordAssistantUsageEvent } from './service-usage.js'
import type {
  AssistantMessageInput,
} from './service-contracts.js'
import type {
  AssistantConnectedAppsPort,
} from './connected-apps-port.js'
import type {
  AssistantHostedActionApprovalPort,
  AssistantHostedAutomationTool,
  AssistantHostedExecutionContext,
  AssistantHostedFamilyPlanTool,
  AssistantHostedAssistantConfigurationTool,
  AssistantHostedClinicalRecordsConnectLinkTool,
  AssistantHostedGroupPermissionOfferTool,
  AssistantHostedGroupSharedReader,
  AssistantHostedGroupTool,
  AssistantHostedImageGenerationLauncher,
  AssistantHostedLabsTool,
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

export interface AssistantHostedInvocationScope {
  conversationScope: AssistantConversationScope | null
  origin: HostedExecutionAssistantAskOrigin
}

export type AssistantHostedVaultFileSendResult =
  | {
      approvalUrl: string
      filename: string
      status: 'pending'
    }
  | {
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
  readonly clinicalRecordsConnectLinkTool?: AssistantHostedClinicalRecordsConnectLinkTool | null
  readonly familyPlanTool?: AssistantHostedFamilyPlanTool | null
  readonly deviceTool?: AssistantHostedDeviceTool | null
  readonly groupPermissionOfferTool?: AssistantHostedGroupPermissionOfferTool | null
  readonly groupSharedReader?: AssistantHostedGroupSharedReader | null
  readonly groupTool?: AssistantHostedGroupTool | null
  readonly labsTool?: AssistantHostedLabsTool | null
  readonly imageGenerationLauncher?: AssistantHostedImageGenerationLauncher | null
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
  currentInvocationScope?(): AssistantHostedInvocationScope | null
  closeNewsletterCapability?(): void
  recordNewsletterSendResult?(
    result: Extract<HostedRuntimeNewsletterToolResponse, { action: 'send' }>,
  ): void
  recordDetachedUsage?(input: {
    effectiveEnv: Readonly<Record<string, string | undefined>>
    operationId: string
    originAssistantInputId: string
    usageDraft: AssistantProviderUsageDraft
  }): void
  currentUserActionScope?(): AssistantHostedUserActionScope | null
  currentProductFeedbackAcceptedInputIds?(): readonly string[]
  readonly computerToolsAvailable: boolean
  readonly vaultFileSendAvailable: boolean
  sendVaultFile(
    ref: string,
    toolCallId?: string | null,
  ): Promise<AssistantHostedVaultFileSendResult>
}

type AssistantHostedToolDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}

export function createAssistantHostedToolContext(input: {
  computerToolsAvailable?: boolean
  executionContext?: AssistantHostedExecutionContext | null
  beforeToolExecution?: () => Promise<void>
  getConversationScope?: () => AssistantConversationScope
  getDeliveryContext?: () => AssistantHostedToolDeliveryContext
  getUserActionAcceptedInputIds?: () => readonly string[]
  getProductFeedbackAcceptedInputIds?: () => readonly string[]
  messageInput: AssistantMessageInput
  newsletterOutbox?: {
    turnId: string
    vault: string
  } | null
  route?: CodexThreadIdentity | null
  recordNewsletterSendResult?: (
    result: Extract<HostedRuntimeNewsletterToolResponse, { action: 'send' }>,
  ) => void
  sendVaultFile?: (
    ref: string,
    toolCallId?: string | null,
  ) => Promise<AssistantHostedVaultFileSendResult>
  session: AssistantSession
}): AssistantHostedToolContext {
  const executionContext = input.executionContext ?? null
  const route = input.route ?? null
  const clinicalRecordsConnectLinkTool =
    executionContext?.clinicalRecordsConnectLinkTool ?? null
  const newsletterPort = input.messageInput.scheduledAutomationAuthority
    ? executionContext?.newsletterTool ?? null
    : null
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
  const newsletterOutboxTool = newsletterPort && input.newsletterOutbox
    ? createAssistantNewsletterOutboxTool({
        automationAuthority: input.messageInput.outboxAutomationAuthority ?? null,
        authority: input.messageInput.scheduledAutomationAuthority ?? null,
        newsletterTool: newsletterPort,
        sessionId: input.session.sessionId,
        turnId: input.newsletterOutbox.turnId,
        vault: input.newsletterOutbox.vault,
      })
    : null
  const newsletterTool = newsletterOutboxTool ?? newsletterPort
  const readCurrentUserActionAssistantInputId = () => {
    const currentAssistantInputId =
      executionContext?.currentAssistantInputId?.() ?? null
    const userActionAcceptedInputIds =
      input.getUserActionAcceptedInputIds?.() ?? []
    return currentAssistantInputId !== null &&
      userActionAcceptedInputIds.at(-1) === currentAssistantInputId
      ? currentAssistantInputId
      : null
  }
  const readCurrentUserActionScope = (): AssistantHostedUserActionScope | null => {
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
  }
  let subscriptionActionClaimed = false
  let clinicalRecordsConnectLinkRequest: ReturnType<
    AssistantHostedClinicalRecordsConnectLinkTool['createConnectLink']
  > | null = null

  return {
    actionApprovalPort: executionContext?.actionApprovalPort ?? null,
    automationTool: executionContext?.automationTool ?? null,
    assistantConfigurationTool:
      executionContext?.assistantConfigurationTool ?? null,
    connectedApps: executionContext?.connectedApps ?? null,
    clinicalRecordsConnectLinkTool: clinicalRecordsConnectLinkTool
      ? {
          createConnectLink: (options) => {
            clinicalRecordsConnectLinkRequest ??=
              clinicalRecordsConnectLinkTool.createConnectLink(options)
            return clinicalRecordsConnectLinkRequest
          },
        }
      : null,
    familyPlanTool: executionContext?.familyPlanTool ?? null,
    deviceTool: executionContext?.deviceTool ?? null,
    groupPermissionOfferTool:
      executionContext?.groupPermissionOfferTool ?? null,
    groupSharedReader: executionContext?.groupSharedReader ?? null,
    groupTool: executionContext?.groupTool ?? null,
    labsTool: executionContext?.labsTool ?? null,
    imageGenerationLauncher: executionContext?.imageGenerationLauncher ?? null,
    newsletterTool,
    personalizationTool: executionContext?.personalizationTool ?? null,
    planUsageTool: executionContext?.planUsageTool ?? null,
    subscriptionTool: executionContext?.subscriptionTool ?? null,
    phoneCalls: executionContext?.phoneCalls ?? null,
    ...(executionContext?.usageRecorder && route
      ? {
          recordDetachedUsage(usageInput) {
            const deliveryContext = readDeliveryContext()
            void recordAssistantUsageEvent({
              effectiveEnv: usageInput.effectiveEnv,
              executionContext: { hosted: executionContext },
              providerRequestAcceptedInputIds: [
                usageInput.originAssistantInputId,
              ],
              providerRequestOrdinal:
                usageInput.usageDraft.providerRequestOrdinal,
              providerRequestOutcome:
                usageInput.usageDraft.providerRequestOutcome,
              providerResult: {
                attemptCount: 1,
                provider: usageInput.usageDraft.provider,
                providerOptions: route.providerOptions,
                route,
                session: deliveryContext.session,
                usage: usageInput.usageDraft.usage,
              },
              turnId: usageInput.operationId,
            })
          },
        }
      : {}),
    ...(input.beforeToolExecution
      ? { beforeToolExecution: input.beforeToolExecution }
      : {}),
    computerToolsAvailable: input.computerToolsAvailable === true,
    currentAssistantInputId: () =>
      executionContext?.currentAssistantInputId?.() ?? null,
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
    currentInvocationScope: () => {
      const userActionScope = readCurrentUserActionScope()
      const assistantInputId = userActionScope?.acceptedInputIds.at(-1) ?? null
      if (userActionScope && assistantInputId) {
        return {
          conversationScope: userActionScope.conversationScope,
          origin: {
            assistantInputId,
            kind: 'accepted_input',
            sessionId: userActionScope.originSessionId,
          },
        }
      }
      const authority =
        readDeliveryContext().messageInput.scheduledInvocationAuthority ?? null
      return authority
        ? {
            conversationScope: null,
            origin: {
              automationId: authority.automationId,
              kind: 'automation_occurrence',
              occurrenceAt: authority.occurrenceAt,
            },
          }
        : null
    },
    closeNewsletterCapability: newsletterOutboxTool?.closeCapability,
    recordNewsletterSendResult: input.recordNewsletterSendResult,
    currentUserActionScope: readCurrentUserActionScope,
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
