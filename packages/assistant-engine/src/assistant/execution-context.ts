import type { AssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeAssistantBackendTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantUsageRecord } from '@murphai/hosted-execution/assistant-usage'
import type {
  AutomationAssistantTargetOverride,
  AutomationContinuityPolicy,
  AutomationSchedule,
  AutomationStatus,
} from '@murphai/contracts'
import type {
  HostedClinicalRecordsConnectLinkResponse,
} from '@murphai/hosted-execution/clinical-records'
import type {
  HostedRuntimeAssistantPersonalizationToolAuthority,
  HostedRuntimeAssistantPersonalizationToolRequest,
  HostedRuntimeAssistantPersonalizationToolResponse,
} from '@murphai/hosted-execution/assistant-personalization'
import type {
  HostedActionApprovalRequest,
  HostedActionApprovalResult,
} from '@murphai/hosted-execution/action-approval'
import type {
  HostedRuntimeProductFeedbackRecord,
  HostedRuntimeProductFeedbackRecordResponse,
  HostedRuntimeFamilyPlanToolRequest,
  HostedRuntimeFamilyPlanToolResponse,
  HostedRuntimeAssistantConfigurationControlRequest,
  HostedRuntimeAssistantConfigurationToolResponse,
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
  HostedPlanUsageStatus,
} from '@murphai/hosted-execution/plan-usage'
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

export type AssistantHostedAutomationToolRequest =
  | {
      action: 'save'
      assistantTargetOverride?: AutomationAssistantTargetOverride | null
      automationId?: string
      continuityPolicy?: AutomationContinuityPolicy
      instructions: string
      schedule: AutomationSchedule
      slug?: string
      status?: AutomationStatus
      summary?: string | null
      tags?: readonly string[]
      title: string
    }
  | {
      action: 'patch'
      assistantTargetOverride?: AutomationAssistantTargetOverride | null
      continuityPolicy?: AutomationContinuityPolicy
      instructions?: string
      lookup: string
      retargetToCurrentConversation?: boolean
      schedule?: AutomationSchedule
      slug?: string
      status?: AutomationStatus
      summary?: string | null
      tags?: readonly string[]
      title?: string
    }

export interface AssistantHostedAutomationToolResponse {
  action: 'patch' | 'save'
  automationId: string
  created: boolean
  lookupId: string
  routeBinding: 'current_conversation' | 'preserved'
  status: AutomationStatus
}

export interface AssistantHostedAutomationTool {
  request(
    request: AssistantHostedAutomationToolRequest,
    context?: { signal?: AbortSignal | null },
  ): Promise<AssistantHostedAutomationToolResponse>
}

export interface AssistantUsageRecorder {
  recordUsage(
    record: AssistantUsageRecord,
    providerRequestAcceptedInputIds?: readonly string[],
  ): Promise<void>
}

export interface AssistantHostedActionApprovalPort {
  request(input: HostedActionApprovalRequest): Promise<HostedActionApprovalResult>
}

export interface AssistantHostedProductFeedbackRecorder {
  recordProductFeedback(
    feedback: HostedRuntimeProductFeedbackRecord,
  ): Promise<HostedRuntimeProductFeedbackRecordResponse>
}

export interface AssistantHostedFamilyPlanTool {
  request(
    request: HostedRuntimeFamilyPlanToolRequest,
  ): Promise<HostedRuntimeFamilyPlanToolResponse>
}

export interface AssistantHostedPlanUsageTool {
  read(): Promise<HostedPlanUsageStatus>
}

export interface AssistantHostedSubscriptionTool {
  request(
    request: HostedRuntimeSubscriptionControlRequest,
  ): Promise<HostedRuntimeSubscriptionToolResponse>
}

export interface AssistantHostedClinicalRecordsConnectLinkTool {
  createConnectLink(
    options?: { signal?: AbortSignal | null },
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
  ): Promise<HostedRuntimeGroupToolResponse>
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

export type AssistantGeneratedImageContentType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'

export interface AssistantHostedGeneratedImageUploadInput {
  alt: string | null
  bytes: Uint8Array
  contentType: AssistantGeneratedImageContentType
  filename: string
  metadata: Record<string, string>
  source: string
}

export interface AssistantHostedGeneratedImageUploader {
  uploadGeneratedImage(
    input: AssistantHostedGeneratedImageUploadInput,
  ): Promise<AssistantResponseMedia>
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
  assistantConfigurationTool?: AssistantHostedAssistantConfigurationTool | null
  channelTypingDependencies?: AssistantChannelTypingDependencies
  connectedApps?: AssistantConnectedAppsPort | null
  clinicalRecordsConnectLinkTool?: AssistantHostedClinicalRecordsConnectLinkTool | null
  defaultTarget?: AssistantModelTarget | null
  deviceConnectProviders?: readonly AssistantHostedDeviceConnectProvider[]
  deviceTool?: AssistantHostedDeviceTool | null
  familyPlanTool?: AssistantHostedFamilyPlanTool | null
  personalizationTool?: AssistantHostedPersonalizationTool | null
  groupTool?: AssistantHostedGroupTool | null
  newsletterTool?: AssistantHostedNewsletterTool | null
  planUsageTool?: AssistantHostedPlanUsageTool | null
  subscriptionTool?: AssistantHostedSubscriptionTool | null
  dynamicContextPrompts?: readonly string[] | null
  generatedImageUploader?: AssistantHostedGeneratedImageUploader | null
  generatedImageUploaderRequired?: boolean | null
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  memberId: string
  progressDeliveryDependencies?: AssistantHostedProgressDeliveryDependencies
  productFeedbackRecorder?: AssistantHostedProductFeedbackRecorder | null
  providerFetch?: typeof fetch | null
  phoneCalls?: AssistantPhoneCallPort | null
  publicInternetFetch?: typeof fetch | null
  resolveScheduledLinqRoute?(input: {
    homeRouteFallbackAllowed: boolean
    signal?: AbortSignal | null
    target: string
    targetKind: 'explicit' | 'thread'
  }): Promise<{
    target: string
    threadIsDirect: boolean
  }>
  usageRecorder?: AssistantUsageRecorder | null
  userEnvKeys: readonly string[]
}

export interface AssistantExecutionContext {
  hosted: AssistantHostedExecutionContext | null
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
  const generatedImageUploader = normalizeAssistantGeneratedImageUploader(
    hosted?.generatedImageUploader,
  )
  const familyPlanTool = normalizeAssistantFamilyPlanTool(hosted?.familyPlanTool)
  const personalizationTool = normalizeAssistantPersonalizationTool(
    hosted?.personalizationTool,
  )
  const groupTool = normalizeAssistantGroupTool(hosted?.groupTool)
  const newsletterTool = normalizeAssistantNewsletterTool(hosted?.newsletterTool)
  const planUsageTool = normalizeAssistantPlanUsageTool(hosted?.planUsageTool)
  const subscriptionTool = normalizeAssistantSubscriptionTool(
    hosted?.subscriptionTool,
  )
  const phoneCalls = normalizeAssistantPhoneCallPort(hosted?.phoneCalls)
  const productFeedbackRecorder = normalizeAssistantProductFeedbackRecorder(
    hosted?.productFeedbackRecorder,
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
      ...(assistantConfigurationTool ? { assistantConfigurationTool } : {}),
      ...(connectedApps ? { connectedApps } : {}),
      ...(clinicalRecordsConnectLinkTool ? { clinicalRecordsConnectLinkTool } : {}),
      ...(generatedImageUploader ? { generatedImageUploader } : {}),
      ...(familyPlanTool ? { familyPlanTool } : {}),
      ...(personalizationTool ? { personalizationTool } : {}),
      ...(groupTool ? { groupTool } : {}),
      ...(newsletterTool ? { newsletterTool } : {}),
      ...(planUsageTool ? { planUsageTool } : {}),
      ...(subscriptionTool ? { subscriptionTool } : {}),
      ...(hosted?.generatedImageUploaderRequired === true
        ? { generatedImageUploaderRequired: true }
        : {}),
      ...(typeof hosted?.materializeWorkspaceArtifacts === 'function'
        ? {
            materializeWorkspaceArtifacts: hosted.materializeWorkspaceArtifacts,
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
      ...(productFeedbackRecorder ? { productFeedbackRecorder } : {}),
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
  if (!input || typeof input.request !== 'function') {
    return undefined
  }

  return {
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

function normalizeAssistantProductFeedbackRecorder(
  input: AssistantHostedExecutionContext['productFeedbackRecorder'] | undefined,
): AssistantHostedProductFeedbackRecorder | undefined {
  if (!input || typeof input.recordProductFeedback !== 'function') {
    return undefined
  }

  return {
    recordProductFeedback: input.recordProductFeedback,
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

function normalizeAssistantGeneratedImageUploader(
  input: AssistantHostedExecutionContext['generatedImageUploader'] | undefined,
): AssistantHostedGeneratedImageUploader | undefined {
  if (!input || typeof input.uploadGeneratedImage !== 'function') {
    return undefined
  }

  return {
    uploadGeneratedImage: input.uploadGeneratedImage,
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
