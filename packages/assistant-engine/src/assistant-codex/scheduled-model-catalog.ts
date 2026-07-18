import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const CODEX_EFFECTIVE_MODEL_CATALOG_MAX_BYTES = 10 * 1024 * 1024
const CODEX_EFFECTIVE_MODEL_CATALOG_TIMEOUT_MS = 60_000
const SCHEDULED_MODEL_CATALOG_FILE = 'codex-model-catalog.scheduled.json'

/**
 * Resolves the launch-time model catalog for an unattended Codex process.
 *
 * Codex 0.144 resolves model-selected tool mode and multi-agent version in a
 * process-wide ModelsManager. Thread config cannot override those selectors,
 * so scheduled turns run in a one-shot process with this exact catalog.
 */
export async function resolveScheduledCodexModelCatalogJson(input: {
  abortSignal?: AbortSignal
  codexCommand: string
  configOverrides?: readonly string[]
  env: NodeJS.ProcessEnv
  oss?: boolean | null
  profile?: string | null
  tempRoot: string
}): Promise<string> {
  const catalogJson = await readEffectiveCodexModelCatalog(input)
  const catalog = readRecord(parseCatalogJson(catalogJson))
  const models = Array.isArray(catalog?.models) ? catalog.models : null
  if (!catalog || !models || models.length === 0) {
    throw invalidScheduledCatalogError(
      'The effective Codex model catalog did not contain any models.',
    )
  }

  const scheduledModels = models.map((value) => {
    const model = readRecord(value)
    const slug = normalizeNullableString(
      typeof model?.slug === 'string' ? model.slug : null,
    )
    if (!model || !slug) {
      throw invalidScheduledCatalogError(
        'The effective Codex model catalog contained an invalid model entry.',
      )
    }
    return {
      ...model,
      // These native selectors are consumed by Codex's process-wide model
      // manager before thread config is applied: Disabled removes V1/V2
      // collaboration handlers and Direct prevents inherited code-mode flags
      // from restoring a shell.
      multi_agent_version: 'disabled',
      tool_mode: 'direct',
    }
  })
  const catalogPath = path.join(input.tempRoot, SCHEDULED_MODEL_CATALOG_FILE)
  await writeFile(
    catalogPath,
    `${JSON.stringify({
      ...catalog,
      models: scheduledModels,
    })}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  )
  return catalogPath
}

async function readEffectiveCodexModelCatalog(input: {
  abortSignal?: AbortSignal
  codexCommand: string
  configOverrides?: readonly string[]
  env: NodeJS.ProcessEnv
  oss?: boolean | null
  profile?: string | null
  tempRoot: string
}): Promise<string> {
  const { execFile } = await import('node:child_process')
  const profile = normalizeNullableString(input.profile)
  return await new Promise<string>((resolve, reject) => {
    const rejectResolution = () => reject(invalidScheduledCatalogError(
      'Codex could not resolve the effective model catalog.',
    ))
    try {
      execFile(
        input.codexCommand,
        [
          ...(profile ? ['--profile', profile] : []),
          ...(input.oss === true ? ['--oss'] : []),
          ...(input.configOverrides ?? []).flatMap((override) => [
            '--config',
            override,
          ]),
          'debug',
          'models',
        ],
        {
          cwd: input.tempRoot,
          encoding: 'utf8',
          env: input.env,
          maxBuffer: CODEX_EFFECTIVE_MODEL_CATALOG_MAX_BYTES,
          signal: input.abortSignal,
          timeout: CODEX_EFFECTIVE_MODEL_CATALOG_TIMEOUT_MS,
        },
        (error, stdout) => {
          if (error) {
            rejectResolution()
            return
          }
          resolve(stdout)
        },
      )
    } catch {
      rejectResolution()
    }
  })
}

function parseCatalogJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw invalidScheduledCatalogError(
      'Codex returned an invalid effective model catalog.',
    )
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function invalidScheduledCatalogError(message: string): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_CODEX_SCHEDULED_MODEL_CATALOG_INVALID',
    message,
    { retryable: false },
  )
}
