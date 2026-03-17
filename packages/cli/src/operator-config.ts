import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
  assistantApprovalPolicyValues,
  assistantChatProviderValues,
  assistantSandboxValues,
} from './assistant-cli-contracts.js'
import {
  resolveEffectiveTopLevelToken,
} from './command-helpers.js'
export {
  ROOT_OPTIONS_WITH_VALUES,
  resolveEffectiveTopLevelToken,
} from './command-helpers.js'

const OPERATOR_CONFIG_SCHEMA = 'healthybob.operator-config.v1'
const OPERATOR_CONFIG_DIRECTORY = '.healthybob'
const OPERATOR_CONFIG_PATH = path.join(OPERATOR_CONFIG_DIRECTORY, 'config.json')

const assistantOperatorDefaultsSchema = z.object({
  provider: z.enum(assistantChatProviderValues).nullable(),
  codexCommand: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  identityId: z.string().min(1).nullable(),
  sandbox: z.enum(assistantSandboxValues).nullable(),
  approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable(),
  profile: z.string().min(1).nullable(),
  oss: z.boolean().nullable(),
})

const operatorConfigSchema = z.object({
  schema: z.literal(OPERATOR_CONFIG_SCHEMA),
  defaultVault: z.string().min(1).nullable(),
  assistant: assistantOperatorDefaultsSchema.nullable().default(null),
  updatedAt: z.string().datetime({ offset: true }),
})

export type OperatorConfig = z.infer<typeof operatorConfigSchema>
export type AssistantOperatorDefaults = z.infer<
  typeof assistantOperatorDefaultsSchema
>

export const TOP_LEVEL_COMMANDS_REQUIRING_VAULT = new Set([
  'allergy',
  'assistant',
  'audit',
  'chat',
  'condition',
  'document',
  'event',
  'experiment',
  'export',
  'family',
  'genetics',
  'goal',
  'history',
  'inbox',
  'init',
  'intake',
  'journal',
  'list',
  'meal',
  'profile',
  'provider',
  'regimen',
  'samples',
  'search',
  'show',
  'timeline',
  'validate',
  'vault',
])

export function resolveOperatorHomeDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredHome = env.HOME?.trim()
  return path.resolve(configuredHome && configuredHome.length > 0 ? configuredHome : os.homedir())
}

export function resolveOperatorConfigPath(
  homeDirectory = resolveOperatorHomeDirectory(),
): string {
  return path.join(homeDirectory, OPERATOR_CONFIG_PATH)
}

export function normalizeVaultForConfig(
  vault: string,
  homeDirectory = resolveOperatorHomeDirectory(),
): string {
  const absoluteVault = path.resolve(vault)
  const normalizedHome = path.resolve(homeDirectory)

  if (absoluteVault === normalizedHome) {
    return '~'
  }

  if (absoluteVault.startsWith(`${normalizedHome}${path.sep}`)) {
    return `~${absoluteVault.slice(normalizedHome.length)}`
  }

  return absoluteVault
}

export function expandConfiguredVaultPath(
  configuredPath: string,
  homeDirectory = resolveOperatorHomeDirectory(),
): string {
  if (configuredPath === '~') {
    return homeDirectory
  }

  if (configuredPath.startsWith('~/')) {
    return path.join(homeDirectory, configuredPath.slice(2))
  }

  return path.resolve(configuredPath)
}

export async function readOperatorConfig(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<OperatorConfig | null> {
  try {
    const raw = await readFile(resolveOperatorConfigPath(homeDirectory), 'utf8')
    return operatorConfigSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return null
    }

    throw error
  }
}

export async function saveDefaultVaultConfig(
  vault: string,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<OperatorConfig> {
  const existing = await readOperatorConfig(homeDirectory)
  const config = operatorConfigSchema.parse({
    schema: OPERATOR_CONFIG_SCHEMA,
    defaultVault: normalizeVaultForConfig(vault, homeDirectory),
    assistant: existing?.assistant ?? null,
    updatedAt: new Date().toISOString(),
  })
  const configPath = resolveOperatorConfigPath(homeDirectory)

  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  return config
}

export async function resolveDefaultVault(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<string | null> {
  const config = await readOperatorConfig(homeDirectory)
  if (!config?.defaultVault) {
    return null
  }

  return expandConfiguredVaultPath(config.defaultVault, homeDirectory)
}

export async function resolveAssistantOperatorDefaults(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantOperatorDefaults | null> {
  const config = await readOperatorConfig(homeDirectory)
  return config?.assistant ?? null
}

export function hasExplicitVaultOption(args: readonly string[]): boolean {
  for (const token of args) {
    if (token === '--') {
      return false
    }

    if (token === '--vault' || token.startsWith('--vault=')) {
      return true
    }
  }

  return false
}

export function applyDefaultVaultToArgs(
  args: readonly string[],
  vault: string | null,
): string[] {
  if (!vault || hasExplicitVaultOption(args)) {
    return [...args]
  }

  const topLevelToken = resolveEffectiveTopLevelToken(args)
  if (!topLevelToken || !TOP_LEVEL_COMMANDS_REQUIRING_VAULT.has(topLevelToken)) {
    return [...args]
  }

  const separatorIndex = args.indexOf('--')
  if (separatorIndex < 0) {
    return [...args, '--vault', vault]
  }

  return [
    ...args.slice(0, separatorIndex),
    '--vault',
    vault,
    ...args.slice(separatorIndex),
  ]
}
