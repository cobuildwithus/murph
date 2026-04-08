import type {
  AssistantProviderFailoverRoute,
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
  buildAssistantFailoverRoutes,
  type ResolvedAssistantFailoverRoute,
} from './failover.js'
import {
  compactAssistantProviderConfigInput,
  inferAssistantProviderFromConfigInput,
  mergeAssistantProviderConfigsForProvider,
  serializeAssistantProviderSessionOptions,
  type AssistantProviderConfig,
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'

export interface AssistantExecutionPlan {
  primaryProviderConfig: AssistantProviderConfig
  primaryTarget: AssistantModelTarget
  resumeState: AssistantSessionResumeState | null
  routes: ResolvedAssistantFailoverRoute[]
}

export function resolveAssistantExecutionPlan(input: {
  backups?: readonly AssistantProviderFailoverRoute[] | null
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
    inferAssistantProviderFromConfigInput(overrideConfig) ??
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

  const routes = buildAssistantFailoverRoutes({
    backups: input.backups ?? input.defaults?.failoverRoutes ?? null,
    codexCommand:
      primaryTarget.adapter === 'codex-cli'
        ? primaryTarget.codexCommand ?? null
        : null,
    defaults: input.defaults,
    provider: primaryTarget.adapter,
    providerOptions: serializeAssistantProviderSessionOptions(
      primaryProviderConfig,
    ),
  })

  return {
    primaryProviderConfig,
    primaryTarget,
    resumeState: input.resumeState ?? null,
    routes,
  }
}
