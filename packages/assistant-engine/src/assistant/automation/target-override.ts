import {
  automationAssistantTargetOverrideSchema,
  type AutomationAssistantTargetOverride,
} from '@murphai/contracts'
import {
  HOSTED_ASSISTANT_ASTRA_MODEL,
  HOSTED_ASSISTANT_GPT_6_SOL_MODEL,
  HOSTED_ASSISTANT_GPT_6_LUNA_MODEL,
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS,
  isHostedAssistantProductModel,
  type HostedAssistantProductModel,
  type HostedAssistantReasoningEffort,
} from '@murphai/hosted-execution/assistant-model'
import {
  assistantBackendTargetToProviderConfigInput,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  compactAssistantProviderConfigInput,
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'
import {
  assistantCodexModelProviderRequiresModelThreadCompatibility,
  VENICE_CODEX_MODEL_PROVIDER_ID,
  OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'

import { normalizeNullableString } from '../shared.js'

// Reviewed replacements apply at execution, after the provider is resolved.
// Keep stored pins intact so a provider switch or rollback can resolve them again.
const AUTOMATION_OPENAI_MODEL_REPLACEMENTS = new Map<string, HostedAssistantProductModel>([
  [HOSTED_ASSISTANT_LUNA_MODEL, HOSTED_ASSISTANT_GPT_6_LUNA_MODEL],
  [HOSTED_ASSISTANT_SOL_MODEL, HOSTED_ASSISTANT_GPT_6_SOL_MODEL],
  ['gpt-5.6-terra', HOSTED_ASSISTANT_GPT_6_SOL_MODEL],
])
const AUTOMATION_OPENAI_MODEL_PROVIDERS = new Set<string>([
  OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
])

const AUTOMATION_DEFAULT_REASONING_BY_HOSTED_PRODUCT_MODEL = {
  [HOSTED_ASSISTANT_LUNA_MODEL]: 'high',
  [HOSTED_ASSISTANT_SOL_MODEL]: 'low',
  [HOSTED_ASSISTANT_ASTRA_MODEL]: 'low',
  [HOSTED_ASSISTANT_GPT_6_SOL_MODEL]: 'low',
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

  const model = normalizeNullableString(input.model)
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

/**
 * Resolve a persisted turn override against the model provider that will
 * actually execute it. Hosted product model names are managed-inference
 * preferences, not portable model ids for endpoints whose thread identity
 * depends on the exact model. Explicit provider transitions and arbitrary
 * custom model ids remain available to canonical CLI/internal authors.
 */
export function resolveAutomationAssistantTargetOverrideForTarget(
  input: AutomationAssistantTargetOverride | null | undefined,
  baseTarget: AssistantModelTarget | null | undefined,
): AssistantProviderConfigInput | null {
  const storedOverride = compactAutomationAssistantTargetOverride(input)
  if (!storedOverride) {
    return null
  }

  const baseConfig = baseTarget
    ? assistantBackendTargetToProviderConfigInput(baseTarget)
    : null
  const explicitModelProvider = normalizeNullableString(storedOverride.modelProvider)
  const effectiveModelProvider =
    explicitModelProvider ?? normalizeNullableString(baseConfig?.modelProvider)
  const override = automationAssistantTargetOverrideToProviderConfigInput(
    storedOverride,
    effectiveModelProvider,
  )
  if (!override) {
    return override
  }

  const supportsReasoningEffort =
    !assistantCodexModelProviderRequiresModelThreadCompatibility(
      effectiveModelProvider,
    )
  const suppressProductModel =
    explicitModelProvider === null &&
    (isHostedAssistantProductModel(override.model) ||
      override.model === 'gpt-5.6-terra') &&
    (!supportsReasoningEffort ||
      (effectiveModelProvider === VENICE_CODEX_MODEL_PROVIDER_ID &&
        (!isHostedAssistantProductModel(override.model) ||
          !HOSTED_ASSISTANT_VENICE_PROVIDER_MODELS[override.model])))
  if (!suppressProductModel && supportsReasoningEffort) {
    return override
  }

  const model = suppressProductModel ? null : override.model ?? null
  const reasoningEffort = supportsReasoningEffort
    ? override.reasoningEffort ?? null
    : null

  return compactAssistantProviderConfigInput({
    model,
    modelProvider: explicitModelProvider,
    reasoningEffort,
  })
}
