import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import {
  type AssistantSelfDeliveryTarget,
} from './assistant-cli-contracts.js'
import {
  assistantBackendTargetSchema,
  assistantBackendTargetToProviderConfigInput,
  createAssistantBackendTarget,
  normalizeAssistantBackendTarget,
  sanitizeAssistantBackendTargetForPersistence,
  type AssistantBackendTarget,
} from './assistant-backend.js'
import { readEnvValue } from './env-values.js'
import {
  type AssistantProviderDefaultsConfig,
  type AssistantProviderConfigInput,
  serializeAssistantProviderOperatorDefaults,
} from './assistant/provider-config.js'
import {
  parseHostedAssistantConfig,
  type HostedAssistantConfig,
} from './hosted-assistant-config.js'
import {
  applyAssistantSelfDeliveryTargetDefaults as applyAssistantSelfDeliveryTargetDefaultsFromModule,
  assistantSelfDeliveryTargetMapSchema,
  clearAssistantSelfDeliveryTargets as clearAssistantSelfDeliveryTargetsFromModule,
  listAssistantSelfDeliveryTargets as listAssistantSelfDeliveryTargetsFromModule,
  normalizeAssistantSelfDeliveryTargetMap,
  normalizeUnknownAssistantSelfDeliveryTargets as normalizeUnknownAssistantSelfDeliveryTargetsFromModule,
  resolveAssistantSelfDeliveryTarget as resolveAssistantSelfDeliveryTargetFromModule,
  saveAssistantSelfDeliveryTarget as saveAssistantSelfDeliveryTargetFromModule,
  type AssistantSelfDeliveryTargetLookupInput,
} from './operator-config/self-delivery-targets.js'
import {
  expandConfiguredVaultPath,
  normalizeVaultForConfig,
  pathExists,
  readOperatorConfigFile,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
  writeOperatorConfigFile,
} from './operator-config/storage.js'
export {
  ROOT_OPTIONS_WITH_VALUES,
  resolveEffectiveTopLevelToken,
} from './command-helpers.js'
export {
  expandConfiguredVaultPath,
  normalizeVaultForConfig,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
} from './operator-config/storage.js'
export type { AssistantSelfDeliveryTargetLookupInput } from './operator-config/self-delivery-targets.js'

const OPERATOR_CONFIG_SCHEMA = 'murph.operator-config.v1'
export const VAULT_ENV = 'VAULT'
export const VAULT_ENV_KEYS = [VAULT_ENV] as const

const assistantOperatorSharedFields = {
  identityId: z.string().min(1).nullable().default(null),
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
  selfDeliveryTargets: assistantSelfDeliveryTargetMapSchema.default(null),
} as const

const assistantOperatorDefaultsSchema = z.object({
  backend: assistantBackendTargetSchema.nullable().default(null),
  ...assistantOperatorSharedFields,
}).strict()

const operatorConfigSchema = z.object({
  schema: z.literal(OPERATOR_CONFIG_SCHEMA),
  defaultVault: z.string().min(1).nullable(),
  assistant: z.unknown().nullable().default(null),
  hostedAssistant: z.unknown().nullable().optional(),
  updatedAt: z.string().datetime({ offset: true }),
})

type RawOperatorConfig = z.infer<typeof operatorConfigSchema>

export interface OperatorConfig extends Omit<RawOperatorConfig, 'assistant' | 'hostedAssistant'> {
  assistant: AssistantOperatorDefaults | null
  hostedAssistant: HostedAssistantConfig | null
  hostedAssistantInvalid?: boolean
}
export type AssistantOperatorDefaults = z.infer<
  typeof assistantOperatorDefaultsSchema
>

const assistantSelfDeliveryTargetDependencies = {
  normalizeString: normalizeOperatorConfigString,
  resolveDefaults: resolveAssistantOperatorDefaults,
  saveDefaultsPatch: saveAssistantOperatorDefaultsPatch,
}

export async function readOperatorConfig(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<OperatorConfig | null> {
  try {
    const raw = await readOperatorConfigFile(resolveOperatorConfigPath(homeDirectory))
    if (raw === null) {
      return null
    }

    return normalizeParsedOperatorConfig(
      operatorConfigSchema.parse(JSON.parse(raw)),
    )
  } catch (error) {
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
  const existing = await readOperatorConfigForPatch(homeDirectory)
  const config = buildOperatorConfig(
    {
      defaultVault: normalizeVaultForConfig(vault, homeDirectory),
    },
    existing,
  )
  const configPath = resolveOperatorConfigPath(homeDirectory)

  await writeOperatorConfigFile(
    configPath,
    `${JSON.stringify(serializeOperatorConfigForWrite(config), null, 2)}\n`,
  )

  return config
}

export async function saveAssistantOperatorDefaultsPatch(
  patch: Partial<AssistantOperatorDefaults>,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<OperatorConfig> {
  const existing = await readOperatorConfigForPatch(homeDirectory)
  const config = buildOperatorConfig(
    {
      assistant: mergeAssistantOperatorDefaults(existing?.assistant ?? null, patch),
    },
    existing,
  )
  const configPath = resolveOperatorConfigPath(homeDirectory)

  await writeOperatorConfigFile(
    configPath,
    `${JSON.stringify(serializeOperatorConfigForWrite(config), null, 2)}\n`,
  )

  return config
}

async function readOperatorConfigForPatch(
  homeDirectory: string,
): Promise<OperatorConfig | null> {
  try {
    return await readOperatorConfig(homeDirectory)
  } catch (error) {
    if (!hasErrorCode(error, 'ASSISTANT_RUNTIME_TARGET_UNSUPPORTED')) {
      throw error
    }
  }

  const raw = await readOperatorConfigFile(resolveOperatorConfigPath(homeDirectory))
  if (raw === null) {
    return null
  }

  try {
    const parsed = operatorConfigSchema.parse(JSON.parse(raw))
    return normalizeParsedOperatorConfig({
      ...parsed,
      assistant: stripUnsupportedAssistantBackend(parsed.assistant),
    })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return null
    }

    throw error
  }
}

function stripUnsupportedAssistantBackend(value: unknown): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? {
        ...value,
        backend: null,
      }
    : null
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
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

  await writeOperatorConfigFile(
    configPath,
    `${JSON.stringify(serializeOperatorConfigForWrite(config), null, 2)}\n`,
  )

  return config
}

function normalizeAssistantBackendTargetForPersistence(
  value: unknown,
): AssistantBackendTarget | null {
  return sanitizeAssistantBackendTargetForPersistence(
    normalizeAssistantBackendTarget(value),
  )
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

  const assistant = normalizeAssistantOperatorDefaults(config.assistant)

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

  const config = await readOperatorConfigForPatch(homeDirectory)
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

export async function resolveConfiguredDefaultVault(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<string | null> {
  const config = await readOperatorConfigForPatch(homeDirectory)
  if (!config?.defaultVault) {
    return null
  }

  const configuredDefaultVault = expandConfiguredVaultPath(
    config.defaultVault,
    homeDirectory,
  )
  if (!(await pathExists(configuredDefaultVault))) {
    return null
  }

  return configuredDefaultVault
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
): AssistantProviderDefaultsConfig | null {
  const backend = resolveAssistantBackendTarget(defaults)
  if (!backend) {
    return null
  }

  return serializeAssistantProviderOperatorDefaults(
    assistantBackendTargetToProviderConfigInput(backend),
  )
}

export function resolveAssistantBackendTarget(
  defaults: AssistantOperatorDefaults | null | undefined,
): AssistantBackendTarget | null {
  return normalizeAssistantBackendTargetForPersistence(defaults?.backend ?? null)
}

export function buildAssistantProviderDefaultsPatch(input: {
  defaults: AssistantOperatorDefaults | null | undefined
  providerConfig: AssistantProviderConfigInput
}): Partial<AssistantOperatorDefaults> {
  const savedProviderDefaults = resolveAssistantProviderDefaults(input.defaults)
  const nextBackend = normalizeAssistantBackendTargetForPersistence(
    createAssistantBackendTarget({
      ...(savedProviderDefaults ? savedProviderDefaults : {}),
      ...input.providerConfig,
    }),
  )

  return {
    backend: nextBackend,
  }
}

export async function listAssistantSelfDeliveryTargets(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTarget[]> {
  return listAssistantSelfDeliveryTargetsFromModule(
    assistantSelfDeliveryTargetDependencies,
    homeDirectory,
  )
}

export async function resolveAssistantSelfDeliveryTarget(
  channel: string,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTarget | null> {
  return resolveAssistantSelfDeliveryTargetFromModule(
    channel,
    assistantSelfDeliveryTargetDependencies,
    homeDirectory,
  )
}

export async function saveAssistantSelfDeliveryTarget(
  target: AssistantSelfDeliveryTarget,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTarget> {
  return saveAssistantSelfDeliveryTargetFromModule(
    target,
    assistantSelfDeliveryTargetDependencies,
    homeDirectory,
  )
}

export async function clearAssistantSelfDeliveryTargets(
  channel?: string | null,
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<string[]> {
  return clearAssistantSelfDeliveryTargetsFromModule(
    channel,
    assistantSelfDeliveryTargetDependencies,
    homeDirectory,
  )
}

export async function applyAssistantSelfDeliveryTargetDefaults(
  input: AssistantSelfDeliveryTargetLookupInput,
  options?: {
    allowSingleSavedTargetFallback?: boolean
  },
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantSelfDeliveryTargetLookupInput> {
  return applyAssistantSelfDeliveryTargetDefaultsFromModule(
    input,
    assistantSelfDeliveryTargetDependencies,
    options,
    homeDirectory,
  )
}

function mergeAssistantOperatorDefaults(
  existing: AssistantOperatorDefaults | null,
  patch: Partial<AssistantOperatorDefaults>,
): AssistantOperatorDefaults {
  return assistantOperatorDefaultsSchema.parse({
    backend:
      'backend' in patch
        ? normalizeAssistantBackendTargetForPersistence(patch.backend ?? null)
        : normalizeAssistantBackendTargetForPersistence(existing?.backend ?? null),
    identityId:
      'identityId' in patch ? patch.identityId : existing?.identityId ?? null,
    account: 'account' in patch ? patch.account : existing?.account ?? null,
    selfDeliveryTargets:
      'selfDeliveryTargets' in patch
        ? normalizeAssistantSelfDeliveryTargetMap(
            patch.selfDeliveryTargets ?? null,
            normalizeOperatorConfigString,
          )
        : existing?.selfDeliveryTargets ?? null,
  })
}

function normalizeAssistantOperatorDefaults(
  defaults: unknown,
): AssistantOperatorDefaults | null {
  if (!defaults) {
    return null
  }

  const currentParsed = assistantOperatorDefaultsSchema.safeParse(defaults)
  if (currentParsed.success) {
    return compactAssistantOperatorDefaults(currentParsed.data)
  }

  if (typeof defaults !== 'object' || defaults === null) {
    return null
  }

  const record = defaults as Record<string, unknown>

  return compactAssistantOperatorDefaults({
    backend: normalizeUnknownAssistantBackendTarget(record.backend),
    identityId: normalizeUnknownAssistantIdentityId(record.identityId),
    account: normalizeUnknownAssistantAccount(record.account),
    selfDeliveryTargets: normalizeUnknownAssistantSelfDeliveryTargetsFromModule(
      record.selfDeliveryTargets,
      normalizeOperatorConfigString,
    ),
  })
}

function serializeAssistantOperatorDefaultsForWrite(
  defaults: AssistantOperatorDefaults | null | undefined,
): unknown {
  if (!defaults) {
    return null
  }

  return {
    backend: normalizeAssistantBackendTargetForPersistence(defaults.backend ?? null),
    identityId: defaults.identityId,
    account: defaults.account ?? null,
    selfDeliveryTargets: defaults.selfDeliveryTargets ?? null,
  }
}

function normalizeOperatorConfigString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function compactAssistantOperatorDefaults(
  defaults: AssistantOperatorDefaults,
): AssistantOperatorDefaults | null {
  const normalized = assistantOperatorDefaultsSchema.parse({
    backend: normalizeAssistantBackendTarget(defaults.backend ?? null),
    identityId: defaults.identityId ?? null,
    account: defaults.account ?? null,
    selfDeliveryTargets: normalizeAssistantSelfDeliveryTargetMap(
      defaults.selfDeliveryTargets ?? null,
      normalizeOperatorConfigString,
    ),
  })

  return hasAssistantOperatorDefaultsValues(normalized) ? normalized : null
}

function hasAssistantOperatorDefaultsValues(
  defaults: AssistantOperatorDefaults,
): boolean {
  return Boolean(
    defaults.backend ??
      defaults.identityId ??
      defaults.account ??
      (defaults.selfDeliveryTargets &&
      Object.keys(defaults.selfDeliveryTargets).length > 0
        ? 'selfDeliveryTargets'
        : null),
  )
}

function normalizeUnknownAssistantBackendTarget(
  value: unknown,
): AssistantBackendTarget | null {
  return normalizeAssistantBackendTarget(value)
}

function normalizeUnknownAssistantIdentityId(value: unknown): string | null {
  return normalizeOperatorConfigString(typeof value === 'string' ? value : null)
}

function normalizeUnknownAssistantAccount(
  value: unknown,
): AssistantOperatorDefaults['account'] {
  const schema = assistantOperatorDefaultsSchema.shape.account
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : null
}
