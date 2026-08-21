import {
  assistantBackendTargetToProviderConfigInput,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import {
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  resolveAssistantCodexUsageProviderName,
} from '@murphai/operator-config/assistant/target-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { CodexThreadIdentity } from './codex-thread-route.js'
import {
  compactAssistantProviderConfigInput,
  type AssistantProviderConfigInput,
} from '@murphai/operator-config/assistant/provider-config'
import {
  buildResolveAssistantSessionInput,
} from './session-resolution.js'
import type {
  AssistantMessageInput,
  ResolvedAssistantSession,
} from './service-contracts.js'
import {
  isAssistantSessionNotFoundError,
  resolveAssistantSession,
} from './store.js'
import { resolveAssistantExecutionPlan } from './execution-plan.js'
import {
  resolveAutomationAssistantTargetOverrideForTarget,
} from './automation/target-override.js'

export function resolveAssistantTurnRoute(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  resolved: ResolvedAssistantSession,
): CodexThreadIdentity {
  return resolveAssistantExecutionPlan({
    defaults,
    override: resolveAssistantTurnRouteOverride(
      input,
      resolved.session.target,
    ),
    sessionTarget: resolved.session.target,
  }).codexRoute
}

export async function resolveAssistantTurnRouteForMessage(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  boundaryDefaultTarget: AssistantModelTarget | null = null,
): Promise<CodexThreadIdentity> {
  const sessionInput = buildResolveAssistantSessionInput(
    input,
    defaults,
    boundaryDefaultTarget,
  )

  try {
    const resolved = await resolveAssistantSession({
      ...sessionInput,
      createIfMissing: false,
    })
    return resolveAssistantTurnRoute(input, defaults, resolved)
  } catch (error) {
    if (!isAssistantSessionNotFoundError(error)) {
      throw error
    }

    return resolveAssistantExecutionPlan({
      defaults: null,
      override: resolveAssistantTurnAutomationTargetOverride(
        input,
        sessionInput.target,
      ),
      sessionTarget: sessionInput.target,
    }).codexRoute
  }
}

function resolveAssistantTurnRouteOverride(
  input: AssistantMessageInput,
  baseTarget: AssistantModelTarget | null,
): AssistantProviderConfigInput | null {
  const messageOverride = compactAssistantProviderConfigInput(input)
  const automationBaseTarget = applyAssistantProviderConfigOverrideToTarget(
    baseTarget,
    messageOverride,
  )
  const automationOverride =
    resolveAssistantTurnAutomationTargetOverride(
      input,
      automationBaseTarget,
    )

  return compactAssistantProviderConfigInput({
    ...(messageOverride ?? {}),
    ...(automationOverride ?? {}),
  })
}

function resolveAssistantTurnAutomationTargetOverride(
  input: AssistantMessageInput,
  baseTarget: AssistantModelTarget | null | undefined,
): AssistantProviderConfigInput | null {
  if (input.maintenanceProfile !== 'member-memory') {
    return resolveAutomationAssistantTargetOverrideForTarget(
      input.assistantTargetOverride,
      baseTarget,
    )
  }

  // The profile is engine-owned. Its persisted automation target is ignored;
  // the invocation's already-hydrated provider remains the provider authority.
  const baseProvider = resolveAssistantCodexUsageProviderName(
    baseTarget
      ? assistantBackendTargetToProviderConfigInput(baseTarget).modelProvider ?? null
      : null,
  )
  if (baseProvider === HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID) {
    return {
      model: 'gpt-5.5',
      reasoningEffort: 'low',
    }
  }
  if (baseProvider === HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID) {
    return null
  }
  throw new VaultCliError(
    'ASSISTANT_PROVIDER_UNSUPPORTED',
    'The selected provider cannot execute the member-memory maintenance tool contract.',
  )
}

function applyAssistantProviderConfigOverrideToTarget(
  baseTarget: AssistantModelTarget | null,
  override: AssistantProviderConfigInput | null,
): AssistantModelTarget | null {
  if (!override) {
    return baseTarget
  }

  return resolveAssistantExecutionPlan({
    defaults: null,
    override,
    sessionTarget: baseTarget,
  }).primaryTarget
}
