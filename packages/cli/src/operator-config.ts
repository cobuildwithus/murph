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
export const HEALTHYBOB_VAULT_ENV = 'HEALTHYBOB_VAULT'

const assistantOperatorDefaultsSchema = z.object({
  provider: z.enum(assistantChatProviderValues).nullable(),
  codexCommand: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  reasoningEffort: z.string().min(1).nullable().default(null),
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

const NON_EXECUTING_BUILTIN_FLAGS = new Set([
  '--help',
  '-h',
  '--llms',
  '--llms-full',
  '--mcp',
  '--schema',
  '--version',
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
  const config = buildOperatorConfig(
    {
      defaultVault: normalizeVaultForConfig(vault, homeDirectory),
    },
    existing,
  )
  const configPath = resolveOperatorConfigPath(homeDirectory)

  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  return config
}

export async function saveAssistantOperatorDefaultsPatch(
  patch: Partial<AssistantOperatorDefaults>,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<OperatorConfig> {
  const existing = await readOperatorConfig(homeDirectory)
  const config = buildOperatorConfig(
    {
      assistant: mergeAssistantOperatorDefaults(existing?.assistant ?? null, patch),
    },
    existing,
  )
  const configPath = resolveOperatorConfigPath(homeDirectory)

  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  return config
}

function buildOperatorConfig(
  patch: {
    assistant?: AssistantOperatorDefaults | null
    defaultVault?: string | null
  },
  existing: OperatorConfig | null,
): OperatorConfig {
  return operatorConfigSchema.parse({
    schema: OPERATOR_CONFIG_SCHEMA,
    defaultVault:
      patch.defaultVault !== undefined
        ? patch.defaultVault
        : existing?.defaultVault ?? null,
    assistant:
      patch.assistant !== undefined
        ? patch.assistant
        : existing?.assistant ?? null,
    updatedAt: new Date().toISOString(),
  })
}

export async function resolveDefaultVault(
  homeDirectory = resolveOperatorHomeDirectory(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const envVault = env[HEALTHYBOB_VAULT_ENV]?.trim()
  if (envVault) {
    return expandConfiguredVaultPath(envVault, homeDirectory)
  }

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

function mergeAssistantOperatorDefaults(
  existing: AssistantOperatorDefaults | null,
  patch: Partial<AssistantOperatorDefaults>,
): AssistantOperatorDefaults {
  return assistantOperatorDefaultsSchema.parse({
    provider:
      'provider' in patch ? patch.provider : existing?.provider ?? null,
    codexCommand:
      'codexCommand' in patch ? patch.codexCommand : existing?.codexCommand ?? null,
    model: 'model' in patch ? patch.model : existing?.model ?? null,
    reasoningEffort:
      'reasoningEffort' in patch
        ? patch.reasoningEffort
        : existing?.reasoningEffort ?? null,
    identityId:
      'identityId' in patch ? patch.identityId : existing?.identityId ?? null,
    sandbox: 'sandbox' in patch ? patch.sandbox : existing?.sandbox ?? null,
    approvalPolicy:
      'approvalPolicy' in patch
        ? patch.approvalPolicy
        : existing?.approvalPolicy ?? null,
    profile: 'profile' in patch ? patch.profile : existing?.profile ?? null,
    oss: 'oss' in patch ? patch.oss : existing?.oss ?? null,
  })
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
  if (!vault || hasExplicitVaultOption(args) || hasNonExecutingBuiltinFlag(args)) {
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

function hasNonExecutingBuiltinFlag(args: readonly string[]): boolean {
  return args.some((token) => NON_EXECUTING_BUILTIN_FLAGS.has(token))
}
