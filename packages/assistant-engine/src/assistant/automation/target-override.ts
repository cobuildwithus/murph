import {
  automationAssistantTargetOverrideSchema,
  normalizeStoredAssistantModel,
  type AutomationAssistantTargetOverride,
} from '@murphai/contracts'
import {
  HOSTED_ASSISTANT_ASTRA_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_GPT_6_LUNA_MODEL,
  isHostedAssistantProductModel,
  type HostedAssistantProductModel,
  type HostedAssistantReasoningEffort,
} from '@murphai/hosted-execution/assistant-model'
import {
  assistantBackendTargetToProviderConfigInput,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'
import {
  OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'

import { normalizeNullableString } from '../shared.js'

// Reviewed replacements apply at execution, after the provider is resolved.
// Keep stored pins intact so their original preference remains inspectable.
const AUTOMATION_OPENAI_MODEL_REPLACEMENTS = new Map<string, HostedAssistantProductModel>([
  ['gpt-5.6-terra', HOSTED_ASSISTANT_SOL_MODEL],
])
const AUTOMATION_OPENAI_MODEL_PROVIDERS = new Set<string>([
  OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
])

const AUTOMATION_DEFAULT_REASONING_BY_HOSTED_PRODUCT_MODEL = {
  [HOSTED_ASSISTANT_ASTRA_MODEL]: 'low',
  [HOSTED_ASSISTANT_TERRA_MODEL]: 'low',
  [HOSTED_ASSISTANT_SOL_MODEL]: 'low',
  [HOSTED_ASSISTANT_GPT_6_LUNA_MODEL]: 'low',
} as const satisfies Record<
  HostedAssistantProductModel,
  HostedAssistantReasoningEffort
>

export function compactAutomationAssistantTargetOverride(
  input: AutomationAssistantTargetOverride | null | undefined,
): AutomationAssistantTargetOverride | null {
  if (!input) {
    return null
  }

  const model = normalizeStoredAssistantModel(normalizeNullableString(input.model))
  const modelProvider = normalizeNullableString(input.modelProvider)
  const reasoningEffort = normalizeNullableString(input.reasoningEffort)
  const target = {
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }

  return Object.keys(target).length > 0
    ? automationAssistantTargetOverrideSchema.parse(target)
    : null
}

function resolveAutomationAssistantTargetOverrideDefaults(
  input: AutomationAssistantTargetOverride | null | undefined,
  modelProvider: string | null | undefined,
): AutomationAssistantTargetOverride | null {
  const storedTarget = compactAutomationAssistantTargetOverride(input)
  const replacement = modelProvider && AUTOMATION_OPENAI_MODEL_PROVIDERS.has(modelProvider)
    ? AUTOMATION_OPENAI_MODEL_REPLACEMENTS.get(storedTarget?.model ?? '')
    : undefined
  const target = replacement ? { ...storedTarget, model: replacement } : storedTarget
  if (
    !target?.model ||
    target.reasoningEffort ||
    !isHostedAssistantProductModel(target.model)
  ) {
    return target
  }

  return {
    ...target,
    reasoningEffort:
      AUTOMATION_DEFAULT_REASONING_BY_HOSTED_PRODUCT_MODEL[target.model],
  }
}

export function automationAssistantTargetOverrideToProviderConfigInput(
  input: AutomationAssistantTargetOverride | null | undefined,
  modelProvider?: string | null,
): AssistantProviderConfigInput | null {
  const target = resolveAutomationAssistantTargetOverrideDefaults(input, modelProvider)
  if (!target) {
    return null
  }

  return {
    ...(target.model ? { model: target.model } : {}),
    ...(target.modelProvider ? { modelProvider: target.modelProvider } : {}),
    ...(target.reasoningEffort ? { reasoningEffort: target.reasoningEffort } : {}),
  }
}

export function resolveAutomationAssistantTargetOverrideForTarget(
  input: AutomationAssistantTargetOverride | null | undefined,
  baseTarget: AssistantModelTarget | null | undefined,
): AssistantProviderConfigInput | null {
  const baseConfig = baseTarget
    ? assistantBackendTargetToProviderConfigInput(baseTarget)
    : null
  const storedOverride = compactAutomationAssistantTargetOverride(input)
  const explicitModelProvider = normalizeNullableString(storedOverride?.modelProvider)
  const effectiveModelProvider =
    explicitModelProvider ?? normalizeNullableString(baseConfig?.modelProvider)
  return automationAssistantTargetOverrideToProviderConfigInput(
    storedOverride,
    effectiveModelProvider,
  )
}
