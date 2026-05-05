import type { AssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import { normalizeAssistantBackendTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantChannelDependencies } from './channel-adapters.js'
import { normalizeNullableString } from './shared.js'

export type AssistantChannelTypingDependencies = Pick<
  AssistantChannelDependencies,
  'startLinqTyping' | 'startTelegramTyping'
>

export interface AssistantHostedDeviceConnectLink {
  authorizationUrl: string
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

export interface AssistantHostedExecutionContext {
  channelTypingDependencies?: AssistantChannelTypingDependencies
  defaultTarget?: AssistantModelTarget | null
  deviceConnectProviders?: readonly AssistantHostedDeviceConnectProvider[]
  issueDeviceConnectLink?(
    input: AssistantHostedDeviceConnectRequest,
  ): Promise<AssistantHostedDeviceConnectLink>
  memberId: string
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
  const defaultTarget = normalizeAssistantBackendTarget(hosted?.defaultTarget ?? null)
  const channelTypingDependencies = normalizeAssistantChannelTypingDependencies(
    hosted?.channelTypingDependencies,
  )
  const deviceConnectProviders = normalizeAssistantHostedDeviceConnectProviders(
    hosted?.deviceConnectProviders,
  )
  if (!memberId) {
    return {
      hosted: null,
    }
  }

  return {
    hosted: {
      ...(typeof hosted?.issueDeviceConnectLink === 'function'
        ? {
            issueDeviceConnectLink: hosted.issueDeviceConnectLink,
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
      memberId,
      userEnvKeys:
        hosted?.userEnvKeys
          .map((key) => normalizeNullableString(key))
          .filter((key): key is string => key !== null) ?? [],
    },
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
