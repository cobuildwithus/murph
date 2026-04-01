import { normalizeNullableString } from './shared.js'

export interface AssistantHostedExecutionContext {
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
      memberId,
      userEnvKeys:
        hosted?.userEnvKeys
          .map((key) => normalizeNullableString(key))
          .filter((key): key is string => key !== null) ?? [],
    },
  }
}
