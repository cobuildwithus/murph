import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantProviderRouteRecoverySchema,
  assistantProviderRouteRecoverySecretsSchema,
  assistantSessionSchema,
  assistantSessionSecretsSchema,
  type AssistantProviderRouteRecovery,
  type AssistantProviderRouteRecoverySecrets,
  type AssistantSession,
  type AssistantSessionSecrets,
} from '../assistant-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { quarantineAssistantStateFile } from './quarantine.js'
import {
  mergeAssistantHeaders,
  splitAssistantHeadersForPersistence,
} from './redaction.js'
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
): AssistantSecretPersistenceResult<AssistantSession> & {
  secrets: AssistantSessionSecrets | null
} {
  const providerHeaders = splitAssistantHeadersForPersistence(
    session.providerOptions.headers,
  )
  const bindingHeaders = splitAssistantHeadersForPersistence(
    session.providerBinding?.providerOptions.headers,
  )

  const persisted = assistantSessionSchema.parse({
    ...session,
    providerOptions: {
      ...session.providerOptions,
      headers: providerHeaders.persistedHeaders,
    },
    providerBinding: session.providerBinding
      ? {
          ...session.providerBinding,
          providerOptions: {
            ...session.providerBinding.providerOptions,
            headers: bindingHeaders.persistedHeaders,
          },
        }
      : null,
  })

  const migratedHeaderNames = [
    ...Object.keys(providerHeaders.secretHeaders ?? {}),
    ...Object.keys(bindingHeaders.secretHeaders ?? {}),
  ].sort((left, right) => left.localeCompare(right))

  const secrets =
    providerHeaders.secretHeaders || bindingHeaders.secretHeaders
      ? assistantSessionSecretsSchema.parse({
          schema: 'murph.assistant-session-secrets.v1',
          sessionId: session.sessionId,
          updatedAt: session.updatedAt,
          providerHeaders: providerHeaders.secretHeaders,
          providerBindingHeaders: bindingHeaders.secretHeaders,
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
    providerOptions: {
      ...session.providerOptions,
      headers: mergeAssistantHeaders(
        session.providerOptions.headers,
        secrets.providerHeaders,
      ),
    },
    providerBinding: session.providerBinding
      ? {
          ...session.providerBinding,
          providerOptions: {
            ...session.providerBinding.providerOptions,
            headers: mergeAssistantHeaders(
              session.providerBinding.providerOptions.headers,
              secrets.providerBindingHeaders,
            ),
          },
        }
      : null,
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

export function extractAssistantProviderRouteRecoverySecretsForPersistence(
  recovery: AssistantProviderRouteRecovery,
): AssistantSecretPersistenceResult<AssistantProviderRouteRecovery> & {
  secrets: AssistantProviderRouteRecoverySecrets | null
} {
  const routes: AssistantProviderRouteRecovery['routes'] = []
  const secretRoutes: AssistantProviderRouteRecoverySecrets['routes'] = []
  const migratedHeaderNames = new Set<string>()

  for (const route of recovery.routes) {
    const split = splitAssistantHeadersForPersistence(route.providerOptions.headers)
    routes.push({
      ...route,
      providerOptions: {
        ...route.providerOptions,
        headers: split.persistedHeaders,
      },
    })
    if (split.secretHeaders) {
      secretRoutes.push({
        routeId: route.routeId,
        providerHeaders: split.secretHeaders,
      })
      for (const headerName of Object.keys(split.secretHeaders)) {
        migratedHeaderNames.add(headerName)
      }
    }
  }

  const persisted = assistantProviderRouteRecoverySchema.parse({
    ...recovery,
    routes,
  })
  const secrets =
    secretRoutes.length > 0
      ? assistantProviderRouteRecoverySecretsSchema.parse({
          schema: 'murph.assistant-provider-route-recovery-secrets.v1',
          sessionId: recovery.sessionId,
          updatedAt: recovery.updatedAt,
          routes: secretRoutes,
        })
      : null

  return {
    migratedHeaderNames: [...migratedHeaderNames].sort((left, right) =>
      left.localeCompare(right),
    ),
    persisted,
    secrets,
  }
}

export function mergeAssistantProviderRouteRecoverySecrets(
  recovery: AssistantProviderRouteRecovery,
  secrets: AssistantProviderRouteRecoverySecrets | null,
): AssistantProviderRouteRecovery {
  if (!secrets || secrets.routes.length === 0) {
    return recovery
  }

  const secretHeadersByRouteId = new Map(
    secrets.routes.map((route) => [route.routeId, route.providerHeaders]),
  )

  return assistantProviderRouteRecoverySchema.parse({
    ...recovery,
    routes: recovery.routes.map((route) => ({
      ...route,
      providerOptions: {
        ...route.providerOptions,
        headers: mergeAssistantHeaders(
          route.providerOptions.headers,
          secretHeadersByRouteId.get(route.routeId) ?? null,
        ),
      },
    })),
  })
}

export async function readAssistantProviderRouteRecoverySecrets(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantProviderRouteRecoverySecrets | null> {
  const secretsPath = resolveAssistantProviderRouteRecoverySecretsPath(
    input.paths,
    input.sessionId,
  )

  try {
    const raw = await readFile(secretsPath, 'utf8')
    return assistantProviderRouteRecoverySecretsSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    await quarantineAssistantStateFile({
      artifactKind: 'provider-route-recovery',
      error,
      filePath: secretsPath,
      paths: input.paths,
    }).catch(() => undefined)
    throw createAssistantSecretSidecarCorruptedError({
      code: 'ASSISTANT_PROVIDER_ROUTE_RECOVERY_SECRETS_CORRUPTED',
      error,
      filePath: secretsPath,
      message: `Assistant provider route recovery secret sidecar for session "${input.sessionId}" is corrupted and was quarantined. Repair or restore the secret sidecar before relying on recovery state.`,
      sessionId: input.sessionId,
    })
  }
}

export async function persistAssistantProviderRouteRecoverySecrets(input: {
  paths: AssistantStatePaths
  secrets: AssistantProviderRouteRecoverySecrets | null
  sessionId: string
}): Promise<void> {
  const secretsPath = resolveAssistantProviderRouteRecoverySecretsPath(
    input.paths,
    input.sessionId,
  )
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

export function resolveAssistantProviderRouteRecoverySecretsPath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return path.join(
    paths.providerRouteRecoverySecretsDirectory,
    `${assertAssistantSessionId(sessionId)}.json`,
  )
}

function createAssistantSecretSidecarCorruptedError(input: {
  code:
    | 'ASSISTANT_PROVIDER_ROUTE_RECOVERY_SECRETS_CORRUPTED'
    | 'ASSISTANT_SESSION_SECRETS_CORRUPTED'
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
