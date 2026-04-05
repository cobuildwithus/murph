import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AssistantStatePaths,
  AssistantStatePermissionAudit,
} from '@murphai/runtime-state/node'
import {
  assistantSessionSecretsSchema,
  parseAssistantSessionRecord,
} from '@murphai/assistant-core/assistant-cli-contracts'
import {
  auditAssistantStatePermissions,
  isMissingFileError,
} from '@murphai/assistant-core/assistant-runtime'
import {
  extractAssistantSessionSecretsForPersistence,
} from '@murphai/assistant-core/assistant-state'
import { resolveAssistantSessionPath } from '@murphai/assistant-core/assistant-state'

export interface AssistantStateSecrecyAudit {
  malformedSessionSecretSidecars: number
  orphanSessionSecretSidecars: number
  permissionAudit: AssistantStatePermissionAudit
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
    sessionFilesScanned: sessionInlineSecrets.filesScanned,
    sessionInlineSecretFiles: sessionInlineSecrets.inlineSecretFiles,
    sessionInlineSecretHeaders: sessionInlineSecrets.inlineSecretHeaders,
    sessionSecretSidecarFiles: sessionSecretSidecars.filesScanned,
  }
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
