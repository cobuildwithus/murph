import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  type AssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantCodexModelProviderRequiresModelThreadCompatibility,
} from '@murphai/operator-config/assistant/target-runtime'
import {
  serializeAssistantProviderSessionOptions,
  type AssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import { resolveCodexAssistantLabel } from './codex-runtime.js'
import { normalizeNullableString } from './shared.js'

export interface CodexThreadIdentity {
  codexCommand: string | null
  label: string
  provider: 'codex-cli'
  providerOptions: AssistantProviderSessionOptions
  routeFingerprint?: string
  routeId: string
  threadCompatibilityFingerprint?: string
}

export function buildCodexThreadIdentity(
  providerConfig: AssistantProviderConfig,
): CodexThreadIdentity {
  const provider = 'codex-cli' as const
  const providerOptions = serializeAssistantProviderSessionOptions(providerConfig)
  const codexCommand = providerConfig.target.codexCommand

  const routeFingerprint = hashCodexThreadIdentity({
    codexCommand,
    provider,
    providerOptions,
  })
  const threadCompatibilityFingerprint = hashCodexThreadCompatibilityIdentity({
    codexCommand,
    provider,
    providerOptions,
  })
  return {
    routeFingerprint,
    routeId: routeFingerprint,
    threadCompatibilityFingerprint,
    label: buildCodexThreadIdentityLabel(providerConfig),
    provider,
    providerOptions,
    codexCommand,
  }
}

export function readCodexThreadRouteFingerprint(
  route: Pick<CodexThreadIdentity, 'routeId' | 'routeFingerprint'> | null | undefined,
): string {
  return route?.routeFingerprint ?? route?.routeId ?? ''
}

export function readCodexThreadCompatibilityFingerprint(
  route: CodexThreadIdentity,
): string {
  return route.threadCompatibilityFingerprint ?? readCodexThreadRouteFingerprint(route)
}

function buildCodexThreadIdentityLabel(
  providerConfig: AssistantProviderConfig,
): string {
  const providerLabel = resolveCodexAssistantLabel(providerConfig)

  const parts = [
    'primary',
    providerLabel,
    normalizeNullableString(providerConfig.target.model),
    normalizeNullableString(providerConfig.target.profile),
  ].filter((value): value is string => value !== null)

  return parts.join(':')
}

function hashCodexThreadIdentity(input: {
  codexCommand: string | null
  provider: 'codex-cli'
  providerOptions: AssistantProviderSessionOptions
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify(buildCodexThreadIdentityFingerprint(input)),
    )
    .digest('hex')
    .slice(0, 16)
}

function hashCodexThreadCompatibilityIdentity(input: {
  codexCommand: string | null
  provider: 'codex-cli'
  providerOptions: AssistantProviderSessionOptions
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        provider: input.provider,
        executionDriver: input.providerOptions.executionDriver,
        modelProvider: input.providerOptions.modelProvider ?? null,
        model: assistantCodexModelProviderRequiresModelThreadCompatibility(
            input.providerOptions.modelProvider,
          )
          ? input.providerOptions.model
          : null,
        sandbox: input.providerOptions.sandbox,
        approvalPolicy: input.providerOptions.approvalPolicy,
        profile: input.providerOptions.profile,
        oss: input.providerOptions.oss,
        codexHome: normalizeCodexThreadIdentityCodexHome(input.providerOptions.codexHome),
        codexCommand: normalizeCodexThreadIdentityCodexCommand(input.codexCommand),
        resumeKind: input.providerOptions.resumeKind,
      }),
    )
    .digest('hex')
    .slice(0, 16)
}

function buildCodexThreadIdentityFingerprint(input: {
  codexCommand: string | null
  provider: 'codex-cli'
  providerOptions: AssistantProviderSessionOptions
}) {
  return {
    provider: input.provider,
    executionDriver: input.providerOptions.executionDriver,
    model: input.providerOptions.model,
    modelProvider: input.providerOptions.modelProvider ?? null,
    reasoningEffort: input.providerOptions.reasoningEffort,
    sandbox: input.providerOptions.sandbox,
    approvalPolicy: input.providerOptions.approvalPolicy,
    profile: input.providerOptions.profile,
    oss: input.providerOptions.oss,
    codexHome: normalizeCodexThreadIdentityCodexHome(input.providerOptions.codexHome),
    codexCommand: normalizeCodexThreadIdentityCodexCommand(input.codexCommand),
    resumeKind: input.providerOptions.resumeKind,
  }
}

function normalizeCodexThreadIdentityCodexCommand(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)
  return normalized === 'codex' ? null : normalized
}

function normalizeCodexThreadIdentityCodexHome(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }

  const pathSegments = normalized.replace(/\\/gu, '/').split('/')
  if (pathSegments.at(-1) === '.codex-hosted') {
    return '<hosted-codex-home>'
  }

  return normalizeCodexThreadIdentityLocalCodexHome(normalized)
}

function normalizeCodexThreadIdentityLocalCodexHome(value: string): string {
  if (value === '~') {
    return path.resolve(homedir())
  }

  if (value.startsWith('~/')) {
    return path.resolve(homedir(), value.slice(2))
  }

  return path.resolve(value)
}
