import type * as z from '@murphai/contracts/zod-runtime'
import { readFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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
  serializeAssistantConversationForPersistence,
} from './conversation-persistence.js'
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

export interface AssistantSessionSecretsPersistenceStage {
  abort: () => Promise<void>
  commit: () => Promise<void>
}

export function extractAssistantSessionSecretsForPersistence(
  session: AssistantSession,
): AssistantSecretPersistenceResult<z.infer<typeof assistantPersistedSessionSchema>> & {
  secrets: AssistantSessionSecrets | null
} {
  const persisted = assistantPersistedSessionSchema.parse({
    ...serializeAssistantConversationForPersistence(session),
  })

  return {
    migratedHeaderNames: [],
    persisted,
    secrets: null,
  }
}

export function mergeAssistantSessionSecrets(
  session: AssistantSession,
  secrets: AssistantSessionSecrets | null,
): AssistantSession {
  void secrets
  return session
}

export async function readAssistantSessionSecrets(input: {
  paths: AssistantStatePaths
  sessionId: string
  updatedAt?: string | null
}): Promise<AssistantSessionSecrets | null> {
  const secretsPath = resolveAssistantSessionSecretsPath(input.paths, input.sessionId)
  let secrets: AssistantSessionSecrets
  let raw: string | null = null

  try {
    raw = await readFile(secretsPath, 'utf8')
    secrets = assistantSessionSecretsSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    await quarantineAssistantStateFile({
      artifactKind: 'session',
      error,
      ...(raw === null ? {} : { expectedContent: raw }),
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

  try {
    assertAssistantSessionSecretsIdentity({
      expectedSessionId: input.sessionId,
      expectedUpdatedAt: input.updatedAt,
      secrets,
    })
  } catch (error) {
    await quarantineAssistantStateFile({
      artifactKind: 'session',
      error,
      ...(raw === null ? {} : { expectedContent: raw }),
      filePath: secretsPath,
      paths: input.paths,
    }).catch(() => undefined)
    throw error
  }

  return secrets
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

  assertAssistantSessionSecretsIdentity({
    expectedSessionId: input.sessionId,
    expectedUpdatedAt: input.secrets.updatedAt,
    secrets: input.secrets,
  })
  await ensureAssistantStateDirectory(path.dirname(secretsPath))
  await writeJsonFileAtomic(secretsPath, input.secrets)
}

export async function stageAssistantSessionSecretsForPersistence(input: {
  paths: AssistantStatePaths
  secrets: AssistantSessionSecrets | null
  sessionId: string
}): Promise<AssistantSessionSecretsPersistenceStage> {
  const secretsPath = resolveAssistantSessionSecretsPath(input.paths, input.sessionId)
  if (!input.secrets) {
    return {
      abort: async () => undefined,
      commit: async () => {
        await rm(secretsPath, { force: true })
      },
    }
  }

  assertAssistantSessionSecretsIdentity({
    expectedSessionId: input.sessionId,
    expectedUpdatedAt: input.secrets.updatedAt,
    secrets: input.secrets,
  })

  await ensureAssistantStateDirectory(path.dirname(secretsPath))
  const stagedPath = `${secretsPath}.tmp-${process.pid}-${randomUUID()}`
  await writeJsonFileAtomic(stagedPath, input.secrets)

  return {
    abort: async () => {
      await rm(stagedPath, { force: true })
    },
    commit: async () => {
      await rename(stagedPath, secretsPath)
    },
  }
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

function assertAssistantSessionSecretsIdentity(input: {
  expectedSessionId: string
  expectedUpdatedAt?: string | null
  secrets: AssistantSessionSecrets
}): void {
  if (input.secrets.sessionId !== input.expectedSessionId) {
    throw new VaultCliError(
      'ASSISTANT_SESSION_SECRETS_MISMATCH',
      `Assistant session "${input.expectedSessionId}" secret sidecar belongs to a different session and was not used.`,
      {
        expectedSessionId: input.expectedSessionId,
        sidecarSessionId: input.secrets.sessionId,
      },
    )
  }

  if (
    input.expectedUpdatedAt &&
    input.secrets.updatedAt !== input.expectedUpdatedAt
  ) {
    throw new VaultCliError(
      'ASSISTANT_SESSION_SECRETS_MISMATCH',
      `Assistant session "${input.expectedSessionId}" secret sidecar is stale and was not used.`,
      {
        expectedSessionId: input.expectedSessionId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        sidecarUpdatedAt: input.secrets.updatedAt,
      },
    )
  }
}
