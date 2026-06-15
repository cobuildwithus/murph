import { constants as fsConstants, readFileSync, statSync } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import {
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from '@murphai/hosted-execution/cli-runtime-bridge'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { sanitizeChildProcessEnv } from '../child-process-env.js'

interface CodexDisplayConfigProfile {
  model: string | null
  reasoningEffort: string | null
}

interface CodexDisplayConfig {
  defaultProfile: string | null
  model: string | null
  profiles: Record<string, CodexDisplayConfigProfile>
  reasoningEffort: string | null
}

export interface CodexDisplayOptions {
  model: string | null
  reasoningEffort: string | null
}

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

export function hasHostedCodexModelCatalogFlexTier(input: {
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
      .some((tier) => tier?.id === 'flex')
  } catch {
    return false
  }
}

export async function resolveCodexDisplayOptions(input: {
  configPath?: string
  model?: string | null
  profile?: string | null
}): Promise<CodexDisplayOptions> {
  const explicitModel = normalizeNullableString(input.model)
  const explicitProfile = normalizeNullableString(input.profile)
  const config = await readCodexDisplayConfig(input.configPath)
  const activeProfileName = explicitProfile ?? config.defaultProfile
  const activeProfile = activeProfileName
    ? config.profiles[activeProfileName] ?? null
    : null

  return {
    model: explicitModel ?? activeProfile?.model ?? config.model,
    reasoningEffort:
      activeProfile?.reasoningEffort ?? config.reasoningEffort,
  }
}

async function readCodexDisplayConfig(
  configPath = path.join(homedir(), '.codex', 'config.toml'),
): Promise<CodexDisplayConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    return parseCodexDisplayConfig(raw)
  } catch {
    return {
      defaultProfile: null,
      model: null,
      reasoningEffort: null,
      profiles: {},
    }
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
  try {
    await stat(resolvedHome)
  } catch {
    throw new VaultCliError(
      'ASSISTANT_CODEX_HOME_INVALID',
      'Configured Codex home does not exist. Check --codexHome or CODEX_HOME.',
    )
  }

  let resolvedStats
  try {
    await access(
      resolvedHome,
      fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK,
    )
    resolvedStats = await stat(resolvedHome)
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

function parseCodexDisplayConfig(raw: string): CodexDisplayConfig {
  const config: CodexDisplayConfig = {
    defaultProfile: null,
    model: null,
    reasoningEffort: null,
    profiles: {},
  }

  let activeProfile: string | null = null

  for (const rawLine of raw.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }

    const profileSectionMatch = /^\[profiles\.([^\]]+)\]$/u.exec(line)
    if (profileSectionMatch) {
      activeProfile = profileSectionMatch[1] ?? null
      if (activeProfile && !config.profiles[activeProfile]) {
        config.profiles[activeProfile] = {
          model: null,
          reasoningEffort: null,
        }
      }
      continue
    }

    if (/^\[.*\]$/u.test(line)) {
      activeProfile = null
      continue
    }

    const stringAssignmentMatch =
      /^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*$/u.exec(line)
    if (!stringAssignmentMatch) {
      continue
    }

    const [, key, value] = stringAssignmentMatch
    const normalizedValue = normalizeNullableString(value)

    if (activeProfile) {
      const profile = config.profiles[activeProfile]
      if (!profile) {
        continue
      }

      if (key === 'model') {
        profile.model = normalizedValue
      } else if (key === 'model_reasoning_effort') {
        profile.reasoningEffort = normalizedValue
      }
      continue
    }

    if (key === 'model') {
      config.model = normalizedValue
    } else if (key === 'model_reasoning_effort') {
      config.reasoningEffort = normalizedValue
    } else if (key === 'profile') {
      config.defaultProfile = normalizedValue
    }
  }

  return config
}
