import {
  assistantApprovalPolicyValues,
  assistantReasoningEffortValues,
  assistantSandboxValues,
  type AssistantApprovalPolicy,
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
  resolveOpenAICompatibleProviderTargetPresetId,
  type SetupAssistantProviderPreset,
} from './assistant/openai-compatible-provider-presets.js'
import { resolveAssistantRuntimeTarget } from './assistant/target-runtime.js'
import type { AssistantProviderConfigInput } from './assistant/provider-config.js'
import {
  readOperatorConfig,
  saveHostedAssistantConfig,
} from './operator-config.js'
import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_APPROVAL_POLICY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV,
  HOSTED_ASSISTANT_MODEL_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
  HOSTED_ASSISTANT_REASONING_EFFORT_ENV,
  HOSTED_ASSISTANT_SANDBOX_ENV,
  HOSTED_ASSISTANT_ZERO_DATA_RETENTION_ENV,
} from './hosted-assistant-config-constants.js'

export {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_APPROVAL_POLICY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV,
  HOSTED_ASSISTANT_MODEL_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
  HOSTED_ASSISTANT_REASONING_EFFORT_ENV,
  HOSTED_ASSISTANT_SANDBOX_ENV,
  HOSTED_ASSISTANT_ZERO_DATA_RETENTION_ENV,
}
const HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL_ENV =
  'HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL'

const hostedAssistantAllowedApiKeyEnvNameSet = new Set<string>(
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
)

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
  provider: 'openai-compatible' | null
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
  gatewayOnlyProviders: readonly string[] | null
  model: string | null
  oss: boolean | null
  profile: string | null
  providerName: string | null
  providerToken: string | null
  reasoningEffort: AssistantReasoningEffort | null
  sandbox: AssistantSandbox | null
  zeroDataRetention: boolean | null
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
  return parseHostedAssistantConfig(JSON.parse(value))
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

  return normalizeHostedAssistantString(providerConfig.baseUrl) !== null
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
    if (envProfile) {
      const nextConfig = upsertHostedAssistantProfile(existingHostedConfig, envProfile)
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

  if (envProfile) {
    const nextConfig = upsertHostedAssistantProfile(existingHostedConfig, envProfile)
    if (!hostedAssistantConfigsEqual(existingHostedConfig, nextConfig)) {
      const saved = await saveHostedAssistantConfig(nextConfig, input.homeDirectory)
      const savedState = resolveHostedAssistantOperatorDefaultsState(saved.hostedAssistant)

      return {
        ...savedState,
        seeded: true,
        source: 'hosted-env',
      }
    }
  }

  if (existingState.configured) {
    return {
      ...existingState,
      seeded: false,
      source: 'saved',
    }
  }

  if (input.allowMissing) {
    return {
      configured: false,
      provider: existingActiveProfile?.target.adapter ?? null,
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
      provider: readyProfile?.target.adapter ?? activeProfile?.target.adapter ?? null,
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

export function isHostedAssistantApiKeyEnvName(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeHostedAssistantString(value)
  return normalized !== null && hostedAssistantAllowedApiKeyEnvNameSet.has(normalized)
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

  const providerSelection = resolveHostedAssistantProviderPreset(raw.providerToken)

  if (!raw.model) {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      `${HOSTED_ASSISTANT_MODEL_ENV} must be configured for hosted assistant provider ${providerSelection.label}.`,
    )
  }

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

  const runtimeTarget = resolveAssistantRuntimeTarget({
    provider: 'openai-compatible',
    apiKeyEnv: raw.apiKeyEnv ?? providerSelection.presetApiKeyEnv,
    baseUrl,
    gatewayOnlyProviders: raw.gatewayOnlyProviders,
    model: raw.model,
    presetId: providerSelection.presetId,
    providerName: raw.providerName ?? providerSelection.presetProviderName,
    reasoningEffort: raw.reasoningEffort,
    zeroDataRetention: raw.zeroDataRetention === true,
  })

  if (raw.zeroDataRetention !== null && !runtimeTarget.supportsZeroDataRetention) {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      `${HOSTED_ASSISTANT_ZERO_DATA_RETENTION_ENV} can be used only with a hosted target that enforces zero data retention.`,
    )
  }

  if (
    raw.gatewayOnlyProviders &&
    !isHostedAssistantVercelAiGatewayTarget({
      baseUrl,
      presetId: providerSelection.presetId,
      providerName: raw.providerName ?? providerSelection.presetProviderName,
    })
  ) {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      `${HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV} can be used only with Vercel AI Gateway hosted assistant targets.`,
    )
  }

  const zeroDataRetention = runtimeTarget.supportsZeroDataRetention
    ? (raw.zeroDataRetention ?? true)
    : raw.zeroDataRetention

  return {
    providerConfig: {
      provider: 'openai-compatible',
      apiKeyEnv: raw.apiKeyEnv ?? providerSelection.presetApiKeyEnv,
      baseUrl,
      ...(raw.gatewayOnlyProviders
        ? { gatewayOnlyProviders: raw.gatewayOnlyProviders }
        : {}),
      model: raw.model,
      presetId: providerSelection.presetId,
      providerName: raw.providerName ?? providerSelection.presetProviderName,
      reasoningEffort: raw.reasoningEffort,
      ...(zeroDataRetention === true ? { zeroDataRetention: true } : {}),
    },
  }
}

function readHostedAssistantRawEnvConfig(
  env: Readonly<Record<string, string | undefined>> | undefined,
): HostedAssistantRawEnvConfig {
  const source = env ?? process.env
  const rawOss = normalizeHostedAssistantString(source[HOSTED_ASSISTANT_OSS_ENV])
  const rawZeroDataRetention = normalizeHostedAssistantString(
    source[HOSTED_ASSISTANT_ZERO_DATA_RETENTION_ENV],
  )
  const values = {
    apiKeyEnv: normalizeHostedAssistantString(source[HOSTED_ASSISTANT_API_KEY_ENV]),
    approvalPolicy: parseHostedAssistantEnum(
      source[HOSTED_ASSISTANT_APPROVAL_POLICY_ENV],
      HOSTED_ASSISTANT_APPROVAL_POLICY_ENV,
      assistantApprovalPolicyValues,
    ),
    baseUrl: normalizeHostedAssistantSeedBaseUrl(
      source,
      normalizeHostedAssistantString(source[HOSTED_ASSISTANT_BASE_URL_ENV]),
    ),
    codexCommand: normalizeHostedAssistantString(source[HOSTED_ASSISTANT_CODEX_COMMAND_ENV]),
    gatewayOnlyProviders: parseHostedAssistantGatewayOnlyProviders(
      source[HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV],
    ),
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
    zeroDataRetention: parseHostedAssistantBoolean(
      rawZeroDataRetention,
      HOSTED_ASSISTANT_ZERO_DATA_RETENTION_ENV,
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
      values.gatewayOnlyProviders,
      values.approvalPolicy,
      values.sandbox,
      values.profile,
      values.reasoningEffort,
      rawOss,
      rawZeroDataRetention,
    ].some((value) => value !== null),
  }
}

function normalizeHostedAssistantSeedBaseUrl(
  source: Readonly<Record<string, string | undefined>>,
  baseUrl: string | null,
): string | null {
  if (!baseUrl) {
    return null
  }

  const bridgeHost = readHostedAssistantContainerReachableHost(source)
  if (!bridgeHost) {
    return baseUrl
  }

  try {
    const url = new URL(baseUrl)
    if (url.hostname !== 'host.docker.internal' && url.hostname !== bridgeHost) {
      return baseUrl
    }

    url.hostname = '127.0.0.1'
    return url.toString()
  } catch {
    return baseUrl
  }
}

function readHostedAssistantContainerReachableHost(
  source: Readonly<Record<string, string | undefined>>,
): string | null {
  const localInternalProxyBaseUrl = normalizeHostedAssistantString(
    source[HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL_ENV],
  )
  if (!localInternalProxyBaseUrl) {
    return null
  }

  try {
    return new URL(localInternalProxyBaseUrl).hostname
  } catch {
    return null
  }
}

function resolveHostedAssistantProviderPreset(providerToken: string): {
  label: string
  presetApiKeyEnv: string | null
  presetBaseUrl: string | null
  presetId: SetupAssistantProviderPreset
  presetProviderName: string | null
} {
  if (providerToken === 'codex-cli') {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      `${HOSTED_ASSISTANT_PROVIDER_ENV}=codex-cli is not supported for hosted assistant execution. Hosted assistant bootstrap accepts only openai-compatible providers and named OpenAI-compatible aliases.`,
    )
  }

  const preset =
    resolveOpenAICompatibleProviderPresetFromId(providerToken) ??
    resolveOpenAICompatibleProviderPresetFromProviderName(providerToken)

  if (!preset) {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      `${HOSTED_ASSISTANT_PROVIDER_ENV} must be openai-compatible or a supported OpenAI-compatible provider alias. Received: ${providerToken}`,
    )
  }

  return {
    label: preset.id,
    presetApiKeyEnv: preset.apiKeyEnv,
    presetBaseUrl: preset.baseUrl,
    presetId: preset.id,
    presetProviderName: preset.providerName,
  }
}

function isHostedAssistantVercelAiGatewayTarget(input: {
  baseUrl: string | null
  presetId: SetupAssistantProviderPreset | null
  providerName: string | null
}): boolean {
  return (
    resolveOpenAICompatibleProviderTargetPresetId({
      baseUrl: input.baseUrl,
      presetId: input.presetId,
      providerName: input.providerName,
    }) === 'vercel-ai-gateway'
  )
}

function normalizeHostedAssistantString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function parseHostedAssistantGatewayOnlyProviders(
  value: string | undefined,
): readonly string[] | null {
  const raw = normalizeHostedAssistantString(value)

  if (raw === null) {
    return null
  }

  const seen = new Set<string>()
  const providers: string[] = []

  for (const token of raw.split(',')) {
    const normalized = normalizeHostedAssistantString(token)?.toLowerCase() ?? null

    if (!normalized || !/^[a-z0-9][a-z0-9._-]*$/u.test(normalized)) {
      throw new HostedAssistantConfigurationError(
        'HOSTED_ASSISTANT_CONFIG_INVALID',
        `${HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV} must be a comma-separated list of Vercel AI Gateway provider slugs.`,
      )
    }

    if (seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    providers.push(normalized)
  }

  if (providers.length === 0) {
    throw new HostedAssistantConfigurationError(
      'HOSTED_ASSISTANT_CONFIG_INVALID',
      `${HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS_ENV} must include at least one provider slug when set.`,
    )
  }

  return providers
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
