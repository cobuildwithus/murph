import {
  normalizeAssistantBackendTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import type {
  AssistantVaultImageResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantUsageRecord } from '@murphai/hosted-execution/assistant-usage'
import type {
  HostedExecutionExternalThreadRouteAuthority,
} from '@murphai/hosted-execution/contracts'
import type {
  HostedRuntimeLinqDeliveryBlockCode,
  HostedRuntimeLinqDeliveryPosture,
} from '@murphai/hosted-execution/routes'
import type {
  AutomationAssistantTargetOverride,
  AutomationContinuityPolicy,
  AutomationSchedule,
  AutomationStatus,
  AutomationSupportKind,
} from '@murphai/contracts'
import type {
  HostedClinicalRecordsConnectLinkRequest,
  HostedClinicalRecordsConnectLinkResponse,
} from '@murphai/hosted-execution/clinical-records'
import type {
  HostedRuntimeAssistantPersonalizationToolAuthority,
  HostedRuntimeAssistantPersonalizationToolRequest,
  HostedRuntimeAssistantPersonalizationToolResponse,
} from '@murphai/hosted-execution/assistant-personalization'
import type {
  HostedActionApprovalObservation,
  HostedActionApprovalRequest,
  HostedActionApprovalResult,
} from '@murphai/hosted-execution/action-approval'
import type { AssistantRuntimeIssueInput } from './issue-reporting.js'
import type {
  HostedRuntimeProductFeedbackRecord,
  HostedRuntimeFamilyPlanToolRequest,
  HostedRuntimeFamilyPlanToolResponse,
  HostedRuntimeIMessageContactToolRequest,
  HostedRuntimeIMessageContactToolResponse,
  HostedRuntimeAssistantConfigurationControlRequest,
  HostedRuntimeAssistantConfigurationToolResponse,
  HostedRuntimeGroupParticipantDisplayName,
  HostedRuntimeGroupParticipantDisplayNameSource,
  HostedRuntimeGroupSharedMember,
  HostedRuntimeGroupSharedProjection,
  HostedRuntimeGroupSharedReadRequest,
  HostedRuntimeGroupSharedReadResult,
  HostedRuntimeGroupSharedRecord,
  HostedRuntimeGroupToolRequest,
  HostedRuntimeGroupToolResponse,
  HostedRuntimeNewsletterToolRequest,
  HostedRuntimeNewsletterToolResponse,
} from '@murphai/hosted-execution/runtime-control'
import type {
  HostedPhoneCallStartRequest,
  HostedPhoneCallStartResponse,
} from '@murphai/hosted-execution/phone-calls'
import type {
  HostedPhysicalNoteSendRequest,
  HostedPhysicalNoteSendResponse,
} from '@murphai/hosted-execution/physical-notes'
import type {
  HostedPlanUsageStatus,
  HostedPlanUsageToolRequest,
} from '@murphai/hosted-execution/plan-usage'
import type {
  HostedVaultShareSelectableProjectionScope,
} from '@murphai/hosted-execution/vault-share'
import type {
  HostedRuntimeLabsToolRequest,
  HostedRuntimeLabsToolResponse,
} from '@murphai/hosted-execution/labs'
import type {
  HostedRuntimeSubscriptionControlRequest,
  HostedRuntimeSubscriptionToolResponse,
} from '@murphai/hosted-execution/subscription'
import type { AssistantChannelDependencies } from './channel-adapters.js'
import type { AssistantConnectedAppsPort } from './connected-apps-port.js'
import { normalizeNullableString } from './shared.js'

export type AssistantChannelTypingDependencies = Pick<
  AssistantChannelDependencies,
  'startLinqTyping' | 'startTelegramTyping'
>

export type AssistantHostedProgressDeliveryDependencies = Pick<
  AssistantChannelDependencies,
  'sendTelegram' | 'sendTelegramImage' | 'sendLinq' | 'sendLinqVoiceMemo' | 'sendEmail' | 'signal'
>

export interface AssistantHostedDeviceConnectLink {
  authorizationUrl: string
  connectUrl: string
  expiresAt: string
  provider: string
  providerLabel: string
}

export interface AssistantHostedDeviceConnectProvider {
  label: string
  provider: string
}

export type AssistantHostedDeviceToolRequest =
  | {
      action: 'list_accounts'
      provider?: string | null
      sourceProvider?: string | null
    }
  | {
      action: 'connect'
      provider: string
    }
  | {
      accountId: string
      action: 'reconcile'
    }

export interface AssistantHostedDeviceAccountSummary {
  accountId: string
  displayName: string | null
  lastErrorCode: string | null
  lastSyncCompletedAt: string | null
  provider: string
  status: 'active' | 'disconnected' | 'reauthorization_required'
}

export type AssistantHostedDeviceToolResponse =
  | {
      accounts: readonly AssistantHostedDeviceAccountSummary[]
      action: 'list_accounts'
      provider: string | null
      sourceProvider: string | null
    }
  | {
      action: 'connect'
      link: AssistantHostedDeviceConnectLink
    }
  | {
      accountId: string
      action: 'reconcile'
      occurredAt: string
      status: 'queued'
    }

export interface AssistantHostedDeviceTool {
  request(
    request: AssistantHostedDeviceToolRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<AssistantHostedDeviceToolResponse>
}

export interface AssistantHostedLabsTool {
  request(
    request: HostedRuntimeLabsToolRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedRuntimeLabsToolResponse>
}

export type AssistantHostedAutomationToolRequest =
  | {
      action: 'save'
      activeUntil?: string | null
      assistantTargetOverride?: AutomationAssistantTargetOverride | null
      automationId?: string
      continuityPolicy?: AutomationContinuityPolicy
      instructions: string
      schedule: AutomationSchedule
      slug?: string
      status?: AutomationStatus
      summary?: string | null
      supportKind?: AutomationSupportKind | null
      supportSeriesId?: string
      tags?: readonly string[]
      title: string
    }
  | {
      action: 'patch'
      activeUntil?: string | null
      assistantTargetOverride?: AutomationAssistantTargetOverride | null
      continuityPolicy?: AutomationContinuityPolicy
      instructions?: string
      lookup: string
      retargetToCurrentConversation?: boolean
      schedule?: AutomationSchedule
      slug?: string
      status?: AutomationStatus
      summary?: string | null
      supportKind?: AutomationSupportKind | null
      supportSeriesId?: string
      tags?: readonly string[]
      title?: string
    }
  | {
      action: 'reconcile'
      desiredAutomationIds: readonly string[]
      supportSeriesId: string
    }

export type AssistantHostedAutomationToolResponse =
  | {
      action: 'patch' | 'save'
      automationId: string
      created: boolean
      effectiveTimeZone: string | null
      lookupId: string
      nextRunAt: string | null
      routeBinding: 'current_conversation' | 'preserved'
      schedule: AutomationSchedule
      status: AutomationStatus
      timingVerified: boolean
    }
  | {
      action: 'reconcile'
      archivedCount: number
      matchedCount: number
      missingDesiredAutomationIds: readonly string[]
      supportSeriesId: string
      unchangedCount: number
    }

export interface AssistantHostedAutomationTool {
  request(
    request: AssistantHostedAutomationToolRequest,
    context?: {
      onboardingFirstReadCompletionTransition?: true
      signal?: AbortSignal | null
    },
  ): Promise<AssistantHostedAutomationToolResponse>
}

export interface AssistantUsageRecorder {
  recordUsage(
    record: AssistantUsageRecord,
    providerRequestAcceptedInputIds?: readonly string[],
  ): Promise<void>
}

export interface AssistantHostedActionApprovalPort {
  read(
    input: HostedActionApprovalRequest,
  ): Promise<HostedActionApprovalObservation>
  request(input: HostedActionApprovalRequest): Promise<HostedActionApprovalResult>
}

export interface AssistantHostedProductFeedbackCandidateSink {
  acceptProductFeedbackCandidate(
    feedback: HostedRuntimeProductFeedbackRecord,
  ): void
  deliverProductSupportEscalation?(
    feedback: HostedRuntimeProductFeedbackRecord,
  ): Promise<{ recorded: boolean }>
}

export interface AssistantHostedFamilyPlanTool {
  request(
    request: HostedRuntimeFamilyPlanToolRequest,
  ): Promise<HostedRuntimeFamilyPlanToolResponse>
}

export interface AssistantHostedPlanUsageTool {
  read(request: HostedPlanUsageToolRequest): Promise<HostedPlanUsageStatus>
}

export interface AssistantHostedIMessageContactTool {
  ensure(
    request: HostedRuntimeIMessageContactToolRequest,
  ): Promise<HostedRuntimeIMessageContactToolResponse>
}

export interface AssistantHostedSubscriptionTool {
  request(
    request: HostedRuntimeSubscriptionControlRequest,
  ): Promise<HostedRuntimeSubscriptionToolResponse>
}

export interface AssistantHostedClinicalRecordsConnectLinkTool {
  createConnectLink(
    options?: {
      requestKey?: HostedClinicalRecordsConnectLinkRequest['requestKey']
      signal?: AbortSignal | null
    },
  ): Promise<HostedClinicalRecordsConnectLinkResponse>
}

export interface AssistantHostedPersonalizationTool {
  request(
    request: HostedRuntimeAssistantPersonalizationToolRequest,
    authority?: HostedRuntimeAssistantPersonalizationToolAuthority,
  ): Promise<HostedRuntimeAssistantPersonalizationToolResponse>
}

export interface AssistantHostedAssistantConfigurationTool {
  request(
    request: HostedRuntimeAssistantConfigurationControlRequest,
  ): Promise<HostedRuntimeAssistantConfigurationToolResponse>
}

export interface AssistantHostedGroupTool {
  request(
    request: HostedRuntimeGroupToolRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<HostedRuntimeGroupToolResponse>
  /**
   * Trusted-host answer for whether this turn can deliver an attachment to
   * exactly one direct route, so a deterministically undeliverable request is
   * refused before slow generation work. The model supplies no route
   * authority. An absent implementation admits the request and leaves the
   * existing post-generation route binding as the only gate.
   */
  directAttachmentRouteStatus?():
    | { status: 'ok' }
    | { status: 'unavailable'; unavailableReason: string }
}

export interface AssistantHostedGroupPermissionOfferRequest {
  projectionScopes: readonly HostedVaultShareSelectableProjectionScope[]
}

export interface AssistantHostedGroupPermissionOfferTool {
  request(
    request: AssistantHostedGroupPermissionOfferRequest,
  ): Promise<
    Extract<
      HostedRuntimeGroupToolResponse,
      { action: 'create_join_link' | 'post_join_offer' }
    >
  >
}

export type AssistantHostedGroupSharedReadRequest =
  HostedRuntimeGroupSharedReadRequest
export type AssistantHostedGroupSharedRecord = HostedRuntimeGroupSharedRecord
export type AssistantHostedGroupSharedProjection =
  HostedRuntimeGroupSharedProjection
export type AssistantHostedGroupSharedMember = HostedRuntimeGroupSharedMember
export type AssistantHostedGroupSharedReadResponse =
  HostedRuntimeGroupSharedReadResult

export type AssistantGroupParticipantDisplayNameSource =
  HostedRuntimeGroupParticipantDisplayNameSource
export type AssistantGroupParticipantDisplayName =
  HostedRuntimeGroupParticipantDisplayName

export interface AssistantHostedGroupParticipantDisplayNameReader {
  read(input: {
    channel: 'linq'
    senderHandles: readonly string[]
  }): Promise<readonly AssistantGroupParticipantDisplayName[]>
}

export interface AssistantHostedGroupSharedReader {
  request(
    request: AssistantHostedGroupSharedReadRequest,
  ): Promise<AssistantHostedGroupSharedReadResponse>
}

export interface AssistantHostedNewsletterTool {
  request(
    request: HostedRuntimeNewsletterToolRequest,
  ): Promise<HostedRuntimeNewsletterToolResponse>
}

export interface AssistantPhoneCallPort {
  start(
    request: HostedPhoneCallStartRequest,
    context?: {
      signal?: AbortSignal | null
    },
  ): Promise<HostedPhoneCallStartResponse>
}

export interface AssistantPhysicalNotePort {
  send(
    request: HostedPhysicalNoteSendRequest,
    context?: {
      signal?: AbortSignal | null
    },
  ): Promise<HostedPhysicalNoteSendResponse>
}

export type AssistantPrivateImageContentType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'

export interface AssistantHostedPrivateImageUrlPublishInput {
  bytes: Uint8Array
  contentType: AssistantPrivateImageContentType
}

export interface AssistantHostedPrivateImageUrlPublisher {
  publishPrivateImageUrl(
    input: AssistantHostedPrivateImageUrlPublishInput,
  ): Promise<{
    expiresAt: string
    url: string
  }>
}

export interface AssistantHostedImageGenerationResult {
  failureDiagnostic?: string | null
  media: AssistantVaultImageResponseMedia | null
  runtimeIssue: AssistantRuntimeIssueInput | null
  savedImageRef: string | null
}

export interface AssistantGeneratedImageCapturePersistenceMetadata {
  retentionWakeAt: string
}

export type AssistantGeneratedImageCapturePersistence = <T>(
  write: () => Promise<T>,
  metadata: AssistantGeneratedImageCapturePersistenceMetadata,
) => Promise<T>

export interface AssistantHostedImageGenerationLauncher {
  launch(input: {
    // The durable assistant session that must receive the asynchronous
    // completion. The host binds it; it is never derived from tool arguments
    // and never doubles as the pending-image coordination scope.
    continuationSessionId?: string | null
    operationId: string
    originAssistantInputId: string
    originAssistantInputIdExact: boolean
    // Pending/queued duplicate prevention and cleanup scope. Unrelated to
    // continuation identity.
    scopeId?: string | null
    run(
      signal: AbortSignal,
      persistCanonicalWrite: <T>(
        write: () => Promise<T>,
        metadata: AssistantGeneratedImageCapturePersistenceMetadata,
      ) => Promise<T>,
    ): Promise<AssistantHostedImageGenerationResult>
  }): 'already-pending' | 'already-started' | 'started'
  readStatus?(scopeId: string): 'pending' | 'queued' | null
}

export interface AssistantWorkspaceArtifactMaterializationResult {
  materializedArtifactPaths: ReadonlySet<string>
  missingArtifactPaths: ReadonlySet<string>
}

export interface AssistantWorkspaceArtifactMaterializationOptions {
  maxFileBytes?: number
}

export type AssistantWorkspaceArtifactMaterializer = (
  relativePaths: readonly string[],
  options?: AssistantWorkspaceArtifactMaterializationOptions,
) => Promise<AssistantWorkspaceArtifactMaterializationResult>

export interface AssistantHostedExecutionContext {
  actionApprovalPort?: AssistantHostedActionApprovalPort | null
  automationTool?: AssistantHostedAutomationTool | null
  currentAssistantInputId?: () => string | null
  createScheduledGroupTools?(input: {
    channel: string
    target: string
    threadIsDirect: boolean
  }): {
    groupPermissionOfferTool?: AssistantHostedGroupPermissionOfferTool
    groupSharedReader: AssistantHostedGroupSharedReader
    groupTool: AssistantHostedGroupTool
  } | null
  assistantConfigurationTool?: AssistantHostedAssistantConfigurationTool | null
  channelTypingDependencies?: AssistantChannelTypingDependencies
  connectedApps?: AssistantConnectedAppsPort | null
  clinicalRecordsConnectLinkTool?: AssistantHostedClinicalRecordsConnectLinkTool | null
  defaultTarget?: AssistantModelTarget | null
  deviceConnectProviders?: readonly AssistantHostedDeviceConnectProvider[]
  deviceTool?: AssistantHostedDeviceTool | null
  familyPlanTool?: AssistantHostedFamilyPlanTool | null
  imessageContactTool?: AssistantHostedIMessageContactTool | null
  personalizationTool?: AssistantHostedPersonalizationTool | null
  groupParticipantDisplayNameReader?: AssistantHostedGroupParticipantDisplayNameReader | null
  groupPermissionOfferTool?: AssistantHostedGroupPermissionOfferTool | null
  groupSharedReader?: AssistantHostedGroupSharedReader | null
  groupTool?: AssistantHostedGroupTool | null
  labsTool?: AssistantHostedLabsTool | null
  newsletterTool?: AssistantHostedNewsletterTool | null
  planUsageTool?: AssistantHostedPlanUsageTool | null
  physicalNotes?: AssistantPhysicalNotePort | null
  privateImageUrlPublisher?: AssistantHostedPrivateImageUrlPublisher | null
  subscriptionTool?: AssistantHostedSubscriptionTool | null
  dynamicContextPrompts?: readonly string[] | null
  imageGenerationLauncher?: AssistantHostedImageGenerationLauncher | null
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  persistGeneratedImageCapture?: AssistantGeneratedImageCapturePersistence | null
  memberId: string
  progressDeliveryDependencies?: AssistantHostedProgressDeliveryDependencies
  productFeedbackCandidateSink?: AssistantHostedProductFeedbackCandidateSink | null
  providerFetch?: typeof fetch | null
  phoneCalls?: AssistantPhoneCallPort | null
  publicInternetFetch?: typeof fetch | null
  resolveScheduledLinqRoute?(input: {
    fromPhoneNumber?: string | null
    homeRouteFallbackAllowed: boolean
    signal?: AbortSignal | null
    target: string
    targetKind: 'explicit' | 'thread'
  }): Promise<{
    conversationThreadId?: string | null
    deliveryBlockCode?: HostedRuntimeLinqDeliveryBlockCode | null
    deliveryPosture?: HostedRuntimeLinqDeliveryPosture | null
    target: string
    threadIsDirect: boolean
  }>
  resolveScheduledExternalThreadRoute?(input: {
    channel: 'telegram'
    signal?: AbortSignal | null
    target: string
  }): Promise<HostedExecutionExternalThreadRouteAuthority>
  usageRecorder?: AssistantUsageRecorder | null
  userEnvKeys: readonly string[]
}

export interface AssistantExecutionContext {
  hosted: AssistantHostedExecutionContext | null
}

export function appendAssistantHostedDynamicContextPrompt(input: {
  executionContext: AssistantExecutionContext
  prompt: string | null
}): AssistantExecutionContext {
  if (!input.prompt || !input.executionContext.hosted) {
    return input.executionContext
  }
  return {
    hosted: {
      ...input.executionContext.hosted,
      dynamicContextPrompts: [
        ...(input.executionContext.hosted.dynamicContextPrompts ?? []),
        input.prompt,
      ],
    },
  }
}

export function normalizeAssistantExecutionContext(
  input: AssistantExecutionContext | null | undefined,
): AssistantExecutionContext {
  const hosted = input?.hosted
  const memberId = normalizeNullableString(hosted?.memberId)
  const actionApprovalPort = normalizeAssistantActionApprovalPort(
    hosted?.actionApprovalPort,
  )
  const automationTool = normalizeAssistantAutomationTool(hosted?.automationTool)
  const assistantConfigurationTool = normalizeAssistantConfigurationTool(
    hosted?.assistantConfigurationTool,
  )
  const connectedApps = normalizeAssistantConnectedAppsPort(hosted?.connectedApps)
  const clinicalRecordsConnectLinkTool = normalizeAssistantClinicalRecordsConnectLinkTool(
    hosted?.clinicalRecordsConnectLinkTool,
  )
  const defaultTarget = normalizeAssistantBackendTarget(hosted?.defaultTarget ?? null)
  const channelTypingDependencies = normalizeAssistantChannelTypingDependencies(
    hosted?.channelTypingDependencies,
  )
  const progressDeliveryDependencies = normalizeAssistantHostedProgressDeliveryDependencies(
    hosted?.progressDeliveryDependencies,
  )
  const deviceConnectProviders = normalizeAssistantHostedDeviceConnectProviders(
    hosted?.deviceConnectProviders,
  )
  const deviceTool = normalizeAssistantDeviceTool(hosted?.deviceTool)
  const dynamicContextPrompts = normalizeAssistantDynamicContextPrompts(
    hosted?.dynamicContextPrompts,
  )
  const familyPlanTool = normalizeAssistantFamilyPlanTool(hosted?.familyPlanTool)
  const imessageContactTool = normalizeAssistantIMessageContactTool(
    hosted?.imessageContactTool,
  )
  const personalizationTool = normalizeAssistantPersonalizationTool(
    hosted?.personalizationTool,
  )
  const groupParticipantDisplayNameReader =
    normalizeAssistantGroupParticipantDisplayNameReader(
      hosted?.groupParticipantDisplayNameReader,
    )
  const groupPermissionOfferTool = normalizeAssistantGroupPermissionOfferTool(
    hosted?.groupPermissionOfferTool,
  )
  const groupTool = normalizeAssistantGroupTool(hosted?.groupTool)
  const groupSharedReader = normalizeAssistantGroupSharedReader(
    hosted?.groupSharedReader,
  )
  const labsTool = normalizeAssistantLabsTool(hosted?.labsTool)
  const newsletterTool = normalizeAssistantNewsletterTool(hosted?.newsletterTool)
  const planUsageTool = normalizeAssistantPlanUsageTool(hosted?.planUsageTool)
  const subscriptionTool = normalizeAssistantSubscriptionTool(
    hosted?.subscriptionTool,
  )
  const phoneCalls = normalizeAssistantPhoneCallPort(hosted?.phoneCalls)
  const physicalNotes = normalizeAssistantPhysicalNotePort(hosted?.physicalNotes)
  const privateImageUrlPublisher = normalizeAssistantPrivateImageUrlPublisher(
    hosted?.privateImageUrlPublisher,
  )
  const productFeedbackCandidateSink = normalizeAssistantProductFeedbackCandidateSink(
    hosted?.productFeedbackCandidateSink,
  )
  const usageRecorder = normalizeAssistantUsageRecorder(hosted?.usageRecorder)
  if (!memberId) {
    return {
      hosted: null,
    }
  }

  return {
    hosted: {
      ...(actionApprovalPort ? { actionApprovalPort } : {}),
      ...(automationTool ? { automationTool } : {}),
      ...(typeof hosted?.currentAssistantInputId === 'function'
        ? {
            currentAssistantInputId: hosted.currentAssistantInputId,
          }
        : {}),
      ...(typeof hosted?.createScheduledGroupTools === 'function'
        ? { createScheduledGroupTools: hosted.createScheduledGroupTools }
        : {}),
      ...(assistantConfigurationTool ? { assistantConfigurationTool } : {}),
      ...(connectedApps ? { connectedApps } : {}),
      ...(clinicalRecordsConnectLinkTool ? { clinicalRecordsConnectLinkTool } : {}),
      ...(hosted?.imageGenerationLauncher
        ? { imageGenerationLauncher: hosted.imageGenerationLauncher }
        : {}),
      ...(familyPlanTool ? { familyPlanTool } : {}),
      ...(imessageContactTool ? { imessageContactTool } : {}),
      ...(personalizationTool ? { personalizationTool } : {}),
      ...(groupParticipantDisplayNameReader
        ? { groupParticipantDisplayNameReader }
        : {}),
      ...(groupPermissionOfferTool ? { groupPermissionOfferTool } : {}),
      ...(groupSharedReader ? { groupSharedReader } : {}),
      ...(groupTool ? { groupTool } : {}),
      ...(labsTool ? { labsTool } : {}),
      ...(newsletterTool ? { newsletterTool } : {}),
      ...(planUsageTool ? { planUsageTool } : {}),
      ...(physicalNotes ? { physicalNotes } : {}),
      ...(privateImageUrlPublisher ? { privateImageUrlPublisher } : {}),
      ...(subscriptionTool ? { subscriptionTool } : {}),
      ...(typeof hosted?.materializeWorkspaceArtifacts === 'function'
        ? {
            materializeWorkspaceArtifacts: hosted.materializeWorkspaceArtifacts,
          }
        : {}),
      ...(typeof hosted?.persistGeneratedImageCapture === 'function'
        ? {
            persistGeneratedImageCapture: hosted.persistGeneratedImageCapture,
          }
        : {}),
      ...(defaultTarget
        ? {
            defaultTarget,
          }
        : {}),
      ...(channelTypingDependencies
        ? {
            channelTypingDependencies,
          }
        : {}),
      ...(deviceConnectProviders.length > 0
        ? {
            deviceConnectProviders,
          }
        : {}),
      ...(deviceTool ? { deviceTool } : {}),
      ...(dynamicContextPrompts.length > 0
        ? {
            dynamicContextPrompts,
          }
        : {}),
      ...(productFeedbackCandidateSink ? { productFeedbackCandidateSink } : {}),
      ...(usageRecorder ? { usageRecorder } : {}),
      memberId,
      ...(progressDeliveryDependencies
        ? {
            progressDeliveryDependencies,
          }
        : {}),
      ...(phoneCalls ? { phoneCalls } : {}),
      ...(typeof hosted?.providerFetch === 'function'
        ? { providerFetch: hosted.providerFetch }
        : {}),
      ...(typeof hosted?.publicInternetFetch === 'function'
        ? { publicInternetFetch: hosted.publicInternetFetch }
        : {}),
      ...(typeof hosted?.resolveScheduledLinqRoute === 'function'
        ? { resolveScheduledLinqRoute: hosted.resolveScheduledLinqRoute }
        : {}),
      ...(typeof hosted?.resolveScheduledExternalThreadRoute === 'function'
        ? {
            resolveScheduledExternalThreadRoute:
              hosted.resolveScheduledExternalThreadRoute,
          }
        : {}),
      userEnvKeys:
        hosted?.userEnvKeys
          .map((key) => normalizeNullableString(key))
          .filter((key): key is string => key !== null) ?? [],
    },
  }
}

function normalizeAssistantDynamicContextPrompts(
  input: readonly string[] | null | undefined,
): string[] {
  return (input ?? [])
    .map((prompt) => normalizeNullableString(prompt))
    .filter((prompt): prompt is string => prompt !== null)
}

function normalizeAssistantActionApprovalPort(
  input: AssistantHostedExecutionContext['actionApprovalPort'] | undefined,
): AssistantHostedActionApprovalPort | undefined {
  if (
    !input
    || typeof input.read !== 'function'
    || typeof input.request !== 'function'
  ) {
    return undefined
  }

  return {
    read: input.read.bind(input),
    request: input.request.bind(input),
  }
}

function normalizeAssistantAutomationTool(
  input: AssistantHostedExecutionContext['automationTool'] | undefined,
): AssistantHostedAutomationTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantDeviceTool(
  input: AssistantHostedExecutionContext['deviceTool'] | undefined,
): AssistantHostedDeviceTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantConnectedAppsPort(
  input: AssistantHostedExecutionContext['connectedApps'] | undefined,
): AssistantConnectedAppsPort | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantClinicalRecordsConnectLinkTool(
  input: AssistantHostedExecutionContext['clinicalRecordsConnectLinkTool'] | undefined,
): AssistantHostedClinicalRecordsConnectLinkTool | undefined {
  if (!input || typeof input.createConnectLink !== 'function') {
    return undefined
  }

  return {
    createConnectLink: input.createConnectLink.bind(input),
  }
}

function normalizeAssistantPhoneCallPort(
  input: AssistantHostedExecutionContext['phoneCalls'] | undefined,
): AssistantPhoneCallPort | undefined {
  if (!input || typeof input.start !== 'function') {
    return undefined
  }

  return {
    start: input.start.bind(input),
  }
}

function normalizeAssistantPhysicalNotePort(
  input: AssistantHostedExecutionContext['physicalNotes'] | undefined,
): AssistantPhysicalNotePort | undefined {
  if (!input || typeof input.send !== 'function') {
    return undefined
  }

  return {
    send: input.send.bind(input),
  }
}

function normalizeAssistantPrivateImageUrlPublisher(
  input: AssistantHostedExecutionContext['privateImageUrlPublisher'] | undefined,
): AssistantHostedPrivateImageUrlPublisher | undefined {
  if (!input || typeof input.publishPrivateImageUrl !== 'function') {
    return undefined
  }

  return {
    publishPrivateImageUrl: input.publishPrivateImageUrl.bind(input),
  }
}

function normalizeAssistantProductFeedbackCandidateSink(
  input: AssistantHostedExecutionContext['productFeedbackCandidateSink'] | undefined,
): AssistantHostedProductFeedbackCandidateSink | undefined {
  if (!input || typeof input.acceptProductFeedbackCandidate !== 'function') {
    return undefined
  }

  return {
    acceptProductFeedbackCandidate:
      input.acceptProductFeedbackCandidate.bind(input),
    ...(typeof input.deliverProductSupportEscalation === 'function'
      ? {
          deliverProductSupportEscalation:
            input.deliverProductSupportEscalation.bind(input),
        }
      : {}),
  }
}

function normalizeAssistantFamilyPlanTool(
  input: AssistantHostedExecutionContext['familyPlanTool'] | undefined,
): AssistantHostedFamilyPlanTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantPlanUsageTool(
  input: AssistantHostedExecutionContext['planUsageTool'] | undefined,
): AssistantHostedPlanUsageTool | undefined {
  if (!input || typeof input.read !== 'function') {
    return undefined
  }

  return {
    read: input.read.bind(input),
  }
}

function normalizeAssistantIMessageContactTool(
  input: AssistantHostedExecutionContext['imessageContactTool'] | undefined,
): AssistantHostedIMessageContactTool | undefined {
  if (!input || typeof input.ensure !== 'function') {
    return undefined
  }

  return {
    ensure: input.ensure.bind(input),
  }
}

function normalizeAssistantSubscriptionTool(
  input: AssistantHostedExecutionContext['subscriptionTool'] | undefined,
): AssistantHostedSubscriptionTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantPersonalizationTool(
  input: AssistantHostedExecutionContext['personalizationTool'] | undefined,
): AssistantHostedPersonalizationTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantConfigurationTool(
  input: AssistantHostedExecutionContext['assistantConfigurationTool'] | undefined,
): AssistantHostedAssistantConfigurationTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantGroupTool(
  input: AssistantHostedExecutionContext['groupTool'] | undefined,
): AssistantHostedGroupTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  // Keep the optional route probe bound alongside `request`. Dropping it here
  // silently downgrades a pre-generation refusal into a post-generation one,
  // because callers treat an absent probe as admission.
  const directAttachmentRouteStatus = input.directAttachmentRouteStatus
  return {
    request: input.request.bind(input),
    ...(typeof directAttachmentRouteStatus === 'function'
      ? { directAttachmentRouteStatus: directAttachmentRouteStatus.bind(input) }
      : {}),
  }
}

function normalizeAssistantGroupParticipantDisplayNameReader(
  input:
    | AssistantHostedExecutionContext['groupParticipantDisplayNameReader']
    | undefined,
): AssistantHostedGroupParticipantDisplayNameReader | undefined {
  if (!input || typeof input.read !== 'function') {
    return undefined
  }

  return {
    read: input.read.bind(input),
  }
}

function normalizeAssistantGroupPermissionOfferTool(
  input: AssistantHostedExecutionContext['groupPermissionOfferTool'] | undefined,
): AssistantHostedGroupPermissionOfferTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantGroupSharedReader(
  input: AssistantHostedExecutionContext['groupSharedReader'] | undefined,
): AssistantHostedGroupSharedReader | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantLabsTool(
  input: AssistantHostedExecutionContext['labsTool'] | undefined,
): AssistantHostedLabsTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantNewsletterTool(
  input: AssistantHostedExecutionContext['newsletterTool'] | undefined,
): AssistantHostedNewsletterTool | undefined {
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
    request: input.request.bind(input),
  }
}

function normalizeAssistantUsageRecorder(
  input: AssistantHostedExecutionContext['usageRecorder'] | undefined,
): AssistantUsageRecorder | undefined {
  if (!input || typeof input.recordUsage !== 'function') {
    return undefined
  }

  return {
    recordUsage: input.recordUsage,
  }
}

function normalizeAssistantChannelTypingDependencies(
  input: AssistantHostedExecutionContext['channelTypingDependencies'] | undefined,
): AssistantChannelTypingDependencies | undefined {
  if (!input) {
    return undefined
  }

  const dependencies: AssistantChannelTypingDependencies = {}
  if (typeof input.startLinqTyping === 'function') {
    dependencies.startLinqTyping = input.startLinqTyping
  }
  if (typeof input.startTelegramTyping === 'function') {
    dependencies.startTelegramTyping = input.startTelegramTyping
  }

  return dependencies.startLinqTyping || dependencies.startTelegramTyping
    ? dependencies
    : undefined
}

function normalizeAssistantHostedProgressDeliveryDependencies(
  input: AssistantHostedExecutionContext['progressDeliveryDependencies'] | undefined,
): AssistantHostedProgressDeliveryDependencies | undefined {
  if (!input) {
    return undefined
  }

  const dependencies: AssistantHostedProgressDeliveryDependencies = {}
  if (typeof input.sendTelegram === 'function') {
    dependencies.sendTelegram = input.sendTelegram
  }
  if (typeof input.sendTelegramImage === 'function') {
    dependencies.sendTelegramImage = input.sendTelegramImage
  }
  if (typeof input.sendLinq === 'function') {
    dependencies.sendLinq = input.sendLinq
  }
  if (typeof input.sendLinqVoiceMemo === 'function') {
    dependencies.sendLinqVoiceMemo = input.sendLinqVoiceMemo
  }
  if (typeof input.sendEmail === 'function') {
    dependencies.sendEmail = input.sendEmail
  }
  if (
    input.signal &&
    (
      dependencies.sendTelegram ||
      dependencies.sendTelegramImage ||
      dependencies.sendLinq ||
      dependencies.sendLinqVoiceMemo ||
      dependencies.sendEmail
    )
  ) {
    dependencies.signal = input.signal
  }

  return (
    dependencies.sendTelegram ||
    dependencies.sendTelegramImage ||
    dependencies.sendLinq ||
    dependencies.sendLinqVoiceMemo ||
    dependencies.sendEmail
  )
    ? dependencies
    : undefined
}

export function normalizeAssistantHostedDeviceConnectProviderKey(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null
  if (!normalized || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(normalized)) {
    return null
  }

  return normalized
}

export function normalizeAssistantHostedDeviceConnectProviders(
  input: readonly AssistantHostedDeviceConnectProvider[] | null | undefined,
): AssistantHostedDeviceConnectProvider[] {
  const providers: AssistantHostedDeviceConnectProvider[] = []
  const seen = new Set<string>()

  for (const entry of input ?? []) {
    const provider = normalizeAssistantHostedDeviceConnectProviderKey(entry.provider)
    if (!provider || seen.has(provider)) {
      continue
    }

    seen.add(provider)
    providers.push({
      label: normalizeNullableString(entry.label) ?? provider,
      provider,
    })
  }

  return providers
}

export function formatAssistantHostedDeviceConnectProviderList(
  providers: readonly AssistantHostedDeviceConnectProvider[] | null | undefined,
): string {
  const labels = normalizeAssistantHostedDeviceConnectProviders(providers).map(
    (entry) => `${entry.label} (\`${entry.provider}\`)`,
  )

  if (labels.length === 0) {
    return 'none'
  }

  if (labels.length === 1) {
    return labels[0]!
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`
  }

  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

export function resolveAssistantExecutionDefaultTarget(input: {
  executionContext: AssistantExecutionContext | null | undefined
  fallbackTarget: AssistantModelTarget
}): AssistantModelTarget {
  return input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget
}

export function resolveAssistantExecutionOperatorDefaults(input: {
  defaults: AssistantOperatorDefaults | null | undefined
  executionContext: AssistantExecutionContext | null | undefined
}): AssistantOperatorDefaults | null {
  const hostedDefaultTarget = input.executionContext?.hosted?.defaultTarget ?? null
  if (!hostedDefaultTarget) {
    return input.defaults ?? null
  }

  return {
    ...(input.defaults ?? {}),
    identityId: input.defaults?.identityId ?? null,
    selfDeliveryTargets: input.defaults?.selfDeliveryTargets ?? null,
    backend: hostedDefaultTarget,
  }
}
