import { createHash } from 'node:crypto'
import type {
  AssistantChatProvider,
  AssistantProviderBinding,
  AssistantProviderSessionOptions,
  AssistantSessionProviderState,
  AssistantTurnTrigger,
} from '../assistant-cli-contracts.js'
import { resolveAssistantProviderTraits } from '../assistant-provider.js'
import {
  normalizeAssistantProviderBinding,
  readAssistantProviderResumeRouteId,
  readAssistantProviderResumeWorkspaceKey,
  readAssistantProviderSessionId,
  writeAssistantCodexPromptVersion,
  writeAssistantProviderStateResumeRouteId,
  writeAssistantProviderStateResumeWorkspaceKey,
} from './provider-state.js'
import {
  shouldUseAssistantOpenAIResponsesApi,
} from './provider-config.js'

export function hashAssistantProviderWorkingDirectory(
  workingDirectory: string,
): string {
  return createHash('sha1')
    .update(workingDirectory)
    .digest('hex')
    .slice(0, 16)
}

export function resolveAssistantProviderResumeKey(input: {
  binding: AssistantProviderBinding | null
  provider: AssistantChatProvider
}): string | null {
  if (!input.binding || input.binding.provider !== input.provider) {
    return null
  }

  const traits = resolveAssistantProviderTraits(input.provider)
  const supportsProviderSessionResume =
    traits.resumeKeyMode === 'provider-session-id' ||
    shouldUseAssistantOpenAIResponsesApi({
      provider: input.binding.provider,
      ...input.binding.providerOptions,
    })

  if (!supportsProviderSessionResume) {
    return null
  }

  return input.binding.providerSessionId
}

export function shouldResumeAssistantProviderRecovery(
  turnTrigger: AssistantTurnTrigger,
): boolean {
  return (
    turnTrigger === 'manual-ask' || turnTrigger === 'manual-deliver'
  )
}

export function resolveAssistantRouteResumeBinding(input: {
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
  recoveredBinding: AssistantProviderBinding | null
  routeId: string
  sessionBinding: AssistantProviderBinding | null
  workingDirectoryKey: string | null
}): AssistantProviderBinding | null {
  if (
    doesAssistantResumeBindingMatchRoute({
      binding: input.recoveredBinding,
      provider: input.provider,
      providerOptions: input.providerOptions,
      routeId: input.routeId,
      workingDirectoryKey: input.workingDirectoryKey,
    })
  ) {
    return input.recoveredBinding
  }

  if (
    doesAssistantResumeBindingMatchRoute({
      binding: input.sessionBinding,
      provider: input.provider,
      providerOptions: input.providerOptions,
      routeId: input.routeId,
      workingDirectoryKey: input.workingDirectoryKey,
    })
  ) {
    return input.sessionBinding
  }

  return null
}

export function doesAssistantResumeBindingMatchRoute(input: {
  binding: AssistantProviderBinding | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
  routeId: string
  workingDirectoryKey: string | null
}): boolean {
  if (input.binding?.provider !== input.provider) {
    return false
  }

  const resumeRouteId = readAssistantProviderResumeRouteId({
    providerBinding: input.binding,
  })
  const resumeWorkspaceKey = readAssistantProviderResumeWorkspaceKey({
    providerBinding: input.binding,
  })
  const resumesOfficialOpenAIResponses =
    shouldUseAssistantOpenAIResponsesApi({
      provider: input.provider,
      ...input.providerOptions,
    }) &&
    shouldUseAssistantOpenAIResponsesApi({
      provider: input.binding.provider,
      ...input.binding.providerOptions,
    })

  if (resumesOfficialOpenAIResponses) {
    return resumeRouteId === input.routeId
  }

  if (input.workingDirectoryKey === null) {
    return false
  }

  return (
    resumeRouteId === input.routeId &&
    resumeWorkspaceKey === input.workingDirectoryKey
  )
}

export function resolveNextAssistantProviderBinding(input: {
  previousBinding: AssistantProviderBinding | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
  providerSessionId: string | null
  providerState: AssistantSessionProviderState | null
  routeId: string | null
  workspaceKey: string | null
}): AssistantProviderBinding {
  const previousBinding =
    input.previousBinding?.provider === input.provider
      ? input.previousBinding
      : null
  const traits = resolveAssistantProviderTraits(input.provider)
  const supportsProviderSessionResume =
    traits.resumeKeyMode === 'provider-session-id' ||
    shouldUseAssistantOpenAIResponsesApi({
      provider: input.provider,
      ...input.providerOptions,
    })
  const nextProviderSessionId =
    supportsProviderSessionResume
      ? resolveNextAssistantProviderSessionId({
          previousBinding,
          providerSessionId: input.providerSessionId,
          routeId: input.routeId,
          workspaceKey: input.workspaceKey,
        })
      : null

  return normalizeAssistantProviderBinding({
    provider: input.provider,
    providerOptions: input.providerOptions,
    providerSessionId: nextProviderSessionId,
    providerState: resolveNextAssistantProviderState({
      previousBinding,
      providerSessionId: nextProviderSessionId,
      providerState: input.providerState ?? null,
      routeId: input.routeId,
      workspaceKey: input.workspaceKey,
    }) as AssistantProviderBinding['providerState'],
  }) as AssistantProviderBinding
}

export function buildRecoveredAssistantProviderBindingSeed(input: {
  currentCodexPromptVersion: string
  previousBinding: AssistantProviderBinding | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
}): AssistantProviderBinding {
  const previousBinding =
    input.previousBinding?.provider === input.provider
      ? input.previousBinding
      : null

  return normalizeAssistantProviderBinding({
    provider: input.provider,
    providerOptions: input.providerOptions,
    providerSessionId: null,
    providerState:
      input.provider === 'codex-cli'
        ? writeAssistantCodexPromptVersion(
            normalizeAssistantProviderBinding({
              provider: input.provider,
              providerOptions: input.providerOptions,
              providerSessionId: null,
              providerState: previousBinding?.providerState ?? null,
            }),
            input.currentCodexPromptVersion,
          )?.providerState ?? null
        : previousBinding?.providerState ?? null,
  }) as AssistantProviderBinding
}

function resolveNextAssistantProviderSessionId(input: {
  previousBinding: AssistantProviderBinding | null
  providerSessionId: string | null
  routeId: string | null
  workspaceKey: string | null
}): string | null {
  if (input.providerSessionId !== null) {
    return input.providerSessionId
  }

  if (
    input.previousBinding &&
    readAssistantProviderResumeRouteId({
      providerBinding: input.previousBinding,
    }) === input.routeId &&
    readAssistantProviderResumeWorkspaceKey({
      providerBinding: input.previousBinding,
    }) === input.workspaceKey
  ) {
    return readAssistantProviderSessionId({
      providerBinding: input.previousBinding,
    })
  }

  return null
}

function resolveNextAssistantProviderState(input: {
  previousBinding: AssistantProviderBinding | null
  providerSessionId: string | null
  providerState: AssistantSessionProviderState | null
  routeId: string | null
  workspaceKey: string | null
}): AssistantSessionProviderState | null {
  if (input.providerSessionId === null) {
    return null
  }

  const previousRouteId =
    input.previousBinding
      ? readAssistantProviderResumeRouteId({
          providerBinding: input.previousBinding,
        })
      : null
  const previousWorkspaceKey =
    input.previousBinding
      ? readAssistantProviderResumeWorkspaceKey({
          providerBinding: input.previousBinding,
        })
      : null
  const baseState =
    input.providerState ??
    (previousRouteId === input.routeId && previousWorkspaceKey === input.workspaceKey
      ? input.previousBinding?.providerState ?? null
      : null)

  return writeAssistantProviderStateResumeWorkspaceKey(
    writeAssistantProviderStateResumeRouteId(baseState, input.routeId),
    input.workspaceKey,
  )
}
