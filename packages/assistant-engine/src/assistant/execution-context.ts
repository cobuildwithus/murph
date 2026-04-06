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

export interface AssistantHostedExecutionContext {
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
      memberId,
      userEnvKeys:
        hosted?.userEnvKeys
          .map((key) => normalizeNullableString(key))
          .filter((key): key is string => key !== null) ?? [],
    },
  }
}
