import { homedir } from 'node:os'
import { constants as fsConstants, readFileSync, statSync } from 'node:fs'
import { access,  stat } from 'node:fs/promises'

import path from 'node:path'

import {
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from '@murphai/hosted-execution/env'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { sanitizeChildProcessEnv } from '../child-process-env.js'

export async function resolveCodexChildEnv(input: {
  codexHome?: string | null
  env?: NodeJS.ProcessEnv
}): Promise<NodeJS.ProcessEnv> {
  const nextEnv = sanitizeChildProcessEnv(input.env)
  const resolvedHome = resolveConfiguredCodexHome(input.codexHome)
  if (!resolvedHome) {
    return nextEnv
  }
  await assertAccessibleCodexHomeDirectory(resolvedHome)

  return {
    ...nextEnv,
    CODEX_HOME: resolvedHome,
  }
}

export function withHostedCodexModelCatalogConfigOverride(input: {
  configOverrides?: readonly string[]
  env?: NodeJS.ProcessEnv
}): readonly string[] | undefined {
  const existing = input.configOverrides ?? []
  if (existing.some(isCodexModelCatalogJsonConfigOverride)) {
    return input.configOverrides
  }

  const modelCatalogJson = normalizeNullableString(
    input.env?.[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV],
  )
  if (!modelCatalogJson) {
    return input.configOverrides
  }

  return [
    ...existing,
    `model_catalog_json=${JSON.stringify(modelCatalogJson)}`,
  ]
}

// Only the hosted catalog contract removes Codex's overriding mode messages.
// An explicit different catalog must retain thread-level instructions.
export function supportsCodexTurnDeveloperInstructions(input: {
  configOverrides?: readonly string[]
  env?: NodeJS.ProcessEnv
}): boolean {
  const catalog = normalizeNullableString(
    input.env?.[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV],
  )
  if (!catalog) return false
  const override = input.configOverrides?.filter(isCodexModelCatalogJsonConfigOverride).at(-1)
  return override === undefined || override === `model_catalog_json=${JSON.stringify(catalog)}`
}

// Murph turn steering is a product default, not an inherited upstream default:
// an admitted follow-up preempts unfinished generation in the same turn, and an
// interrupted turn stops its code-mode cells and their nested tool calls. These
// stay CLI-layer process overrides so user config isolation cannot drop them.
const CODEX_APP_SERVER_STEERING_FEATURE_OVERRIDES = [
  'features.instant_interrupt=true',
  'features.code_mode_interrupt=true',
] as const

export function withCodexAppServerSteeringFeatureOverrides(
  configOverrides: readonly string[],
): readonly string[] {
  const missing = CODEX_APP_SERVER_STEERING_FEATURE_OVERRIDES.filter((feature) =>
    !configOverrides.some((override) =>
      readCodexConfigOverrideKey(override) === readCodexConfigOverrideKey(feature)
    )
  )
  return missing.length === 0 ? configOverrides : [...configOverrides, ...missing]
}

function readCodexConfigOverrideKey(override: string): string {
  return override.split('=', 1)[0]!.trim()
}

export function hasHostedCodexModelCatalogServiceTier(input: {
  serviceTier: 'flex' | 'priority'
  env?: NodeJS.ProcessEnv
  model?: string | null
}): boolean {
  const modelCatalogJson = normalizeNullableString(
    input.env?.[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV],
  )
  const model = normalizeNullableString(input.model)
  if (!modelCatalogJson || !model || !path.isAbsolute(modelCatalogJson)) {
    return false
  }

  try {
    const modelCatalogStats = statSync(modelCatalogJson)
    if (!modelCatalogStats.isFile()) {
      return false
    }
    const catalog = readRecord(
      JSON.parse(readFileSync(modelCatalogJson, 'utf8')),
    )
    const models = Array.isArray(catalog?.models) ? catalog.models : []
    const targetModel = models
      .map(readRecord)
      .find((candidate) => candidate?.slug === model)
    const serviceTiers = Array.isArray(targetModel?.service_tiers)
      ? targetModel.service_tiers
      : []
    return serviceTiers
      .map(readRecord)
      .some((tier) => tier?.id === input.serviceTier)
  } catch {
    return false
  }
}

function resolveConfiguredCodexHome(
  codexHome: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(codexHome)
  if (!normalized) {
    return null
  }

  if (normalized === '~') {
    return homedir()
  }

  if (normalized.startsWith(`~${path.sep}`)) {
    return path.resolve(homedir(), normalized.slice(2))
  }

  return path.resolve(normalized)
}

function isCodexModelCatalogJsonConfigOverride(value: string): boolean {
  return value.trim().startsWith('model_catalog_json=')
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

async function assertAccessibleCodexHomeDirectory(
  resolvedHome: string,
): Promise<void> {
  let resolvedStats: Awaited<ReturnType<typeof stat>>
  try {
    resolvedStats = await stat(resolvedHome)
  } catch {
    throw new VaultCliError(
      'ASSISTANT_CODEX_HOME_INVALID',
      'Configured Codex home does not exist. Check --codexHome or CODEX_HOME.',
    )
  }

  try {
    await access(
      resolvedHome,
      fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK,
    )
  } catch {
    throw new VaultCliError(
      'ASSISTANT_CODEX_HOME_INVALID',
      'Configured Codex home is not accessible. Check --codexHome permissions.',
    )
  }

  if (!resolvedStats.isDirectory()) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_HOME_INVALID',
      'Configured Codex home is not a directory. Check --codexHome.',
    )
  }
}
