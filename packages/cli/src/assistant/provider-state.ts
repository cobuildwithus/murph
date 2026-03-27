import {
  assistantSessionProviderStateSchema,
  type AssistantSession,
  type AssistantSessionProviderState,
} from '../assistant-cli-contracts.js'
import { normalizeNullableString } from './shared.js'

export function readAssistantCodexPromptVersion(input: {
  providerState?: AssistantSessionProviderState | null
}): string | null {
  return normalizeNullableString(input.providerState?.codexCli?.promptVersion) ?? null
}

export function writeAssistantCodexPromptVersion(
  providerState: AssistantSessionProviderState | null | undefined,
  promptVersion: string | null | undefined,
): AssistantSessionProviderState | null {
  const normalizedPromptVersion = normalizeNullableString(promptVersion)
  const current = normalizeAssistantSessionProviderState(providerState)

  if (!normalizedPromptVersion) {
    if (!current?.codexCli) {
      return current
    }

    return assistantSessionProviderStateSchema.parse({
      ...current,
      codexCli: null,
    })
  }

  return assistantSessionProviderStateSchema.parse({
    ...(current ?? {}),
    codexCli: {
      promptVersion: normalizedPromptVersion,
    },
  })
}

export function normalizeAssistantSessionProviderState(
  value: AssistantSessionProviderState | null | undefined,
): AssistantSessionProviderState | null {
  if (!value) {
    return null
  }

  const parsed = assistantSessionProviderStateSchema.parse(value)
  return parsed.codexCli ? parsed : null
}

export function normalizeAssistantSessionSnapshot(
  session: AssistantSession,
): AssistantSession {
  const providerState = normalizeAssistantSessionProviderState(session.providerState)

  return {
    ...session,
    providerState,
  }
}
