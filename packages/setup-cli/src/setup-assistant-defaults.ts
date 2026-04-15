import {
  buildAssistantProviderDefaultsPatch,
  resolveAssistantBackendTarget,
  resolveAssistantProviderDefaults,
  type AssistantOperatorDefaults,
} from '@murphai/operator-config/operator-config'
import type {
  SetupCommandOptions,
  SetupConfiguredAssistant,
} from '@murphai/operator-config/setup-cli-contracts'

export function assistantSelectionToOperatorDefaults(
  assistant: SetupConfiguredAssistant,
  existingDefaults: AssistantOperatorDefaults | null,
): Partial<AssistantOperatorDefaults> {
  if (!assistant.provider) {
    return {
      backend: null,
      account: assistant.account ?? null,
    }
  }

  return {
    ...buildAssistantProviderDefaultsPatch({
      defaults: existingDefaults,
      provider: assistant.provider,
      providerConfig: {
        model: assistant.model,
        ...(assistant.codexCommand !== null
          ? {
              codexCommand: assistant.codexCommand,
            }
          : {}),
        ...(assistant.codexHome !== undefined
          ? {
              codexHome: assistant.codexHome ?? null,
            }
          : {}),
        reasoningEffort: assistant.reasoningEffort,
        sandbox: assistant.sandbox,
        approvalPolicy: assistant.approvalPolicy,
        profile: assistant.profile,
        oss: assistant.oss === true,
        baseUrl: assistant.baseUrl,
        apiKeyEnv: assistant.apiKeyEnv,
        presetId: assistant.presetId ?? null,
        providerName: assistant.providerName,
        ...(assistant.zeroDataRetention === true
          ? { zeroDataRetention: true }
          : {}),
      },
    }),
    account: assistant.account ?? null,
  }
}

export function assistantOperatorDefaultsMatch(
  existing: AssistantOperatorDefaults | null,
  next: Partial<AssistantOperatorDefaults>,
): boolean {
  return (
    JSON.stringify(resolveAssistantBackendTarget(existing)) ===
      JSON.stringify(next.backend ?? null) &&
    JSON.stringify(existing?.account ?? null) ===
      JSON.stringify(next.account ?? null)
  )
}

export function formatAssistantDefaultsSummary(
  assistant: SetupConfiguredAssistant,
): string {
  if (assistant.provider === 'openai-compatible') {
    return appendAssistantAccountSummary(
      assistant.baseUrl
        ? `${assistant.model ?? 'the configured model'} via ${assistant.baseUrl}`
        : `${assistant.model ?? 'the configured model'} via the saved OpenAI-compatible endpoint`,
      assistant.account ?? null,
    )
  }

  if (assistant.oss) {
    return appendAssistantAccountSummary(
      `${assistant.model ?? 'the configured local model'} in Codex OSS`,
      assistant.account ?? null,
    )
  }

  return appendAssistantAccountSummary(
    `${assistant.model ?? 'the configured model'} in Codex CLI`,
    assistant.account ?? null,
  )
}

export function formatSavedAssistantDefaultsSummary(
  defaults: AssistantOperatorDefaults | null | undefined,
): string | null {
  const backend = resolveAssistantBackendTarget(defaults)
  if (!backend) {
    return null
  }

  switch (backend.adapter) {
    case 'openai-compatible':
      return appendAssistantAccountSummary(
        backend.endpoint
          ? `${backend.model ?? 'the configured model'} via ${backend.endpoint}`
          : `${backend.model ?? 'the configured model'} via the saved OpenAI-compatible endpoint`,
        defaults?.account ?? null,
      )
    case 'codex-cli':
    default:
      return appendAssistantAccountSummary(
        backend.oss
          ? `${backend.model ?? 'the configured local model'} in Codex OSS`
          : `${backend.model ?? 'the configured model'} in Codex CLI`,
        defaults?.account ?? null,
      )
  }
}

export function buildSetupAssistantOptionsFromDefaults(
  defaults: AssistantOperatorDefaults | null | undefined,
): Partial<SetupCommandOptions> {
  const backend = resolveAssistantBackendTarget(defaults)
  if (!backend) {
    return {}
  }

  switch (backend.adapter) {
    case 'openai-compatible': {
      const savedDefaults = resolveAssistantProviderDefaults(
        defaults ?? null,
        'openai-compatible',
      )

      return {
        assistantPreset: 'openai-compatible',
        assistantProviderPreset: savedDefaults?.presetId ?? undefined,
        assistantModel: savedDefaults?.model ?? undefined,
        assistantBaseUrl: savedDefaults?.baseUrl ?? undefined,
        assistantApiKeyEnv: savedDefaults?.apiKeyEnv ?? undefined,
        assistantProviderName: savedDefaults?.providerName ?? undefined,
        assistantReasoningEffort: savedDefaults?.reasoningEffort ?? undefined,
        ...(savedDefaults?.zeroDataRetention === true
          ? {
              assistantZeroDataRetention: true,
            }
          : {}),
      }
    }

    case 'codex-cli':
    default: {
      const savedDefaults = resolveAssistantProviderDefaults(
        defaults ?? null,
        'codex-cli',
      )

      return {
        assistantPreset: 'codex',
        assistantModel: savedDefaults?.model ?? undefined,
        assistantCodexCommand: savedDefaults?.codexCommand ?? undefined,
        assistantCodexHome: savedDefaults?.codexHome ?? undefined,
        assistantProfile: savedDefaults?.profile ?? undefined,
        assistantReasoningEffort: savedDefaults?.reasoningEffort ?? undefined,
        assistantOss: savedDefaults?.oss === true ? true : undefined,
      }
    }
  }
}

function normalizeNullableConfigField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function appendAssistantAccountSummary(
  summary: string,
  account:
    | SetupConfiguredAssistant['account']
    | AssistantOperatorDefaults['account']
    | null
    | undefined,
): string {
  const planName = normalizeNullableConfigField(account?.planName)
  if (planName) {
    return `${summary} (${planName} account)`
  }

  if (account?.kind === 'api-key') {
    return `${summary} (API key account)`
  }

  return summary
}
