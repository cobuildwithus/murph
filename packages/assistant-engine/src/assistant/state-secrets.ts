import { z } from 'zod'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantPersistedSessionSchema,
  assistantSessionSecretsSchema,
  type AssistantSession,
  type AssistantSessionSecrets,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { quarantineAssistantStateFile } from './quarantine.js'
import {
  mergeAssistantHeaders,
  splitAssistantHeadersForPersistence,
} from './redaction.js'
import { serializeAssistantSessionForPersistence } from './provider-state.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import { assertAssistantSessionId } from './state-ids.js'
import type { AssistantStatePaths } from './store/paths.js'

export interface AssistantSecretPersistenceResult<TPersisted> {
  migratedHeaderNames: string[]
  persisted: TPersisted
}

export function extractAssistantSessionSecretsForPersistence(
  session: AssistantSession,
): AssistantSecretPersistenceResult<z.infer<typeof assistantPersistedSessionSchema>> & {
  secrets: AssistantSessionSecrets | null
} {
  const providerHeaders = splitAssistantHeadersForPersistence(
    session.target.adapter === 'openai-compatible' ? session.target.headers : null,
  )

  const persisted = assistantPersistedSessionSchema.parse({
    ...serializeAssistantSessionForPersistence(session),
    target:
      session.target.adapter === 'openai-compatible'
        ? {
            ...session.target,
            headers: providerHeaders.persistedHeaders,
          }
        : session.target,
  })

  const migratedHeaderNames = [...Object.keys(providerHeaders.secretHeaders ?? {})].sort(
    (left, right) => left.localeCompare(right),
  )

  const secrets = providerHeaders.secretHeaders
    ? assistantSessionSecretsSchema.parse({
          schema: 'murph.assistant-session-secrets.v1',
          sessionId: session.sessionId,
          updatedAt: session.updatedAt,
          providerHeaders: providerHeaders.secretHeaders,
        })
    : null

  return {
    migratedHeaderNames,
    persisted,
    secrets,
  }
}

export function mergeAssistantSessionSecrets(
  session: AssistantSession,
  secrets: AssistantSessionSecrets | null,
): AssistantSession {
  if (!secrets) {
    return session
  }

  return {
    ...session,
    target:
      session.target.adapter === 'openai-compatible'
        ? {
            ...session.target,
            headers: mergeAssistantHeaders(
              session.target.headers,
              secrets.providerHeaders,
            ),
          }
        : session.target,
    providerOptions: {
      ...session.providerOptions,
      headers: mergeAssistantHeaders(session.providerOptions.headers, secrets.providerHeaders),
    },
  }
}

export async function readAssistantSessionSecrets(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantSessionSecrets | null> {
  const secretsPath = resolveAssistantSessionSecretsPath(input.paths, input.sessionId)

  try {
    const raw = await readFile(secretsPath, 'utf8')
    return assistantSessionSecretsSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    await quarantineAssistantStateFile({
      artifactKind: 'session',
      error,
      filePath: secretsPath,
      paths: input.paths,
    }).catch(() => undefined)
    throw createAssistantSecretSidecarCorruptedError({
      code: 'ASSISTANT_SESSION_SECRETS_CORRUPTED',
      error,
      filePath: secretsPath,
      message: `Assistant session "${input.sessionId}" secret sidecar is corrupted and was quarantined. Repair or restore the secret sidecar before resuming it.`,
      sessionId: input.sessionId,
    })
  }
}

export async function persistAssistantSessionSecrets(input: {
  paths: AssistantStatePaths
  secrets: AssistantSessionSecrets | null
  sessionId: string
}): Promise<void> {
  const secretsPath = resolveAssistantSessionSecretsPath(input.paths, input.sessionId)
  if (!input.secrets) {
    await rm(secretsPath, { force: true })
    return
  }

  await ensureAssistantStateDirectory(path.dirname(secretsPath))
  await writeJsonFileAtomic(secretsPath, input.secrets)
}

export function resolveAssistantSessionSecretsPath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return path.join(
    paths.sessionSecretsDirectory,
    `${assertAssistantSessionId(sessionId)}.json`,
  )
}

function createAssistantSecretSidecarCorruptedError(input: {
  code: 'ASSISTANT_SESSION_SECRETS_CORRUPTED'
  error: unknown
  filePath: string
  message: string
  sessionId: string
}): VaultCliError {
  return new VaultCliError(input.code, input.message, {
    filePath: input.filePath,
    reason: input.error instanceof Error ? input.error.message : String(input.error),
    sessionId: input.sessionId,
  })
}
