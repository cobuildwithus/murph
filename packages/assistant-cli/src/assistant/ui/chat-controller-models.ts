import * as React from 'react'
import { type AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { resolveCodexDisplayOptions } from '@murphai/assistant-engine/assistant-codex'
import {
  buildAssistantProviderDefaultsPatch,
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
  saveAssistantOperatorDefaultsPatch,
} from '@murphai/operator-config/operator-config'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'

import {
  resolveCodexModelCatalog,
} from '@murphai/assistant-engine/assistant-provider-catalog'
import { updateAssistantSessionOptions, type AssistantChatInput } from '../service.js'

export function useAssistantModelCatalogState(input: {
  activeModel: string | null
  activeReasoningEffort: string | null
  session: AssistantSession
}) {
  return React.useMemo(
    () =>
      resolveCodexModelCatalog({
        provider: input.session.provider,
        currentModel: input.activeModel,
        currentReasoningEffort: input.activeReasoningEffort,
        oss: input.session.providerOptions.oss,
      }),
    [
      input.activeModel,
      input.activeReasoningEffort,
      input.session.provider,
      input.session.providerOptions.oss,
    ],
  )
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
      provider: input.session.provider,
      model: input.nextModel,
      reasoningEffort: input.nextReasoningEffort,
    },
  })

  await saveAssistantOperatorDefaultsPatch(
    buildAssistantProviderDefaultsPatch({
      defaults: input.defaults,
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
      normalizeNullableString(input.resolvedSession.providerOptions.model),
    initialActiveReasoningEffort:
      normalizeNullableString(input.input.reasoningEffort) ??
      normalizeNullableString(input.selectedProviderDefaults?.reasoningEffort) ??
      normalizeNullableString(input.resolvedSession.providerOptions.reasoningEffort),
  }
}
