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
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  resolveAssistantProviderDefaults,
  type AssistantOperatorDefaults,
} from '@murphai/operator-config/operator-config'
import { quarantineAssistantStateFile } from './quarantine.js'
import { appendAssistantRuntimeEventAtPaths } from './runtime-events.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths, type AssistantStatePaths } from './store/paths.js'
import {
  isAssistantCodexTargetConfig,
  mergeAssistantProviderConfigsForProvider,
  resolveAssistantChatProviderFromConfig,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import { resolveAssistantProviderLabel } from './provider-registry.js'
import {
  isMissingFileError,
  normalizeNullableString,
  writeJsonFileAtomic,
} from './shared.js'

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
  return readAssistantFailoverStateAtPath(paths, paths.failoverStatePath)
}

export async function saveAssistantFailoverState(
  vault: string,
  state: AssistantFailoverState,
): Promise<AssistantFailoverState> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsed = assistantFailoverStateSchema.parse(state)
    await writeAssistantFailoverStateAtPath(paths, parsed)
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
    const state = await readAssistantFailoverStateAtPath(paths, paths.failoverStatePath)
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
    await writeAssistantFailoverStateAtPath(paths, nextState)
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
    const state = await readAssistantFailoverStateAtPath(paths, paths.failoverStatePath)
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
    await writeAssistantFailoverStateAtPath(paths, nextState)
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

  const traits = readAssistantProviderFailoverTraits(input.error)
  if (traits.interrupted) {
    return false
  }
  if (typeof traits.retryable === 'boolean') {
    return traits.retryable
  }
  if (traits.connectionLost) {
    return true
  }
  if (isAssistantProviderTerminalFailure(input.error)) {
    return false
  }

  const code = readErrorCode(input.error)
  if (!code) {
    return true
  }

  return !new Set([
    'ASSISTANT_PROMPT_REQUIRED',
    'ASSISTANT_CODEX_APP_SERVER_FAILED',
    'ASSISTANT_CODEX_APP_SERVER_RPC_FAILED',
    'ASSISTANT_CODEX_APP_SERVER_TIMEOUT',
    'ASSISTANT_CODEX_APPROVAL_POLICY_UNSUPPORTED',
    'ASSISTANT_CODEX_FAILED',
    'ASSISTANT_CODEX_HOME_INVALID',
    'ASSISTANT_CODEX_IMAGE_INVALID',
    'ASSISTANT_CODEX_NOT_FOUND',
    'ASSISTANT_CODEX_RESUME_STALE',
    'invalid_payload',
  ]).has(code)
}

function isAssistantProviderTerminalFailure(error: unknown): boolean {
  const statusCode = readAssistantProviderStatusCode(error)
  if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
    return true
  }

  const normalizedCode = readNormalizedErrorCode(error)
  if (normalizedCode && isAssistantProviderTerminalCode(normalizedCode)) {
    return true
  }

  return looksLikeAssistantProviderTerminalFailureMessage(readErrorMessage(error))
}

function readAssistantProviderFailoverTraits(error: unknown): {
  connectionLost: boolean
  interrupted: boolean
  retryable: boolean | null
} {
  const context =
    error && typeof error === 'object' && 'context' in error
      ? (error as { context?: unknown }).context
      : null
  const normalized =
    context && typeof context === 'object' && !Array.isArray(context)
      ? (context as Record<string, unknown>)
      : null

  return {
    connectionLost:
      normalized?.connectionLost === true ||
      normalized?.recoverableConnectionLoss === true,
    interrupted: normalized?.interrupted === true,
    retryable:
      typeof normalized?.retryable === 'boolean' ? normalized.retryable : null,
  }
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
    codexCommand:
      isAssistantCodexTargetConfig(input.providerConfig)
        ? input.providerConfig.target.codexCommand
        : null,
    provider: resolveAssistantChatProviderFromConfig(input.providerConfig),
    providerOptions,
  })

  return {
    routeId,
    label,
    provider: input.provider,
    providerOptions,
    codexCommand:
      isAssistantCodexTargetConfig(input.providerConfig)
        ? input.providerConfig.target.codexCommand
        : null,
    cooldownMs:
      normalizePositiveInt(input.cooldownMs) ?? DEFAULT_FAILOVER_COOLDOWN_MS,
  }
}

async function readAssistantFailoverStateAtPath(
  paths: AssistantStatePaths,
  failoverStatePath: string,
): Promise<AssistantFailoverState> {
  try {
    const raw = await readFile(failoverStatePath, 'utf8')
    return assistantFailoverStateSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (!isMissingFileError(error)) {
      await quarantineAssistantStateFile({
        artifactKind: 'failover',
        error,
        filePath: failoverStatePath,
        paths,
      }).catch(() => undefined)
    }
  }

  return createEmptyAssistantFailoverState()
}

async function writeAssistantFailoverStateAtPath(
  paths: AssistantStatePaths,
  state: AssistantFailoverState,
): Promise<void> {
  await writeJsonFileAtomic(paths.failoverStatePath, state)
  await appendAssistantRuntimeEventAtPaths(paths, {
    at: state.updatedAt,
    component: 'failover',
    entityId: 'assistant-failover',
    entityType: 'failover-state',
    kind: 'failover.state.upserted',
    level: 'info',
    message: `Assistant failover state was persisted with ${state.routes.length} route(s).`,
    data: {
      routeCount: state.routes.length,
    },
  }).catch(() => undefined)
}

function createEmptyAssistantFailoverState(): AssistantFailoverState {
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
    normalizeNullableString(input.providerConfig.target.model),
    normalizeNullableString(
      isAssistantCodexTargetConfig(input.providerConfig)
        ? input.providerConfig.target.profile
        : null,
    ),
  ].filter((value): value is string => value !== null)

  return parts.join(':') || resolveAssistantChatProviderFromConfig(input.providerConfig)
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
    providerDefaults ? { ...providerDefaults, provider: input.provider } : null,
    input.providerOptions,
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

function readAssistantProviderStatusCode(error: unknown): number | null {
  for (const candidate of [
    error,
    readRecordProperty(error, 'context'),
    readRecordProperty(error, 'cause'),
  ]) {
    const statusCode =
      readNumberProperty(candidate, 'statusCode') ??
      readNumberProperty(candidate, 'status')
    if (statusCode !== null) {
      return statusCode
    }
  }

  return null
}

function readNormalizedErrorCode(error: unknown): string | null {
  return readErrorCode(error)?.trim().toLowerCase() ?? null
}

function isAssistantProviderTerminalCode(code: string): boolean {
  return new Set([
    'authentication_error',
    'configuration_error',
    'forbidden',
    'invalid_api_key',
    'invalid_payload',
    'invalid_request',
    'invalid_request_error',
    'invalid_url',
    'missing_api_key',
    'model_not_found',
    'no_such_model',
    'not_found',
    'permission_denied',
    'resource_not_found',
    'unauthorized',
    'unsupported_model',
  ]).has(code)
}

function looksLikeAssistantProviderTerminalFailureMessage(
  message: string | null,
): boolean {
  const normalized = message?.trim().toLowerCase() ?? ''
  if (!normalized) {
    return false
  }

  return (
    /\binvalid request\b/u.test(normalized) ||
    /\b(?:authentication|unauthorized|forbidden|invalid api key|api key|credentials?)\b/u.test(
      normalized,
    ) ||
    /\b(?:model not found|no such model|unknown model|unsupported model)\b/u.test(
      normalized,
    ) ||
    /\b(?:base url|endpoint|configuration)\b.*\b(?:required|invalid|missing|misconfigured)\b/u.test(
      normalized,
    )
  )
}

function readRecordProperty(
  value: unknown,
  key: 'cause' | 'context',
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || !(key in value)) {
    return null
  }

  const candidate = (value as Record<string, unknown>)[key]
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null
}

function readNumberProperty(
  value: unknown,
  key: 'status' | 'statusCode',
): number | null {
  if (!value || typeof value !== 'object' || !(key in value)) {
    return null
  }

  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function normalizePositiveInt(value: number | null | undefined): number | null {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return null
  }

  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : null
}
