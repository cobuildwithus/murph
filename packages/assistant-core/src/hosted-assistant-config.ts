import {
  assistantApprovalPolicyValues,
  assistantReasoningEffortValues,
  assistantSandboxValues,
  type AssistantApprovalPolicy,
  type AssistantChatProvider,
  type AssistantReasoningEffort,
  type AssistantSandbox,
} from './assistant-cli-contracts.js'
import {
  HOSTED_ASSISTANT_CONFIG_SCHEMA,
  createHostedAssistantConfig,
  createHostedAssistantProfile,
  hostedAssistantConfigsEqual,
  hostedAssistantProfileToProviderConfigInput,
  normalizeHostedAssistantConfig,
  resolveHostedAssistantActiveProfile,
  resolveHostedAssistantProfileLabel,
  type HostedAssistantConfig,
  type HostedAssistantProfile,
} from './assistant/hosted-config.js'
import {
  resolveOpenAICompatibleProviderPresetFromId,
  resolveOpenAICompatibleProviderPresetFromProviderName,
} from './assistant/openai-compatible-provider-presets.js'
import type { AssistantProviderConfigInput } from './assistant/provider-config.js'
import {
  readOperatorConfig,
  saveHostedAssistantConfig,
} from './operator-config.js'

export const HOSTED_ASSISTANT_PROVIDER_ENV = 'HOSTED_ASSISTANT_PROVIDER'
export const HOSTED_ASSISTANT_MODEL_ENV = 'HOSTED_ASSISTANT_MODEL'
export const HOSTED_ASSISTANT_BASE_URL_ENV = 'HOSTED_ASSISTANT_BASE_URL'
export const HOSTED_ASSISTANT_API_KEY_ENV = 'HOSTED_ASSISTANT_API_KEY_ENV'
export const HOSTED_ASSISTANT_PROVIDER_NAME_ENV = 'HOSTED_ASSISTANT_PROVIDER_NAME'
export const HOSTED_ASSISTANT_CODEX_COMMAND_ENV = 'HOSTED_ASSISTANT_CODEX_COMMAND'
export const HOSTED_ASSISTANT_APPROVAL_POLICY_ENV = 'HOSTED_ASSISTANT_APPROVAL_POLICY'
export const HOSTED_ASSISTANT_SANDBOX_ENV = 'HOSTED_ASSISTANT_SANDBOX'
export const HOSTED_ASSISTANT_PROFILE_ENV = 'HOSTED_ASSISTANT_PROFILE'
export const HOSTED_ASSISTANT_REASONING_EFFORT_ENV = 'HOSTED_ASSISTANT_REASONING_EFFORT'
export const HOSTED_ASSISTANT_OSS_ENV = 'HOSTED_ASSISTANT_OSS'

export const HOSTED_ASSISTANT_CONFIG_ENV_NAMES = [
  HOSTED_ASSISTANT_PROVIDER_ENV,
  HOSTED_ASSISTANT_MODEL_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_APPROVAL_POLICY_ENV,
  HOSTED_ASSISTANT_SANDBOX_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_REASONING_EFFORT_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
] as const

const HOSTED_ASSISTANT_PLATFORM_PROFILE_ID = 'platform-default'

export type HostedAssistantConfigurationErrorCode =
  | 'HOSTED_ASSISTANT_CONFIG_INVALID'
  | 'HOSTED_ASSISTANT_CONFIG_REQUIRED'

export class HostedAssistantConfigurationError extends Error {
  readonly code: HostedAssistantConfigurationErrorCode

  constructor(
    code: HostedAssistantConfigurationErrorCode,
    message: string,
  ) {
    super(message)
    this.code = code
    this.name = 'HostedAssistantConfigurationError'
  }
}

export interface HostedAssistantOperatorConfigState {
  configured: boolean
  provider: AssistantChatProvider | null
}

export interface HostedAssistantBootstrapResult extends HostedAssistantOperatorConfigState {
  seeded: boolean
  source: 'hosted-env' | 'invalid' | 'missing' | 'saved'
}

interface HostedAssistantSeedPlan {
  providerConfig: AssistantProviderConfigInput
}

interface HostedAssistantRawEnvConfig {
  anyConfigured: boolean
  apiKeyEnv: string | null
  approvalPolicy: AssistantApprovalPolicy | null
  baseUrl: string | null
  codexCommand: string | null
  model: string | null
  oss: boolean | null
  profile: string | null
  providerName: string | null
  providerToken: string | null
  reasoningEffort: AssistantReasoningEffort | null
  sandbox: AssistantSandbox | null
}

export {
  HOSTED_ASSISTANT_CONFIG_SCHEMA,
  type HostedAssistantConfig,
  type HostedAssistantProfile,
}

export function parseHostedAssistantConfig(value: unknown): HostedAssistantConfig {
  const parsed = normalizeHostedAssistantConfig(
    value as HostedAssistantConfig | null | undefined,
  )

  if (!parsed) {
    throw new TypeError('Hosted assistant config is required.')
  }

  return parsed
}

export function tryParseHostedAssistantConfig(value: unknown): HostedAssistantConfig | null {
  try {
    return parseHostedAssistantConfig(value)
  } catch {
    return null
  }
}

export function parseHostedAssistantConfigJson(value: string): HostedAssistantConfig {
  return parseHostedAssistantConfig(JSON.parse(value) as unknown)
}

export function prepareHostedAssistantConfigForWrite(
  config: HostedAssistantConfig | null | undefined,
): HostedAssistantConfig | null {
  return normalizeHostedAssistantConfig(config)
}

export function resolveHostedAssistantProfile(
  config: HostedAssistantConfig | null | undefined,
  profileId: string | null | undefined,
): HostedAssistantProfile | null {
  const normalized = normalizeHostedAssistantConfig(config)
  const normalizedProfileId = normalizeHostedAssistantString(profileId)

  if (!normalized || !normalizedProfileId) {
    return null
  }

  return (
    normalized.profiles.find((profile) => profile.id === normalizedProfileId) ?? null
  )
}

export function resolveActiveHostedAssistantProfile(
  config: HostedAssistantConfig | null | undefined,
): HostedAssistantProfile | null {
  return resolveHostedAssistantActiveProfile(config)
}

export function compileHostedAssistantProfileProviderConfig(
  profile: HostedAssistantProfile,
): AssistantProviderConfigInput {
  return hostedAssistantProfileToProviderConfigInput(profile)
}

export function isHostedAssistantProfileReady(
  profile: HostedAssistantProfile | null | undefined,
): boolean {
  if (!profile) {
    return false
  }

  const providerConfig = hostedAssistantProfileToProviderConfigInput(profile)
  if (!normalizeHostedAssistantString(providerConfig.model)) {
    return false
  }

  if (profile.provider === 'openai-compatible') {
    return normalizeHostedAssistantString(providerConfig.baseUrl) !== null
  }

  return true
}

export function resolveReadyHostedAssistantProfile(
  config: HostedAssistantConfig | null | undefined,
): HostedAssistantProfile | null {
  const activeProfile = resolveActiveHostedAssistantProfile(config)
  return isHostedAssistantProfileReady(activeProfile) ? activeProfile : null
}

export function resolveHostedAssistantProviderConfig(
  config: HostedAssistantConfig | null | undefined,
): AssistantProviderConfigInput | null {
  const readyProfile = resolveReadyHostedAssistantProfile(config)
  return readyProfile
    ? hostedAssistantProfileToProviderConfigInput(readyProfile)
    : null
}

export async function ensureHostedAssistantOperatorDefaults(input: {
  allowMissing: boolean
  env?: Readonly<Record<string, string | undefined>>
  homeDirectory?: string
}): Promise<HostedAssistantBootstrapResult> {
  const existingOperatorConfig = await readOperatorConfig(input.homeDirectory)
  const existingHostedConfig = existingOperatorConfig?.hostedAssistant ?? null
  const existingHostedConfigInvalid = existingOperatorConfig?.hostedAssistantInvalid === true
  const existingActiveProfile = resolveActiveHostedAssistantProfile(existingHostedConfig)
  const existingState = resolveHostedAssistantOperatorDefaultsState(existingHostedConfig)
  const envProfile = resolveHostedAssistantEnvProfile(input.env, existingActiveProfile)

  if (existingHostedConfigInvalid) {
    if (input.allowMissing) {
      return {
        configured: false,
        provider: null,
        seeded: false,
        source: 'invalid',
      }
    }

    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      'Hosted assistant config is present but invalid.',
    )
  }

  if (existingState.configured) {
    if (
      existingActiveProfile?.managedBy === 'platform' &&
      envProfile &&
      !hostedAssistantConfigsEqual(
        existingHostedConfig,
        upsertHostedAssistantProfile(existingHostedConfig, envProfile),
      )
    ) {
      const nextConfig = upsertHostedAssistantProfile(existingHostedConfig, envProfile)
      const saved = await saveHostedAssistantConfig(nextConfig, input.homeDirectory)
      const savedState = resolveHostedAssistantOperatorDefaultsState(saved.hostedAssistant)

      return {
        ...savedState,
        seeded: true,
        source: 'hosted-env',
      }
    }

    return {
      ...existingState,
      seeded: false,
      source: 'saved',
    }
  }

  if (
    existingActiveProfile?.managedBy === 'platform' &&
    envProfile
  ) {
    const nextConfig = upsertHostedAssistantProfile(existingHostedConfig, envProfile)
    const saved = await saveHostedAssistantConfig(nextConfig, input.homeDirectory)
    const savedState = resolveHostedAssistantOperatorDefaultsState(saved.hostedAssistant)

    return {
      ...savedState,
      seeded: true,
      source: 'hosted-env',
    }
  }

  if (!existingHostedConfig && envProfile) {
    const nextConfig = createHostedAssistantConfig({
      activeProfileId: envProfile.id,
      profiles: [envProfile],
    })
    const saved = await saveHostedAssistantConfig(nextConfig, input.homeDirectory)
    const savedState = resolveHostedAssistantOperatorDefaultsState(saved.hostedAssistant)

    return {
      ...savedState,
      seeded: true,
      source: 'hosted-env',
    }
  }

  if (input.allowMissing) {
    return {
      configured: false,
      provider: existingActiveProfile?.provider ?? null,
      seeded: false,
      source: 'missing',
    }
  }

  if (existingHostedConfig) {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      'Hosted assistant config is present but does not define a ready active profile.',
    )
  }

  throw new HostedAssistantConfigurationError(
    'HOSTED_ASSISTANT_CONFIG_REQUIRED',
    [
      'Hosted assistant automation requires explicit hosted assistant config.',
      `Set ${HOSTED_ASSISTANT_PROVIDER_ENV} and ${HOSTED_ASSISTANT_MODEL_ENV}`,
      'or save an explicit hosted assistant profile before hosted runs.',
    ].join(' '),
  )
}

export function resolveHostedAssistantOperatorDefaultsState(
  config: HostedAssistantConfig | null | undefined,
): HostedAssistantOperatorConfigState {
  const hostedConfig = tryParseHostedAssistantConfig(config)
  if (hostedConfig) {
    const activeProfile = resolveActiveHostedAssistantProfile(hostedConfig)
    const readyProfile = resolveReadyHostedAssistantProfile(hostedConfig)

    return {
      configured: readyProfile !== null,
      provider: readyProfile?.provider ?? activeProfile?.provider ?? null,
    }
  }

  return {
    configured: false,
    provider: null,
  }
}

export function readHostedAssistantApiKeyEnvName(
  source: Readonly<Record<string, unknown>>,
): string | null {
  return normalizeHostedAssistantString(source[HOSTED_ASSISTANT_API_KEY_ENV])
}

function resolveHostedAssistantEnvProfile(
  env: Readonly<Record<string, string | undefined>> | undefined,
  existingActiveProfile: HostedAssistantProfile | null,
): HostedAssistantProfile | null {
  const seedPlan = resolveHostedAssistantSeedPlan(env)
  if (!seedPlan) {
    return null
  }

  const platformProfile = existingActiveProfile?.managedBy === 'platform'
    ? existingActiveProfile
    : null

  return createHostedAssistantProfile({
    id: platformProfile?.id ?? HOSTED_ASSISTANT_PLATFORM_PROFILE_ID,
    label: resolveHostedAssistantProfileLabel(seedPlan.providerConfig),
    managedBy: 'platform',
    providerConfig: seedPlan.providerConfig,
  })
}

function upsertHostedAssistantProfile(
  config: HostedAssistantConfig | null | undefined,
  profile: HostedAssistantProfile,
): HostedAssistantConfig {
  const normalized = normalizeHostedAssistantConfig(config)

  if (!normalized) {
    return createHostedAssistantConfig({
      activeProfileId: profile.id,
      profiles: [profile],
    })
  }

  return createHostedAssistantConfig({
    activeProfileId: profile.id,
    profiles: [
      ...normalized.profiles.filter((candidate) => candidate.id !== profile.id),
      profile,
    ],
  })
}

function resolveHostedAssistantSeedPlan(
  env: Readonly<Record<string, string | undefined>> | undefined,
): HostedAssistantSeedPlan | null {
  const raw = readHostedAssistantRawEnvConfig(env)

  if (!raw.anyConfigured) {
    return null
  }

  if (!raw.providerToken) {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      `${HOSTED_ASSISTANT_PROVIDER_ENV} is required when any HOSTED_ASSISTANT_* setting is configured.`,
    )
  }

  const providerSelection = resolveHostedAssistantProviderSelection(raw.providerToken)

  if (!raw.model) {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      `${HOSTED_ASSISTANT_MODEL_ENV} must be configured for hosted assistant provider ${providerSelection.label}.`,
    )
  }

  switch (providerSelection.provider) {
    case 'codex-cli':
      requireAbsentHostedAssistantValues(
        providerSelection.label,
        [
          [HOSTED_ASSISTANT_BASE_URL_ENV, raw.baseUrl],
          [HOSTED_ASSISTANT_API_KEY_ENV, raw.apiKeyEnv],
          [HOSTED_ASSISTANT_PROVIDER_NAME_ENV, raw.providerName],
        ],
      )
      return {
        providerConfig: {
          provider: 'codex-cli',
          approvalPolicy: raw.approvalPolicy,
          codexCommand: raw.codexCommand,
          model: raw.model,
          oss: raw.oss ?? false,
          profile: raw.profile,
          reasoningEffort: raw.reasoningEffort,
          sandbox: raw.sandbox,
        },
      }
    case 'openai-compatible': {
      requireAbsentHostedAssistantValues(
        providerSelection.label,
        [
          [HOSTED_ASSISTANT_CODEX_COMMAND_ENV, raw.codexCommand],
          [HOSTED_ASSISTANT_APPROVAL_POLICY_ENV, raw.approvalPolicy],
          [HOSTED_ASSISTANT_SANDBOX_ENV, raw.sandbox],
          [HOSTED_ASSISTANT_PROFILE_ENV, raw.profile],
          [HOSTED_ASSISTANT_OSS_ENV, raw.oss],
        ],
      )

      const baseUrl = raw.baseUrl ?? providerSelection.presetBaseUrl
      if (!baseUrl) {
        throw new HostedAssistantConfigurationError(
          'HOSTED_ASSISTANT_CONFIG_INVALID',
          [
            `${HOSTED_ASSISTANT_BASE_URL_ENV} must be configured for hosted assistant provider ${providerSelection.label}.`,
            `Named providers like ${HOSTED_ASSISTANT_PROVIDER_ENV}=openai or openrouter set this automatically.`,
          ].join(' '),
        )
      }

      return {
        providerConfig: {
          provider: 'openai-compatible',
          apiKeyEnv: raw.apiKeyEnv ?? providerSelection.presetApiKeyEnv,
          baseUrl,
          model: raw.model,
          providerName: raw.providerName ?? providerSelection.presetProviderName,
          reasoningEffort: raw.reasoningEffort,
        },
      }
    }
  }
}

function readHostedAssistantRawEnvConfig(
  env: Readonly<Record<string, string | undefined>> | undefined,
): HostedAssistantRawEnvConfig {
  const source = env ?? process.env
  const rawOss = normalizeHostedAssistantString(source[HOSTED_ASSISTANT_OSS_ENV])
  const values = {
    apiKeyEnv: normalizeHostedAssistantString(source[HOSTED_ASSISTANT_API_KEY_ENV]),
    approvalPolicy: parseHostedAssistantEnum(
      source[HOSTED_ASSISTANT_APPROVAL_POLICY_ENV],
      HOSTED_ASSISTANT_APPROVAL_POLICY_ENV,
      assistantApprovalPolicyValues,
    ),
    baseUrl: normalizeHostedAssistantString(source[HOSTED_ASSISTANT_BASE_URL_ENV]),
    codexCommand: normalizeHostedAssistantString(source[HOSTED_ASSISTANT_CODEX_COMMAND_ENV]),
    model: normalizeHostedAssistantString(source[HOSTED_ASSISTANT_MODEL_ENV]),
    oss: parseHostedAssistantBoolean(rawOss, HOSTED_ASSISTANT_OSS_ENV),
    profile: normalizeHostedAssistantString(source[HOSTED_ASSISTANT_PROFILE_ENV]),
    providerName: normalizeHostedAssistantString(source[HOSTED_ASSISTANT_PROVIDER_NAME_ENV]),
    providerToken: normalizeHostedAssistantString(source[HOSTED_ASSISTANT_PROVIDER_ENV]),
    reasoningEffort: parseHostedAssistantEnum(
      source[HOSTED_ASSISTANT_REASONING_EFFORT_ENV],
      HOSTED_ASSISTANT_REASONING_EFFORT_ENV,
      assistantReasoningEffortValues,
    ),
    sandbox: parseHostedAssistantEnum(
      source[HOSTED_ASSISTANT_SANDBOX_ENV],
      HOSTED_ASSISTANT_SANDBOX_ENV,
      assistantSandboxValues,
    ),
  }

  return {
    ...values,
    anyConfigured: [
      values.providerToken,
      values.model,
      values.baseUrl,
      values.apiKeyEnv,
      values.providerName,
      values.codexCommand,
      values.approvalPolicy,
      values.sandbox,
      values.profile,
      values.reasoningEffort,
      rawOss,
    ].some((value) => value !== null),
  }
}

function resolveHostedAssistantProviderSelection(providerToken: string): {
  label: string
  presetApiKeyEnv: string | null
  presetBaseUrl: string | null
  presetProviderName: string | null
  provider: AssistantChatProvider
} {
  if (providerToken === 'codex-cli') {
    return {
      label: 'codex-cli',
      presetApiKeyEnv: null,
      presetBaseUrl: null,
      presetProviderName: null,
      provider: 'codex-cli',
    }
  }

  const preset =
    resolveOpenAICompatibleProviderPresetFromId(providerToken) ??
    resolveOpenAICompatibleProviderPresetFromProviderName(providerToken)

  if (!preset) {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      `${HOSTED_ASSISTANT_PROVIDER_ENV} must be codex-cli, openai-compatible, or a supported OpenAI-compatible provider alias. Received: ${providerToken}`,
    )
  }

  return {
    label: preset.id,
    presetApiKeyEnv: preset.apiKeyEnv,
    presetBaseUrl: preset.baseUrl,
    presetProviderName: preset.providerName,
    provider: 'openai-compatible',
  }
}

function normalizeHostedAssistantString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function parseHostedAssistantBoolean(
  rawValue: string | null,
  envName: string,
): boolean | null {
  if (rawValue === null) {
    return null
  }

  switch (rawValue.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
    case 'enabled':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
    case 'disabled':
      return false
    default:
      throw new HostedAssistantConfigurationError(
        'HOSTED_ASSISTANT_CONFIG_INVALID',
        `${envName} must be a boolean value such as true/false or 1/0.`,
      )
  }
}

function parseHostedAssistantEnum<TValue extends string>(
  value: string | undefined,
  envName: string,
  allowedValues: readonly TValue[],
): TValue | null {
  const normalized = normalizeHostedAssistantString(value)

  if (normalized === null) {
    return null
  }

  if (allowedValues.includes(normalized as TValue)) {
    return normalized as TValue
  }

  throw new HostedAssistantConfigurationError(
    'HOSTED_ASSISTANT_CONFIG_INVALID',
    `${envName} must be one of ${allowedValues.join(', ')}.`,
  )
}

function requireAbsentHostedAssistantValues(
  providerLabel: string,
  values: ReadonlyArray<readonly [string, unknown]>,
): void {
  const configured = values
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([envName]) => envName)

  if (configured.length === 0) {
    return
  }

  throw new HostedAssistantConfigurationError(
    'HOSTED_ASSISTANT_CONFIG_INVALID',
    `${configured.join(', ')} cannot be used when ${HOSTED_ASSISTANT_PROVIDER_ENV}=${providerLabel}.`,
  )
}
