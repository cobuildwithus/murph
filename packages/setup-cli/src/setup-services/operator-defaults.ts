import {
  normalizeVaultForConfig,
  readOperatorConfig,
  saveAssistantOperatorDefaultsPatch,
  saveDefaultVaultConfig,
} from '@murphai/operator-config/operator-config'
import type {
  SetupConfiguredAssistant,
  SetupStepResult,
} from '@murphai/operator-config/setup-cli-contracts'
import {
  assistantOperatorDefaultsMatch,
  assistantSelectionToOperatorDefaults,
  formatAssistantDefaultsSummary,
} from '../setup-assistant-defaults.js'
import { createStep } from './steps.js'

/**
 * Operator default persistence owns the optional post-setup writes to the
 * operator config, separate from the rest of host/tool provisioning.
 */

export async function ensureDefaultVaultSelection(input: {
  dryRun: boolean
  homeDirectory: string
  steps: SetupStepResult[]
  vault: string
}): Promise<void> {
  const existing = await readOperatorConfig(input.homeDirectory)
  const existingDefaultVault =
    existing?.defaultVault === null || existing?.defaultVault === undefined
      ? null
      : existing.defaultVault
  const nextDefaultVault = normalizeVaultForConfig(input.vault, input.homeDirectory)
  const status =
    existingDefaultVault === nextDefaultVault
      ? 'reused'
      : input.dryRun
        ? 'planned'
        : 'completed'
  const detail =
    existingDefaultVault === nextDefaultVault
      ? `Reusing ${nextDefaultVault} as the default Murph vault for future CLI commands.`
      : input.dryRun
        ? `Would save ${nextDefaultVault} as the default Murph vault for future CLI commands.`
        : `Saved ${nextDefaultVault} as the default Murph vault for future CLI commands.`

  if (!input.dryRun && existingDefaultVault !== nextDefaultVault) {
    await saveDefaultVaultConfig(input.vault, input.homeDirectory)
  }

  input.steps.push(
    createStep({
      detail,
      id: 'default-vault',
      kind: 'configure',
      status,
      title: 'Default vault selection',
    }),
  )
}

export async function configureSetupOperatorDefaults(input: {
  assistant: SetupConfiguredAssistant | null
  dryRun: boolean
  env?: NodeJS.ProcessEnv
  homeDirectory: string
  notes: string[]
  steps: SetupStepResult[]
  vault: string
}): Promise<SetupConfiguredAssistant | null> {
  await ensureDefaultVaultSelection({
    dryRun: input.dryRun,
    homeDirectory: input.homeDirectory,
    steps: input.steps,
    vault: input.vault,
  })

  if (input.assistant == null) {
    return null
  }

  return await ensureAssistantDefaultSelection({
    assistant: input.assistant,
    dryRun: input.dryRun,
    env: input.env,
    homeDirectory: input.homeDirectory,
    notes: input.notes,
    steps: input.steps,
  })
}

export async function ensureAssistantDefaultSelection(input: {
  assistant: SetupConfiguredAssistant
  dryRun: boolean
  env?: NodeJS.ProcessEnv
  homeDirectory: string
  notes: string[]
  steps: SetupStepResult[]
}): Promise<SetupConfiguredAssistant> {
  if (!input.assistant.enabled || input.assistant.provider === null) {
    input.steps.push(
      createStep({
        detail:
          'Skipped saving assistant defaults during setup and left any existing assistant config unchanged.',
        id: 'assistant-defaults',
        kind: 'configure',
        status: 'skipped',
        title: 'Assistant defaults',
      }),
    )
    return input.assistant
  }

  const existing = await readOperatorConfig(input.homeDirectory)
  const nextDefaults = assistantSelectionToOperatorDefaults(
    input.assistant,
    existing?.assistant ?? null,
  )
  const status = assistantOperatorDefaultsMatch(
    existing?.assistant ?? null,
    nextDefaults,
  )
    ? 'reused'
    : input.dryRun
      ? 'planned'
      : 'completed'
  const summary = formatAssistantDefaultsSummary(input.assistant)
  const detail =
    status === 'reused'
      ? `Reusing ${summary} as the default assistant for future chats and auto-reply.`
      : input.dryRun
        ? `Would save ${summary} as the default assistant for future chats and auto-reply.`
        : `Saved ${summary} as the default assistant for future chats and auto-reply.`

  if (status !== 'reused' && !input.dryRun) {
    await saveAssistantOperatorDefaultsPatch(nextDefaults, input.homeDirectory)
  }

  if (
    input.assistant.provider === 'openai-compatible' &&
    input.assistant.apiKeyEnv &&
    !input.env?.[input.assistant.apiKeyEnv]?.trim()
  ) {
    input.notes.push(
      `Export ${input.assistant.apiKeyEnv} before using the saved OpenAI-compatible assistant backend.`,
    )
  }

  input.steps.push(
    createStep({
      detail,
      id: 'assistant-defaults',
      kind: 'configure',
      status,
      title: 'Assistant defaults',
    }),
  )

  return input.assistant
}
