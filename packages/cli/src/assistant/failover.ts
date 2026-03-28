import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  assistantFailoverStateSchema,
  assistantProviderRouteStateSchema,
  type AssistantChatProvider,
  type AssistantFailoverState,
  type AssistantProviderFailoverRoute,
  type AssistantProviderRouteState,
  type AssistantProviderSessionOptions,
} from '../assistant-cli-contracts.js'
import {
  resolveAssistantProviderDefaults,
  type AssistantOperatorDefaults,
} from '../operator-config.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import {
  mergeAssistantProviderConfigsForProvider,
  serializeAssistantProviderSessionOptions,
} from './provider-config.js'
import { resolveAssistantProviderLabel } from './provider-registry.js'
import { isMissingFileError, normalizeNullableString, writeJsonFileAtomic } from './shared.js'

const ASSISTANT_FAILOVER_STATE_SCHEMA = 'murph.assistant-failover-state.v1'
const DEFAULT_FAILOVER_COOLDOWN_MS = 60_000
const RATE_LIMIT_FAILOVER_COOLDOWN_MS = 5 * 60_000

export interface ResolvedAssistantFailoverRoute {
  codexCommand: string | null
  cooldownMs: number
  label: string
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
  routeId: string
}

export async function readAssistantFailoverState(
  vault: string,
): Promise<AssistantFailoverState> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  try {
    const raw = await readFile(paths.failoverStatePath, 'utf8')
    return assistantFailoverStateSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  return assistantFailoverStateSchema.parse({
    schema: ASSISTANT_FAILOVER_STATE_SCHEMA,
    updatedAt: new Date(0).toISOString(),
    routes: [],
  })
}

export async function saveAssistantFailoverState(
  vault: string,
  state: AssistantFailoverState,
): Promise<AssistantFailoverState> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsed = assistantFailoverStateSchema.parse(state)
    await writeJsonFileAtomic(paths.failoverStatePath, parsed)
    return parsed
  })
}

export function buildAssistantFailoverRoutes(input: {
  backups?: readonly AssistantProviderFailoverRoute[] | null
  codexCommand?: string | null
  defaults?: AssistantOperatorDefaults | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
}): ResolvedAssistantFailoverRoute[] {
  const primary = createResolvedAssistantFailoverRoute({
    name: 'primary',
    provider: input.provider,
    providerConfig: resolveAssistantFailoverRouteProviderConfig({
      provider: input.provider,
      providerOptions: input.providerOptions,
      defaults: input.defaults,
      codexCommand: input.codexCommand,
    }),
    cooldownMs: null,
  })
  const backupRoutes = (input.backups ?? []).map((route) =>
    createResolvedAssistantFailoverRoute({
      name: route.name,
      provider: route.provider,
      providerConfig: resolveAssistantFailoverRouteProviderConfig({
        provider: route.provider,
        providerOptions: route,
        defaults: input.defaults,
        codexCommand: route.codexCommand ?? input.codexCommand,
      }),
      cooldownMs: route.cooldownMs,
    }),
  )

  return dedupeAssistantFailoverRoutes([primary, ...backupRoutes])
}

export function isAssistantFailoverRouteCoolingDown(input: {
  now?: Date
  route: ResolvedAssistantFailoverRoute
  state: AssistantFailoverState
}): boolean {
  const routeState = input.state.routes.find((entry) => entry.routeId === input.route.routeId)
  if (!routeState?.cooldownUntil) {
    return false
  }

  const cooldownUntilMs = Date.parse(routeState.cooldownUntil)
  const nowMs = (input.now ?? new Date()).getTime()
  return Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs
}

export function getAssistantFailoverCooldownUntil(input: {
  route: ResolvedAssistantFailoverRoute
  state: AssistantFailoverState
}): string | null {
  return (
    input.state.routes.find((entry) => entry.routeId === input.route.routeId)?.cooldownUntil ??
    null
  )
}

export async function recordAssistantFailoverRouteSuccess(input: {
  at?: string
  route: ResolvedAssistantFailoverRoute
  vault: string
}): Promise<AssistantFailoverState> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const at = input.at ?? new Date().toISOString()
    const state = await readAssistantFailoverStateAtPath(paths.failoverStatePath)
    const routes = upsertAssistantProviderRouteState(
      state.routes,
      {
        routeId: input.route.routeId,
        label: input.route.label,
        provider: input.route.provider,
        model: input.route.providerOptions.model,
        failureCount: 0,
        successCount: 1,
        consecutiveFailures: 0,
        lastFailureAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        cooldownUntil: null,
      },
      'success',
    )

    const nextState = assistantFailoverStateSchema.parse({
      ...state,
      updatedAt: at,
      routes,
    })
    await writeJsonFileAtomic(paths.failoverStatePath, nextState)
    return nextState
  })
}

export async function recordAssistantFailoverRouteFailure(input: {
  at?: string
  cooldownMs?: number | null
  error: unknown
  route: ResolvedAssistantFailoverRoute
  vault: string
}): Promise<AssistantFailoverState> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const at = input.at ?? new Date().toISOString()
    const state = await readAssistantFailoverStateAtPath(paths.failoverStatePath)
    const explicitCooldownMs = normalizePositiveInt(input.cooldownMs)
    const derivedCooldownMs = resolveAssistantFailoverCooldownMs(input.error)
    const cooldownMs =
      explicitCooldownMs ??
      Math.max(input.route.cooldownMs, derivedCooldownMs ?? input.route.cooldownMs)
    const cooldownUntil =
      cooldownMs && cooldownMs > 0
        ? new Date(Date.parse(at) + cooldownMs).toISOString()
        : null
    const routes = upsertAssistantProviderRouteState(
      state.routes,
      {
        routeId: input.route.routeId,
        label: input.route.label,
        provider: input.route.provider,
        model: input.route.providerOptions.model,
        failureCount: 1,
        successCount: 0,
        consecutiveFailures: 1,
        lastFailureAt: at,
        lastErrorCode: readErrorCode(input.error),
        lastErrorMessage: readErrorMessage(input.error),
        cooldownUntil,
      },
      'failure',
    )

    const nextState = assistantFailoverStateSchema.parse({
      ...state,
      updatedAt: at,
      routes,
    })
    await writeJsonFileAtomic(paths.failoverStatePath, nextState)
    return nextState
  })
}

export function shouldAttemptAssistantProviderFailover(input: {
  abortSignal?: AbortSignal
  error: unknown
}): boolean {
  if (input.abortSignal?.aborted) {
    return false
  }

  const code = readErrorCode(input.error)
  if (!code) {
    return true
  }

  return !new Set([
    'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED',
    'ASSISTANT_PROMPT_REQUIRED',
    'invalid_payload',
  ]).has(code)
}

function createResolvedAssistantFailoverRoute(input: {
  cooldownMs: number | null | undefined
  name: string | null | undefined
  provider: AssistantChatProvider
  providerConfig: ReturnType<typeof resolveAssistantFailoverRouteProviderConfig>
}): ResolvedAssistantFailoverRoute {
  const providerOptions = serializeAssistantProviderSessionOptions(input.providerConfig)
  const label = buildAssistantFailoverRouteLabel({
    name: input.name,
    providerConfig: input.providerConfig,
  })
  const routeId = hashAssistantFailoverRoute({
    codexCommand: input.providerConfig.codexCommand,
    provider: input.provider,
    providerOptions,
  })

  return {
    routeId,
    label,
    provider: input.provider,
    providerOptions,
    codexCommand: input.providerConfig.codexCommand,
    cooldownMs:
      normalizePositiveInt(input.cooldownMs) ?? DEFAULT_FAILOVER_COOLDOWN_MS,
  }
}

async function readAssistantFailoverStateAtPath(
  failoverStatePath: string,
): Promise<AssistantFailoverState> {
  try {
    const raw = await readFile(failoverStatePath, 'utf8')
    return assistantFailoverStateSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  return assistantFailoverStateSchema.parse({
    schema: ASSISTANT_FAILOVER_STATE_SCHEMA,
    updatedAt: new Date(0).toISOString(),
    routes: [],
  })
}

function dedupeAssistantFailoverRoutes(
  routes: readonly ResolvedAssistantFailoverRoute[],
): ResolvedAssistantFailoverRoute[] {
  const deduped: ResolvedAssistantFailoverRoute[] = []
  const seen = new Set<string>()

  for (const route of routes) {
    if (seen.has(route.routeId)) {
      continue
    }
    seen.add(route.routeId)
    deduped.push(route)
  }

  return deduped
}

function buildAssistantFailoverRouteLabel(input: {
  name: string | null | undefined
  providerConfig: ReturnType<typeof resolveAssistantFailoverRouteProviderConfig>
}): string {
  const explicitName = normalizeNullableString(input.name)
  const providerLabel = resolveAssistantProviderLabel(input.providerConfig)

  const parts = [
    explicitName,
    providerLabel,
    normalizeNullableString(input.providerConfig.model),
    normalizeNullableString(input.providerConfig.profile),
  ].filter((value): value is string => value !== null)

  return parts.join(':') || input.providerConfig.provider
}

function resolveAssistantFailoverRouteProviderConfig(input: {
  codexCommand?: string | null
  defaults?: AssistantOperatorDefaults | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderFailoverRoute | AssistantProviderSessionOptions
}) {
  const providerDefaults = resolveAssistantProviderDefaults(input.defaults, input.provider)
  return mergeAssistantProviderConfigsForProvider(
    input.provider,
    providerDefaults ? { provider: input.provider, ...providerDefaults } : null,
    { provider: input.provider, ...input.providerOptions },
    input.provider === 'codex-cli'
      ? { provider: input.provider, codexCommand: input.codexCommand }
      : { provider: input.provider },
  )
}

function hashAssistantFailoverRoute(input: {
  codexCommand: string | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        provider: input.provider,
        providerOptions: input.providerOptions,
        codexCommand: input.codexCommand,
      }),
    )
    .digest('hex')
    .slice(0, 16)
}

function resolveAssistantFailoverCooldownMs(error: unknown): number | null {
  const code = readErrorCode(error)
  const message = readErrorMessage(error)?.toLowerCase() ?? ''
  if (
    code?.includes('RATE') ||
    code?.includes('LIMIT') ||
    code?.includes('QUOTA') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('quota')
  ) {
    return RATE_LIMIT_FAILOVER_COOLDOWN_MS
  }

  return null
}

function upsertAssistantProviderRouteState(
  existingRoutes: readonly AssistantProviderRouteState[],
  delta: AssistantProviderRouteState,
  mode: 'failure' | 'success',
): AssistantProviderRouteState[] {
  const routes = [...existingRoutes]
  const index = routes.findIndex((entry) => entry.routeId === delta.routeId)
  if (index < 0) {
    routes.push(
      assistantProviderRouteStateSchema.parse({
        ...delta,
      }),
    )
    return routes
  }

  const current = routes[index]!
  routes[index] = assistantProviderRouteStateSchema.parse({
    ...current,
    label: delta.label,
    provider: delta.provider,
    model: delta.model,
    failureCount:
      mode === 'failure'
        ? current.failureCount + delta.failureCount
        : current.failureCount,
    successCount:
      mode === 'success'
        ? current.successCount + delta.successCount
        : current.successCount,
    consecutiveFailures:
      mode === 'failure' ? current.consecutiveFailures + 1 : 0,
    lastFailureAt: mode === 'failure' ? delta.lastFailureAt : current.lastFailureAt,
    lastErrorCode: mode === 'failure' ? delta.lastErrorCode : null,
    lastErrorMessage: mode === 'failure' ? delta.lastErrorMessage : null,
    cooldownUntil: mode === 'failure' ? delta.cooldownUntil : null,
  })
  return routes
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  return typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return typeof error === 'string' && error.trim().length > 0 ? error : null
}

function normalizePositiveInt(value: number | null | undefined): number | null {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return null
  }

  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : null
}
