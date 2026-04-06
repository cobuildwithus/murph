import * as React from 'react'
import { type AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { resolveCodexDisplayOptions } from '@murphai/assistant-engine/assistant-codex'
import {
  buildAssistantProviderDefaultsPatch,
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
  saveAssistantOperatorDefaultsPatch,
} from '@murphai/operator-config/operator-config'
import { normalizeNullableString } from '@murphai/assistant-engine/assistant-runtime'

import {
  discoverAssistantProviderModels,
  resolveAssistantModelCatalog,
  type AssistantModelDiscoveryResult,
} from '../provider-catalog.js'
import { updateAssistantSessionOptions, type AssistantChatInput } from '../service.js'

function assistantModelDiscoveryResultsEqual(
  left: AssistantModelDiscoveryResult | null,
  right: AssistantModelDiscoveryResult | null,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return (
    left.status === right.status &&
    (normalizeNullableString(left.message) ?? null) ===
      (normalizeNullableString(right.message) ?? null) &&
    left.models.length === right.models.length &&
    left.models.every((model, index) => model.id === right.models[index]?.id)
  )
}

export function useAssistantModelCatalogState(input: {
  activeModel: string | null
  activeReasoningEffort: string | null
  session: AssistantSession
}) {
  const [modelDiscovery, setModelDiscovery] =
    React.useState<AssistantModelDiscoveryResult | null>(null)
  const modelCatalog = resolveAssistantModelCatalog({
    provider: input.session.provider,
    baseUrl: input.session.providerOptions.baseUrl,
    currentModel: input.activeModel,
    currentReasoningEffort: input.activeReasoningEffort,
    discovery: modelDiscovery,
    headers: input.session.providerOptions.headers ?? null,
    apiKeyEnv: input.session.providerOptions.apiKeyEnv,
    oss: input.session.providerOptions.oss,
    providerName: input.session.providerOptions.providerName,
  })

  React.useEffect(() => {
    let cancelled = false
    const baseUrl = normalizeNullableString(input.session.providerOptions.baseUrl)

    if (!modelCatalog.capabilities.supportsModelDiscovery || !baseUrl) {
      setModelDiscovery((existing) => (existing === null ? existing : null))
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      const nextDiscovery = await discoverAssistantProviderModels({
        provider: input.session.provider,
        baseUrl,
        apiKeyEnv: input.session.providerOptions.apiKeyEnv,
        headers: input.session.providerOptions.headers ?? null,
        providerName: input.session.providerOptions.providerName,
      })

      if (cancelled) {
        return
      }

      setModelDiscovery((existing) =>
        assistantModelDiscoveryResultsEqual(existing, nextDiscovery)
          ? existing
          : nextDiscovery,
      )
    })()

    return () => {
      cancelled = true
    }
  }, [
    modelCatalog.capabilities.supportsModelDiscovery,
    input.session.provider,
    input.session.providerOptions.apiKeyEnv,
    input.session.providerOptions.baseUrl,
    input.session.providerOptions.headers,
    input.session.providerOptions.providerName,
  ])

  return modelCatalog
}

export async function persistAssistantModelSelection(input: {
  defaults: Awaited<ReturnType<typeof resolveAssistantOperatorDefaults>>
  nextModel: string | null
  nextReasoningEffort: string | null
  session: AssistantSession
  vault: AssistantChatInput['vault']
}): Promise<AssistantSession> {
  const updatedSession = await updateAssistantSessionOptions({
    vault: input.vault,
    sessionId: input.session.sessionId,
    providerOptions: {
      model: input.nextModel,
      reasoningEffort: input.nextReasoningEffort,
    },
  })

  await saveAssistantOperatorDefaultsPatch(
    buildAssistantProviderDefaultsPatch({
      defaults: input.defaults,
      provider: updatedSession.provider,
      providerConfig: {
        ...updatedSession.providerOptions,
        model: input.nextModel,
        reasoningEffort: input.nextReasoningEffort,
      },
    }),
  )

  return updatedSession
}

export function resolveInitialAssistantSelection(input: {
  codexDisplay: Awaited<ReturnType<typeof resolveCodexDisplayOptions>>
  input: AssistantChatInput
  resolvedSession: AssistantSession
  selectedProviderDefaults: ReturnType<typeof resolveAssistantProviderDefaults>
}): {
  initialActiveModel: string | null
  initialActiveReasoningEffort: string | null
} {
  return {
    initialActiveModel:
      normalizeNullableString(input.input.model) ??
      normalizeNullableString(input.selectedProviderDefaults?.model) ??
      normalizeNullableString(input.resolvedSession.providerOptions.model) ??
      normalizeNullableString(input.codexDisplay.model),
    initialActiveReasoningEffort:
      normalizeNullableString(input.input.reasoningEffort) ??
      normalizeNullableString(input.selectedProviderDefaults?.reasoningEffort) ??
      normalizeNullableString(input.resolvedSession.providerOptions.reasoningEffort),
  }
}
