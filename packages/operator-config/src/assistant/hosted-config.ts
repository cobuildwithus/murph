import { z } from 'zod'
import {
  assistantModelTargetSchema,
  type AssistantChatProvider,
} from '../assistant-cli-contracts.js'
import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
  sanitizeAssistantBackendTargetForPersistence,
} from '../assistant-backend.js'
import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfigInput,
} from './provider-config.js'
import {
  resolveOpenAICompatibleProviderPreset,
  resolveOpenAICompatibleProviderPresetFromId,
} from './openai-compatible-provider-presets.js'

export const HOSTED_ASSISTANT_CONFIG_SCHEMA = 'murph.hosted-assistant-config.v1'
export const hostedAssistantProfileManagedByValues = [
  'member',
  'platform',
] as const

export const hostedAssistantProfileSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    managedBy: z.enum(hostedAssistantProfileManagedByValues).default('member'),
    target: assistantModelTargetSchema.refine(
      (target) => target.adapter === 'openai-compatible',
      'Hosted assistant profiles must use the OpenAI-compatible adapter.',
    ),
  })
  .strict()

const hostedAssistantConfigBaseSchema = z
  .object({
    schema: z.literal(HOSTED_ASSISTANT_CONFIG_SCHEMA),
    activeProfileId: z.string().min(1).nullable().default(null),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const hostedAssistantConfigSchema = hostedAssistantConfigBaseSchema.extend({
  profiles: z.array(hostedAssistantProfileSchema).default([]),
})

export type HostedAssistantProfileManagedBy =
  (typeof hostedAssistantProfileManagedByValues)[number]
export type HostedAssistantProfile = z.infer<typeof hostedAssistantProfileSchema>
export type HostedAssistantConfig = z.infer<typeof hostedAssistantConfigSchema>

export function createHostedAssistantConfig(input: {
  activeProfileId?: string | null
  profiles: readonly HostedAssistantProfile[]
  updatedAt?: string | null
}): HostedAssistantConfig {
  const profiles = input.profiles.map((profile) =>
    createHostedAssistantProfile({
      id: profile.id,
      label: profile.label,
      managedBy: profile.managedBy,
      providerConfig: hostedAssistantProfileToProviderConfigInput(profile),
    }),
  )
  const activeProfileId = resolveHostedAssistantActiveProfileId(
    normalizeHostedAssistantString(input.activeProfileId),
    profiles,
  )

  return hostedAssistantConfigSchema.parse({
    schema: HOSTED_ASSISTANT_CONFIG_SCHEMA,
    activeProfileId,
    profiles,
    updatedAt: normalizeHostedAssistantString(input.updatedAt) ?? new Date().toISOString(),
  })
}

export function createHostedAssistantProfile(input: {
  id: string
  label?: string | null
  managedBy?: HostedAssistantProfileManagedBy | null
  providerConfig: AssistantProviderConfigInput | null | undefined
}): HostedAssistantProfile {
  const normalizedConfig = normalizeAssistantProviderConfig(input.providerConfig)
  const target = sanitizeAssistantBackendTargetForPersistence(
    createAssistantModelTarget(normalizedConfig),
  )

  if (!target || target.adapter !== 'openai-compatible') {
    throw new TypeError(
      'Hosted assistant profiles require an explicit OpenAI-compatible target.',
    )
  }

  return hostedAssistantProfileSchema.parse({
    id: normalizeRequiredHostedAssistantString(input.id, 'hosted assistant profile id'),
    label:
      normalizeHostedAssistantString(input.label) ??
      resolveHostedAssistantProfileLabel({
        apiKeyEnv: target.apiKeyEnv,
        baseUrl: target.endpoint,
        presetId: target.presetId,
        provider: target.adapter,
        providerName: target.providerName,
      }),
    managedBy: input.managedBy ?? 'member',
    target,
  })
}

export function normalizeHostedAssistantConfig(
  config: HostedAssistantConfig | null | undefined,
): HostedAssistantConfig | null {
  if (!config) {
    return null
  }

  const currentParsed = hostedAssistantConfigSchema.safeParse(config)
  if (currentParsed.success) {
    return createHostedAssistantConfig({
      activeProfileId: currentParsed.data.activeProfileId,
      profiles: currentParsed.data.profiles,
      updatedAt: currentParsed.data.updatedAt,
    })
  }

  if (typeof config !== 'object' || config === null) {
    return null
  }

  const record = config as Record<string, unknown>
  const base = hostedAssistantConfigBaseSchema.safeParse({
    schema: record.schema,
    activeProfileId: record.activeProfileId ?? null,
    updatedAt: record.updatedAt,
  })
  if (!base.success) {
    return null
  }

  if (record.profiles !== undefined && !Array.isArray(record.profiles)) {
    return null
  }

  const rawProfiles = Array.isArray(record.profiles) ? record.profiles : []
  const profiles: HostedAssistantProfile[] = []
  for (const profile of rawProfiles) {
    const normalizedProfile = normalizeUnknownHostedAssistantProfile(profile)
    if (!normalizedProfile) {
      return null
    }

    profiles.push(normalizedProfile)
  }

  return createHostedAssistantConfig({
    activeProfileId: base.data.activeProfileId,
    profiles,
    updatedAt: base.data.updatedAt,
  })
}

export function serializeHostedAssistantConfigForWrite(
  config: HostedAssistantConfig | null | undefined,
): unknown {
  return normalizeHostedAssistantConfig(config)
}

export function resolveHostedAssistantActiveProfile(
  config: HostedAssistantConfig | null | undefined,
): HostedAssistantProfile | null {
  const normalized = normalizeHostedAssistantConfig(config)
  if (!normalized) {
    return null
  }

  const activeProfileId = resolveHostedAssistantActiveProfileId(
    normalized.activeProfileId,
    normalized.profiles,
  )
  if (!activeProfileId) {
    return null
  }

  return normalized.profiles.find((profile) => profile.id === activeProfileId) ?? null
}

export function hostedAssistantProfileToProviderConfigInput(
  profile: HostedAssistantProfile,
): AssistantProviderConfigInput {
  return assistantBackendTargetToProviderConfigInput(profile.target)
}

export function hostedAssistantConfigsEqual(
  left: HostedAssistantConfig | null | undefined,
  right: HostedAssistantConfig | null | undefined,
): boolean {
  const normalizedLeft = normalizeHostedAssistantConfig(left)
  const normalizedRight = normalizeHostedAssistantConfig(right)

  return JSON.stringify(stripHostedAssistantConfigTimestamps(normalizedLeft)) === JSON.stringify(
    stripHostedAssistantConfigTimestamps(normalizedRight),
  )
}

export function hostedAssistantProfilesEqual(
  left: HostedAssistantProfile | null | undefined,
  right: HostedAssistantProfile | null | undefined,
): boolean {
  const normalizedLeft = left
    ? createHostedAssistantProfile({
        id: left.id,
        label: left.label,
        managedBy: left.managedBy,
        providerConfig: hostedAssistantProfileToProviderConfigInput(left),
      })
    : null
  const normalizedRight = right
    ? createHostedAssistantProfile({
        id: right.id,
        label: right.label,
        managedBy: right.managedBy,
        providerConfig: hostedAssistantProfileToProviderConfigInput(right),
      })
    : null

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
}

export function resolveHostedAssistantProfileLabel(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  presetId?: string | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
}): string {
  const preset =
    resolveOpenAICompatibleProviderPresetFromId(input.presetId) ??
    resolveOpenAICompatibleProviderPreset({
      apiKeyEnv: input.apiKeyEnv,
      baseUrl: input.baseUrl,
      providerName: input.providerName,
    })
  if (preset && preset.id !== 'custom') {
    return preset.title
  }

  const providerName = normalizeHostedAssistantString(input.providerName)
  if (providerName) {
    return providerName
  }

  const baseUrl = normalizeHostedAssistantString(input.baseUrl)
  if (baseUrl) {
    try {
      return new URL(baseUrl).host
    } catch {
      return baseUrl
    }
  }

  return input.provider === 'openai-compatible'
    ? 'OpenAI-compatible endpoint'
    : 'Hosted assistant profile'
}

function resolveHostedAssistantActiveProfileId(
  activeProfileId: string | null,
  profiles: readonly HostedAssistantProfile[],
): string | null {
  if (activeProfileId && profiles.some((profile) => profile.id === activeProfileId)) {
    return activeProfileId
  }

  return profiles[0]?.id ?? null
}

function stripHostedAssistantConfigTimestamps(
  config: HostedAssistantConfig | null,
): Omit<HostedAssistantConfig, 'updatedAt'> | null {
  if (!config) {
    return null
  }

  return {
    activeProfileId: config.activeProfileId,
    profiles: config.profiles,
    schema: config.schema,
  }
}

function normalizeUnknownHostedAssistantProfile(
  value: unknown,
): HostedAssistantProfile | null {
  const current = hostedAssistantProfileSchema.safeParse(value)
  if (!current.success) {
    return null
  }

  return createHostedAssistantProfile({
    id: current.data.id,
    label: current.data.label,
    managedBy: current.data.managedBy,
    providerConfig: hostedAssistantProfileToProviderConfigInput(current.data),
  })
}

function normalizeHostedAssistantString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeRequiredHostedAssistantString(value: string | null | undefined, label: string) {
  const normalized = normalizeHostedAssistantString(value)
  if (!normalized) {
    throw new TypeError(`${label} is required.`)
  }

  return normalized
}
