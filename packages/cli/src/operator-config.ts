import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
  assistantApprovalPolicyValues,
  assistantChatProviderValues,
  assistantProviderFailoverRouteSchema,
  assistantSelfDeliveryTargetSchema,
  assistantSandboxValues,
  type AssistantSelfDeliveryTarget,
} from './assistant-cli-contracts.js'
import {
  ROOT_OPTIONS_WITH_VALUES,
  resolveEffectiveTopLevelToken,
} from './command-helpers.js'
export {
  ROOT_OPTIONS_WITH_VALUES,
  resolveEffectiveTopLevelToken,
} from './command-helpers.js'

const OPERATOR_CONFIG_SCHEMA = 'healthybob.operator-config.v1'
const OPERATOR_CONFIG_DIRECTORY = '.healthybob'
const OPERATOR_CONFIG_PATH = path.join(OPERATOR_CONFIG_DIRECTORY, 'config.json')
export const VAULT_ENV = 'VAULT'
export const VAULT_ENV_KEYS = [VAULT_ENV] as const

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
  baseUrl: z.string().min(1).nullable().optional(),
  apiKeyEnv: z.string().min(1).nullable().optional(),
  providerName: z.string().min(1).nullable().optional(),
  failoverRoutes: z.array(assistantProviderFailoverRouteSchema).nullable().optional(),
  account: z
    .object({
      source: z.string().min(1),
      kind: z.enum(['account', 'api-key', 'unknown']),
      planCode: z.string().min(1).nullable(),
      planName: z.string().min(1).nullable(),
      quota: z
        .object({
          creditsRemaining: z.number().finite().nullable(),
          creditsUnlimited: z.boolean().nullable(),
          primaryWindow: z
            .object({
              usedPercent: z.number().min(0).max(100),
              remainingPercent: z.number().min(0).max(100),
              windowMinutes: z.number().int().positive().nullable(),
              resetsAt: z.string().datetime({ offset: true }).nullable(),
            })
            .strict()
            .nullable(),
          secondaryWindow: z
            .object({
              usedPercent: z.number().min(0).max(100),
              remainingPercent: z.number().min(0).max(100),
              windowMinutes: z.number().int().positive().nullable(),
              resetsAt: z.string().datetime({ offset: true }).nullable(),
            })
            .strict()
            .nullable(),
        })
        .strict()
        .nullable(),
    })
    .strict()
    .nullable()
    .optional(),
  selfDeliveryTargets: z
    .record(z.string().min(1), assistantSelfDeliveryTargetSchema)
    .nullable()
    .default(null),
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
export interface AssistantSelfDeliveryTargetLookupInput {
  channel?: string | null
  deliveryTarget?: string | null
  identityId?: string | null
  participantId?: string | null
  sourceThreadId?: string | null
}

export const TOP_LEVEL_COMMANDS_REQUIRING_VAULT = new Set([
  'allergy',
  'assistant',
  'audit',
  'blood-test',
  'chat',
  'condition',
  'doctor',
  'device',
  'document',
  'event',
  'experiment',
  'export',
  'family',
  'food',
  'genetics',
  'goal',
  'history',
  'inbox',
  'init',
  'intake',
  'intervention',
  'journal',
  'list',
  'meal',
  'profile',
  'provider',
  'recipe',
  'protocol',
  'research',
  'run',
  'samples',
  'search',
  'status',
  'stop',
  'supplement',
  'deepthink',
  'show',
  'timeline',
  'validate',
  'vault',
  'workout',
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

const COMMAND_GROUP_PATHS_REQUIRING_SUBCOMMAND = new Set([
  'allergy',
  'assistant',
  'assistant cron',
  'assistant memory',
  'assistant session',
  'assistant self-target',
  'audit',
  'blood-test',
  'condition',
  'device',
  'device account',
  'device daemon',
  'device provider',
  'document',
  'event',
  'experiment',
  'export',
  'export pack',
  'family',
  'food',
  'genetics',
  'goal',
  'history',
  'inbox',
  'inbox attachment',
  'inbox model',
  'inbox promote',
  'inbox source',
  'intake',
  'intervention',
  'journal',
  'meal',
  'profile',
  'profile current',
  'provider',
  'recipe',
  'protocol',
  'samples',
  'samples batch',
  'search',
  'search index',
  'supplement',
  'supplement compound',
  'vault',
  'workout',
])

const COMMAND_PATHS_EXEMPT_FROM_VAULT = new Set([
  'assistant self-target',
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
  const envVault = readEnvValue(env, VAULT_ENV_KEYS)
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

export async function listAssistantSelfDeliveryTargets(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTarget[]> {
  const defaults = await resolveAssistantOperatorDefaults(homeDirectory)
  return sortAssistantSelfDeliveryTargets(defaults?.selfDeliveryTargets ?? null)
}

export async function resolveAssistantSelfDeliveryTarget(
  channel: string,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTarget | null> {
  const normalizedChannel = normalizeOperatorConfigString(channel)?.toLowerCase()
  if (!normalizedChannel) {
    return null
  }

  const defaults = await resolveAssistantOperatorDefaults(homeDirectory)
  return defaults?.selfDeliveryTargets?.[normalizedChannel] ?? null
}

export async function saveAssistantSelfDeliveryTarget(
  target: AssistantSelfDeliveryTarget,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTarget> {
  const normalizedTarget = normalizeAssistantSelfDeliveryTarget(target)
  const existing = await resolveAssistantOperatorDefaults(homeDirectory)
  const nextTargets = {
    ...(existing?.selfDeliveryTargets ?? {}),
    [normalizedTarget.channel]: normalizedTarget,
  }

  await saveAssistantOperatorDefaultsPatch(
    {
      selfDeliveryTargets: nextTargets,
    },
    homeDirectory,
  )

  return normalizedTarget
}

export async function clearAssistantSelfDeliveryTargets(
  channel?: string | null,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<string[]> {
  const existing = await resolveAssistantOperatorDefaults(homeDirectory)
  const currentTargets = {
    ...(existing?.selfDeliveryTargets ?? {}),
  }
  const normalizedChannel = normalizeOperatorConfigString(channel)?.toLowerCase() ?? null

  if (normalizedChannel) {
    if (!currentTargets[normalizedChannel]) {
      return []
    }

    delete currentTargets[normalizedChannel]
    await saveAssistantOperatorDefaultsPatch(
      {
        selfDeliveryTargets:
          Object.keys(currentTargets).length > 0 ? currentTargets : null,
      },
      homeDirectory,
    )
    return [normalizedChannel]
  }

  const clearedChannels = sortAssistantSelfDeliveryTargets(currentTargets).map(
    (target) => target.channel,
  )
  if (clearedChannels.length === 0) {
    return []
  }

  await saveAssistantOperatorDefaultsPatch(
    {
      selfDeliveryTargets: null,
    },
    homeDirectory,
  )

  return clearedChannels
}

export async function applyAssistantSelfDeliveryTargetDefaults(
  input: AssistantSelfDeliveryTargetLookupInput,
  options?: {
    allowSingleSavedTargetFallback?: boolean
  },
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTargetLookupInput> {
  const normalizedChannel = normalizeOperatorConfigString(input.channel)?.toLowerCase() ?? null
  const savedTarget = normalizedChannel
    ? await resolveAssistantSelfDeliveryTarget(normalizedChannel, homeDirectory)
    : options?.allowSingleSavedTargetFallback
      ? await resolveSingleAssistantSelfDeliveryTarget(homeDirectory)
      : null

  if (!savedTarget) {
    return {
      channel: normalizedChannel,
      identityId: normalizeOperatorConfigString(input.identityId),
      participantId: normalizeOperatorConfigString(input.participantId),
      sourceThreadId: normalizeOperatorConfigString(input.sourceThreadId),
      deliveryTarget: normalizeOperatorConfigString(input.deliveryTarget),
    }
  }

  return {
    channel: normalizedChannel ?? savedTarget.channel,
    identityId:
      normalizeOperatorConfigString(input.identityId) ?? savedTarget.identityId ?? null,
    participantId:
      normalizeOperatorConfigString(input.participantId) ?? savedTarget.participantId ?? null,
    sourceThreadId:
      normalizeOperatorConfigString(input.sourceThreadId) ??
      savedTarget.sourceThreadId ??
      null,
    deliveryTarget:
      normalizeOperatorConfigString(input.deliveryTarget) ??
      savedTarget.deliveryTarget ??
      null,
  }
}

function readEnvValue(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) {
      return value
    }
  }

  return null
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
    baseUrl: 'baseUrl' in patch ? patch.baseUrl : existing?.baseUrl ?? null,
    apiKeyEnv:
      'apiKeyEnv' in patch ? patch.apiKeyEnv : existing?.apiKeyEnv ?? null,
    providerName:
      'providerName' in patch ? patch.providerName : existing?.providerName ?? null,
    failoverRoutes:
      'failoverRoutes' in patch
        ? patch.failoverRoutes
        : existing?.failoverRoutes ?? null,
    account: 'account' in patch ? patch.account : existing?.account ?? null,
    selfDeliveryTargets:
      'selfDeliveryTargets' in patch
        ? normalizeAssistantSelfDeliveryTargetMap(patch.selfDeliveryTargets ?? null)
        : existing?.selfDeliveryTargets ?? null,
  })
}

function normalizeAssistantSelfDeliveryTargetMap(
  targets: Record<string, AssistantSelfDeliveryTarget> | null,
): Record<string, AssistantSelfDeliveryTarget> | null {
  if (!targets || Object.keys(targets).length === 0) {
    return null
  }

  return Object.fromEntries(
    Object.values(targets).map((target) => {
      const normalized = normalizeAssistantSelfDeliveryTarget(target)
      return [normalized.channel, normalized]
    }),
  )
}

function normalizeAssistantSelfDeliveryTarget(
  target: AssistantSelfDeliveryTarget,
): AssistantSelfDeliveryTarget {
  const channel = normalizeOperatorConfigString(target.channel)?.toLowerCase()
  if (!channel) {
    throw new Error('Assistant self delivery targets require a channel.')
  }

  return assistantSelfDeliveryTargetSchema.parse({
    channel,
    identityId: normalizeOperatorConfigString(target.identityId),
    participantId: normalizeOperatorConfigString(target.participantId),
    sourceThreadId: normalizeOperatorConfigString(target.sourceThreadId),
    deliveryTarget: normalizeOperatorConfigString(target.deliveryTarget),
  })
}

function sortAssistantSelfDeliveryTargets(
  targets: Record<string, AssistantSelfDeliveryTarget> | null,
): AssistantSelfDeliveryTarget[] {
  return Object.values(targets ?? {}).sort((left, right) =>
    left.channel.localeCompare(right.channel),
  )
}

async function resolveSingleAssistantSelfDeliveryTarget(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTarget | null> {
  const targets = await listAssistantSelfDeliveryTargets(homeDirectory)
  return targets.length === 1 ? targets[0] ?? null : null
}

function normalizeOperatorConfigString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
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

  if (hasVaultExemptCommandPath(args)) {
    return [...args]
  }

  if (hasIncompleteCommandGroupPath(args)) {
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

function hasIncompleteCommandGroupPath(args: readonly string[]): boolean {
  const commandPath = getCommandPath(args)
  if (commandPath === null) {
    return false
  }

  return COMMAND_GROUP_PATHS_REQUIRING_SUBCOMMAND.has(commandPath)
}

function hasVaultExemptCommandPath(args: readonly string[]): boolean {
  const commandPath = getCommandPath(args)
  if (commandPath === null) {
    return false
  }

  return [...COMMAND_PATHS_EXEMPT_FROM_VAULT].some(
    (prefix) => commandPath === prefix || commandPath.startsWith(`${prefix} `),
  )
}

function getCommandPath(args: readonly string[]): string | null {
  const commandTokens: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token || token === '--') {
      break
    }

    if (token.startsWith('-')) {
      if (commandTokens.length === 0 && ROOT_OPTIONS_WITH_VALUES.has(token)) {
        index += 1
        continue
      }

      break
    }

    commandTokens.push(token)
  }

  return commandTokens.length > 0 ? commandTokens.join(' ') : null
}
