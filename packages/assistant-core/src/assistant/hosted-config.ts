import { z } from 'zod'
import {
  assistantApprovalPolicyValues,
  assistantChatProviderValues,
  assistantSandboxValues,
  type AssistantChatProvider,
} from '../assistant-cli-contracts.js'
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
    provider: z.enum(assistantChatProviderValues),
    codexCommand: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    reasoningEffort: z.string().min(1).nullable(),
    sandbox: z.enum(assistantSandboxValues).nullable(),
    approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable(),
    profile: z.string().min(1).nullable(),
    oss: z.boolean(),
    baseUrl: z.string().min(1).nullable(),
    apiKeyEnv: z.string().min(1).nullable(),
    providerName: z.string().min(1).nullable(),
  })
  .strict()

export const hostedAssistantConfigSchema = z
  .object({
    schema: z.literal(HOSTED_ASSISTANT_CONFIG_SCHEMA),
    activeProfileId: z.string().min(1).nullable().default(null),
    profiles: z.array(hostedAssistantProfileSchema).default([]),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()

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

  return hostedAssistantProfileSchema.parse({
    id: normalizeRequiredHostedAssistantString(input.id, 'hosted assistant profile id'),
    label:
      normalizeHostedAssistantString(input.label) ??
      resolveHostedAssistantProfileLabel({
        apiKeyEnv: normalizedConfig.apiKeyEnv,
        baseUrl: normalizedConfig.baseUrl,
        provider: normalizedConfig.provider,
        providerName: normalizedConfig.providerName,
      }),
    managedBy: input.managedBy ?? 'member',
    provider: normalizedConfig.provider,
    codexCommand: normalizedConfig.codexCommand,
    model: normalizedConfig.model,
    reasoningEffort: normalizedConfig.reasoningEffort,
    sandbox: normalizedConfig.sandbox,
    approvalPolicy: normalizedConfig.approvalPolicy,
    profile: normalizedConfig.profile,
    oss: normalizedConfig.oss,
    baseUrl: normalizedConfig.baseUrl,
    apiKeyEnv: normalizedConfig.apiKeyEnv,
    providerName: normalizedConfig.providerName,
  })
}

export function normalizeHostedAssistantConfig(
  config: HostedAssistantConfig | null | undefined,
): HostedAssistantConfig | null {
  if (!config) {
    return null
  }

  const parsed = hostedAssistantConfigSchema.parse(config)

  return createHostedAssistantConfig({
    activeProfileId: parsed.activeProfileId,
    profiles: parsed.profiles,
    updatedAt: parsed.updatedAt,
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
  return {
    provider: profile.provider,
    approvalPolicy: profile.approvalPolicy,
    apiKeyEnv: profile.apiKeyEnv,
    baseUrl: profile.baseUrl,
    codexCommand: profile.codexCommand,
    model: profile.model,
    oss: profile.oss,
    profile: profile.profile,
    providerName: profile.providerName,
    reasoningEffort: profile.reasoningEffort,
    sandbox: profile.sandbox,
  }
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
  if (input.provider === 'codex-cli') {
    return 'Codex CLI'
  }

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

function normalizeHostedAssistantString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeRequiredHostedAssistantString(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = normalizeHostedAssistantString(value)
  if (!normalized) {
    throw new TypeError(`${label} must be a non-empty string.`)
  }

  return normalized
}
