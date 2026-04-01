import {
  resolveAssistantDaemonClientConfig,
  type AssistantDaemonClientConfig,
} from '@murphai/assistantd/client'
import {
  assistantAskResultSchema,
  assistantCronJobSchema,
  assistantCronRunRecordSchema,
  assistantCronTargetSnapshotSchema,
  assistantOutboxIntentSchema,
  assistantRunResultSchema,
  assistantSessionSchema,
  assistantStatusResultSchema,
  type AssistantAskResult,
  type AssistantCronJob,
  type AssistantCronRunRecord,
  type AssistantCronTargetSnapshot,
  type AssistantOutboxIntent,
  type AssistantRunResult,
  type AssistantSession,
  type AssistantStatusResult,
} from '@murphai/assistant-core/assistant-cli-contracts'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from '@murphai/assistant-core/assistant/service-contracts'
import type { RunAssistantAutomationInput } from './assistant/automation.js'
import type {
  AssistantCronTargetMutationResult,
  AssistantCronProcessDueResult,
  AssistantCronStatusSnapshot,
  SetAssistantCronJobTargetInput,
} from './assistant/cron.js'
import type { AssistantOutboxDispatchMode } from './assistant/outbox.js'
import { normalizeNullableString } from '@murphai/assistant-core/assistant/shared'

export {
  resolveAssistantDaemonClientConfig,
  type AssistantDaemonClientConfig,
} from '@murphai/assistantd/client'

export interface AssistantDaemonOpenConversationResult {
  created: boolean
  session: AssistantSession
}

export type AssistantDaemonAutomationInput = Omit<
  RunAssistantAutomationInput,
  'inboxServices' | 'onEvent' | 'onInboxEvent' | 'signal' | 'vaultServices'
>

export function canUseAssistantDaemonForMessage(
  input: AssistantMessageInput,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return false
  }

  return (
    input.abortSignal === undefined &&
    input.onProviderEvent === undefined &&
    input.onTraceEvent === undefined &&
    input.sessionSnapshot === undefined &&
    input.transcriptSnapshot === undefined
  )
}

export async function maybeSendAssistantMessageViaDaemon(
  input: AssistantMessageInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantAskResult | null> {
  if (!canUseAssistantDaemonForMessage(input, env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/message', {
    env,
    method: 'POST',
    body: serializeAssistantMessageInput(input),
  })
  return assistantAskResultSchema.parse(payload)
}

export async function maybeOpenAssistantConversationViaDaemon(
  input: AssistantSessionResolutionFields,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantDaemonOpenConversationResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/open-conversation', {
    env,
    method: 'POST',
    body: input,
  })
  return parseAssistantDaemonOpenConversationPayload(payload)
}

export async function maybeUpdateAssistantSessionOptionsViaDaemon(
  input: {
    providerOptions: Partial<AssistantSession['providerOptions']>
    sessionId: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantSession | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/session-options', {
    env,
    method: 'POST',
    body: input,
  })
  return assistantSessionSchema.parse(payload)
}

export async function maybeListAssistantOutboxIntentsViaDaemon(
  input: { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantOutboxIntent[] | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/outbox', {
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantOutboxIntentListPayload(payload)
}

export async function maybeGetAssistantOutboxIntentViaDaemon(
  input: {
    intentId: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantOutboxIntent | null | undefined> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return undefined
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/outbox/${encodeURIComponent(input.intentId)}`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantNullableOutboxIntentPayload(payload)
}

export async function maybeGetAssistantStatusViaDaemon(
  input: {
    limit?: number
    sessionId?: string | null
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantStatusResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/status', {
      limit:
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? String(Math.trunc(input.limit))
          : null,
      sessionId: normalizeNullableString(input.sessionId),
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return assistantStatusResultSchema.parse(payload)
}

export async function maybeListAssistantSessionsViaDaemon(
  input: { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantSession[] | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/sessions', {
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantSessionListPayload(payload)
}

export async function maybeGetAssistantSessionViaDaemon(
  input: {
    sessionId: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantSession | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/sessions/${encodeURIComponent(input.sessionId)}`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'GET',
    },
  )
  return assistantSessionSchema.parse(payload)
}

export async function maybeGetAssistantCronStatusViaDaemon(
  input: { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronStatusSnapshot | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/cron/status', {
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantCronStatusPayload(payload)
}

export async function maybeListAssistantCronJobsViaDaemon(
  input: { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronJob[] | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/cron/jobs', {
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantCronJobListPayload(payload)
}

export async function maybeGetAssistantCronJobViaDaemon(
  input: {
    job: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronJob | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/cron/jobs/${encodeURIComponent(input.job)}`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'GET',
    },
  )
  return assistantCronJobSchema.parse(payload)
}

export async function maybeGetAssistantCronTargetViaDaemon(
  input: {
    job: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronTargetSnapshot | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/cron/jobs/${encodeURIComponent(input.job)}/target`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'GET',
    },
  )
  return assistantCronTargetSnapshotSchema.parse(payload)
}

export async function maybeSetAssistantCronTargetViaDaemon(
  input: SetAssistantCronJobTargetInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronTargetMutationResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const body = {
    channel: input.channel ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
    dryRun: input.dryRun ?? false,
    identityId: input.identityId ?? null,
    participantId: input.participantId ?? null,
    sourceThreadId: input.sourceThreadId ?? null,
    vault: input.vault,
  } as {
    channel: string | null
    deliveryTarget: string | null
    dryRun: boolean
    identityId: string | null
    participantId: string | null
    resetContinuity?: boolean
    sourceThreadId: string | null
    vault: string
  }
  if (input.resetContinuity !== undefined) {
    body.resetContinuity = input.resetContinuity
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/cron/jobs/${encodeURIComponent(input.job)}/target`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'POST',
      body,
    },
  )
  return parseAssistantCronTargetMutationPayload(payload)
}

export async function maybeListAssistantCronRunsViaDaemon(
  input: {
    job: string
    limit?: number
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ jobId: string; runs: AssistantCronRunRecord[] } | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/cron/runs', {
      job: input.job,
      limit:
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? String(Math.trunc(input.limit))
          : null,
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantCronRunsPayload(payload)
}

export async function maybeDrainAssistantOutboxViaDaemon(
  input: {
    dependencies?: unknown
    dispatchHooks?: unknown
    limit?: number
    now?: Date
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<
  | {
      attempted: number
      failed: number
      queued: number
      sent: number
    }
  | null
> {
  if (input.dependencies !== undefined || input.dispatchHooks !== undefined) {
    return null
  }
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/outbox/drain', {
    env,
    method: 'POST',
    body: {
      limit:
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? Math.trunc(input.limit)
          : undefined,
      now: input.now?.toISOString(),
      vault: input.vault,
    },
  })
  return parseAssistantOutboxDrainPayload(payload)
}

export async function maybeRunAssistantAutomationViaDaemon(
  input: AssistantDaemonAutomationInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantRunResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/automation/run-once', {
    env,
    method: 'POST',
    body: {
      allowSelfAuthored: input.allowSelfAuthored,
      deliveryDispatchMode: input.deliveryDispatchMode,
      drainOutbox: input.drainOutbox,
      maxPerScan: input.maxPerScan,
      modelSpec: input.modelSpec,
      once: input.once,
      requestId: input.requestId ?? null,
      scanIntervalMs: input.scanIntervalMs,
      sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
      startDaemon: input.startDaemon,
      vault: input.vault,
    },
  })
  return assistantRunResultSchema.parse(payload)
}

export async function maybeProcessDueAssistantCronViaDaemon(
  input: {
    deliveryDispatchMode?: AssistantOutboxDispatchMode
    limit?: number
    signal?: AbortSignal
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronProcessDueResult | null> {
  if (input.signal !== undefined) {
    return null
  }
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/cron/process-due', {
    env,
    method: 'POST',
    body: {
      deliveryDispatchMode: input.deliveryDispatchMode,
      limit:
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? Math.trunc(input.limit)
          : undefined,
      vault: input.vault,
    },
  })
  return parseAssistantCronProcessDuePayload(payload)
}

async function assistantDaemonFetchJson(
  routePath: string,
  input: {
    body?: unknown
    env?: NodeJS.ProcessEnv
    method: 'GET' | 'POST'
  },
): Promise<unknown> {
  const config = resolveAssistantDaemonClientConfig(input.env ?? process.env)
  if (!config) {
    throw new Error('Assistant daemon client is not configured.')
  }

  const headers = new Headers({
    Authorization: `Bearer ${config.token}`,
  })
  if (input.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${routePath}`, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
  } catch (error) {
    throw new Error(
      `Assistant daemon request failed before receiving a response for ${routePath}.`,
      { cause: error },
    )
  }

  const text = await response.text()
  const parsedPayload = parseAssistantDaemonJsonPayload(text)
  if (!response.ok) {
    throw buildAssistantDaemonHttpError(
      parsedPayload.ok ? parsedPayload.value : parseAssistantDaemonTextPayload(text),
      response.status,
    )
  }

  if (!parsedPayload.ok) {
    throw new Error(
      `Assistant daemon returned an invalid JSON response for ${routePath}.`,
      { cause: parsedPayload.error },
    )
  }

  return parsedPayload.value
}

function buildAssistantDaemonHttpError(payload: unknown, status: number): Error {
  const message =
    readAssistantDaemonPayloadStringField(payload, 'error') ??
    (typeof payload === 'string' && payload.length > 0 ? payload : null) ??
    `Assistant daemon request failed with HTTP ${status}.`
  const error = new Error(message) as Error & { code?: string; status?: number }
  const code = readAssistantDaemonPayloadStringField(payload, 'code')
  if (code) {
    error.code = code
  }
  error.status = status
  return error
}

function serializeAssistantMessageInput(
  input: AssistantMessageInput,
): Omit<
  AssistantMessageInput,
  'abortSignal' | 'onProviderEvent' | 'onTraceEvent' | 'sessionSnapshot' | 'transcriptSnapshot'
> {
  const {
    abortSignal: _abortSignal,
    onProviderEvent: _onProviderEvent,
    onTraceEvent: _onTraceEvent,
    sessionSnapshot: _sessionSnapshot,
    transcriptSnapshot: _transcriptSnapshot,
    ...serializableInput
  } = input
  return serializableInput
}

function parseAssistantDaemonOpenConversationPayload(
  payload: unknown,
): AssistantDaemonOpenConversationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid conversation payload.')
  }

  const record = payload as Record<string, unknown>
  if (typeof record.created !== 'boolean') {
    throw new Error('Assistant daemon conversation payload was missing the created flag.')
  }

  return {
    created: record.created,
    session: assistantSessionSchema.parse(record.session),
  }
}

function parseAssistantSessionListPayload(payload: unknown): AssistantSession[] {
  if (!Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid session list payload.')
  }
  return payload.map((entry) => assistantSessionSchema.parse(entry))
}

function parseAssistantOutboxIntentListPayload(
  payload: unknown,
): AssistantOutboxIntent[] {
  if (!Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid outbox intent list payload.')
  }
  return payload.map((entry) => assistantOutboxIntentSchema.parse(entry))
}

function parseAssistantNullableOutboxIntentPayload(
  payload: unknown,
): AssistantOutboxIntent | null {
  if (payload === null) {
    return null
  }
  return assistantOutboxIntentSchema.parse(payload)
}

function parseAssistantOutboxDrainPayload(payload: unknown): {
  attempted: number
  failed: number
  queued: number
  sent: number
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid outbox drain payload.')
  }

  const record = payload as Record<string, unknown>
  return {
    attempted: parseAssistantCountField(record.attempted, 'attempted'),
    failed: parseAssistantCountField(record.failed, 'failed'),
    queued: parseAssistantCountField(record.queued, 'queued'),
    sent: parseAssistantCountField(record.sent, 'sent'),
  }
}

function parseAssistantCronStatusPayload(
  payload: unknown,
): AssistantCronStatusSnapshot {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid cron status payload.')
  }

  const record = payload as Record<string, unknown>
  const nextRunAt = record.nextRunAt
  if (nextRunAt !== null && nextRunAt !== undefined && typeof nextRunAt !== 'string') {
    throw new Error('Assistant daemon payload field nextRunAt was invalid.')
  }

  return {
    dueJobs: parseAssistantCountField(record.dueJobs, 'dueJobs'),
    enabledJobs: parseAssistantCountField(record.enabledJobs, 'enabledJobs'),
    nextRunAt: nextRunAt ?? null,
    runningJobs: parseAssistantCountField(record.runningJobs, 'runningJobs'),
    totalJobs: parseAssistantCountField(record.totalJobs, 'totalJobs'),
  }
}

function parseAssistantCronJobListPayload(
  payload: unknown,
): AssistantCronJob[] {
  if (!Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid cron job list payload.')
  }
  return payload.map((entry) => assistantCronJobSchema.parse(entry))
}

function parseAssistantCronRunsPayload(
  payload: unknown,
): { jobId: string; runs: AssistantCronRunRecord[] } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid cron runs payload.')
  }

  const record = payload as Record<string, unknown>
  if (typeof record.jobId !== 'string' || record.jobId.length === 0) {
    throw new Error('Assistant daemon payload field jobId was invalid.')
  }
  if (!Array.isArray(record.runs)) {
    throw new Error('Assistant daemon payload field runs was invalid.')
  }

  return {
    jobId: record.jobId,
    runs: record.runs.map((entry) => assistantCronRunRecordSchema.parse(entry)),
  }
}

function parseAssistantCronTargetMutationPayload(
  payload: unknown,
): AssistantCronTargetMutationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid cron target payload.')
  }

  const record = payload as Record<string, unknown>
  return {
    job: assistantCronJobSchema.parse(record.job),
    beforeTarget: assistantCronTargetSnapshotSchema.parse(record.beforeTarget),
    afterTarget: assistantCronTargetSnapshotSchema.parse(record.afterTarget),
    changed: parseAssistantBooleanField(record.changed, 'changed'),
    continuityReset: parseAssistantBooleanField(
      record.continuityReset,
      'continuityReset',
    ),
    dryRun: parseAssistantBooleanField(record.dryRun, 'dryRun'),
  }
}

function parseAssistantCronProcessDuePayload(
  payload: unknown,
): AssistantCronProcessDueResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid cron process payload.')
  }

  const record = payload as Record<string, unknown>
  return {
    failed: parseAssistantCountField(record.failed, 'failed'),
    processed: parseAssistantCountField(record.processed, 'processed'),
    succeeded: parseAssistantCountField(record.succeeded, 'succeeded'),
  }
}

function parseAssistantCountField(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Assistant daemon payload field ${field} was invalid.`)
  }
  return value
}

function parseAssistantBooleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Assistant daemon payload field ${field} was invalid.`)
  }
  return value
}

function parseAssistantDaemonJsonPayload(text: string):
  | { ok: true; value: unknown }
  | { error: unknown; ok: false } {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return {
      ok: true,
      value: null,
    }
  }

  try {
    return {
      ok: true,
      value: JSON.parse(trimmed) as unknown,
    }
  } catch (error) {
    return {
      ok: false,
      error,
    }
  }
}

function parseAssistantDaemonTextPayload(text: string): string | null {
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readAssistantDaemonPayloadStringField(
  payload: unknown,
  key: string,
): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function buildAssistantDaemonRoutePath(
  routePath: string,
  query: Record<string, string | null | undefined>,
): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value.length > 0) {
      searchParams.set(key, value)
    }
  }
  const search = searchParams.toString()
  return search ? `${routePath}?${search}` : routePath
}
