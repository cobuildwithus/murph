import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantProviderBindingSchema,
  assistantProviderRouteRecoveryEntrySchema,
  assistantProviderRouteRecoverySchema,
  parseAssistantSessionRecord,
  type AssistantChatProvider,
  type AssistantProviderBinding,
  type AssistantProviderRouteRecovery,
  type AssistantSession,
} from '../assistant-cli-contracts.js'
import { quarantineAssistantStateFile } from './quarantine.js'
import { appendAssistantRuntimeEventAtPaths } from './runtime-events.js'
import {
  normalizeAssistantProviderBinding,
  normalizeAssistantSessionSnapshot,
  readAssistantProviderResumeRouteId,
  writeAssistantProviderResumeRouteId,
  writeAssistantProviderStateResumeWorkspaceKey,
} from './provider-state.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths, type AssistantStatePaths } from './store/paths.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import { resolveAssistantOpaqueStateFilePath } from './state-ids.js'
import {
  extractAssistantProviderRouteRecoverySecretsForPersistence,
  mergeAssistantProviderRouteRecoverySecrets,
  persistAssistantProviderRouteRecoverySecrets,
  readAssistantProviderRouteRecoverySecrets,
  resolveAssistantProviderRouteRecoverySecretsPath,
} from './state-secrets.js'

const ASSISTANT_PROVIDER_ROUTE_RECOVERY_SCHEMA =
  'murph.assistant-provider-route-recovery.v1'

export async function recoverAssistantSessionAfterProviderFailure(input: {
  error: unknown
  provider: AssistantChatProvider
  providerOptions: AssistantSession['providerOptions']
  providerBinding: NonNullable<AssistantSession['providerBinding']>
  routeId: string
  session: AssistantSession
  vault: string
  workspaceKey: string | null
}): Promise<AssistantSession | null> {
  if (!shouldRecoverAssistantSessionAfterProviderFailure(input.error)) {
    return null
  }

  const providerSessionId = extractRecoveredProviderSessionId(input.error)
  const currentProviderBinding = normalizeAssistantProviderBinding(
    input.session.providerBinding,
  )
  if (
    !providerSessionId ||
    (currentProviderBinding?.provider === input.provider &&
      currentProviderBinding.providerSessionId === providerSessionId &&
      readAssistantProviderResumeRouteId({
        providerBinding: currentProviderBinding,
      }) === input.routeId)
  ) {
    return null
  }

  try {
    const recoveredAt = new Date().toISOString()
    const recoveredProviderBinding = buildRecoveredProviderBinding({
      provider: input.provider,
      providerBinding: input.providerBinding,
      providerOptions: input.providerOptions,
      providerSessionId,
      routeId: input.routeId,
      workspaceKey: input.workspaceKey,
    })
    const recoveredSession = normalizeAssistantSessionSnapshot({
      ...input.session,
      providerBinding: recoveredProviderBinding,
      updatedAt: recoveredAt,
    })
    await saveAssistantProviderRouteRecovery({
      at: recoveredAt,
      providerBinding: recoveredProviderBinding,
      routeId: input.routeId,
      sessionId: input.session.sessionId,
      vault: input.vault,
    })
    return recoveredSession
  } catch {
    return null
  }
}

export async function readAssistantProviderRouteRecovery(
  vault: string,
  sessionId: string,
): Promise<AssistantProviderRouteRecovery | null> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  return readAssistantProviderRouteRecoveryAtPath(
    paths,
    resolveAssistantProviderRouteRecoveryPath(paths, sessionId),
  )
}

export function readRecoveredAssistantProviderBindingForRoute(input: {
  provider: AssistantChatProvider
  recovery: AssistantProviderRouteRecovery | null
  routeId: string
  session: AssistantSession
}): AssistantProviderBinding | null {
  const entry =
    input.recovery?.routes.find(
      (route) =>
        route.routeId === input.routeId && route.provider === input.provider,
    ) ?? null
  if (!entry || entry.recoveredAt.localeCompare(input.session.updatedAt) < 0) {
    return null
  }

  return assistantProviderBindingSchema.parse({
    provider: entry.provider,
    providerSessionId: entry.providerSessionId,
    providerOptions: entry.providerOptions,
    providerState: entry.providerState,
  })
}

export async function clearAssistantProviderRouteRecovery(input: {
  sessionId: string
  vault: string
}): Promise<void> {
  await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    await Promise.all([
      rm(resolveAssistantProviderRouteRecoveryPath(paths, input.sessionId), {
        force: true,
      }),
      rm(resolveAssistantProviderRouteRecoverySecretsPath(paths, input.sessionId), {
        force: true,
      }),
    ])
  })
}

export function attachRecoveredAssistantSession(
  error: unknown,
  session: AssistantSession | null,
): void {
  if (!session || !error || typeof error !== 'object') {
    return
  }

  const currentContext = readAssistantProviderErrorContext(error) ?? {}
  ;(error as { context?: Record<string, unknown> }).context = {
    ...currentContext,
    assistantSession: session,
  }
}

export function extractRecoveredAssistantSession(
  error: unknown,
): AssistantSession | null {
  const context = readAssistantProviderErrorContext(error)
  if (!context) {
    return null
  }

  try {
    return normalizeAssistantSessionSnapshot(
      parseAssistantSessionRecord(context.assistantSession),
    )
  } catch {
    return null
  }
}

export function extractRecoveredProviderSessionId(error: unknown): string | null {
  const context = readAssistantProviderErrorContext(error)
  const providerSessionId = context?.providerSessionId
  return (
    typeof providerSessionId === 'string' && providerSessionId.trim().length > 0
      ? providerSessionId.trim()
      : null
  )
}

export function isAssistantProviderConnectionLostError(
  error: unknown,
): boolean {
  const context = readAssistantProviderErrorContext(error)
  return Boolean(
    context &&
      (context.connectionLost === true ||
        context.recoverableConnectionLoss === true),
  )
}

export function isAssistantProviderStalledError(error: unknown): boolean {
  const context = readAssistantProviderErrorContext(error)
  return Boolean(context && context.providerStalled === true)
}

export function isAssistantProviderInterruptedError(error: unknown): boolean {
  const context = readAssistantProviderErrorContext(error)
  return Boolean(context && context.interrupted === true)
}

function shouldRecoverAssistantSessionAfterProviderFailure(
  error: unknown,
): boolean {
  return (
    isAssistantProviderConnectionLostError(error) ||
    isAssistantProviderInterruptedError(error)
  )
}

function buildRecoveredProviderBinding(input: {
  provider: AssistantChatProvider
  providerBinding: NonNullable<AssistantSession['providerBinding']>
  providerOptions: AssistantSession['providerOptions']
  providerSessionId: string
  routeId: string
  workspaceKey: string | null
}): AssistantProviderBinding {
  const seededBinding = assistantProviderBindingSchema.parse({
    ...input.providerBinding,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    providerOptions: input.providerOptions,
    providerState: writeAssistantProviderStateResumeWorkspaceKey(
      input.providerBinding.providerState,
      input.workspaceKey,
    ),
  })

  return (
    writeAssistantProviderResumeRouteId(
      seededBinding,
      input.routeId,
    ) ?? seededBinding
  )
}

async function saveAssistantProviderRouteRecovery(input: {
  at: string
  providerBinding: AssistantProviderBinding
  routeId: string
  sessionId: string
  vault: string
}): Promise<AssistantProviderRouteRecovery> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const recoveryPath = resolveAssistantProviderRouteRecoveryPath(
      paths,
      input.sessionId,
    )
    await ensureAssistantStateDirectory(path.dirname(recoveryPath))
    const existing = await readAssistantProviderRouteRecoveryAtPath(paths, recoveryPath)
    const routes = [
      ...(existing?.routes.filter((route) => route.routeId !== input.routeId) ?? []),
      assistantProviderRouteRecoveryEntrySchema.parse({
        routeId: input.routeId,
        provider: input.providerBinding.provider,
        providerSessionId: input.providerBinding.providerSessionId,
        providerOptions: input.providerBinding.providerOptions,
        providerState: input.providerBinding.providerState ?? null,
        recoveredAt: input.at,
      }),
    ]
    const next = assistantProviderRouteRecoverySchema.parse({
      schema: ASSISTANT_PROVIDER_ROUTE_RECOVERY_SCHEMA,
      sessionId: input.sessionId,
      updatedAt: input.at,
      routes,
    })
    const { persisted, secrets } =
      extractAssistantProviderRouteRecoverySecretsForPersistence(next)
    await persistAssistantProviderRouteRecoverySecrets({
      paths,
      secrets,
      sessionId: input.sessionId,
    })
    await writeJsonFileAtomic(recoveryPath, persisted)
    await appendAssistantRuntimeEventAtPaths(paths, {
      at: input.at,
      component: 'provider-recovery',
      entityId: input.sessionId,
      entityType: 'provider-route-recovery',
      kind: 'provider-route-recovery.upserted',
      level: 'info',
      message: `Assistant provider route recovery was persisted for session ${input.sessionId}.`,
      data: {
        routeId: input.routeId,
      },
    }).catch(() => undefined)
    return (await readAssistantProviderRouteRecoveryAtPath(paths, recoveryPath)) ?? next
  })
}

async function readAssistantProviderRouteRecoveryAtPath(
  paths: AssistantStatePaths,
  filePath: string,
): Promise<AssistantProviderRouteRecovery | null> {
  let recovery: AssistantProviderRouteRecovery

  try {
    const raw = await readFile(filePath, 'utf8')
    recovery = assistantProviderRouteRecoverySchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    await quarantineAssistantStateFile({
      artifactKind: 'provider-route-recovery',
      error,
      filePath,
      paths,
    }).catch(() => undefined)
    return null
  }

  const secrets = await readAssistantProviderRouteRecoverySecrets({
    paths,
    sessionId: recovery.sessionId,
  })
  return mergeAssistantProviderRouteRecoverySecrets(recovery, secrets)
}

function resolveAssistantProviderRouteRecoveryPath(
  paths: ReturnType<typeof resolveAssistantStatePaths>,
  sessionId: string,
): string {
  return resolveAssistantOpaqueStateFilePath({
    directory: paths.providerRouteRecoveryDirectory,
    extension: '.json',
    kind: 'session',
    value: sessionId,
  })
}

function readAssistantProviderErrorContext(
  error: unknown,
): Record<string, unknown> | null {
  if (!error || typeof error !== 'object' || !('context' in error)) {
    return null
  }

  const context = (error as { context?: unknown }).context
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null
  }

  return context as Record<string, unknown>
}
