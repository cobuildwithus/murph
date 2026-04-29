import type {
  AssistantSessionResumeState,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import { resolveAssistantBackendTarget } from '@murphai/operator-config/operator-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  buildAssistantPrimaryProviderRoute,
  type ResolvedAssistantProviderRoute,
} from './provider-route.js'
import {
  compactAssistantProviderConfigInput,
  mergeAssistantProviderConfigsForProvider,
  type AssistantProviderConfig,
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'

export interface AssistantExecutionPlan {
  primaryProviderConfig: AssistantProviderConfig
  primaryTarget: AssistantModelTarget
  resumeState: AssistantSessionResumeState | null
  routes: ResolvedAssistantProviderRoute[]
}

export function resolveAssistantExecutionPlan(input: {
  boundaryDefaultTarget?: AssistantModelTarget | null
  defaults: AssistantOperatorDefaults | null
  override?: AssistantProviderConfigInput | null
  resumeState?: AssistantSessionResumeState | null
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
  const resolvedProvider =
    overrideConfig?.provider ??
    baseProviderConfig?.provider ??
    null

  if (!resolvedProvider) {
    throw new VaultCliError(
      'ASSISTANT_TARGET_REQUIRED',
      'Assistant execution requires an explicit target or a boundary default.',
    )
  }

  const primaryProviderConfig = mergeAssistantProviderConfigsForProvider(
    resolvedProvider,
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
  if (primaryTarget.adapter !== 'codex-cli') {
    throw new VaultCliError(
      'ASSISTANT_PROVIDER_UNSUPPORTED',
      'Assistant execution only supports Codex app-server targets.',
    )
  }

  const routes = [buildAssistantPrimaryProviderRoute(primaryProviderConfig)]

  return {
    primaryProviderConfig,
    primaryTarget,
    resumeState: input.resumeState ?? null,
    routes,
  }
}
