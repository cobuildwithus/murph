import { createInterface } from 'node:readline'
import { prepareSetupPromptInput } from './setup-prompt-io.js'
import { VaultCliError } from './vault-cli-errors.js'
import {
  resolveAssistantCodexModelProviderConfig,
} from './assistant/target-runtime.js'
import {
  type SetupChannel,
  type SetupConfiguredWearable,
  type SetupWearable,
  normalizeSetupWearables,
} from './setup-cli-contracts.js'

type HiddenPromptReadline = ReturnType<typeof createInterface> & {
  _writeToOutput?: (stringToWrite: string) => void
}

const TELEGRAM_TOKEN_KEYS = ['TELEGRAM_BOT_TOKEN'] as const
const EMAIL_API_KEY_KEYS = ['AGENTMAIL_API_KEY'] as const
const JUNCTION_API_KEY_KEYS = ['JUNCTION_API_KEY'] as const
const JUNCTION_CLIENT_USER_ID_SECRET_KEYS = ['JUNCTION_CLIENT_USER_ID_SECRET'] as const
const JUNCTION_ENV_KEYS = ['JUNCTION_ENV'] as const
const JUNCTION_REGION_KEYS = ['JUNCTION_REGION'] as const
const JUNCTION_CLIENT_KEY_GROUPS = [
  JUNCTION_API_KEY_KEYS,
  JUNCTION_CLIENT_USER_ID_SECRET_KEYS,
  JUNCTION_ENV_KEYS,
  JUNCTION_REGION_KEYS,
] as const
const WHOOP_CLIENT_ID_KEYS = ['WHOOP_CLIENT_ID'] as const
const WHOOP_CLIENT_SECRET_KEYS = ['WHOOP_CLIENT_SECRET'] as const
const WHOOP_CLIENT_KEY_GROUPS = [WHOOP_CLIENT_ID_KEYS, WHOOP_CLIENT_SECRET_KEYS] as const
const OURA_CLIENT_ID_KEYS = ['OURA_CLIENT_ID'] as const
const OURA_CLIENT_SECRET_KEYS = ['OURA_CLIENT_SECRET'] as const
const OURA_CLIENT_KEY_GROUPS = [OURA_CLIENT_ID_KEYS, OURA_CLIENT_SECRET_KEYS] as const
const STRAVA_CLIENT_ID_KEYS = ['STRAVA_CLIENT_ID'] as const
const STRAVA_CLIENT_SECRET_KEYS = ['STRAVA_CLIENT_SECRET'] as const
const STRAVA_CLIENT_KEY_GROUPS = [STRAVA_CLIENT_ID_KEYS, STRAVA_CLIENT_SECRET_KEYS] as const

export const SETUP_RUNTIME_ENV_NOTICE =
  'Murph can use keys from your current shell for this setup run. Values you enter here are saved to local `.env.local` so future Murph commands can read them.'

export interface SetupWizardRuntimeStatus {
  badge: string
  detail: string
  missingEnv: string[]
  ready: boolean
}

export interface SetupRuntimeEnvResolver {
  getCurrentEnv(): NodeJS.ProcessEnv
  promptForMissing(input: {
    assistantModelProvider?: string | null
    channels: readonly SetupChannel[]
    env: NodeJS.ProcessEnv
    helpText?: readonly string[]
    wearables: readonly SetupWearable[]
  }): Promise<NodeJS.ProcessEnv>
}

export function createSetupRuntimeEnvResolver(): SetupRuntimeEnvResolver {
  return {
    getCurrentEnv() {
      return { ...process.env }
    },
    async promptForMissing(input) {
      const missingKeys = resolveSetupRuntimePromptKeys(input)
      if (missingKeys.length === 0) {
        return {}
      }

      process.stderr.write(`\n${SETUP_RUNTIME_ENV_NOTICE}\n`)
      process.stderr.write(
        'Enter any missing keys for this setup run. Leave a prompt blank to skip it for now.\n\n',
      )
      if (input.helpText && input.helpText.length > 0) {
        process.stderr.write(
          'Type ? or help to reprint the callback, webhook, tunnel, and docs guidance. Type q to cancel setup.\n\n',
        )
      }

      const overrides: NodeJS.ProcessEnv = {}
      for (const key of missingKeys) {
        const value = await promptForRuntimeEnvValue(
          `Enter ${key} for this setup run (leave blank to skip): `,
          input.helpText,
        )
        if (value) {
          overrides[key] = value
        }
      }

      return overrides
    },
  }
}

export function applySetupRuntimeEnvOverridesToProcess(
  envOverrides: NodeJS.ProcessEnv | undefined,
): void {
  if (!envOverrides) {
    return
  }

  for (const [key, value] of Object.entries(envOverrides)) {
    if (typeof value === 'string' && value.trim()) {
      process.env[key] = value
    }
  }
}

export function resolveSetupChannelMissingEnv(
  channel: SetupChannel,
  env: NodeJS.ProcessEnv,
): string[] {
  switch (channel) {
    case 'telegram':
      return hasAnyEnv(env, TELEGRAM_TOKEN_KEYS)
        ? []
        : [TELEGRAM_TOKEN_KEYS[0]]
    case 'email':
      return hasAnyEnv(env, EMAIL_API_KEY_KEYS)
        ? []
        : [EMAIL_API_KEY_KEYS[0]]
  }
}

export function resolveSetupWearableMissingEnv(
  wearable: SetupWearable,
  env: NodeJS.ProcessEnv,
): string[] {
  switch (wearable) {
    case 'garmin':
      return resolvePreferredEnvKeys(env, JUNCTION_CLIENT_KEY_GROUPS)
    case 'oura':
      return resolvePreferredEnvKeys(env, OURA_CLIENT_KEY_GROUPS)
    case 'strava':
      return resolvePreferredEnvKeys(env, STRAVA_CLIENT_KEY_GROUPS)
    case 'whoop':
      return resolvePreferredEnvKeys(env, WHOOP_CLIENT_KEY_GROUPS)
  }
}

export function describeSetupChannelStatus(
  channel: SetupChannel,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): SetupWizardRuntimeStatus {
  void platform
  const missingEnv = resolveSetupChannelMissingEnv(channel, env)

  switch (channel) {
    case 'telegram':
      return missingEnv.length === 0
        ? {
            badge: 'ready',
            detail: 'Bot token is available in the current environment.',
            missingEnv,
            ready: true,
          }
        : {
            badge: 'needs token',
            detail:
              'Add TELEGRAM_BOT_TOKEN to the current environment to enable Telegram auto-reply.',
            missingEnv,
            ready: false,
          }
    case 'email':
      return missingEnv.length === 0
        ? {
            badge: 'ready',
            detail:
              'AgentMail API key is available for inbox discovery or provisioning in the current environment.',
            missingEnv,
            ready: true,
          }
        : {
            badge: 'needs key',
            detail:
              'Add AGENTMAIL_API_KEY to the current environment to enable the email channel.',
            missingEnv,
            ready: false,
          }
  }
}

export function describeSetupWearableStatus(
  wearable: SetupWearable,
  env: NodeJS.ProcessEnv,
): SetupWizardRuntimeStatus {
  const missingEnv = resolveSetupWearableMissingEnv(wearable, env)

  switch (wearable) {
    case 'garmin':
      return missingEnv.length === 0
        ? {
            badge: 'ready',
            detail: 'Junction Link can open Garmin connect after setup.',
            missingEnv,
            ready: true,
          }
        : {
            badge: 'needs Junction',
            detail:
              'Add Junction credentials to the current environment to enable Garmin connect.',
            missingEnv,
            ready: false,
          }
    case 'oura':
      return missingEnv.length === 0
        ? {
            badge: 'ready',
            detail: 'OAuth connect can open after setup.',
            missingEnv,
            ready: true,
          }
        : {
            badge: 'needs client keys',
            detail:
              'Add OURA_CLIENT_ID and OURA_CLIENT_SECRET to the current environment to enable Oura connect.',
            missingEnv,
            ready: false,
          }
    case 'strava':
      return missingEnv.length === 0
        ? {
            badge: 'ready',
            detail: 'OAuth connect can open after setup.',
            missingEnv,
            ready: true,
          }
        : {
            badge: 'needs client keys',
            detail:
              'Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to the current environment to enable Strava connect.',
            missingEnv,
            ready: false,
          }
    case 'whoop':
      return missingEnv.length === 0
        ? {
            badge: 'ready',
            detail: 'OAuth connect can open after setup.',
            missingEnv,
            ready: true,
          }
        : {
            badge: 'needs client keys',
            detail:
              'Add WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET to the current environment to enable WHOOP connect.',
            missingEnv,
            ready: false,
          }
  }
}

export function resolveSetupAssistantModelProviderMissingEnv(
  modelProvider: string | null | undefined,
  env: NodeJS.ProcessEnv,
): string[] {
  const envKeys = resolveSetupAssistantModelProviderEnvKeys(modelProvider)
  return envKeys.length > 0 && !hasAnyEnv(env, envKeys)
    ? envKeys
    : []
}

export function resolveSetupAssistantModelProviderEnvKeys(
  modelProvider: string | null | undefined,
): string[] {
  const modelProviderConfig =
    resolveAssistantCodexModelProviderConfig(modelProvider)
  return modelProviderConfig ? [modelProviderConfig.envKey] : []
}

export function describeSetupAssistantModelProviderStatus(
  modelProvider: string | null | undefined,
  env: NodeJS.ProcessEnv,
): SetupWizardRuntimeStatus {
  const modelProviderConfig =
    resolveAssistantCodexModelProviderConfig(modelProvider)
  if (!modelProviderConfig) {
    return {
      badge: 'ready',
      detail: 'No assistant provider API key is required.',
      missingEnv: [],
      ready: true,
    }
  }

  const missingEnv = resolveSetupAssistantModelProviderMissingEnv(
    modelProviderConfig.id,
    env,
  )
  return missingEnv.length === 0
    ? {
        badge: 'ready',
        detail: `${modelProviderConfig.name} API key is available in the current environment.`,
        missingEnv,
        ready: true,
      }
    : {
        badge: 'needs key',
        detail: `Add ${modelProviderConfig.envKey} to the current environment to use ${modelProviderConfig.name}.`,
        missingEnv,
        ready: false,
      }
}

export function describeSelectedSetupWearables(input: {
  wearables: readonly SetupWearable[]
  env: NodeJS.ProcessEnv
}): SetupConfiguredWearable[] {
  const configured: SetupConfiguredWearable[] = []

  for (const wearable of normalizeSetupWearables(input.wearables)) {
    const status = describeSetupWearableStatus(wearable, input.env)
    configured.push({
      detail: status.ready
        ? `Selected ${formatSetupWearableName(wearable)}. Murph can open the connect flow after setup.`
        : `Selected ${formatSetupWearableName(wearable)}, but it still needs ${formatSetupMissingEnvList(status.missingEnv)} before the connect flow can open.`,
      enabled: true,
      missingEnv: status.missingEnv,
      ready: status.ready,
      wearable,
    })
  }

  return configured
}

export function resolveSetupRuntimePromptKeys(input: {
  assistantModelProvider?: string | null
  channels: readonly SetupChannel[]
  env: NodeJS.ProcessEnv
  wearables: readonly SetupWearable[]
}): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const modelProviderConfig = resolveAssistantCodexModelProviderConfig(
    input.assistantModelProvider,
  )

  if (modelProviderConfig) {
    const missingAssistantEnv = resolveSetupAssistantModelProviderMissingEnv(
      modelProviderConfig.id,
      input.env,
    )
    for (const key of missingAssistantEnv) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }

  for (const channel of input.channels) {
    for (const key of resolveSetupChannelMissingEnv(channel, input.env)) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }

  for (const wearable of input.wearables) {
    for (const key of resolveSetupWearableMissingEnv(wearable, input.env)) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }

  return keys
}

function resolvePreferredEnvKeys(
  env: NodeJS.ProcessEnv,
  envGroups: readonly (readonly string[])[],
): string[] {
  return envGroups.flatMap((keys) => (hasAnyEnv(env, keys) ? [] : [keys[0] ?? '']))
}

function hasAnyEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((key) => normalizeEnvValue(env[key]) !== null)
}

function normalizeEnvValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

async function promptForRuntimeEnvValue(
  question: string,
  helpText?: readonly string[],
): Promise<string> {
  while (true) {
    const answer = await readSetupRuntimePromptAnswer(question)
    const normalizedAnswer = answer.trim()

    if (normalizedAnswer.toLowerCase() === 'q') {
      throw new VaultCliError('setup_cancelled', 'Murph setup was cancelled.')
    }

    if (
      helpText
      && helpText.length > 0
      && (normalizedAnswer === '?' || normalizedAnswer.toLowerCase() === 'help')
    ) {
      writeSetupRuntimePromptHelp(helpText)
      continue
    }

    return normalizedAnswer
  }
}

async function readSetupRuntimePromptAnswer(question: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    prepareSetupPromptInput(process.stdin)
    const readline = createInterface({
      input: process.stdin,
      output: process.stderr,
    })
    const promptReadline: HiddenPromptReadline = readline
    const originalWriteToOutput = promptReadline._writeToOutput?.bind(readline)
    let hideAnswer = false
    promptReadline._writeToOutput = (stringToWrite) => {
      if (hideAnswer) {
        return
      }

      if (originalWriteToOutput) {
        originalWriteToOutput(stringToWrite)
        return
      }

      process.stderr.write(stringToWrite)
    }

    const cancel = () => {
      readline.close()
      reject(
        new VaultCliError('setup_cancelled', 'Murph setup was cancelled.'),
      )
    }

    readline.once('SIGINT', cancel)
    readline.question(question, (answer) => {
      process.stderr.write('\n')
      readline.removeListener('SIGINT', cancel)
      readline.close()
      resolve(answer)
    })
    hideAnswer = true
  })
}

function writeSetupRuntimePromptHelp(helpText: readonly string[]): void {
  process.stderr.write('\n')
  for (const line of helpText) {
    process.stderr.write(`${line}\n`)
  }
  process.stderr.write('\n')
}

function formatSetupWearableName(wearable: SetupWearable): string {
  switch (wearable) {
    case 'garmin':
      return 'Garmin'
    case 'oura':
      return 'Oura'
    case 'strava':
      return 'Strava'
    case 'whoop':
      return 'WHOOP'
  }
}

function formatSetupMissingEnvList(missingEnv: readonly string[]): string {
  if (missingEnv.length === 0) {
    return 'nothing else'
  }

  if (missingEnv.length === 1) {
    return missingEnv[0] ?? ''
  }

  return `${missingEnv.slice(0, -1).join(', ')} and ${missingEnv[missingEnv.length - 1]}`
}
