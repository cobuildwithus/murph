import type { AssistantExecutionDriver } from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export interface AssistantResponsesRequestPolicy {
  gatewayOnlyProviders?: readonly string[]
  gatewayZeroDataRetention?: boolean
}

export interface AssistantModelSpec {
  apiKey?: string
  apiKeyEnv?: string
  apiKeyEnvValue?: string | null
  baseUrl?: string
  executionDriver?: AssistantExecutionDriver
  headers?: Record<string, string>
  model: string
  providerName?: string
  responsesRequestPolicy?: AssistantResponsesRequestPolicy
}

export const ASSISTANT_MODEL_CONFIG_INVALID_CODE =
  'assistant_model_config_invalid' as const

export function isAssistantModelConfigurationError(
  error: unknown,
): error is VaultCliError {
  return (
    error instanceof VaultCliError &&
    error.code === ASSISTANT_MODEL_CONFIG_INVALID_CODE
  )
}

export function assertAssistantModelSpecReadyForExecution(
  spec: AssistantModelSpec,
): void {
  const configuredExecutionDriver =
    typeof spec.executionDriver === 'string' && spec.executionDriver.trim().length > 0
      ? spec.executionDriver.trim()
      : 'codex-app-server'

  if (configuredExecutionDriver !== 'codex-app-server') {
    throw new VaultCliError(
      ASSISTANT_MODEL_CONFIG_INVALID_CODE,
      'Assistant model configuration is invalid: legacy OpenAI-compatible model execution has been removed. Configure Codex app-server instead.',
      {
        executionDriver: configuredExecutionDriver,
      },
    )
  }

  if (spec.model.trim().length === 0) {
    throw new VaultCliError(
      ASSISTANT_MODEL_CONFIG_INVALID_CODE,
      'Assistant model configuration is invalid: model id is required.',
      {
        executionDriver: configuredExecutionDriver,
      },
    )
  }
}
