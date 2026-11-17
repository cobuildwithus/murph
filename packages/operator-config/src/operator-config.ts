import { normalizeStoredAssistantModel } from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'
import {
  type AssistantSelfDeliveryTarget,
} from './assistant-cli-contracts.js'
import {
  assistantBackendTargetSchema,
  assistantBackendTargetToProviderConfigInput,
  normalizeAssistantBackendTarget,
  sanitizeAssistantBackendTargetForPersistence,
  type AssistantBackendTarget,
} from './assistant-backend.js'
import {
  type AssistantProviderDefaultsConfig,
  serializeAssistantProviderOperatorDefaults,
} from './assistant/provider-config.js'
import {
  parseHostedAssistantConfig,
  prepareHostedAssistantConfigForWrite,
  type HostedAssistantConfig,
} from './hosted-assistant-config.js'
import {
  applyAssistantSelfDeliveryTargetDefaults as applyAssistantSelfDeliveryTargetDefaultsFromModule,
  assistantSelfDeliveryTargetMapSchema,
  normalizeAssistantSelfDeliveryTargetMap,
  listAssistantSelfDeliveryTargets as listAssistantSelfDeliveryTargetsFromModule,
  normalizeUnknownAssistantSelfDeliveryTargets as normalizeUnknownAssistantSelfDeliveryTargetsFromModule,
  resolveAssistantSelfDeliveryTarget as resolveAssistantSelfDeliveryTargetFromModule,
  type AssistantSelfDeliveryTargetLookupInput,
} from './operator-config/self-delivery-targets.js'
import {
  invalidOperatorConfigError,
  operatorConfigSchema,
  readStrictRawOperatorConfig,
  type RawOperatorConfig,
  readOperatorConfigFile,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
  writeOperatorConfigFile,
} from './operator-config/storage.js'
import { VaultCliError } from './vault-cli-errors.js'
export {
  ROOT_OPTIONS_WITH_VALUES,
} from './command-helpers.js'
export {
  expandConfiguredVaultPath,
  resolveDefaultVault,
  VAULT_ENV,
  VAULT_ENV_KEYS,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
} from './operator-config/storage.js'
export type { AssistantSelfDeliveryTargetLookupInput } from './operator-config/self-delivery-targets.js'

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
              resetsAt: z.isoDateTime({ offset: true }).nullable(),
            })
            .strict()
            .nullable(),
          secondaryWindow: z
            .object({
              usedPercent: z.number().min(0).max(100),
              remainingPercent: z.number().min(0).max(100),
              windowMinutes: z.number().int().positive().nullable(),
              resetsAt: z.isoDateTime({ offset: true }).nullable(),
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
  resolveDefaults: resolveAssistantOperatorDefaultsForPatch,
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

async function readOperatorConfigForPatch(
  homeDirectory: string,
): Promise<OperatorConfig | null> {
  const parsed = await readStrictRawOperatorConfig(homeDirectory)
  if (parsed === null) {
    return null
  }

  const assistant = normalizeAssistantOperatorDefaultsForPatch(parsed.assistant)
  let hostedAssistant: HostedAssistantConfig | null = null
  if (parsed.hostedAssistant !== undefined && parsed.hostedAssistant !== null) {
    try {
      hostedAssistant = parseHostedAssistantConfig(parsed.hostedAssistant)
    } catch {
      throw invalidOperatorConfigError()
    }
  }

  return normalizeParsedOperatorConfig({
    ...parsed,
    assistant,
    hostedAssistant,
  })
}

function normalizeAssistantOperatorDefaultsForPatch(
  defaults: unknown,
): AssistantOperatorDefaults | null {
  if (defaults === undefined || defaults === null) {
    return null
  }

  const current = assistantOperatorDefaultsSchema.safeParse(defaults)
  if (current.success) {
    return current.data
  }

  if (typeof defaults !== 'object' || Array.isArray(defaults)) {
    throw invalidOperatorConfigError()
  }

  try {
    normalizeAssistantBackendTargetForPersistence(
      (defaults as Record<string, unknown>).backend,
    )
  } catch (error) {
    if (!hasErrorCode(error, 'ASSISTANT_RUNTIME_TARGET_UNSUPPORTED')) {
      throw error
    }

    const migrated = assistantOperatorDefaultsSchema.safeParse(
      stripUnsupportedAssistantBackend(defaults),
    )
    if (migrated.success) {
      return migrated.data
    }
  }

  throw invalidOperatorConfigError()
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
  const rawExisting = await readStrictRawOperatorConfig(homeDirectory)
  const existing = rawExisting === null
    ? null
    : normalizeParsedOperatorConfig({
        ...rawExisting,
        assistant: normalizeAssistantOperatorDefaultsForPatch(rawExisting.assistant),
        hostedAssistant: null,
      })
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
  if (patch.assistant?.backend) normalizeAssistantBackendTargetForPersistence(patch.assistant.backend)
  if (patch.hostedAssistant) prepareHostedAssistantConfigForWrite(patch.hostedAssistant)
  return normalizeParsedOperatorConfig(
    operatorConfigSchema.parse({
      schema: operatorConfigSchema.shape.schema.value,
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
    schema: operatorConfigSchema.shape.schema.value,
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

export async function resolveAssistantOperatorDefaults(
  homeDirectory = resolveOperatorHomeDirectory(),
): Promise<AssistantOperatorDefaults | null> {
  const config = await readOperatorConfig(homeDirectory)
  return normalizeAssistantOperatorDefaults(config?.assistant ?? null)
}

async function resolveAssistantOperatorDefaultsForPatch(
  homeDirectory: string,
): Promise<AssistantOperatorDefaults | null> {
  const config = await readOperatorConfigForPatch(homeDirectory)
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

function normalizeAssistantOperatorDefaults(
  defaults: unknown,
): AssistantOperatorDefaults | null {
  if (!defaults) {
    return null
  }

  const currentParsed = assistantOperatorDefaultsSchema.safeParse(defaults)
  if (currentParsed.success) {
    return compactAssistantOperatorDefaults({ ...currentParsed.data,
      backend: currentParsed.data.backend ? { ...currentParsed.data.backend,
        model: normalizeStoredAssistantModel(currentParsed.data.backend.model),
      } : null,
    })
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
