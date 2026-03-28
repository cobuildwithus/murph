import {
  assistantProviderBindingSchema,
  assistantSessionProviderStateSchema,
  type AssistantSession,
  type AssistantProviderBinding,
  type AssistantSessionProviderState,
} from '../assistant-cli-contracts.js'
import { normalizeNullableString } from './shared.js'

export function readAssistantCodexPromptVersion(input: {
  providerBinding?: AssistantProviderBinding | null
} | AssistantSession): string | null {
  const providerBinding = readAssistantProviderBinding(input)
  return (
    normalizeNullableString(providerBinding?.providerState?.codexCli?.promptVersion) ??
    null
  )
}

export function readAssistantProviderResumeRouteId(input: {
  providerBinding?: AssistantProviderBinding | null
} | AssistantSession): string | null {
  const providerBinding = readAssistantProviderBinding(input)
  return normalizeNullableString(providerBinding?.providerState?.resumeRouteId) ?? null
}

export function readAssistantProviderResumeWorkspaceKey(input: {
  providerBinding?: AssistantProviderBinding | null
} | AssistantSession): string | null {
  const providerBinding = readAssistantProviderBinding(input)
  return (
    normalizeNullableString(providerBinding?.providerState?.resumeWorkspaceKey) ??
    null
  )
}

export function readAssistantProviderSessionId(input: {
  providerBinding?: AssistantProviderBinding | null
} | AssistantSession): string | null {
  const providerBinding = readAssistantProviderBinding(input)
  return normalizeNullableString(providerBinding?.providerSessionId) ?? null
}

export function readAssistantProviderBinding(
  input:
    | {
        providerBinding?: AssistantProviderBinding | null
      }
    | AssistantSession
    | null
    | undefined,
): AssistantProviderBinding | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  return normalizeAssistantProviderBinding(
    'providerBinding' in input ? input.providerBinding : null,
  )
}

export function writeAssistantCodexPromptVersion(
  providerBinding: AssistantProviderBinding | null | undefined,
  promptVersion: string | null | undefined,
): AssistantProviderBinding | null {
  const current = normalizeAssistantProviderBinding(providerBinding)
  if (!current || current.provider !== 'codex-cli') {
    return current
  }

  return assistantProviderBindingSchema.parse({
    ...current,
    providerState: writeAssistantSessionProviderStatePromptVersion(
      current.providerState,
      promptVersion,
    ),
  })
}

export function writeAssistantProviderResumeRouteId(
  providerBinding: AssistantProviderBinding | null | undefined,
  routeId: string | null | undefined,
): AssistantProviderBinding | null {
  const current = normalizeAssistantProviderBinding(providerBinding)
  if (!current) {
    return current
  }

  return assistantProviderBindingSchema.parse({
    ...current,
    providerState: writeAssistantSessionProviderStateResumeRouteId(
      current.providerState,
      routeId,
    ),
  })
}

export function writeAssistantProviderStateResumeRouteId(
  providerState: AssistantSessionProviderState | null | undefined,
  routeId: string | null | undefined,
): AssistantSessionProviderState | null {
  return writeAssistantSessionProviderStateResumeRouteId(providerState, routeId)
}

export function writeAssistantProviderStateResumeWorkspaceKey(
  providerState: AssistantSessionProviderState | null | undefined,
  workspaceKey: string | null | undefined,
): AssistantSessionProviderState | null {
  return writeAssistantSessionProviderStateResumeWorkspaceKey(
    providerState,
    workspaceKey,
  )
}

function writeAssistantSessionProviderStatePromptVersion(
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

function writeAssistantSessionProviderStateResumeRouteId(
  providerState: AssistantSessionProviderState | null | undefined,
  routeId: string | null | undefined,
): AssistantSessionProviderState | null {
  const normalizedRouteId = normalizeNullableString(routeId)
  const current = normalizeAssistantSessionProviderState(providerState)

  if (!normalizedRouteId) {
    if (!current?.resumeRouteId) {
      return current
    }

    return assistantSessionProviderStateSchema.parse({
      ...current,
      resumeRouteId: null,
    })
  }

  return assistantSessionProviderStateSchema.parse({
    ...(current ?? {}),
    resumeRouteId: normalizedRouteId,
  })
}

function writeAssistantSessionProviderStateResumeWorkspaceKey(
  providerState: AssistantSessionProviderState | null | undefined,
  workspaceKey: string | null | undefined,
): AssistantSessionProviderState | null {
  const normalizedWorkspaceKey = normalizeNullableString(workspaceKey)
  const current = normalizeAssistantSessionProviderState(providerState)

  if (!normalizedWorkspaceKey) {
    if (!current?.resumeWorkspaceKey) {
      return current
    }

    return assistantSessionProviderStateSchema.parse({
      ...current,
      resumeWorkspaceKey: null,
    })
  }

  return assistantSessionProviderStateSchema.parse({
    ...(current ?? {}),
    resumeWorkspaceKey: normalizedWorkspaceKey,
  })
}

export function normalizeAssistantProviderBinding(
  value: AssistantProviderBinding | null | undefined,
): AssistantProviderBinding | null {
  if (!value) {
    return null
  }

  return assistantProviderBindingSchema.parse({
    ...value,
    providerState: normalizeAssistantSessionProviderState(value.providerState),
  })
}

export function normalizeAssistantSessionProviderState(
  value: AssistantSessionProviderState | null | undefined,
): AssistantSessionProviderState | null {
  if (!value) {
    return null
  }

  const promptVersion = normalizeNullableString(value.codexCli?.promptVersion)
  const resumeRouteId = normalizeNullableString(value.resumeRouteId)
  const resumeWorkspaceKey = normalizeNullableString(value.resumeWorkspaceKey)
  return promptVersion || resumeRouteId || resumeWorkspaceKey
    ? assistantSessionProviderStateSchema.parse({
        codexCli: promptVersion
          ? {
              promptVersion,
            }
          : null,
        resumeRouteId,
        resumeWorkspaceKey,
      })
    : null
}

export function normalizeAssistantSessionSnapshot(
  session: AssistantSession,
): AssistantSession {
  const legacyProviderSessionId =
    normalizeNullableString(session.providerSessionId) ?? null
  const legacyProviderState = normalizeAssistantSessionProviderState(
    session.providerState,
  )
  // An explicit `providerBinding: null` means "clear any provider resume state";
  // only fall back to legacy compatibility fields when the binding key is absent.
  const hasExplicitProviderBinding = Object.prototype.hasOwnProperty.call(
    session,
    'providerBinding',
  )
  const explicitProviderBinding =
    session.providerBinding
      ? {
          ...session.providerBinding,
          providerSessionId:
            normalizeNullableString(session.providerBinding.providerSessionId) ?? null,
          providerState: normalizeAssistantSessionProviderState(
            session.providerBinding.providerState,
          ),
        }
      : null
  const providerBinding = normalizeAssistantProviderBinding(
    hasExplicitProviderBinding
      ? explicitProviderBinding
      : legacyProviderSessionId !== null || legacyProviderState !== null
        ? {
            provider: session.provider,
            providerOptions: session.providerOptions,
            providerSessionId: legacyProviderSessionId,
            providerState: legacyProviderState,
          }
        : null,
  )

  return {
    ...session,
    schema: 'murph.assistant-session.v3',
    providerBinding,
    providerSessionId: providerBinding?.providerSessionId ?? null,
    providerState: providerBinding?.providerState ?? null,
  }
}
