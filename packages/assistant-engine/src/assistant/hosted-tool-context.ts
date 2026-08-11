import { createHash } from 'node:crypto'

import type {
  HostedReturnContactKind,
} from '@murphai/hosted-execution/return-contact'
import type {
  HostedRuntimeNewsletterToolResponse,
  HostedRuntimeNewsletterScheduledAuthority,
  HostedRuntimeScheduledAutomationAuthority,
} from '@murphai/hosted-execution/runtime-control'
import {
  HOSTED_ASSISTANT_DEFAULT_PROVIDER,
  HOSTED_ASSISTANT_VENICE_PROVIDER,
} from '@murphai/hosted-execution/assistant-model'
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
  AssistantHostedIMessageContactTool,
  AssistantHostedImageGenerationLauncher,
  AssistantGeneratedImageCapturePersistence,
  AssistantHostedLabsTool,
  AssistantHostedNewsletterTool,
  AssistantHostedPersonalizationTool,
  AssistantHostedPlanUsageTool,
  AssistantPhysicalNotePort,
  AssistantHostedPrivateImageUrlPublisher,
  AssistantHostedSubscriptionTool,
  AssistantHostedDeviceTool,
  AssistantPhoneCallPort,
} from './execution-context.js'
import {
  resolveAssistantHostedReturnContactKind,
} from './return-contact-kind.js'
import { createAssistantNewsletterOutboxTool } from './newsletter-outbox.js'
import type { AssistantConversationScope } from './conversation-policy.js'
import { resolveAssistantAppointmentReminderSourceInputId } from './appointment-reminder-source-ref.js'

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

export interface AssistantHostedScheduledPhoneCallScope
  extends HostedRuntimeScheduledAutomationAuthority {
  originSessionId: string
}

interface AssistantHostedInvocationScopeBase {
  conversationScope: AssistantConversationScope | null
  originSessionId?: string
}

export interface AssistantHostedAcceptedInputInvocationScope
  extends AssistantHostedInvocationScopeBase {
  origin: Extract<
    HostedExecutionAssistantAskOrigin,
    { kind: 'accepted_input' }
  >
}

export interface AssistantHostedScheduledInvocationScope
  extends AssistantHostedInvocationScopeBase {
  origin: Extract<
    HostedExecutionAssistantAskOrigin,
    { kind: 'automation_occurrence' }
  >
}

export type AssistantHostedInvocationScope =
  | AssistantHostedAcceptedInputInvocationScope
  | AssistantHostedScheduledInvocationScope

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
  readonly imessageContactTool?: AssistantHostedIMessageContactTool | null
  readonly labsTool?: AssistantHostedLabsTool | null
  readonly imageGenerationLauncher?: AssistantHostedImageGenerationLauncher | null
  readonly persistGeneratedImageCapture?: AssistantGeneratedImageCapturePersistence | null
  readonly newsletterTool?: AssistantHostedNewsletterTool | null
  readonly personalizationTool?: AssistantHostedPersonalizationTool | null
  readonly planUsageTool?: AssistantHostedPlanUsageTool | null
  readonly physicalNotes?: AssistantPhysicalNotePort | null
  readonly privateImageUrlPublisher?: AssistantHostedPrivateImageUrlPublisher | null
  readonly subscriptionTool?: AssistantHostedSubscriptionTool | null
  readonly phoneCalls?: AssistantPhoneCallPort | null
  beforeToolExecution?(deliveryContextOrdinal: number): Promise<void>
  currentHostedDeliveryContext(): AssistantHostedDeliveryContext | null
  currentAssistantTarget?(): {
    model: string | null
    provider: string | null
    reasoningEffort: string | null
  }
  currentHostedMailboxItemIds(): readonly string[]
  currentAssistantInputId?(): string | null
  claimSubscriptionAssistantInputId?(): string | null
  claimIMessageContactAssistantInputId?(): string | null
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
  currentScheduledPhoneCallScope?(): AssistantHostedScheduledPhoneCallScope | null
  currentUserActionScope?(): AssistantHostedUserActionScope | null
  currentAppointmentReminderSourceInputIds?(): Promise<readonly string[]>
  currentProductFeedbackAcceptedInputIds?(): readonly string[]
  readonly computerToolsAvailable: boolean
  readonly pendingVaultFilesAvailable?: boolean
  readonly vaultFileSendAvailable: boolean
  sendVaultFile(
    ref: string,
    toolCallId?: string | null,
    retireExportPackIds?: readonly string[],
  ): Promise<AssistantHostedVaultFileSendResult>
}

type AssistantHostedToolDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}

export function createAssistantHostedToolContext(input: {
  computerToolsAvailable?: boolean
  executionContext?: AssistantHostedExecutionContext | null
  beforeToolExecution?: (deliveryContextOrdinal: number) => Promise<void>
  getConversationScope?: () => AssistantConversationScope
  getDeliveryContext?: () => AssistantHostedToolDeliveryContext
  getAppointmentReminderSourceInputIds?: () => Promise<readonly string[]>
  getUserActionAcceptedInputIds?: () => readonly string[]
  getProductFeedbackAcceptedInputIds?: () => readonly string[]
  messageInput: AssistantMessageInput
  newsletterOutbox?: {
    turnId: string
    vault: string
  } | null
  pendingVaultFilesAvailable?: boolean
  route?: CodexThreadIdentity | null
  recordNewsletterSendResult?: (
    result: Extract<HostedRuntimeNewsletterToolResponse, { action: 'send' }>,
  ) => void
  recordNewsletterPendingDeliveryIntentId?: (intentId: string) => void
  sendVaultFile?: (
    ref: string,
    toolCallId?: string | null,
    retireExportPackIds?: readonly string[],
  ) => Promise<AssistantHostedVaultFileSendResult>
  session: AssistantSession
}): AssistantHostedToolContext {
  const executionContext = input.executionContext ?? null
  const route = input.route ?? null
  const clinicalRecordsConnectLinkTool =
    executionContext?.clinicalRecordsConnectLinkTool ?? null
  const imageGenerationLauncher =
    executionContext?.imageGenerationLauncher ?? null
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
        recordPendingDeliveryIntentId:
          input.recordNewsletterPendingDeliveryIntentId,
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
  const readCurrentInvocationScope = (): AssistantHostedInvocationScope | null => {
    const userActionScope = readCurrentUserActionScope()
    const assistantInputId = userActionScope?.acceptedInputIds.at(-1) ?? null
    if (
      userActionScope &&
      assistantInputId &&
      userActionScope.conversationScope !== 'unverified-external'
    ) {
      const acceptedInputScope: AssistantHostedAcceptedInputInvocationScope = {
        conversationScope: userActionScope.conversationScope,
        origin: {
          assistantInputId,
          kind: 'accepted_input',
          sessionId: userActionScope.originSessionId,
        },
        originSessionId: userActionScope.originSessionId,
      }
      return acceptedInputScope
    }
    const deliveryContext = readDeliveryContext()
    return resolveAssistantHostedScheduledInvocationScope({
      conversationScope:
        input.getConversationScope?.() ?? 'unverified-external',
      messageInput: deliveryContext.messageInput,
      originSessionId: deliveryContext.session.sessionId,
    })
  }
  const readCurrentScheduledPhoneCallScope = () => {
    const deliveryContext = readDeliveryContext()
    return resolveAssistantHostedScheduledPhoneCallScope({
      channel: deliveryContext.messageInput.channel,
      conversationScope:
        input.getConversationScope?.() ?? 'unverified-external',
      messageInput: deliveryContext.messageInput,
      originSessionId: deliveryContext.session.sessionId,
    })
  }
  let subscriptionActionClaimed = false
  let imessageContactActionClaimed = false
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
            if (clinicalRecordsConnectLinkRequest) {
              return clinicalRecordsConnectLinkRequest
            }
            const request = clinicalRecordsConnectLinkTool.createConnectLink(options)
            clinicalRecordsConnectLinkRequest = request
            void request.catch(() => {
              if (clinicalRecordsConnectLinkRequest === request) {
                clinicalRecordsConnectLinkRequest = null
              }
            })
            return request
          },
        }
      : null,
    familyPlanTool: executionContext?.familyPlanTool ?? null,
    deviceTool: executionContext?.deviceTool ?? null,
    groupPermissionOfferTool:
      executionContext?.groupPermissionOfferTool ?? null,
    groupSharedReader: executionContext?.groupSharedReader ?? null,
    groupTool: executionContext?.groupTool ?? null,
    imessageContactTool: executionContext?.imessageContactTool ?? null,
    labsTool: executionContext?.labsTool ?? null,
    imageGenerationLauncher: imageGenerationLauncher
      ? bindAssistantHostedImageGenerationContinuation({
          launcher: imageGenerationLauncher,
          readContinuationSessionId: () =>
            readDeliveryContext().session.sessionId,
        })
      : null,
    persistGeneratedImageCapture:
      executionContext?.persistGeneratedImageCapture ?? null,
    newsletterTool,
    personalizationTool: executionContext?.personalizationTool ?? null,
    planUsageTool: executionContext?.planUsageTool ?? null,
    physicalNotes: executionContext?.physicalNotes ?? null,
    privateImageUrlPublisher:
      executionContext?.privateImageUrlPublisher ?? null,
    subscriptionTool: executionContext?.subscriptionTool ?? null,
    phoneCalls: executionContext?.phoneCalls ?? null,
    ...(executionContext?.usageRecorder && route
      ? {
          recordDetachedUsage(usageInput) {
            const deliveryContext = readDeliveryContext()
            void recordAssistantUsageEvent({
              effectiveEnv: usageInput.effectiveEnv,
              executionContext: { hosted: executionContext },
              ...(usageInput.usageDraft.occurredAt === undefined
                ? {}
                : { occurredAt: usageInput.usageDraft.occurredAt }),
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
    claimIMessageContactAssistantInputId: () => {
      if (imessageContactActionClaimed) {
        return null
      }
      const assistantInputId = readCurrentUserActionAssistantInputId()
      if (assistantInputId === null) {
        return null
      }
      imessageContactActionClaimed = true
      return assistantInputId
    },
    currentAssistantTarget: () => {
      const session = readDeliveryContext().session
      return {
        model: session.providerOptions.model ?? null,
        provider:
          session.providerOptions.modelProvider === HOSTED_ASSISTANT_VENICE_PROVIDER
            ? HOSTED_ASSISTANT_VENICE_PROVIDER
            : HOSTED_ASSISTANT_DEFAULT_PROVIDER,
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
    currentInvocationScope: readCurrentInvocationScope,
    closeNewsletterCapability: newsletterOutboxTool?.closeCapability,
    recordNewsletterSendResult: input.recordNewsletterSendResult,
    currentScheduledPhoneCallScope: readCurrentScheduledPhoneCallScope,
    currentUserActionScope: readCurrentUserActionScope,
    currentAppointmentReminderSourceInputIds: async () =>
      await input.getAppointmentReminderSourceInputIds?.()
      ?? input.getUserActionAcceptedInputIds?.()
      ?? [],
    currentProductFeedbackAcceptedInputIds: () =>
      input.getProductFeedbackAcceptedInputIds?.() ?? [],
    pendingVaultFilesAvailable: input.pendingVaultFilesAvailable === true,
    sendVaultFile: input.sendVaultFile ?? (async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: typeof input.sendVaultFile === 'function',
  }
}

export function resolveAssistantHostedScheduledInvocationScope(input: {
  conversationScope: AssistantConversationScope
  messageInput: Pick<
    AssistantMessageInput,
    'scheduledInvocationAuthority' | 'scheduledOccurrenceAt' | 'turnTrigger'
  >
  originSessionId: string
}): AssistantHostedScheduledInvocationScope | null {
  const authority = input.messageInput.scheduledInvocationAuthority ?? null
  if (
    input.conversationScope === 'unverified-external'
    || input.messageInput.turnTrigger !== 'automation-cron'
    || authority === null
    || authority.occurrenceAt !== input.messageInput.scheduledOccurrenceAt
  ) {
    return null
  }

  return {
    conversationScope: input.conversationScope,
    origin: {
      automationId: authority.automationId,
      kind: 'automation_occurrence',
      occurrenceAt: authority.occurrenceAt,
    },
    originSessionId: input.originSessionId,
  }
}

export function createAssistantHostedScheduledRequestKey(input: {
  operation: 'clinical-records-connect-link'
  origin: AssistantHostedScheduledInvocationScope['origin']
}): `scheduled_${string}` {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      automationId: input.origin.automationId,
      occurrenceAt: input.origin.occurrenceAt,
      operation: input.operation,
      schema: 'murph.assistant-scheduled-request-key.v1',
    }))
    .digest('hex')
  return `scheduled_${digest}`
}

export function createAssistantHostedAutomationCreateReplayKey(input: {
  sourceInputIds: readonly string[]
  sourceRef: string
}): `automation_create_${string}` | null {
  const acceptedInputId = resolveAssistantAppointmentReminderSourceInputId({
    acceptedInputIds: input.sourceInputIds,
    sourceRef: input.sourceRef,
  })
  if (!acceptedInputId) {
    return null
  }
  const digest = createHash('sha256')
    .update(JSON.stringify({
      acceptedInputId,
      schema: 'murph.automation-create-replay-key.v3',
    }))
    .digest('hex')
  return `automation_create_${digest}`
}

// The host, not the model or tool arguments, owns which durable session an
// asynchronous image completion resumes. Binding it here keeps the caller's
// `scopeId` (pending/queued coordination) and `readStatus` untouched.
function bindAssistantHostedImageGenerationContinuation(input: {
  launcher: AssistantHostedImageGenerationLauncher
  readContinuationSessionId: () => string
}): AssistantHostedImageGenerationLauncher {
  return {
    ...input.launcher,
    launch(request) {
      return input.launcher.launch({
        ...request,
        continuationSessionId: input.readContinuationSessionId(),
      })
    },
  }
}

export function resolveAssistantHostedScheduledPhoneCallScope(input: {
  channel: AssistantMessageInput['channel']
  conversationScope: AssistantConversationScope
  messageInput: Pick<
    AssistantMessageInput,
    'scheduledInvocationAuthority' | 'scheduledOccurrenceAt' | 'turnTrigger'
  >
  originSessionId: string
}): AssistantHostedScheduledPhoneCallScope | null {
  const scope = resolveAssistantHostedScheduledInvocationScope(input)
  if (
    input.channel?.trim().toLowerCase() !== 'linq'
    || scope?.conversationScope !== 'direct'
  ) {
    return null
  }

  return {
    automationId: scope.origin.automationId,
    occurrenceAt: scope.origin.occurrenceAt,
    originSessionId: scope.originSessionId ?? input.originSessionId,
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
