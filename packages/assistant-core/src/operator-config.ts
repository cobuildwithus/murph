import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
  assistantApprovalPolicyValues,
  assistantChatProviderValues,
  assistantHeadersSchema,
  assistantProviderFailoverRouteSchema,
  assistantSelfDeliveryTargetSchema,
  assistantSandboxValues,
  type AssistantSelfDeliveryTarget,
} from './assistant-cli-contracts.js'
import {
  ROOT_OPTIONS_WITH_VALUES,
  resolveEffectiveTopLevelToken,
} from './command-helpers.js'
import { readEnvValue } from './env-values.js'
import {
  inferAssistantProviderFromConfigInput,
  type AssistantProviderConfigInput,
  serializeAssistantProviderOperatorDefaults,
} from './assistant/provider-config.js'
import {
  resolveHostedAssistantProviderConfig,
  parseHostedAssistantConfig,
  type HostedAssistantConfig,
} from './hosted-assistant-config.js'
export {
  ROOT_OPTIONS_WITH_VALUES,
  resolveEffectiveTopLevelToken,
} from './command-helpers.js'

const OPERATOR_CONFIG_SCHEMA = 'murph.operator-config.v1'
const OPERATOR_CONFIG_DIRECTORY = '.murph'
const OPERATOR_CONFIG_PATH = path.join(OPERATOR_CONFIG_DIRECTORY, 'config.json')
export const VAULT_ENV = 'VAULT'
export const VAULT_ENV_KEYS = [VAULT_ENV] as const

const assistantProviderDefaultsEntrySchema = z.object({
  codexCommand: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  reasoningEffort: z.string().min(1).nullable().default(null),
  sandbox: z.enum(assistantSandboxValues).nullable(),
  approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable(),
  profile: z.string().min(1).nullable(),
  oss: z.boolean().nullable(),
  baseUrl: z.string().min(1).nullable().optional(),
  apiKeyEnv: z.string().min(1).nullable().optional(),
  providerName: z.string().min(1).nullable().optional(),
  headers: assistantHeadersSchema.nullable().optional(),
})

const assistantDefaultsByProviderSchema = z
  .object({
    'codex-cli': assistantProviderDefaultsEntrySchema.nullable().optional(),
    'openai-compatible': assistantProviderDefaultsEntrySchema.nullable().optional(),
  })
  .strict()
  .nullable()
  .optional()

const assistantOperatorDefaultsSchema = z.object({
  provider: z.enum(assistantChatProviderValues).nullable().default(null),
  defaultsByProvider: assistantDefaultsByProviderSchema,
  identityId: z.string().min(1).nullable().default(null),
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
  hostedAssistant: z.unknown().nullable().optional(),
  updatedAt: z.string().datetime({ offset: true }),
})

type RawOperatorConfig = z.infer<typeof operatorConfigSchema>

export interface OperatorConfig extends Omit<RawOperatorConfig, 'hostedAssistant'> {
  hostedAssistant: HostedAssistantConfig | null
  hostedAssistantInvalid?: boolean
}
export type AssistantOperatorDefaults = z.infer<
  typeof assistantOperatorDefaultsSchema
>
export type AssistantProviderDefaultsEntry = z.infer<
  typeof assistantProviderDefaultsEntrySchema
>
type AssistantChatProviderValue = (typeof assistantChatProviderValues)[number]
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
  'workout format',
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
    return normalizeParsedOperatorConfig(
      operatorConfigSchema.parse(JSON.parse(raw) as unknown),
    )
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
  await writeFile(
    configPath,
    `${JSON.stringify(serializeOperatorConfigForWrite(config), null, 2)}\n`,
    'utf8',
  )

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
  await writeFile(
    configPath,
    `${JSON.stringify(serializeOperatorConfigForWrite(config), null, 2)}\n`,
    'utf8',
  )

  return config
}

export async function saveHostedAssistantConfig(
  hostedAssistant: HostedAssistantConfig | null,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<OperatorConfig> {
  const existing = await readOperatorConfig(homeDirectory)
  const config = buildOperatorConfig(
    {
      hostedAssistant,
    },
    existing,
  )
  const configPath = resolveOperatorConfigPath(homeDirectory)

  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    `${JSON.stringify(serializeOperatorConfigForWrite(config), null, 2)}\n`,
    'utf8',
  )

  return config
}

function buildOperatorConfig(
  patch: {
    assistant?: AssistantOperatorDefaults | null
    defaultVault?: string | null
    hostedAssistant?: HostedAssistantConfig | null
  },
  existing: OperatorConfig | null,
): OperatorConfig {
  return normalizeParsedOperatorConfig(
    operatorConfigSchema.parse({
      schema: OPERATOR_CONFIG_SCHEMA,
      defaultVault:
        patch.defaultVault !== undefined
          ? patch.defaultVault
          : existing?.defaultVault ?? null,
      assistant:
        patch.assistant !== undefined
          ? patch.assistant
          : existing?.assistant ?? null,
      hostedAssistant:
        patch.hostedAssistant !== undefined
          ? patch.hostedAssistant
          : existing?.hostedAssistant ?? null,
      updatedAt: new Date().toISOString(),
    }),
  )
}

function normalizeParsedOperatorConfig(
  config: RawOperatorConfig | OperatorConfig,
): OperatorConfig {
  const rawHostedAssistant = config.hostedAssistant ?? null
  let hostedAssistant: HostedAssistantConfig | null = null
  let hostedAssistantInvalid = false

  if (rawHostedAssistant) {
    try {
      hostedAssistant = parseHostedAssistantConfig(rawHostedAssistant)
    } catch {
      hostedAssistantInvalid = true
    }
  }

  const assistant = applyHostedAssistantConfigToAssistantDefaults(
    hostedAssistantInvalid ? null : normalizeAssistantOperatorDefaults(config.assistant),
    hostedAssistant,
  )

  return {
    schema: OPERATOR_CONFIG_SCHEMA,
    defaultVault: config.defaultVault ?? null,
    assistant,
    hostedAssistant,
    ...(hostedAssistantInvalid ? { hostedAssistantInvalid: true } : {}),
    updatedAt: config.updatedAt,
  }
}

function serializeOperatorConfigForWrite(config: OperatorConfig): unknown {
  return {
    schema: config.schema,
    defaultVault: config.defaultVault,
    assistant: serializeAssistantOperatorDefaultsForWrite(config.assistant),
    hostedAssistant:
      config.hostedAssistant
        ? {
            ...config.hostedAssistant,
            updatedAt: config.hostedAssistant.updatedAt ?? config.updatedAt,
          }
        : null,
    updatedAt: config.updatedAt,
  }
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
  if (config?.defaultVault) {
    const configuredDefaultVault = expandConfiguredVaultPath(
      config.defaultVault,
      homeDirectory,
    )
    if (await pathExists(configuredDefaultVault)) {
      return configuredDefaultVault
    }
  }

  const cwdVault = path.resolve(process.cwd(), 'vault')
  if (await pathExists(cwdVault)) {
    return cwdVault
  }

  return null
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false
    }

    throw error
  }
}

export async function resolveAssistantOperatorDefaults(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantOperatorDefaults | null> {
  const config = await readOperatorConfig(homeDirectory)
  return normalizeAssistantOperatorDefaults(config?.assistant ?? null)
}

export async function resolveHostedAssistantConfig(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<HostedAssistantConfig | null> {
  const config = await readOperatorConfig(homeDirectory)
  return config?.hostedAssistant ?? null
}

export function resolveAssistantProviderDefaults(
  defaults: AssistantOperatorDefaults | null | undefined,
  provider: AssistantChatProviderValue,
): AssistantProviderDefaultsEntry | null {
  if (!defaults) {
    return null
  }

  return normalizeAssistantProviderDefaultsEntry(
    provider,
    defaults.defaultsByProvider?.[provider] ?? null,
  )
}

export function buildAssistantProviderDefaultsPatch(input: {
  defaults: AssistantOperatorDefaults | null | undefined
  provider: AssistantChatProviderValue
  providerConfig: AssistantProviderConfigInput
}): Partial<AssistantOperatorDefaults> {
  const savedProviderDefaults = resolveAssistantProviderDefaults(
    input.defaults,
    input.provider,
  )
  const nextProviderDefaults = assistantProviderDefaultsEntrySchema.parse(
    serializeAssistantProviderOperatorDefaults({
      provider: input.provider,
      ...(savedProviderDefaults ? savedProviderDefaults : {}),
      ...input.providerConfig,
    }),
  )

  return {
    provider: input.provider,
    defaultsByProvider: {
      [input.provider]: nextProviderDefaults,
    },
  }
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

function applyHostedAssistantConfigToAssistantDefaults(
  defaults: AssistantOperatorDefaults | null | undefined,
  hostedAssistant: HostedAssistantConfig | null | undefined,
): AssistantOperatorDefaults | null {
  const normalizedDefaults = normalizeAssistantOperatorDefaults(defaults)

  if (!hostedAssistant) {
    return normalizedDefaults
  }

  const hostedProviderConfig = resolveHostedAssistantProviderConfig(hostedAssistant)
  const provider = inferAssistantProviderFromConfigInput(hostedProviderConfig)

  if (!provider || !hostedProviderConfig) {
    return mergeAssistantOperatorDefaults(normalizedDefaults, {
      defaultsByProvider: {
        'codex-cli': null,
        'openai-compatible': null,
      },
      provider: null,
    })
  }

  return mergeAssistantOperatorDefaults(
    normalizedDefaults,
    buildAssistantProviderDefaultsPatch({
      defaults: normalizedDefaults,
      provider,
      providerConfig: hostedProviderConfig,
    }),
  )
}

function mergeAssistantOperatorDefaults(
  existing: AssistantOperatorDefaults | null,
  patch: Partial<AssistantOperatorDefaults>,
): AssistantOperatorDefaults {
  const selectedProvider =
    'provider' in patch
      ? patch.provider ??
        existing?.provider ??
        inferAssistantProviderFromDefaultsByProvider(patch.defaultsByProvider) ??
        null
      : existing?.provider ??
        inferAssistantProviderFromDefaultsByProvider(patch.defaultsByProvider) ??
        null
  const nextDefaultsByProvider = buildAssistantDefaultsByProvider(existing, patch)

  return assistantOperatorDefaultsSchema.parse({
    provider: selectedProvider,
    defaultsByProvider: nextDefaultsByProvider,
    identityId:
      'identityId' in patch ? patch.identityId : existing?.identityId ?? null,
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

function normalizeAssistantOperatorDefaults(
  defaults: AssistantOperatorDefaults | null | undefined,
): AssistantOperatorDefaults | null {
  if (!defaults) {
    return null
  }

  return assistantOperatorDefaultsSchema.parse({
    provider: defaults.provider ?? null,
    defaultsByProvider: normalizeAssistantDefaultsByProvider(
      defaults.defaultsByProvider,
    ),
    identityId: defaults.identityId ?? null,
    failoverRoutes: defaults.failoverRoutes ?? null,
    account: defaults.account ?? null,
    selfDeliveryTargets: normalizeAssistantSelfDeliveryTargetMap(
      defaults.selfDeliveryTargets ?? null,
    ),
  })
}

function buildAssistantDefaultsByProvider(
  existing: AssistantOperatorDefaults | null | undefined,
  patch: Partial<AssistantOperatorDefaults>,
): AssistantOperatorDefaults['defaultsByProvider'] {
  const existingDefaultsByProvider = normalizeAssistantDefaultsByProvider(
    existing?.defaultsByProvider,
  )

  if (!('defaultsByProvider' in patch)) {
    return existingDefaultsByProvider
  }

  return mergeAssistantDefaultsByProvider(
    existingDefaultsByProvider,
    patch.defaultsByProvider,
  )
}

function normalizeAssistantProviderDefaultsEntry(
  provider: AssistantChatProviderValue,
  defaults: AssistantProviderDefaultsEntry | null | undefined,
): AssistantProviderDefaultsEntry | null {
  if (!defaults) {
    return null
  }

  const normalized = assistantProviderDefaultsEntrySchema.parse(
    serializeAssistantProviderOperatorDefaults({
      provider,
      ...defaults,
    }),
  )

  return hasAssistantProviderDefaultsValues(normalized) ? normalized : null
}

function normalizeAssistantDefaultsByProvider(
  defaultsByProvider: AssistantOperatorDefaults['defaultsByProvider'],
): AssistantOperatorDefaults['defaultsByProvider'] {
  if (!defaultsByProvider) {
    return null
  }

  const normalized: NonNullable<AssistantOperatorDefaults['defaultsByProvider']> = {}

  for (const provider of assistantChatProviderValues) {
    const normalizedEntry = normalizeAssistantProviderDefaultsEntry(
      provider,
      defaultsByProvider[provider] ?? null,
    )
    if (!normalizedEntry) {
      continue
    }

    normalized[provider] = normalizedEntry
  }

  return Object.keys(normalized).length > 0
    ? assistantDefaultsByProviderSchema.parse(normalized)
    : null
}

function mergeAssistantDefaultsByProvider(
  existing: AssistantOperatorDefaults['defaultsByProvider'],
  patch: AssistantOperatorDefaults['defaultsByProvider'],
): AssistantOperatorDefaults['defaultsByProvider'] {
  if (!patch) {
    return null
  }

  const nextDefaultsByProvider = {
    ...(normalizeAssistantDefaultsByProvider(existing) ?? {}),
  } as NonNullable<AssistantOperatorDefaults['defaultsByProvider']>

  for (const provider of assistantChatProviderValues) {
    if (!(provider in patch)) {
      continue
    }

    const nextEntry = patch[provider] ?? null
    if (!nextEntry) {
      delete nextDefaultsByProvider[provider]
      continue
    }

    const normalizedEntry = normalizeAssistantProviderDefaultsEntry(
      provider,
      nextEntry,
    )

    if (normalizedEntry) {
      nextDefaultsByProvider[provider] = normalizedEntry
      continue
    }

    delete nextDefaultsByProvider[provider]
  }

  return Object.keys(nextDefaultsByProvider).length > 0
    ? assistantDefaultsByProviderSchema.parse(nextDefaultsByProvider)
    : null
}

function hasAssistantProviderDefaultsValues(
  defaults: AssistantProviderDefaultsEntry,
): boolean {
  return Boolean(
    defaults.codexCommand ??
      defaults.model ??
      defaults.reasoningEffort ??
      defaults.sandbox ??
      defaults.approvalPolicy ??
      defaults.profile ??
      defaults.baseUrl ??
      defaults.apiKeyEnv ??
      defaults.providerName ??
      (defaults.headers && Object.keys(defaults.headers).length > 0
        ? 'headers'
        : null),
  ) || defaults.oss === true
}

function serializeAssistantOperatorDefaultsForWrite(
  defaults: AssistantOperatorDefaults | null | undefined,
): unknown {
  if (!defaults) {
    return null
  }

  return {
    provider: defaults.provider,
    defaultsByProvider: normalizeAssistantDefaultsByProvider(
      defaults.defaultsByProvider,
    ),
    identityId: defaults.identityId,
    failoverRoutes: defaults.failoverRoutes ?? null,
    account: defaults.account ?? null,
    selfDeliveryTargets: defaults.selfDeliveryTargets ?? null,
  }
}

function inferAssistantProviderFromDefaultsByProvider(
  defaultsByProvider: AssistantOperatorDefaults['defaultsByProvider'] | undefined,
): AssistantChatProviderValue | null {
  if (!defaultsByProvider) {
    return null
  }

  for (const provider of assistantChatProviderValues) {
    if (defaultsByProvider[provider]) {
      return provider
    }
  }

  return null
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
