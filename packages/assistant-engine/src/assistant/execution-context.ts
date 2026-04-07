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
  issueDeviceConnectLink?(
    input: AssistantHostedDeviceConnectRequest,
  ): Promise<AssistantHostedDeviceConnectLink>
  // Share-link issuance is browser-authenticated by default and must be injected explicitly.
  issueShareLink?(
    input: AssistantHostedShareLinkRequest,
  ): Promise<AssistantHostedShareLink>
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
      memberId,
      userEnvKeys:
        hosted?.userEnvKeys
          .map((key) => normalizeNullableString(key))
          .filter((key): key is string => key !== null) ?? [],
    },
  }
}
