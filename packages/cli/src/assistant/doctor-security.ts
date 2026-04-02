import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AssistantStatePaths,
  AssistantStatePermissionAudit,
} from '@murphai/runtime-state/node'
import {
  assistantSessionSchema,
  assistantSessionSecretsSchema,
  parseAssistantSessionRecord,
  type AssistantSession,
  type AssistantSessionSecrets,
} from '@murphai/assistant-core/assistant-cli-contracts'
import { normalizeAssistantSessionSnapshot } from '@murphai/assistant-core/assistant-provider'
import { mergeAssistantHeaders } from '@murphai/assistant-core/assistant-runtime'
import {
  auditAssistantStatePermissions,
  isMissingFileError,
  writeJsonFileAtomic,
} from '@murphai/assistant-core/assistant-runtime'
import {
  extractAssistantSessionSecretsForPersistence,
  persistAssistantSessionSecrets,
  readAssistantSessionSecrets,
} from '@murphai/assistant-core/assistant-state'
import { resolveAssistantSessionPath } from '@murphai/assistant-core/assistant-state'

export interface AssistantStateSecrecyAudit {
  malformedSessionSecretSidecars: number
  orphanSessionSecretSidecars: number
  permissionAudit: AssistantStatePermissionAudit
  repairedSessionFiles: number
  sessionFilesScanned: number
  sessionInlineSecretFiles: number
  sessionInlineSecretHeaders: number
  sessionSecretSidecarFiles: number
}

export async function inspectAndRepairAssistantStateSecrecy(
  paths: AssistantStatePaths,
  input: {
    repair?: boolean
  } = {},
): Promise<AssistantStateSecrecyAudit> {
  const repair = input.repair === true
  let repairedSessionFiles = 0

  if (repair) {
    repairedSessionFiles = await repairLegacyAssistantSessionSecrets(paths)
  }

  const [
    permissionAudit,
    sessionInlineSecrets,
    sessionSecretSidecars,
  ] = await Promise.all([
    auditAssistantStatePermissions({
      repair,
      rootPath: paths.assistantStateRoot,
    }),
    scanAssistantSessionInlineSecrets(paths),
    auditAssistantSessionSecretSidecars(paths),
  ])

  return {
    malformedSessionSecretSidecars: sessionSecretSidecars.malformedSidecars,
    orphanSessionSecretSidecars: sessionSecretSidecars.orphanSidecars,
    permissionAudit,
    repairedSessionFiles,
    sessionFilesScanned: sessionInlineSecrets.filesScanned,
    sessionInlineSecretFiles: sessionInlineSecrets.inlineSecretFiles,
    sessionInlineSecretHeaders: sessionInlineSecrets.inlineSecretHeaders,
    sessionSecretSidecarFiles: sessionSecretSidecars.filesScanned,
  }
}

async function repairLegacyAssistantSessionSecrets(
  paths: AssistantStatePaths,
): Promise<number> {
  let repairedFiles = 0

  for (const fileName of await readDirectoryFiles(paths.sessionsDirectory)) {
    if (!fileName.endsWith('.json')) {
      continue
    }

    const sessionPath = path.join(paths.sessionsDirectory, fileName)
    try {
      const raw = await readFile(sessionPath, 'utf8')
      const session = normalizeAssistantSessionSnapshot(
        parseAssistantSessionRecord(JSON.parse(raw) as unknown),
      )
      const extracted = extractAssistantSessionSecretsForPersistence(session)

      if (extracted.migratedHeaderNames.length === 0) {
        continue
      }

      const existingSecrets = await readAssistantSessionSecrets({
        paths,
        sessionId: session.sessionId,
      })
      const mergedSecrets = mergeAssistantSessionSecretsForRepair({
        existingSecrets,
        extractedSecrets: extracted.secrets,
        session,
      })
      const persistedSession = assistantSessionSchema.parse(
        normalizeAssistantSessionSnapshot(extracted.persisted),
      )

      await persistAssistantSessionSecrets({
        paths,
        secrets: mergedSecrets,
        sessionId: session.sessionId,
      })
      await writeJsonFileAtomic(sessionPath, persistedSession)
      repairedFiles += 1
    } catch {
      // Let the main doctor parse checks surface malformed primary records.
    }
  }

  return repairedFiles
}

async function scanAssistantSessionInlineSecrets(
  paths: AssistantStatePaths,
): Promise<{
  filesScanned: number
  inlineSecretFiles: number
  inlineSecretHeaders: number
}> {
  let filesScanned = 0
  let inlineSecretFiles = 0
  let inlineSecretHeaders = 0

  for (const fileName of await readDirectoryFiles(paths.sessionsDirectory)) {
    if (!fileName.endsWith('.json')) {
      continue
    }

    try {
      const raw = await readFile(path.join(paths.sessionsDirectory, fileName), 'utf8')
      const session = parseAssistantSessionRecord(JSON.parse(raw) as unknown)
      const extracted = extractAssistantSessionSecretsForPersistence(session)
      filesScanned += 1

      if (extracted.migratedHeaderNames.length > 0) {
        inlineSecretFiles += 1
        inlineSecretHeaders += extracted.migratedHeaderNames.length
      }
    } catch {
      // Main doctor checks already report malformed session files.
    }
  }

  return {
    filesScanned,
    inlineSecretFiles,
    inlineSecretHeaders,
  }
}

async function auditAssistantSessionSecretSidecars(
  paths: AssistantStatePaths,
): Promise<{
  filesScanned: number
  malformedSidecars: number
  orphanSidecars: number
}> {
  let filesScanned = 0
  let malformedSidecars = 0
  let orphanSidecars = 0

  for (const fileName of await readDirectoryFiles(paths.sessionSecretsDirectory)) {
    if (!fileName.endsWith('.json')) {
      continue
    }

    filesScanned += 1
    const secretPath = path.join(paths.sessionSecretsDirectory, fileName)
    try {
      const raw = await readFile(secretPath, 'utf8')
      const sidecar = assistantSessionSecretsSchema.parse(JSON.parse(raw) as unknown)
      const expectedSessionId = fileName.replace(/\.json$/u, '')
      if (sidecar.sessionId !== expectedSessionId) {
        malformedSidecars += 1
        continue
      }
      if (!(await pathExists(resolveAssistantSessionPath(paths, sidecar.sessionId)))) {
        orphanSidecars += 1
      }
    } catch {
      malformedSidecars += 1
    }
  }

  return {
    filesScanned,
    malformedSidecars,
    orphanSidecars,
  }
}

function mergeAssistantSessionSecretsForRepair(input: {
  existingSecrets: AssistantSessionSecrets | null
  extractedSecrets: AssistantSessionSecrets | null
  session: AssistantSession
}): AssistantSessionSecrets | null {
  const providerHeaders = mergeAssistantHeaders(
    input.existingSecrets?.providerHeaders,
    input.extractedSecrets?.providerHeaders,
  )
  const providerBindingHeaders = mergeAssistantHeaders(
    input.existingSecrets?.providerBindingHeaders,
    input.extractedSecrets?.providerBindingHeaders,
  )

  if (!providerHeaders && !providerBindingHeaders) {
    return null
  }

  return assistantSessionSecretsSchema.parse({
    schema: 'murph.assistant-session-secrets.v1',
    sessionId: input.session.sessionId,
    updatedAt: input.session.updatedAt,
    providerHeaders,
    providerBindingHeaders,
  })
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }
    throw error
  }
}

async function readDirectoryFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
    })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }
}
