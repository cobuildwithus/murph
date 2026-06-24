import type { AssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import type {
  AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeAssistantBackendTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantUsageRecord } from '@murphai/hosted-execution/assistant-usage'
import type {
  HostedRuntimeProductFeedbackRecord,
  HostedRuntimeProductFeedbackRecordResponse,
} from '@murphai/hosted-execution/runtime-control'
import type { AssistantChannelDependencies } from './channel-adapters.js'
import type { AssistantConnectedAppsPort } from './connected-apps-port.js'
import { normalizeNullableString } from './shared.js'

export type AssistantChannelTypingDependencies = Pick<
  AssistantChannelDependencies,
  'startLinqTyping' | 'startTelegramTyping'
>

export type AssistantHostedProgressDeliveryDependencies = Pick<
  AssistantChannelDependencies,
  'sendTelegram' | 'sendLinq' | 'sendLinqVoiceMemo' | 'sendEmail' | 'signal'
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

export interface AssistantHostedDeviceConnectRequest {
  messagingReturnTarget?: 'imessage' | 'telegram' | null
  provider: string
}

export interface AssistantUsageRecorder {
  recordUsage(record: AssistantUsageRecord): Promise<void>
}

export interface AssistantHostedProductFeedbackRecorder {
  recordProductFeedback(
    feedback: HostedRuntimeProductFeedbackRecord,
  ): Promise<HostedRuntimeProductFeedbackRecordResponse>
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

export type AssistantWorkspaceArtifactMaterializer = (
  relativePaths: readonly string[],
) => Promise<AssistantWorkspaceArtifactMaterializationResult>

export interface AssistantHostedExecutionContext {
  channelTypingDependencies?: AssistantChannelTypingDependencies
  connectedApps?: AssistantConnectedAppsPort | null
  defaultTarget?: AssistantModelTarget | null
  deviceConnectProviders?: readonly AssistantHostedDeviceConnectProvider[]
  issueDeviceConnectLink?(
    input: AssistantHostedDeviceConnectRequest,
  ): Promise<AssistantHostedDeviceConnectLink>
  generatedImageUploader?: AssistantHostedGeneratedImageUploader | null
  generatedImageUploaderRequired?: boolean | null
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  memberId: string
  progressDeliveryDependencies?: AssistantHostedProgressDeliveryDependencies
  productFeedbackRecorder?: AssistantHostedProductFeedbackRecorder | null
  providerFetch?: typeof fetch | null
  publicInternetFetch?: typeof fetch | null
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
  const connectedApps = normalizeAssistantConnectedAppsPort(hosted?.connectedApps)
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
  const generatedImageUploader = normalizeAssistantGeneratedImageUploader(
    hosted?.generatedImageUploader,
  )
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
      ...(connectedApps ? { connectedApps } : {}),
      ...(typeof hosted?.issueDeviceConnectLink === 'function'
        ? {
            issueDeviceConnectLink: hosted.issueDeviceConnectLink,
          }
        : {}),
      ...(generatedImageUploader ? { generatedImageUploader } : {}),
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
      ...(productFeedbackRecorder ? { productFeedbackRecorder } : {}),
      ...(usageRecorder ? { usageRecorder } : {}),
      memberId,
      ...(progressDeliveryDependencies
        ? {
            progressDeliveryDependencies,
          }
        : {}),
      ...(typeof hosted?.providerFetch === 'function'
        ? { providerFetch: hosted.providerFetch }
        : {}),
      ...(typeof hosted?.publicInternetFetch === 'function'
        ? { publicInternetFetch: hosted.publicInternetFetch }
        : {}),
      userEnvKeys:
        hosted?.userEnvKeys
          .map((key) => normalizeNullableString(key))
          .filter((key): key is string => key !== null) ?? [],
    },
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
      dependencies.sendLinq ||
      dependencies.sendLinqVoiceMemo ||
      dependencies.sendEmail
    )
  ) {
    dependencies.signal = input.signal
  }

  return (
    dependencies.sendTelegram ||
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
