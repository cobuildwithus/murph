import { createInterface } from 'node:readline'
import { VaultCliError } from './vault-cli-errors.js'
import {
  type SetupChannel,
  type SetupConfiguredWearable,
  type SetupWearable,
  setupWearableValues,
} from './setup-cli-contracts.js'

const TELEGRAM_TOKEN_KEYS = [
  'HEALTHYBOB_TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_TOKEN',
] as const
const EMAIL_API_KEY_KEYS = [
  'HEALTHYBOB_AGENTMAIL_API_KEY',
  'AGENTMAIL_API_KEY',
] as const
const WHOOP_CLIENT_KEYS = [
  'HEALTHYBOB_WHOOP_CLIENT_ID',
  'HEALTHYBOB_WHOOP_CLIENT_SECRET',
] as const
const OURA_CLIENT_KEYS = [
  'HEALTHYBOB_OURA_CLIENT_ID',
  'HEALTHYBOB_OURA_CLIENT_SECRET',
] as const

export const SETUP_RUNTIME_ENV_NOTICE =
  'Healthy Bob uses the current process environment for this run, including shell exports and any CLI-loaded .env.local/.env values. Prompts here are current-run only and do not write env files.'

export interface SetupWizardRuntimeStatus {
  badge: string
  detail: string
  missingEnv: string[]
  ready: boolean
}

export interface SetupRuntimeEnvResolver {
  getCurrentEnv(): NodeJS.ProcessEnv
  promptForMissing(input: {
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
        'Enter any missing values for this onboarding run only. Leave a prompt blank to skip it for now.\n\n',
      )

      const overrides: NodeJS.ProcessEnv = {}
      for (const key of missingKeys) {
        const value = await promptForRuntimeEnvValue(
          `Enter ${key} for this run only (leave blank to skip): `,
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
    case 'imessage':
      return []
    case 'telegram':
      return hasAnyEnv(env, TELEGRAM_TOKEN_KEYS)
        ? []
        : ['HEALTHYBOB_TELEGRAM_BOT_TOKEN']
    case 'email':
      return hasAnyEnv(env, EMAIL_API_KEY_KEYS)
        ? []
        : ['HEALTHYBOB_AGENTMAIL_API_KEY']
  }
}

export function resolveSetupWearableMissingEnv(
  wearable: SetupWearable,
  env: NodeJS.ProcessEnv,
): string[] {
  switch (wearable) {
    case 'oura':
      return resolveExactEnvKeys(env, OURA_CLIENT_KEYS)
    case 'whoop':
      return resolveExactEnvKeys(env, WHOOP_CLIENT_KEYS)
  }
}

export function describeSetupChannelStatus(
  channel: SetupChannel,
  env: NodeJS.ProcessEnv,
): SetupWizardRuntimeStatus {
  const missingEnv = resolveSetupChannelMissingEnv(channel, env)

  switch (channel) {
    case 'imessage':
      return {
        badge: 'ready',
        detail: 'Works through Messages.app on this Mac.',
        missingEnv,
        ready: true,
      }
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
              'Add HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN to the current environment to enable Telegram auto-reply.',
            missingEnv,
            ready: false,
          }
    case 'email':
      return missingEnv.length === 0
        ? {
            badge: 'ready',
            detail: 'AgentMail API key is available in the current environment.',
            missingEnv,
            ready: true,
          }
        : {
            badge: 'needs key',
            detail:
              'Add HEALTHYBOB_AGENTMAIL_API_KEY or AGENTMAIL_API_KEY to the current environment to enable the email channel.',
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

  if (wearable === 'oura') {
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
            'Add HEALTHYBOB_OURA_CLIENT_ID and HEALTHYBOB_OURA_CLIENT_SECRET to the current environment to enable Oura connect.',
          missingEnv,
          ready: false,
        }
  }

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
          'Add HEALTHYBOB_WHOOP_CLIENT_ID and HEALTHYBOB_WHOOP_CLIENT_SECRET to the current environment to enable WHOOP connect.',
        missingEnv,
        ready: false,
      }
}

export function describeSelectedSetupWearables(input: {
  wearables: readonly SetupWearable[]
  env: NodeJS.ProcessEnv
}): SetupConfiguredWearable[] {
  const seen = new Set<SetupWearable>()
  const configured: SetupConfiguredWearable[] = []

  for (const wearable of input.wearables) {
    if (seen.has(wearable)) {
      continue
    }
    seen.add(wearable)

    const status = describeSetupWearableStatus(wearable, input.env)
    configured.push({
      detail: status.ready
        ? `Selected ${formatSetupWearableName(wearable)}. Healthy Bob can open the connect flow after setup.`
        : `Selected ${formatSetupWearableName(wearable)}, but it still needs ${formatSetupMissingEnvList(status.missingEnv)} before the connect flow can open.`,
      enabled: true,
      missingEnv: status.missingEnv,
      ready: status.ready,
      wearable,
    })
  }

  return configured.sort(
    (left, right) =>
      setupWearableValues.indexOf(left.wearable) -
      setupWearableValues.indexOf(right.wearable),
  )
}

function collectSetupPromptKeys(input: {
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

  return keys
}

function resolveExactEnvKeys(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string[] {
  return keys.filter((key) => normalizeEnvValue(env[key]) === null)
}

function hasAnyEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((key) => normalizeEnvValue(env[key]) !== null)
}

function normalizeEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

async function promptForRuntimeEnvValue(question: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const readline = createInterface({
      input: process.stdin,
      output: process.stderr,
    })

    const cancel = () => {
      readline.close()
      reject(
        new VaultCliError('setup_cancelled', 'Healthy Bob setup was cancelled.'),
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
  return wearable === 'oura' ? 'Oura' : 'WHOOP'
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
