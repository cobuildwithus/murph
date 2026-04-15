import { createInterface } from 'node:readline'
import { prepareSetupPromptInput } from './setup-prompt-io.js'
import { VaultCliError } from './vault-cli-errors.js'
import {
  type SetupChannel,
  type SetupConfiguredWearable,
  type SetupWearable,
  normalizeSetupWearables,
} from './setup-cli-contracts.js'

const TELEGRAM_TOKEN_KEYS = ['TELEGRAM_BOT_TOKEN'] as const
const EMAIL_API_KEY_KEYS = ['AGENTMAIL_API_KEY'] as const
const LINQ_TOKEN_KEYS = ['LINQ_API_TOKEN'] as const
const LINQ_WEBHOOK_SECRET_KEYS = ['LINQ_WEBHOOK_SECRET'] as const
const GARMIN_CLIENT_ID_KEYS = ['GARMIN_CLIENT_ID'] as const
const GARMIN_CLIENT_SECRET_KEYS = ['GARMIN_CLIENT_SECRET'] as const
const GARMIN_CLIENT_KEY_GROUPS = [GARMIN_CLIENT_ID_KEYS, GARMIN_CLIENT_SECRET_KEYS] as const
const WHOOP_CLIENT_ID_KEYS = ['WHOOP_CLIENT_ID'] as const
const WHOOP_CLIENT_SECRET_KEYS = ['WHOOP_CLIENT_SECRET'] as const
const WHOOP_CLIENT_KEY_GROUPS = [WHOOP_CLIENT_ID_KEYS, WHOOP_CLIENT_SECRET_KEYS] as const
const OURA_CLIENT_ID_KEYS = ['OURA_CLIENT_ID'] as const
const OURA_CLIENT_SECRET_KEYS = ['OURA_CLIENT_SECRET'] as const
const OURA_CLIENT_KEY_GROUPS = [OURA_CLIENT_ID_KEYS, OURA_CLIENT_SECRET_KEYS] as const

export const SETUP_RUNTIME_ENV_NOTICE =
  'Murph can use keys from your current shell for this setup run. Anything you enter here is only used for this run and is not written to a file.'

export interface SetupWizardRuntimeStatus {
  badge: string
  detail: string
  missingEnv: string[]
  ready: boolean
}

export interface SetupRuntimeEnvResolver {
  getCurrentEnv(): NodeJS.ProcessEnv
  promptForMissing(input: {
    assistantApiKeyEnv?: string | null
    channels: readonly SetupChannel[]
    env: NodeJS.ProcessEnv
    wearables: readonly SetupWearable[]
  }): Promise<NodeJS.ProcessEnv>
}

export function createSetupRuntimeEnvResolver(): SetupRuntimeEnvResolver {
  return {
    getCurrentEnv() {
      return { ...process.env }
    },
    async promptForMissing(input) {
      const missingKeys = collectSetupPromptKeys(input)
      if (missingKeys.length === 0) {
        return {}
      }

      process.stderr.write(`\n${SETUP_RUNTIME_ENV_NOTICE}\n`)
      process.stderr.write(
        'Enter any missing keys for this setup run. Leave a prompt blank to skip it for now.\n\n',
      )

      const overrides: NodeJS.ProcessEnv = {}
      for (const key of missingKeys) {
        const value = await promptForRuntimeEnvValue(
          `Enter ${key} for this setup run (leave blank to skip): `,
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
    case 'linq':
      return [
        ...(hasAnyEnv(env, LINQ_TOKEN_KEYS) ? [] : [LINQ_TOKEN_KEYS[0]]),
        ...(hasAnyEnv(env, LINQ_WEBHOOK_SECRET_KEYS) ? [] : [LINQ_WEBHOOK_SECRET_KEYS[0]]),
      ]
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
      return resolvePreferredEnvKeys(env, GARMIN_CLIENT_KEY_GROUPS)
    case 'oura':
      return resolvePreferredEnvKeys(env, OURA_CLIENT_KEY_GROUPS)
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
    case 'linq':
      return missingEnv.length === 0
        ? {
            badge: 'ready',
            detail:
              'Linq API token and webhook secret are available for local webhook verification and outbound chat delivery in the current environment.',
            missingEnv,
            ready: true,
          }
        : {
            badge: 'needs keys',
            detail:
              'Add LINQ_API_TOKEN and LINQ_WEBHOOK_SECRET to the current environment to enable the Linq channel.',
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
            detail: 'OAuth connect can open after setup.',
            missingEnv,
            ready: true,
          }
        : {
            badge: 'needs client keys',
            detail:
              'Add GARMIN_CLIENT_ID and GARMIN_CLIENT_SECRET to the current environment to enable Garmin connect.',
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

function collectSetupPromptKeys(input: {
  assistantApiKeyEnv?: string | null
  channels: readonly SetupChannel[]
  env: NodeJS.ProcessEnv
  wearables: readonly SetupWearable[]
}): string[] {
  const keys: string[] = []
  const seen = new Set<string>()

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

  const assistantApiKeyEnv = normalizeEnvValue(input.assistantApiKeyEnv)
  if (assistantApiKeyEnv && normalizeEnvValue(input.env[assistantApiKeyEnv]) === null) {
    if (!seen.has(assistantApiKeyEnv)) {
      seen.add(assistantApiKeyEnv)
      keys.push(assistantApiKeyEnv)
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

async function promptForRuntimeEnvValue(question: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    prepareSetupPromptInput(process.stdin)
    const readline = createInterface({
      input: process.stdin,
      output: process.stderr,
    })

    const cancel = () => {
      readline.close()
      reject(
        new VaultCliError('setup_cancelled', 'Murph setup was cancelled.'),
      )
    }

    readline.once('SIGINT', cancel)
    readline.question(question, (answer) => {
      readline.removeListener('SIGINT', cancel)
      readline.close()
      resolve(answer.trim())
    })
  })
}

function formatSetupWearableName(wearable: SetupWearable): string {
  switch (wearable) {
    case 'garmin':
      return 'Garmin'
    case 'oura':
      return 'Oura'
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
