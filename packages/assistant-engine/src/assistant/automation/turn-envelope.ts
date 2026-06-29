import type { AutomationAssistantTargetOverride } from '@murphai/contracts'
import type { AssistantTurnTrigger } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantExecutionContext } from '../execution-context.js'
import type { AssistantOutboxDispatchMode } from '../outbox.js'
import type { AssistantProviderServiceTier } from '../providers/types.js'
import type {
  AssistantMessageInput,
  AssistantTurnEnvironment,
} from '../service-contracts.js'
import { normalizeNullableString } from '../shared.js'

export type AssistantAutomationTurnEnvelope = Pick<
  AssistantMessageInput,
  | 'abortSignal'
  | 'deliveryDispatchMode'
  | 'executionContext'
  | 'model'
  | 'modelProvider'
  | 'providerConfigPersistence'
  | 'reasoningEffort'
  | 'serviceTier'
  | 'turnEnvironment'
  | 'turnTrigger'
>

export function buildAssistantAutomationTurnEnvelope(input: {
  assistantTargetOverride?: AutomationAssistantTargetOverride | null
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  executionContext?: AssistantExecutionContext | null
  serviceTier?: AssistantProviderServiceTier | null
  signal?: AbortSignal
  turnEnvironment?: AssistantTurnEnvironment | null
  turnTrigger: AssistantTurnTrigger
}): AssistantAutomationTurnEnvelope {
  const targetOverride = compactAutomationAssistantTargetOverride(
    input.assistantTargetOverride,
  )

  return {
    abortSignal: input.signal,
    deliveryDispatchMode: input.deliveryDispatchMode,
    executionContext: input.executionContext,
    ...(targetOverride?.model ? { model: targetOverride.model } : {}),
    ...(targetOverride?.modelProvider
      ? { modelProvider: targetOverride.modelProvider }
      : {}),
    ...(targetOverride ? { providerConfigPersistence: 'turn' as const } : {}),
    ...(targetOverride?.reasoningEffort
      ? { reasoningEffort: targetOverride.reasoningEffort }
      : {}),
    serviceTier: input.serviceTier ?? null,
    turnEnvironment: input.turnEnvironment ?? null,
    turnTrigger: input.turnTrigger,
  }
}

function compactAutomationAssistantTargetOverride(
  input: AutomationAssistantTargetOverride | null | undefined,
): AutomationAssistantTargetOverride | null {
  if (!input) {
    return null
  }

  const model = normalizeNullableString(input.model)
  const modelProvider = normalizeNullableString(input.modelProvider)
  const reasoningEffort = normalizeNullableString(input.reasoningEffort)
  const target: AutomationAssistantTargetOverride = {
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }

  return Object.keys(target).length > 0 ? target : null
}
