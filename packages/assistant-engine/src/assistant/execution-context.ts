import type { AssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import { normalizeAssistantBackendTarget } from '@murphai/operator-config/assistant-backend'
import type { SharePack } from '@murphai/contracts'
import { normalizeNullableString } from './shared.js'

export interface AssistantHostedDeviceConnectLink {
  authorizationUrl: string
  expiresAt: string
  provider: string
  providerLabel: string
}

export interface AssistantHostedDeviceConnectRequest {
  provider: string
}

export interface AssistantHostedShareLink {
  shareCode: string
  shareUrl?: string
  url: string
}

export interface AssistantHostedShareLinkRequest {
  expiresInHours?: number
  inviteCode?: string
  pack: SharePack
  recipientPhoneNumber?: string
}

export interface AssistantHostedExecutionContext {
  defaultTarget?: AssistantModelTarget | null
  issueDeviceConnectLink?(
    input: AssistantHostedDeviceConnectRequest,
  ): Promise<AssistantHostedDeviceConnectLink>
  // Share-link issuance is browser-authenticated by default and must be injected explicitly.
  issueShareLink?(
    input: AssistantHostedShareLinkRequest,
  ): Promise<AssistantHostedShareLink>
  memberId: string
  stripeCustomerId?: string | null
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
  const stripeCustomerId = normalizeNullableString(hosted?.stripeCustomerId ?? null)
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
      ...(typeof hosted?.issueShareLink === 'function'
        ? {
            issueShareLink: hosted.issueShareLink,
          }
        : {}),
      ...(defaultTarget
        ? {
            defaultTarget,
          }
        : {}),
      ...(stripeCustomerId
        ? {
            stripeCustomerId,
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
