import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AssistantStatePaths,
  AssistantStatePermissionAudit,
} from '@murph/runtime-state/node'
import {
  assistantProviderRouteRecoverySchema,
  assistantProviderRouteRecoverySecretsSchema,
  assistantSessionSchema,
  assistantSessionSecretsSchema,
  parseAssistantSessionRecord,
  type AssistantProviderRouteRecovery,
  type AssistantProviderRouteRecoverySecrets,
  type AssistantSession,
  type AssistantSessionSecrets,
} from '@murph/assistant-core/assistant-cli-contracts'
import { serializeAssistantProviderSessionOptions } from '@murph/assistant-core/assistant/provider-config'
import { normalizeAssistantSessionSnapshot } from '@murph/assistant-core/assistant/provider-state'
import { mergeAssistantHeaders } from '@murph/assistant-core/assistant/redaction'
import {
  auditAssistantStatePermissions,
  isMissingFileError,
  writeJsonFileAtomic,
} from '@murph/assistant-core/assistant/shared'
import { assertAssistantSessionId } from '@murph/assistant-core/assistant/state-ids'
import {
  extractAssistantProviderRouteRecoverySecretsForPersistence,
  extractAssistantSessionSecretsForPersistence,
  persistAssistantProviderRouteRecoverySecrets,
  persistAssistantSessionSecrets,
  readAssistantProviderRouteRecoverySecrets,
  readAssistantSessionSecrets,
} from '@murph/assistant-core/assistant/state-secrets'
import { resolveAssistantSessionPath } from '@murph/assistant-core/assistant/store/persistence'

export interface AssistantStateSecrecyAudit {
  malformedProviderRouteRecoverySecretSidecars: number
  malformedSessionSecretSidecars: number
  orphanProviderRouteRecoverySecretSidecars: number
  orphanSessionSecretSidecars: number
  permissionAudit: AssistantStatePermissionAudit
  providerRouteRecoveryFilesScanned: number
  providerRouteRecoveryInlineSecretFiles: number
  providerRouteRecoveryInlineSecretHeaders: number
  providerRouteRecoverySecretSidecarFiles: number
  repairedProviderRouteRecoveryFiles: number
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
  let repairedProviderRouteRecoveryFiles = 0

  if (repair) {
    repairedSessionFiles = await repairLegacyAssistantSessionSecrets(paths)
    repairedProviderRouteRecoveryFiles =
      await repairLegacyAssistantProviderRouteRecoverySecrets(paths)
  }

  const [
    permissionAudit,
    sessionInlineSecrets,
    providerRouteRecoveryInlineSecrets,
    sessionSecretSidecars,
    providerRouteRecoverySecretSidecars,
  ] = await Promise.all([
    auditAssistantStatePermissions({
      repair,
      rootPath: paths.assistantStateRoot,
    }),
    scanAssistantSessionInlineSecrets(paths),
    scanAssistantProviderRouteRecoveryInlineSecrets(paths),
    auditAssistantSessionSecretSidecars(paths),
    auditAssistantProviderRouteRecoverySecretSidecars(paths),
  ])

  return {
    malformedProviderRouteRecoverySecretSidecars:
      providerRouteRecoverySecretSidecars.malformedSidecars,
    malformedSessionSecretSidecars: sessionSecretSidecars.malformedSidecars,
    orphanProviderRouteRecoverySecretSidecars:
      providerRouteRecoverySecretSidecars.orphanSidecars,
    orphanSessionSecretSidecars: sessionSecretSidecars.orphanSidecars,
    permissionAudit,
    providerRouteRecoveryFilesScanned:
      providerRouteRecoveryInlineSecrets.filesScanned,
    providerRouteRecoveryInlineSecretFiles:
      providerRouteRecoveryInlineSecrets.inlineSecretFiles,
    providerRouteRecoveryInlineSecretHeaders:
      providerRouteRecoveryInlineSecrets.inlineSecretHeaders,
    providerRouteRecoverySecretSidecarFiles:
      providerRouteRecoverySecretSidecars.filesScanned,
    repairedProviderRouteRecoveryFiles,
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
        normalizeAssistantSessionForRepair(extracted.persisted),
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

async function repairLegacyAssistantProviderRouteRecoverySecrets(
  paths: AssistantStatePaths,
): Promise<number> {
  let repairedFiles = 0

  for (const fileName of await readDirectoryFiles(paths.providerRouteRecoveryDirectory)) {
    if (!fileName.endsWith('.json')) {
      continue
    }

    const recoveryPath = path.join(paths.providerRouteRecoveryDirectory, fileName)
    try {
      const raw = await readFile(recoveryPath, 'utf8')
      const recovery = assistantProviderRouteRecoverySchema.parse(
        JSON.parse(raw) as unknown,
      )
      const extracted =
        extractAssistantProviderRouteRecoverySecretsForPersistence(recovery)

      if (extracted.migratedHeaderNames.length === 0) {
        continue
      }

      const existingSecrets = await readAssistantProviderRouteRecoverySecrets({
        paths,
        sessionId: recovery.sessionId,
      })
      const mergedSecrets = mergeAssistantProviderRouteRecoverySecretsForRepair({
        existingSecrets,
        extractedSecrets: extracted.secrets,
        recovery,
      })

      await persistAssistantProviderRouteRecoverySecrets({
        paths,
        secrets: mergedSecrets,
        sessionId: recovery.sessionId,
      })
      await writeJsonFileAtomic(recoveryPath, extracted.persisted)
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

async function scanAssistantProviderRouteRecoveryInlineSecrets(
  paths: AssistantStatePaths,
): Promise<{
  filesScanned: number
  inlineSecretFiles: number
  inlineSecretHeaders: number
}> {
  let filesScanned = 0
  let inlineSecretFiles = 0
  let inlineSecretHeaders = 0

  for (const fileName of await readDirectoryFiles(paths.providerRouteRecoveryDirectory)) {
    if (!fileName.endsWith('.json')) {
      continue
    }

    try {
      const raw = await readFile(
        path.join(paths.providerRouteRecoveryDirectory, fileName),
        'utf8',
      )
      const recovery = assistantProviderRouteRecoverySchema.parse(
        JSON.parse(raw) as unknown,
      )
      const extracted =
        extractAssistantProviderRouteRecoverySecretsForPersistence(recovery)
      filesScanned += 1

      if (extracted.migratedHeaderNames.length > 0) {
        inlineSecretFiles += 1
        inlineSecretHeaders += extracted.migratedHeaderNames.length
      }
    } catch {
      // Main doctor checks already report malformed route recovery files.
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

async function auditAssistantProviderRouteRecoverySecretSidecars(
  paths: AssistantStatePaths,
): Promise<{
  filesScanned: number
  malformedSidecars: number
  orphanSidecars: number
}> {
  let filesScanned = 0
  let malformedSidecars = 0
  let orphanSidecars = 0

  for (const fileName of await readDirectoryFiles(paths.providerRouteRecoverySecretsDirectory)) {
    if (!fileName.endsWith('.json')) {
      continue
    }

    filesScanned += 1
    const secretPath = path.join(paths.providerRouteRecoverySecretsDirectory, fileName)
    try {
      const raw = await readFile(secretPath, 'utf8')
      const sidecar = assistantProviderRouteRecoverySecretsSchema.parse(
        JSON.parse(raw) as unknown,
      )
      const expectedSessionId = fileName.replace(/\.json$/u, '')
      if (sidecar.sessionId !== expectedSessionId) {
        malformedSidecars += 1
        continue
      }
      if (
        !(await pathExists(
          resolveAssistantProviderRouteRecoveryPath(paths, sidecar.sessionId),
        ))
      ) {
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

function mergeAssistantProviderRouteRecoverySecretsForRepair(input: {
  existingSecrets: AssistantProviderRouteRecoverySecrets | null
  extractedSecrets: AssistantProviderRouteRecoverySecrets | null
  recovery: AssistantProviderRouteRecovery
}): AssistantProviderRouteRecoverySecrets | null {
  const existingByRouteId = new Map(
    (input.existingSecrets?.routes ?? []).map((route) => [
      route.routeId,
      route.providerHeaders,
    ]),
  )
  const extractedByRouteId = new Map(
    (input.extractedSecrets?.routes ?? []).map((route) => [
      route.routeId,
      route.providerHeaders,
    ]),
  )

  const routes = input.recovery.routes
    .map((route) => {
      const providerHeaders = mergeAssistantHeaders(
        existingByRouteId.get(route.routeId) ?? null,
        extractedByRouteId.get(route.routeId) ?? null,
      )
      if (!providerHeaders) {
        return null
      }
      return {
        routeId: route.routeId,
        providerHeaders,
      }
    })
    .filter((route): route is NonNullable<typeof route> => route !== null)

  if (routes.length === 0) {
    return null
  }

  return assistantProviderRouteRecoverySecretsSchema.parse({
    schema: 'murph.assistant-provider-route-recovery-secrets.v1',
    sessionId: input.recovery.sessionId,
    updatedAt: input.recovery.updatedAt,
    routes,
  })
}

function normalizeAssistantSessionForRepair(
  session: AssistantSession,
): AssistantSession {
  return normalizeAssistantSessionSnapshot({
    ...session,
    providerOptions: serializeAssistantProviderSessionOptions({
      provider: session.provider,
      ...session.providerOptions,
    }),
    providerBinding: session.providerBinding
      ? {
          ...session.providerBinding,
          providerOptions: serializeAssistantProviderSessionOptions({
            provider: session.providerBinding.provider,
            ...session.providerBinding.providerOptions,
          }),
        }
      : null,
  })
}

function resolveAssistantProviderRouteRecoveryPath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return path.join(
    paths.providerRouteRecoveryDirectory,
    `${assertAssistantSessionId(sessionId)}.json`,
  )
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
