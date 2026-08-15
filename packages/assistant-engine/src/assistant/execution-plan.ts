import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import { resolveAssistantBackendTarget } from '@murphai/operator-config/operator-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  buildCodexThreadIdentity,
  type CodexThreadIdentity,
} from './codex-thread-route.js'
import {
  compactAssistantProviderConfigInput,
  mergeAssistantProviderConfigs,
  type AssistantProviderConfig,
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'

export interface AssistantExecutionPlan {
  codexRoute: CodexThreadIdentity
  primaryProviderConfig: AssistantProviderConfig
  primaryTarget: AssistantModelTarget
}

export function resolveAssistantExecutionPlan(input: {
  boundaryDefaultTarget?: AssistantModelTarget | null
  defaults: AssistantOperatorDefaults | null
  override?: AssistantProviderConfigInput | null
  sessionTarget?: AssistantModelTarget | null
}): AssistantExecutionPlan {
  const baseTarget =
    input.sessionTarget ??
    resolveAssistantBackendTarget(input.defaults) ??
    input.boundaryDefaultTarget ??
    null
  const baseProviderConfig = baseTarget
    ? assistantBackendTargetToProviderConfigInput(baseTarget)
    : null
  const overrideConfig = compactAssistantProviderConfigInput(input.override)

  if (!baseProviderConfig && !overrideConfig) {
    throw new VaultCliError(
      'ASSISTANT_TARGET_REQUIRED',
      'Assistant execution requires an explicit target or a boundary default.',
    )
  }

  const primaryProviderConfig = mergeAssistantProviderConfigs(
    baseProviderConfig,
    overrideConfig,
  )
  const primaryTarget = createAssistantModelTarget(primaryProviderConfig)

  if (!primaryTarget) {
    throw new VaultCliError(
      'ASSISTANT_TARGET_REQUIRED',
      'Assistant execution requires an explicit target or a boundary default.',
    )
  }
  const codexRoute = buildCodexThreadIdentity(primaryProviderConfig)

  return {
    codexRoute,
    primaryProviderConfig,
    primaryTarget,
  }
}
